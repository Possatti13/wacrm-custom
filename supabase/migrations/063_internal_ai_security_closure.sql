-- ============================================================
-- Migration 063: Internal AI Security Closure & Least Privilege Hardening (Phase 16.1)
--
-- 1. Hardens enqueue_intelligence_extraction:
--    - Enforces least privilege (REVOKE from PUBLIC, anon, authenticated; GRANT to service_role only).
--    - Adds defense-in-depth conversation and trigger message integrity checks.
-- 2. Hardens internal_ai_requests:
--    - Adds composite FK on (account_id, cached_from_request_id) to eliminate cross-tenant caching at database level.
--    - Revokes direct INSERT/UPDATE/DELETE/TRUNCATE from authenticated users.
-- 3. Hardens ai_usage_log & tenant_intelligence_settings:
--    - Revokes direct write privileges from authenticated users; enforces mutation via authorized RPCs only.
-- 4. Canonical Lifecycle RPCs:
--    - claim_internal_ai_request
--    - complete_internal_ai_request
--    - fail_internal_ai_request
-- ============================================================

-- ------------------------------------------------------------
-- 1. HARDEN enqueue_intelligence_extraction
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_intelligence_extraction(
  p_account_id UUID,
  p_conversation_id UUID,
  p_trigger_message_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
DECLARE
  v_settings RECORD;
  v_envelope JSONB;
  v_msg_id BIGINT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_conv_account_id UUID;
  v_msg_conv_id UUID;
BEGIN
  -- 1. Defend in Depth: Verify conversation exists and belongs to p_account_id
  SELECT account_id INTO v_conv_account_id
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_conv_account_id IS NULL OR v_conv_account_id <> p_account_id THEN
    RAISE EXCEPTION 'Integrity error: conversation % does not belong to account %', p_conversation_id, p_account_id
      USING ERRCODE = '23503';
  END IF;

  -- 2. Defend in Depth: When p_trigger_message_id is provided, verify it belongs to p_conversation_id
  IF p_trigger_message_id IS NOT NULL THEN
    SELECT conversation_id INTO v_msg_conv_id
    FROM public.messages
    WHERE id = p_trigger_message_id;

    IF v_msg_conv_id IS NULL OR v_msg_conv_id <> p_conversation_id THEN
      RAISE EXCEPTION 'Integrity error: message % does not belong to conversation %', p_trigger_message_id, p_conversation_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 3. Check Tenant Intelligence Feature Gate and Invocation Mode
  SELECT * INTO v_settings
  FROM public.tenant_intelligence_settings
  WHERE account_id = p_account_id;

  -- Gating: automatic extraction runs ONLY when enabled AND mode = 'automatic'
  IF NOT FOUND OR NOT v_settings.enabled OR v_settings.invocation_mode <> 'automatic' THEN
    RETURN jsonb_build_object(
      'enqueued', false,
      'reason', CASE
        WHEN NOT FOUND OR NOT v_settings.enabled THEN 'intelligence_disabled_for_tenant'
        ELSE 'invocation_mode_not_automatic'
      END
    );
  END IF;

  -- 4. Build Standard Job Envelope
  v_envelope := jsonb_build_object(
    'version', 1,
    'jobId', 'intel-' || p_conversation_id::text || '-' || extract(epoch from v_now)::text,
    'type', 'intelligence.extract_conversation',
    'accountId', p_account_id,
    'createdAt', v_now,
    'payload', jsonb_build_object(
      'accountId', p_account_id,
      'conversationId', p_conversation_id,
      'triggerMessageId', p_trigger_message_id,
      'extractorVersion', v_settings.extractor_version,
      'promptVersion', v_settings.prompt_version,
      'provider', v_settings.provider,
      'model', v_settings.model
    )
  );

  -- 5. Enqueue to PGMQ
  v_msg_id := pgmq.send('intelligence_extraction', v_envelope);

  RETURN jsonb_build_object(
    'enqueued', true,
    'pgmq_msg_id', v_msg_id,
    'provider', v_settings.provider,
    'model', v_settings.model
  );
END;
$$;

-- Revoke execute from public/anon/authenticated and grant ONLY to service_role
REVOKE ALL ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) TO service_role;


-- ------------------------------------------------------------
-- 2. HARDEN internal_ai_requests
-- ------------------------------------------------------------
-- Ensure composite FK on cached_from_request_id for tenant isolation
ALTER TABLE public.internal_ai_requests
  DROP CONSTRAINT IF EXISTS internal_ai_requests_cached_from_request_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_internal_ai_requests_cached_from;

ALTER TABLE public.internal_ai_requests
  ADD CONSTRAINT fk_internal_ai_requests_cached_from
    FOREIGN KEY (account_id, cached_from_request_id)
    REFERENCES public.internal_ai_requests(account_id, id)
    ON DELETE SET NULL;

-- Remove write privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON public.internal_ai_requests FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.internal_ai_requests FROM authenticated;
GRANT SELECT ON public.internal_ai_requests TO authenticated;
GRANT ALL ON public.internal_ai_requests TO service_role;

-- Clean up direct write RLS policies
DROP POLICY IF EXISTS internal_ai_requests_insert ON public.internal_ai_requests;
DROP POLICY IF EXISTS internal_ai_requests_update ON public.internal_ai_requests;
DROP POLICY IF EXISTS internal_ai_requests_delete ON public.internal_ai_requests;

DROP POLICY IF EXISTS internal_ai_requests_select ON public.internal_ai_requests;
CREATE POLICY internal_ai_requests_select ON public.internal_ai_requests
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- ------------------------------------------------------------
-- 3. HARDEN ai_usage_log & tenant_intelligence_settings
-- ------------------------------------------------------------
-- ai_usage_log privileges & RLS
REVOKE ALL ON public.ai_usage_log FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_usage_log FROM authenticated;
GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;

DROP POLICY IF EXISTS ai_usage_log_insert ON public.ai_usage_log;
DROP POLICY IF EXISTS ai_usage_log_update ON public.ai_usage_log;
DROP POLICY IF EXISTS ai_usage_log_delete ON public.ai_usage_log;

DROP POLICY IF EXISTS ai_usage_log_select ON public.ai_usage_log;
CREATE POLICY ai_usage_log_select ON public.ai_usage_log
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- tenant_intelligence_settings privileges & RLS
REVOKE ALL ON public.tenant_intelligence_settings FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenant_intelligence_settings FROM authenticated;
GRANT SELECT ON public.tenant_intelligence_settings TO authenticated;
GRANT ALL ON public.tenant_intelligence_settings TO service_role;

DROP POLICY IF EXISTS tenant_intelligence_settings_insert ON public.tenant_intelligence_settings;
DROP POLICY IF EXISTS tenant_intelligence_settings_update ON public.tenant_intelligence_settings;
DROP POLICY IF EXISTS tenant_intelligence_settings_delete ON public.tenant_intelligence_settings;

DROP POLICY IF EXISTS tenant_intelligence_settings_select ON public.tenant_intelligence_settings;
CREATE POLICY tenant_intelligence_settings_select ON public.tenant_intelligence_settings
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- ------------------------------------------------------------
-- 4. CANONICAL LIFECYCLE RPCS FOR INTERNAL AI REQUESTS
-- ------------------------------------------------------------

-- A. claim_internal_ai_request
CREATE OR REPLACE FUNCTION public.claim_internal_ai_request(
  p_account_id UUID,
  p_user_id UUID,
  p_target_type TEXT,
  p_target_id UUID,
  p_action_type TEXT,
  p_input_fingerprint TEXT,
  p_message_boundary_id UUID DEFAULT NULL,
  p_message_count INTEGER DEFAULT 0,
  p_force_refresh BOOLEAN DEFAULT false,
  p_query_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_settings RECORD;
  v_cached RECORD;
  v_running RECORD;
  v_target_account_id UUID;
  v_msg_conv_id UUID;
  v_new_req RECORD;
  v_today_count INTEGER;
  v_month_count INTEGER;
  v_month_cost NUMERIC;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Authorization: caller must have 'agent' role in p_account_id
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify p_user_id (if provided) belongs to p_account_id
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = p_user_id AND account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Integrity error: requested_by user % is not a member of account %', p_user_id, p_account_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 3. Verify Target Integrity
  IF p_target_type = 'conversation' AND p_target_id IS NOT NULL THEN
    SELECT account_id INTO v_target_account_id FROM public.conversations WHERE id = p_target_id;
    IF v_target_account_id IS NULL OR v_target_account_id <> p_account_id THEN
      RAISE EXCEPTION 'Integrity error: conversation % does not belong to account %', p_target_id, p_account_id
        USING ERRCODE = '23503';
    END IF;
  ELSIF p_target_type = 'contact' AND p_target_id IS NOT NULL THEN
    SELECT account_id INTO v_target_account_id FROM public.contacts WHERE id = p_target_id;
    IF v_target_account_id IS NULL OR v_target_account_id <> p_account_id THEN
      RAISE EXCEPTION 'Integrity error: contact % does not belong to account %', p_target_id, p_account_id
        USING ERRCODE = '23503';
    END IF;
  ELSIF p_target_type = 'account' AND p_target_id IS NOT NULL THEN
    IF p_target_id <> p_account_id THEN
      RAISE EXCEPTION 'Integrity error: target account % does not match caller account %', p_target_id, p_account_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 4. Verify Message Boundary Integrity
  IF p_message_boundary_id IS NOT NULL THEN
    SELECT conversation_id INTO v_msg_conv_id FROM public.messages WHERE id = p_message_boundary_id;
    IF v_msg_conv_id IS NULL OR (p_target_id IS NOT NULL AND v_msg_conv_id <> p_target_id) THEN
      RAISE EXCEPTION 'Integrity error: message % does not belong to conversation %', p_message_boundary_id, p_target_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 5. Check Tenant Settings & Gating
  SELECT * INTO v_settings FROM public.tenant_intelligence_settings WHERE account_id = p_account_id;
  IF NOT FOUND OR NOT v_settings.enabled OR v_settings.invocation_mode = 'off' THEN
    RAISE EXCEPTION 'Intelligence features are disabled for account %', p_account_id
      USING ERRCODE = '55000';
  END IF;

  -- 6. Check Daily/Monthly Limits and Budget
  IF v_settings.max_ai_actions_per_day > 0 THEN
    SELECT COUNT(*) INTO v_today_count
    FROM public.internal_ai_requests
    WHERE account_id = p_account_id
      AND created_at >= date_trunc('day', v_now);

    IF v_today_count >= v_settings.max_ai_actions_per_day THEN
      RAISE EXCEPTION 'Daily AI action quota exceeded (% / %)', v_today_count, v_settings.max_ai_actions_per_day
        USING ERRCODE = '55001';
    END IF;
  END IF;

  IF v_settings.max_ai_actions_per_month > 0 THEN
    SELECT COUNT(*) INTO v_month_count
    FROM public.internal_ai_requests
    WHERE account_id = p_account_id
      AND created_at >= date_trunc('month', v_now);

    IF v_month_count >= v_settings.max_ai_actions_per_month THEN
      RAISE EXCEPTION 'Monthly AI action quota exceeded (% / %)', v_month_count, v_settings.max_ai_actions_per_month
        USING ERRCODE = '55001';
    END IF;
  END IF;

  IF v_settings.monthly_budget_limit_usd IS NOT NULL AND v_settings.monthly_budget_limit_usd > 0 THEN
    SELECT COALESCE(SUM(estimated_cost), 0) INTO v_month_cost
    FROM public.ai_usage_log
    WHERE account_id = p_account_id
      AND created_at >= date_trunc('month', v_now);

    IF v_month_cost >= v_settings.monthly_budget_limit_usd THEN
      RAISE EXCEPTION 'Monthly AI budget limit exceeded ($% / $%)', v_month_cost, v_settings.monthly_budget_limit_usd
        USING ERRCODE = '55002';
    END IF;
  END IF;

  -- 7. Check Cache (unless p_force_refresh)
  IF NOT p_force_refresh THEN
    SELECT * INTO v_cached
    FROM public.internal_ai_requests
    WHERE account_id = p_account_id
      AND target_type = p_target_type
      AND target_id IS NOT DISTINCT FROM p_target_id
      AND action_type = p_action_type
      AND input_fingerprint = p_input_fingerprint
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      -- Record cached usage entry
      INSERT INTO public.ai_usage_log (
        account_id,
        conversation_id,
        mode,
        action_type,
        request_id,
        requested_by_user_id,
        provider,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cached,
        estimated_cost,
        created_at
      ) VALUES (
        p_account_id,
        CASE WHEN p_target_type = 'conversation' THEN p_target_id ELSE NULL END,
        'internal_on_demand',
        p_action_type,
        v_cached.id,
        p_user_id,
        v_settings.provider,
        v_settings.model,
        0, 0, 0,
        true,
        0,
        v_now
      );

      RETURN jsonb_build_object(
        'status', 'cached',
        'cached', true,
        'request', row_to_json(v_cached)
      );
    END IF;
  END IF;

  -- 8. Check Active Lease (double-click concurrency protection < 30s)
  SELECT * INTO v_running
  FROM public.internal_ai_requests
  WHERE account_id = p_account_id
    AND target_type = p_target_type
    AND target_id IS NOT DISTINCT FROM p_target_id
    AND action_type = p_action_type
    AND input_fingerprint = p_input_fingerprint
    AND status = 'running'
    AND created_at >= (v_now - interval '30 seconds')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'running_lease',
      'cached', false,
      'request', row_to_json(v_running)
    );
  END IF;

  -- 9. Create New Running Request Record
  INSERT INTO public.internal_ai_requests (
    account_id,
    requested_by_user_id,
    target_type,
    target_id,
    action_type,
    status,
    input_fingerprint,
    message_boundary_id,
    message_count,
    provider,
    model,
    created_at,
    updated_at
  ) VALUES (
    p_account_id,
    p_user_id,
    p_target_type,
    p_target_id,
    p_action_type,
    'running',
    p_input_fingerprint,
    p_message_boundary_id,
    p_message_count,
    v_settings.provider,
    v_settings.model,
    v_now,
    v_now
  )
  RETURNING * INTO v_new_req;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'cached', false,
    'request', row_to_json(v_new_req),
    'provider', v_settings.provider,
    'model', v_settings.model,
    'temperature', v_settings.temperature,
    'timeout_ms', v_settings.timeout_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_internal_ai_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_internal_ai_request TO authenticated, service_role;


-- B. complete_internal_ai_request
CREATE OR REPLACE FUNCTION public.complete_internal_ai_request(
  p_account_id UUID,
  p_request_id UUID,
  p_result_json JSONB,
  p_result_text TEXT,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_total_tokens INTEGER,
  p_estimated_cost NUMERIC,
  p_latency_ms INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_req RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Authorization
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Update internal_ai_requests
  UPDATE public.internal_ai_requests
  SET
    status = 'completed',
    result_json = p_result_json,
    result_text = p_result_text,
    input_tokens = GREATEST(p_input_tokens, 0),
    output_tokens = GREATEST(p_output_tokens, 0),
    total_tokens = GREATEST(p_total_tokens, 0),
    estimated_cost = GREATEST(p_estimated_cost, 0),
    latency_ms = GREATEST(p_latency_ms, 0),
    completed_at = v_now,
    updated_at = v_now
  WHERE id = p_request_id
    AND account_id = p_account_id
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found for account %', p_request_id, p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Record in ai_usage_log
  INSERT INTO public.ai_usage_log (
    account_id,
    conversation_id,
    mode,
    action_type,
    request_id,
    requested_by_user_id,
    provider,
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cached,
    estimated_cost,
    created_at
  ) VALUES (
    p_account_id,
    CASE WHEN v_req.target_type = 'conversation' THEN v_req.target_id ELSE NULL END,
    'internal_on_demand',
    v_req.action_type,
    v_req.id,
    v_req.requested_by_user_id,
    v_req.provider,
    v_req.model,
    GREATEST(p_input_tokens, 0),
    GREATEST(p_output_tokens, 0),
    GREATEST(p_total_tokens, 0),
    false,
    GREATEST(p_estimated_cost, 0),
    v_now
  );

  RETURN row_to_json(v_req);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_internal_ai_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_internal_ai_request TO authenticated, service_role;


-- C. fail_internal_ai_request
CREATE OR REPLACE FUNCTION public.fail_internal_ai_request(
  p_account_id UUID,
  p_request_id UUID,
  p_error_code TEXT,
  p_error_message TEXT,
  p_latency_ms INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_req RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Access denied: agent role required for account %', p_account_id
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.internal_ai_requests
  SET
    status = 'failed',
    error_code = p_error_code,
    error_message = p_error_message,
    latency_ms = GREATEST(p_latency_ms, 0),
    updated_at = v_now
  WHERE id = p_request_id
    AND account_id = p_account_id
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found for account %', p_request_id, p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN row_to_json(v_req);
END;
$$;

REVOKE ALL ON FUNCTION public.fail_internal_ai_request FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_internal_ai_request TO authenticated, service_role;
