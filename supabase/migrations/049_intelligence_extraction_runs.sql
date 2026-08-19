-- ============================================================
-- Migration 049: Intelligence Extraction Engine (Phase 5A)
--
-- 1. analysis_catalog_contexts (immutable catalog snapshots for reproducibility).
-- 2. Enhance conversation_analysis_runs:
--    - Composite FK to tenant_config_revisions (ON DELETE RESTRICT).
--    - Composite FK to analysis_catalog_contexts (ON DELETE RESTRICT).
--    - input_fingerprint with active/completed uniqueness.
--    - lease_expires_at & processing_started_at for durable claim recovery.
--    - Observability metrics (input_tokens, output_tokens, total_tokens, latency_ms).
-- 3. Controlled RPCs:
--    - get_or_create_tenant_catalog_context
--    - claim_conversation_analysis_run
--    - persist_conversation_analysis_batch
--    - fail_conversation_analysis_run
-- ============================================================

-- 1. ANALYSIS_CATALOG_CONTEXTS
CREATE TABLE IF NOT EXISTS public.analysis_catalog_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  context_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_analysis_catalog_contexts_account_id_id
    UNIQUE (account_id, id),
  CONSTRAINT uq_analysis_catalog_contexts_account_hash
    UNIQUE (account_id, context_hash)
);

CREATE INDEX IF NOT EXISTS idx_analysis_catalog_contexts_lookup
  ON public.analysis_catalog_contexts(account_id, context_hash);

ALTER TABLE public.analysis_catalog_contexts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analysis_catalog_contexts_select ON public.analysis_catalog_contexts;
CREATE POLICY analysis_catalog_contexts_select ON public.analysis_catalog_contexts
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- Processing ledger is server-only (no direct client mutations)


-- 2. ENHANCE CONVERSATION_ANALYSIS_RUNS
ALTER TABLE public.conversation_analysis_runs
  ADD COLUMN IF NOT EXISTS commercial_config_revision_id UUID,
  ADD COLUMN IF NOT EXISTS commercial_config_revision_number INTEGER,
  ADD COLUMN IF NOT EXISTS commercial_config_snapshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS analysis_catalog_context_id UUID,
  ADD COLUMN IF NOT EXISTS catalog_context_hash TEXT,
  ADD COLUMN IF NOT EXISTS input_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0);

-- Composite Foreign Keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversation_analysis_runs_config_rev'
  ) THEN
    ALTER TABLE public.conversation_analysis_runs
      ADD CONSTRAINT fk_conversation_analysis_runs_config_rev
      FOREIGN KEY (account_id, commercial_config_revision_id)
      REFERENCES public.tenant_config_revisions(account_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversation_analysis_runs_catalog_context'
  ) THEN
    ALTER TABLE public.conversation_analysis_runs
      ADD CONSTRAINT fk_conversation_analysis_runs_catalog_context
      FOREIGN KEY (account_id, analysis_catalog_context_id)
      REFERENCES public.analysis_catalog_contexts(account_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Input fingerprint uniqueness for completed runs to prevent duplicate work
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_analysis_runs_completed_fingerprint
  ON public.conversation_analysis_runs (account_id, conversation_id, input_fingerprint)
  WHERE input_fingerprint IS NOT NULL AND status = 'completed';

CREATE INDEX IF NOT EXISTS idx_conversation_analysis_runs_lease
  ON public.conversation_analysis_runs (conversation_id, status, lease_expires_at);


-- 3. INTERNAL HELPER: GET OR CREATE CATALOG CONTEXT
CREATE OR REPLACE FUNCTION public.get_or_create_tenant_catalog_context(
  p_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot JSONB;
  v_hash TEXT;
  v_id UUID;
BEGIN
  -- 1. Build sorted active catalog snapshot
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'type', item.type,
        'sku', item.sku,
        'terms', COALESCE(
          (
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'term', t.term,
                'normalized_term', t.normalized_term,
                'kind', t.kind
              ) ORDER BY t.kind ASC, t.normalized_term ASC
            )
            FROM public.catalog_item_terms t
            WHERE t.account_id = p_account_id AND t.catalog_item_id = item.id
          ),
          '[]'::jsonb
        )
      ) ORDER BY item.type ASC, item.name ASC
    ),
    '[]'::jsonb
  ) INTO v_snapshot
  FROM public.catalog_items item
  WHERE item.account_id = p_account_id AND item.status = 'active';

  -- 2. Deterministic SHA-256 hash
  v_hash := pg_catalog.encode(pg_catalog.sha256(v_snapshot::text::bytea), 'hex');

  -- 3. Upsert into analysis_catalog_contexts
  INSERT INTO public.analysis_catalog_contexts (
    account_id,
    schema_version,
    context_hash,
    snapshot
  ) VALUES (
    p_account_id,
    1,
    v_hash,
    v_snapshot
  )
  ON CONFLICT (account_id, context_hash) DO UPDATE
  SET schema_version = 1
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object(
    'catalog_context_id', v_id,
    'context_hash', v_hash,
    'snapshot', v_snapshot
  );
END;
$$;


-- 4. CLAIM ANALYSIS RUN (DURABLE CLAIM IN SHORT TRANSACTION)
CREATE OR REPLACE FUNCTION public.claim_conversation_analysis_run(
  p_account_id UUID,
  p_conversation_id UUID,
  p_extractor_version TEXT,
  p_prompt_version TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_batch_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version TEXT := COALESCE(NULLIF(pg_catalog.btrim(p_extractor_version), ''), 'v1');
  v_prompt_ver TEXT := COALESCE(NULLIF(pg_catalog.btrim(p_prompt_version), ''), 'v1');
  v_limit INTEGER := COALESCE(p_batch_limit, 25);
  v_lease_secs INTEGER := COALESCE(p_lease_seconds, 300);

  v_active_run RECORD;
  v_config_rev RECORD;
  v_cat_res JSONB;
  v_cat_id UUID;
  v_cat_hash TEXT;
  v_cat_snapshot JSONB;

  v_messages_record RECORD;
  v_msg_ids UUID[];
  v_first_msg RECORD;
  v_last_msg RECORD;
  v_messages_json JSONB;
  v_messages_count INTEGER;

  v_sorted_ids_str TEXT;
  v_fingerprint TEXT;
  v_completed_run RECORD;
  v_new_run_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  -- 1. Authorization: service_role or admin
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Short transactional lock per conversation + extractor version
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('claim_analysis:' || p_account_id::text || ':' || p_conversation_id::text || ':' || v_version)
  );

  -- 3. Check for currently active processing run
  SELECT * INTO v_active_run
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND extractor_version = v_version
    AND status = 'processing'
    AND lease_expires_at > v_now
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_processing',
      'run_id', v_active_run.id,
      'lease_expires_at', v_active_run.lease_expires_at
    );
  END IF;

  -- 4. Expire any stale/crashed processing runs
  UPDATE public.conversation_analysis_runs
  SET status = 'failed',
      error_code = 'lease_expired',
      error_message = 'Previous worker lease expired without completion',
      completed_at = v_now
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND extractor_version = v_version
    AND status = 'processing'
    AND lease_expires_at <= v_now;

  -- 5. Query unanalyzed messages for this conversation + extractor version
  WITH unanalyzed AS (
    SELECT m.id, m.sender_type, m.content_text, m.created_at
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_analysis_messages cam
        WHERE cam.conversation_id = m.conversation_id
          AND cam.message_id = m.id
          AND cam.extractor_version = v_version
      )
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT v_limit
  )
  SELECT
    pg_catalog.array_agg(id ORDER BY created_at ASC, id ASC) AS msg_ids,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', id,
        'sender_type', sender_type,
        'content_text', content_text,
        'created_at', created_at
      ) ORDER BY created_at ASC, id ASC
    ) AS msgs_json,
    pg_catalog.count(*)::integer AS msg_count
  INTO v_messages_record
  FROM unanalyzed;

  v_msg_ids := v_messages_record.msg_ids;
  v_messages_count := COALESCE(v_messages_record.msg_count, 0);

  IF v_messages_count = 0 OR v_msg_ids IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'no_messages',
      'messages_count', 0
    );
  END IF;

  -- 6. Pin latest commercial config revision (Zero-config created if none exists)
  SELECT * INTO v_config_rev
  FROM public.tenant_config_revisions
  WHERE account_id = p_account_id
  ORDER BY revision_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Generate real initial zero-config revision 1
    PERFORM public.generate_tenant_config_snapshot_internal(
      p_account_id,
      'Initial zero-config revision',
      NULL
    );

    SELECT * INTO v_config_rev
    FROM public.tenant_config_revisions
    WHERE account_id = p_account_id
    ORDER BY revision_number DESC
    LIMIT 1;
  END IF;

  -- 7. Pin catalog context
  v_cat_res := public.get_or_create_tenant_catalog_context(p_account_id);
  v_cat_id := (v_cat_res->>'catalog_context_id')::uuid;
  v_cat_hash := v_cat_res->>'context_hash';
  v_cat_snapshot := v_cat_res->'snapshot';

  -- 8. Compute deterministic input_fingerprint
  v_sorted_ids_str := pg_catalog.array_to_string(v_msg_ids, ',');
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(
      (p_account_id::text || '#' ||
       p_conversation_id::text || '#' ||
       v_version || '#' ||
       v_prompt_ver || '#' ||
       v_config_rev.id::text || '#' ||
       v_cat_id::text || '#' ||
       v_sorted_ids_str)::bytea
    ),
    'hex'
  );

  -- 9. Check if already completed with this exact fingerprint
  SELECT * INTO v_completed_run
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND input_fingerprint = v_fingerprint
    AND status = 'completed'
  LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_completed',
      'run_id', v_completed_run.id,
      'input_fingerprint', v_fingerprint
    );
  END IF;

  -- First & Last message references for cursors
  SELECT created_at, id INTO v_first_msg FROM public.messages WHERE id = v_msg_ids[1];
  SELECT created_at, id INTO v_last_msg FROM public.messages WHERE id = v_msg_ids[v_messages_count];

  -- 10. Insert new processing run
  INSERT INTO public.conversation_analysis_runs (
    account_id,
    conversation_id,
    status,
    extractor_version,
    prompt_version,
    provider,
    model,
    commercial_config_revision_id,
    commercial_config_revision_number,
    commercial_config_snapshot_hash,
    analysis_catalog_context_id,
    catalog_context_hash,
    input_fingerprint,
    from_cursor_timestamp,
    from_cursor_message_id,
    to_cursor_timestamp,
    to_cursor_message_id,
    messages_count,
    processing_started_at,
    lease_expires_at,
    created_at
  ) VALUES (
    p_account_id,
    p_conversation_id,
    'processing',
    v_version,
    v_prompt_ver,
    p_provider,
    p_model,
    v_config_rev.id,
    v_config_rev.revision_number,
    v_config_rev.snapshot_hash,
    v_cat_id,
    v_cat_hash,
    v_fingerprint,
    v_first_msg.created_at,
    v_first_msg.id,
    v_last_msg.created_at,
    v_last_msg.id,
    v_messages_count,
    v_now,
    v_now + (v_lease_secs || ' seconds')::interval,
    v_now
  ) RETURNING id INTO v_new_run_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'run_id', v_new_run_id,
    'account_id', p_account_id,
    'conversation_id', p_conversation_id,
    'extractor_version', v_version,
    'prompt_version', v_prompt_ver,
    'input_fingerprint', v_fingerprint,
    'lease_expires_at', v_now + (v_lease_secs || ' seconds')::interval,
    'config_revision', pg_catalog.jsonb_build_object(
      'id', v_config_rev.id,
      'revision_number', v_config_rev.revision_number,
      'snapshot_hash', v_config_rev.snapshot_hash,
      'snapshot', v_config_rev.snapshot
    ),
    'catalog_context', pg_catalog.jsonb_build_object(
      'id', v_cat_id,
      'context_hash', v_cat_hash,
      'snapshot', v_cat_snapshot
    ),
    'messages', v_messages_record.msgs_json,
    'analyzed_message_ids', v_msg_ids,
    'first_message', pg_catalog.jsonb_build_object('id', v_first_msg.id, 'created_at', v_first_msg.created_at),
    'last_message', pg_catalog.jsonb_build_object('id', v_last_msg.id, 'created_at', v_last_msg.created_at)
  );
END;
$$;


-- 5. PERSIST CONVERSATION ANALYSIS BATCH (ATOMIC SHORT FINALIZATION TRANSACTION)
CREATE OR REPLACE FUNCTION public.persist_conversation_analysis_batch(
  p_account_id UUID,
  p_conversation_id UUID,
  p_run_id UUID,
  p_extractor_version TEXT,
  p_insights JSONB,                 -- Array of { insight_type, value_text, value_json, catalog_item_id, confidence, source, dedupe_key, evidence: [...] }
  p_analyzed_message_ids UUID[],
  p_last_message_id UUID,
  p_last_message_created_at TIMESTAMPTZ,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_total_tokens INTEGER DEFAULT NULL,
  p_latency_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version TEXT := COALESCE(NULLIF(pg_catalog.btrim(p_extractor_version), ''), 'v1');
  v_run RECORD;
  v_ins JSONB;
  v_ev JSONB;
  v_new_insight_id UUID;
  v_insights_count INTEGER := 0;
  v_msg_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock run for update
  SELECT * INTO v_run
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analysis run not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: if already completed, return success
  IF v_run.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_completed',
      'run_id', p_run_id,
      'insights_count', v_run.insights_count
    );
  END IF;

  IF v_run.status <> 'processing' THEN
    RAISE EXCEPTION 'Run is in invalid status % (expected processing)', v_run.status
      USING ERRCODE = '22000';
  END IF;

  -- 3. Insert Insights & Evidences
  IF p_insights IS NOT NULL AND pg_catalog.jsonb_array_length(p_insights) > 0 THEN
    FOR v_ins IN SELECT * FROM pg_catalog.jsonb_array_elements(p_insights)
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
        observed_at
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_ins->>'insight_type',
        v_ins->>'value_text',
        COALESCE(v_ins->'value_json', '{}'::jsonb),
        NULLIF(v_ins->>'catalog_item_id', '')::uuid,
        (v_ins->>'confidence')::numeric,
        COALESCE(v_ins->>'source', 'intelligence'),
        'active',
        p_run_id,
        v_ins->>'dedupe_key',
        COALESCE((v_ins->>'observed_at')::timestamptz, v_now)
      )
      ON CONFLICT (account_id, conversation_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'active'
      DO UPDATE SET updated_at = v_now
      RETURNING id INTO v_new_insight_id;

      v_insights_count := v_insights_count + 1;

      -- Insert evidence
      IF v_ins->'evidence' IS NOT NULL AND pg_catalog.jsonb_array_length(v_ins->'evidence') > 0 THEN
        FOR v_ev IN SELECT * FROM pg_catalog.jsonb_array_elements(v_ins->'evidence')
        LOOP
          INSERT INTO public.conversation_insight_evidence (
            account_id,
            conversation_id,
            insight_id,
            message_id,
            start_offset,
            end_offset,
            snippet
          ) VALUES (
            p_account_id,
            p_conversation_id,
            v_new_insight_id,
            (v_ev->>'message_id')::uuid,
            (v_ev->>'start_offset')::integer,
            (v_ev->>'end_offset')::integer,
            v_ev->>'snippet'
          )
          ON CONFLICT (account_id, insight_id, message_id, COALESCE(start_offset, -1), COALESCE(end_offset, -1))
          DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- 4. Mark Analyzed Messages in Ledger
  IF p_analyzed_message_ids IS NOT NULL AND pg_catalog.array_length(p_analyzed_message_ids, 1) > 0 THEN
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
        v_version,
        p_run_id,
        v_now
      )
      ON CONFLICT (conversation_id, message_id, extractor_version)
      DO UPDATE SET analysis_run_id = p_run_id, analyzed_at = v_now;
    END LOOP;
  END IF;

  -- 5. Update Conversation Analysis State Checkpoint
  IF p_last_message_id IS NOT NULL THEN
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
      v_version,
      p_last_message_id,
      p_last_message_created_at,
      p_run_id,
      v_now,
      v_now
    )
    ON CONFLICT (conversation_id, extractor_version)
    DO UPDATE SET
      last_analyzed_message_id = EXCLUDED.last_analyzed_message_id,
      last_analyzed_message_created_at = EXCLUDED.last_analyzed_message_created_at,
      last_analysis_run_id = EXCLUDED.last_analysis_run_id,
      last_analyzed_at = v_now,
      updated_at = v_now;
  END IF;

  -- 6. Mark Run Completed
  UPDATE public.conversation_analysis_runs
  SET status = 'completed',
      insights_count = v_insights_count,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      latency_ms = p_latency_ms,
      completed_at = v_now
  WHERE id = p_run_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'completed',
    'run_id', p_run_id,
    'insights_count', v_insights_count
  );
END;
$$;


-- 6. FAIL ANALYSIS RUN RPC
CREATE OR REPLACE FUNCTION public.fail_conversation_analysis_run(
  p_account_id UUID,
  p_conversation_id UUID,
  p_run_id UUID,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run RECORD;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.conversation_analysis_runs
  SET status = 'failed',
      error_code = pg_catalog.substr(p_error_code, 1, 64),
      error_message = pg_catalog.substr(p_error_message, 1, 500),
      completed_at = pg_catalog.now()
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND id = p_run_id
    AND status = 'processing';

  RETURN pg_catalog.jsonb_build_object(
    'status', 'failed',
    'run_id', p_run_id
  );
END;
$$;
