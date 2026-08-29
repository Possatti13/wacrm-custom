-- ============================================================
-- Migration 078: Intelligence Security & Runtime Hardening
--
-- 1. P0 Sweep Security: Revoke public/authenticated execution of global sweep; enforce backend-only caller.
-- 2. P0 Taxonomy Bootstrap Security: Revoke public/authenticated execution of ensure_tenant_default_objection_taxonomy;
--    provide authenticated admin-scoped initialize_tenant_objection_taxonomy.
-- 3. Eliminate Legacy Per-Message Trigger: Drop trg_customer_message_enqueue_intelligence from messages.
-- 4. Invocation Mode Hardening: Migrate 'automatic' -> 'smart_auto' and enforce canonical modes.
-- 5. Manager-Only Objection Taxonomy Override: Restrict override_objection_taxonomy to admin/owner.
-- ============================================================

-- 1. P0 SWEEP SECURITY (BACKEND-ONLY)
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

  -- Strict Backend-Only Authorization: Global sweep can NEVER be invoked by end users
  IF v_caller_id IS NOT NULL OR (current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized: global intelligence sweep is backend-only' USING ERRCODE = '42501';
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
      AND s.invocation_mode = 'smart_auto'
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

REVOKE ALL ON FUNCTION public.sweep_and_enqueue_due_intelligence(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_and_enqueue_due_intelligence(INTEGER, INTEGER) TO service_role, postgres;


-- 2. P0 TAXONOMY BOOTSTRAP SECURITY
REVOKE ALL ON FUNCTION public.ensure_tenant_default_objection_taxonomy(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_tenant_default_objection_taxonomy(UUID) TO service_role, postgres;

-- Guarded Admin wrapper for manual/setup initialization
CREATE OR REPLACE FUNCTION public.initialize_tenant_objection_taxonomy(p_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only owner/admin can initialize tenant objection taxonomy' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM public.ensure_tenant_default_objection_taxonomy(p_account_id);
  RETURN jsonb_build_object('success', true, 'account_id', p_account_id);
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_tenant_objection_taxonomy(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_tenant_objection_taxonomy(UUID) TO authenticated, service_role, postgres;


-- 3. ELIMINATE LEGACY PER-MESSAGE TRIGGER
DROP TRIGGER IF EXISTS trg_customer_message_enqueue_intelligence ON public.messages;
DROP FUNCTION IF EXISTS public.trg_after_customer_message_insert_enqueue_intelligence();


-- 4. INVOCATION MODE HARDENING (MIGRATE 'automatic' -> 'smart_auto')
UPDATE public.tenant_intelligence_settings
SET invocation_mode = 'smart_auto'
WHERE invocation_mode = 'automatic';

ALTER TABLE public.tenant_intelligence_settings
  DROP CONSTRAINT IF EXISTS tenant_intelligence_settings_invocation_mode_check;

ALTER TABLE public.tenant_intelligence_settings
  ADD CONSTRAINT tenant_intelligence_settings_invocation_mode_check
  CHECK (invocation_mode IN ('off', 'on_demand', 'manual', 'smart_auto'));

ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'internal_on_demand', 'automatic', 'smart_auto'));


-- 5. MANAGER-ONLY OBJECTION TAXONOMY OVERRIDE
CREATE OR REPLACE FUNCTION public.override_objection_taxonomy(
  p_account_id UUID,
  p_occurrence_id UUID,
  p_new_taxonomy_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_occ RECORD;
  v_tax RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization: ONLY owner/admin or service_role can override taxonomy
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only owner/admin can override objection taxonomy' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify Taxonomy Belongs to Same Account
  SELECT * INTO v_tax
  FROM public.tenant_objection_taxonomy
  WHERE id = p_new_taxonomy_id AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Taxonomy category % not found in account %', p_new_taxonomy_id, p_account_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock & Update Occurrence
  SELECT * INTO v_occ
  FROM public.conversation_objection_occurrences
  WHERE id = p_occurrence_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objection occurrence % not found in account %', p_occurrence_id, p_account_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.conversation_objection_occurrences
  SET
    effective_taxonomy_id = p_new_taxonomy_id,
    override_by_user_id = v_caller_id,
    override_at = v_now,
    override_reason = p_reason,
    updated_at = v_now
  WHERE id = p_occurrence_id AND account_id = p_account_id;

  -- 4. Update Current Contact Objection Taxonomy Reference
  UPDATE public.contact_objections
  SET
    taxonomy_id = p_new_taxonomy_id,
    updated_at = v_now
  WHERE account_id = p_account_id
    AND contact_id = v_occ.contact_id
    AND normalized_objection = lower(trim(v_occ.raw_objection));

  -- 5. Recalculate Lead Score
  PERFORM public.calculate_and_persist_contact_score(p_account_id, v_occ.contact_id, 'taxonomy_override');

  RETURN jsonb_build_object(
    'success', true,
    'occurrence_id', p_occurrence_id,
    'original_taxonomy_id', v_occ.original_taxonomy_id,
    'effective_taxonomy_id', p_new_taxonomy_id,
    'override_by_user_id', v_caller_id,
    'override_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.override_objection_taxonomy(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_objection_taxonomy(UUID, UUID, UUID, TEXT) TO authenticated, service_role, postgres;
