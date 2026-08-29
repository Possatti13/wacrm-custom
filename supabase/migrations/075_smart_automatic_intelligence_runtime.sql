-- ============================================================
-- Migration 075: Smart Automatic Commercial Intelligence Runtime (V1.3)
--
-- 1. Adds dirty state columns on conversations for debounced commercial intelligence:
--    - commercial_state_dirty (boolean)
--    - intelligence_eligible_at (timestamptz)
--    - pending_message_count (integer)
--    - intelligence_claimed_at (timestamptz)
-- 2. Creates index for fast sweep of due conversations.
-- 3. Updates conversation_insights check constraint to allow 'buying_signal' and 'loss_signal'.
-- 4. Updates tenant_intelligence_settings invocation_mode to allow 'smart_auto' and 'manual'.
-- 5. Creates trigger trg_flag_conversation_commercial_dirty on messages:
--    - Inbound and outbound customer/agent messages mark conversation as dirty.
--    - Calculates debounce (now() + 15m) or threshold trigger (now() if pending >= 6).
-- 6. Creates trigger on conversations to trigger immediate eligibility on status transitions.
-- 7. Implements sweep_and_enqueue_due_intelligence RPC with FOR UPDATE SKIP LOCKED.
-- 8. Updates persist_conversation_analysis_batch to reset dirty state conditionally.
-- ============================================================

-- 1. CONVERSATIONS DIRTY STATE COLUMNS
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS commercial_state_dirty BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intelligence_eligible_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_message_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intelligence_claimed_at TIMESTAMPTZ;

-- 2. SWEEP INDEX
CREATE INDEX IF NOT EXISTS idx_conversations_intelligence_due
  ON public.conversations (account_id, intelligence_eligible_at)
  WHERE commercial_state_dirty = true;

-- 3. EXPAND INSIGHT_TYPE CHECK CONSTRAINT ON CONVERSATION_INSIGHTS
ALTER TABLE public.conversation_insights
  DROP CONSTRAINT IF EXISTS conversation_insights_insight_type_check;

ALTER TABLE public.conversation_insights
  ADD CONSTRAINT conversation_insights_insight_type_check
  CHECK (insight_type IN (
    'interest',
    'objection',
    'intent',
    'urgency',
    'sentiment',
    'next_action',
    'summary',
    'attribute',
    'buying_signal',
    'loss_signal'
  ));

-- 4. TENANT INTELLIGENCE SETTINGS INVOCATION_MODE CONSTRAINT
ALTER TABLE public.tenant_intelligence_settings
  DROP CONSTRAINT IF EXISTS tenant_intelligence_settings_invocation_mode_check;

ALTER TABLE public.tenant_intelligence_settings
  ADD CONSTRAINT tenant_intelligence_settings_invocation_mode_check
  CHECK (invocation_mode IN ('off', 'on_demand', 'manual', 'automatic', 'smart_auto'));

-- 5. TRIGGER FUNCTION: FLAG CONVERSATION DIRTY ON NEW RELEVANT MESSAGE
CREATE OR REPLACE FUNCTION public.flag_conversation_commercial_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_pending INTEGER;
  v_eligible_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Only process customer or agent messages
  IF NEW.sender_type NOT IN ('customer', 'agent') THEN
    RETURN NEW;
  END IF;

  -- Calculate pending message count and eligibility
  SELECT COALESCE(pending_message_count, 0) + 1 INTO v_new_pending
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF v_new_pending >= 6 THEN
    -- Message threshold reached: eligible immediately
    v_eligible_at := v_now;
  ELSE
    -- Debounce window: eligible after 15 minutes of inactivity
    v_eligible_at := v_now + interval '15 minutes';
  END IF;

  UPDATE public.conversations
  SET
    commercial_state_dirty = true,
    pending_message_count = v_new_pending,
    intelligence_eligible_at = v_eligible_at,
    intelligence_claimed_at = NULL -- Reset any expired claim
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_conversation_commercial_dirty ON public.messages;
CREATE TRIGGER trg_flag_conversation_commercial_dirty
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_conversation_commercial_dirty();

-- 6. TRIGGER ON CONVERSATION STATE TRANSITION (e.g. status closed/pending)
CREATE OR REPLACE FUNCTION public.flag_conversation_transition_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.commercial_state_dirty := true;
    NEW.intelligence_eligible_at := clock_timestamp();
    NEW.intelligence_claimed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_conversation_transition_dirty ON public.conversations;
CREATE TRIGGER trg_flag_conversation_transition_dirty
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_conversation_transition_dirty();

-- 7. SWEEP AND ENQUEUE RPC (Service Role / Scheduler / Admin)
CREATE OR REPLACE FUNCTION public.sweep_and_enqueue_due_intelligence(
  p_batch_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_claim_lease_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::interval;
  v_enqueued_count INTEGER := 0;
  v_conv RECORD;
  v_settings RECORD;
  v_budget_stats RECORD;
  v_payload JSONB;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Only service_role or admin callers can run sweep
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = v_caller_id AND account_role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'Forbidden: only admins or workers can trigger intelligence sweep' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Select eligible conversations with FOR UPDATE SKIP LOCKED
  FOR v_conv IN
    SELECT
      c.id AS conversation_id,
      c.account_id,
      c.pending_message_count,
      c.intelligence_eligible_at
    FROM public.conversations c
    JOIN public.tenant_intelligence_settings s ON s.account_id = c.account_id
    WHERE c.commercial_state_dirty = true
      AND c.intelligence_eligible_at <= v_now
      AND (c.intelligence_claimed_at IS NULL OR c.intelligence_claimed_at < v_now)
      AND s.enabled = true
      AND s.invocation_mode IN ('automatic', 'smart_auto')
    ORDER BY c.intelligence_eligible_at ASC
    LIMIT p_batch_limit
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    -- Verify tenant monthly budget before enqueuing
    SELECT monthly_budget_limit_usd INTO v_settings
    FROM public.tenant_intelligence_settings
    WHERE account_id = v_conv.account_id;

    IF v_settings.monthly_budget_limit_usd IS NOT NULL THEN
      SELECT COALESCE(SUM(estimated_cost), 0) AS total_cost
      INTO v_budget_stats
      FROM public.ai_usage_log
      WHERE account_id = v_conv.account_id
        AND created_at >= date_trunc('month', v_now);

      IF v_budget_stats.total_cost >= v_settings.monthly_budget_limit_usd THEN
        -- Budget exceeded: defer and do not enqueue
        UPDATE public.conversations
        SET intelligence_eligible_at = v_now + interval '1 hour'
        WHERE id = v_conv.conversation_id;
        CONTINUE;
      END IF;
    END IF;

    -- Set claim lease on conversation
    UPDATE public.conversations
    SET intelligence_claimed_at = v_claim_lease_until
    WHERE id = v_conv.conversation_id;

    -- Enqueue to PGMQ intelligence_extraction
    v_payload := jsonb_build_object(
      'accountId', v_conv.account_id,
      'conversationId', v_conv.conversation_id,
      'triggerReason', 'smart_auto_sweep',
      'enqueuedAt', v_now
    );

    PERFORM pgmq.send('intelligence_extraction', v_payload);
    v_enqueued_count := v_enqueued_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'enqueued_count', v_enqueued_count,
    'timestamp', v_now
  );
END;
$$;

-- 8. UPDATE PERSIST_CONVERSATION_ANALYSIS_BATCH TO SAFELY RESET DIRTY STATE
CREATE OR REPLACE FUNCTION public.persist_conversation_analysis_batch(
  p_account_id UUID,
  p_conversation_id UUID,
  p_run_id UUID,
  p_extractor_version TEXT,
  p_insights JSONB,
  p_analyzed_message_ids UUID[],
  p_last_message_id UUID DEFAULT NULL,
  p_last_message_created_at TIMESTAMPTZ DEFAULT NULL,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_total_tokens INTEGER DEFAULT NULL,
  p_latency_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run RECORD;
  v_insight_elem JSONB;
  v_new_insight_id UUID;
  v_insights_count INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_msg_id UUID;
  v_evidence_elem JSONB;
  v_contact_id UUID;
  v_newer_messages_count INTEGER;
BEGIN
  -- 1. Verify Run Identity & State
  SELECT * INTO v_run
  FROM public.conversation_analysis_runs
  WHERE id = p_run_id
    AND account_id = p_account_id
    AND conversation_id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analysis run % not found for conversation %', p_run_id, p_conversation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed', 'run_id', p_run_id, 'insights_count', v_run.insights_count);
  END IF;

  IF v_run.status <> 'processing' AND v_run.status <> 'pending' THEN
    RAISE EXCEPTION 'Run is not in processing or pending state (current: %)', v_run.status USING ERRCODE = '22023';
  END IF;

  SELECT contact_id INTO v_contact_id
  FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id;

  -- 2. Insert Conversation Insights & Evidence
  IF p_insights IS NOT NULL AND jsonb_array_length(p_insights) > 0 THEN
    FOR v_insight_elem IN SELECT * FROM jsonb_array_elements(p_insights)
    LOOP
      INSERT INTO public.conversation_insights (
        account_id,
        conversation_id,
        insight_type,
        value_text,
        value_json,
        catalog_item_id,
        confidence,
        source,
        status,
        analysis_run_id,
        dedupe_key,
        observed_at,
        created_at,
        updated_at
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_insight_elem->>'insight_type',
        v_insight_elem->>'value_text',
        COALESCE(v_insight_elem->'value_json', '{}'::jsonb),
        (v_insight_elem->>'catalog_item_id')::uuid,
        (v_insight_elem->>'confidence')::numeric,
        COALESCE(v_insight_elem->>'source', 'intelligence'),
        'active',
        p_run_id,
        v_insight_elem->>'dedupe_key',
        COALESCE((v_insight_elem->>'observed_at')::timestamptz, p_last_message_created_at, v_now),
        v_now,
        v_now
      )
      ON CONFLICT (account_id, conversation_id, dedupe_key)
      WHERE status = 'active' AND dedupe_key IS NOT NULL
      DO UPDATE SET
        value_text = EXCLUDED.value_text,
        value_json = EXCLUDED.value_json,
        confidence = EXCLUDED.confidence,
        catalog_item_id = EXCLUDED.catalog_item_id,
        analysis_run_id = EXCLUDED.analysis_run_id,
        observed_at = EXCLUDED.observed_at,
        updated_at = v_now
      RETURNING id INTO v_new_insight_id;

      IF v_new_insight_id IS NOT NULL THEN
        v_insights_count := v_insights_count + 1;

        -- Insert Evidence
        IF v_insight_elem->'evidence' IS NOT NULL AND jsonb_array_length(v_insight_elem->'evidence') > 0 THEN
          FOR v_evidence_elem IN SELECT * FROM jsonb_array_elements(v_insight_elem->'evidence')
          LOOP
            INSERT INTO public.conversation_insight_evidence (
              account_id,
              conversation_id,
              insight_id,
              message_id,
              start_offset,
              end_offset,
              snippet,
              created_at
            ) VALUES (
              p_account_id,
              p_conversation_id,
              v_new_insight_id,
              (v_evidence_elem->>'message_id')::uuid,
              (v_evidence_elem->>'start_offset')::integer,
              (v_evidence_elem->>'end_offset')::integer,
              v_evidence_elem->>'snippet',
              v_now
            )
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 3. Record Analyzed Messages
  IF p_analyzed_message_ids IS NOT NULL AND array_length(p_analyzed_message_ids, 1) > 0 THEN
    FOREACH v_msg_id IN ARRAY p_analyzed_message_ids
    LOOP
      INSERT INTO public.conversation_analysis_messages (
        account_id,
        conversation_id,
        message_id,
        extractor_version,
        analysis_run_id,
        analyzed_at
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_msg_id,
        p_extractor_version,
        p_run_id,
        v_now
      )
      ON CONFLICT (conversation_id, message_id, extractor_version) DO NOTHING;
    END LOOP;
  END IF;

  -- 4. Update Conversation Analysis State Checkpoint
  INSERT INTO public.conversation_analysis_state (
    account_id,
    conversation_id,
    extractor_version,
    last_analyzed_message_id,
    last_analyzed_message_created_at,
    last_analysis_run_id,
    last_analyzed_at,
    updated_at
  ) VALUES (
    p_account_id,
    p_conversation_id,
    p_extractor_version,
    p_last_message_id,
    p_last_message_created_at,
    p_run_id,
    v_now,
    v_now
  )
  ON CONFLICT (account_id, conversation_id, extractor_version)
  DO UPDATE SET
    last_analyzed_message_id = COALESCE(EXCLUDED.last_analyzed_message_id, conversation_analysis_state.last_analyzed_message_id),
    last_analyzed_message_created_at = COALESCE(EXCLUDED.last_analyzed_message_created_at, conversation_analysis_state.last_analyzed_message_created_at),
    last_analysis_run_id = EXCLUDED.last_analysis_run_id,
    last_analyzed_at = EXCLUDED.last_analyzed_at,
    updated_at = v_now;

  -- 5. Mark Run as Completed
  UPDATE public.conversation_analysis_runs
  SET
    status = 'completed',
    insights_count = v_insights_count,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    total_tokens = p_total_tokens,
    latency_ms = p_latency_ms,
    completed_at = v_now,
    lease_expires_at = NULL
  WHERE id = p_run_id;

  -- 6. Trigger Commercial State Projection for Contact
  IF v_contact_id IS NOT NULL THEN
    PERFORM public.project_contact_commercial_state(p_account_id, v_contact_id, 'analysis_completed');
  END IF;

  -- 7. Conditionally Reset Conversation Dirty State
  IF p_last_message_created_at IS NOT NULL THEN
    SELECT COUNT(*) INTO v_newer_messages_count
    FROM public.messages
    WHERE conversation_id = p_conversation_id
      AND sender_type IN ('customer', 'agent')
      AND created_at > p_last_message_created_at;

    IF v_newer_messages_count = 0 THEN
      UPDATE public.conversations
      SET
        commercial_state_dirty = false,
        pending_message_count = 0,
        intelligence_claimed_at = NULL,
        intelligence_eligible_at = NULL
      WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations
      SET
        commercial_state_dirty = true,
        pending_message_count = v_newer_messages_count,
        intelligence_claimed_at = NULL,
        intelligence_eligible_at = v_now + interval '15 minutes'
      WHERE id = p_conversation_id;
    END IF;
  ELSE
    UPDATE public.conversations
    SET
      commercial_state_dirty = false,
      pending_message_count = 0,
      intelligence_claimed_at = NULL,
      intelligence_eligible_at = NULL
    WHERE id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'completed',
    'run_id', p_run_id,
    'insights_count', v_insights_count
  );
END;
$$;

-- 9. REVOKE ANONYMOUS ACCESS & GRANT LEAST PRIVILEGE
REVOKE ALL ON FUNCTION public.sweep_and_enqueue_due_intelligence(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_and_enqueue_due_intelligence(INTEGER, INTEGER) TO authenticated, service_role;
