-- ============================================================
-- Migration 064: Internal AI Worker Privilege Closure & Anti-Spoofing Hardening (Phase 16.2)
--
-- 1. Hardens complete_internal_ai_request:
--    - Enforces worker-only least privilege (REVOKE from PUBLIC, anon, authenticated; GRANT to service_role only).
--    - Closes risk of cost fabrication, fake completions, and cache poisoning by authenticated callers.
-- 2. Hardens fail_internal_ai_request:
--    - Enforces worker-only least privilege (REVOKE from PUBLIC, anon, authenticated; GRANT to service_role only).
-- 3. Hardens claim_internal_ai_request:
--    - Prevents requested_by spoofing (authenticated callers can only claim as auth.uid()).
-- ============================================================

-- ------------------------------------------------------------
-- 1. HARDEN claim_internal_ai_request (Anti-Spoofing)
-- ------------------------------------------------------------
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
  v_effective_user_id UUID;
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

    -- Anti-spoofing: Authenticated caller can only request as themselves
    IF p_user_id IS NOT NULL AND p_user_id <> v_caller_id THEN
      RAISE EXCEPTION 'Integrity error: cannot request AI action on behalf of another user'
        USING ERRCODE = '42501';
    END IF;
    v_effective_user_id := v_caller_id;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Service role can specify explicit p_user_id if valid member
    IF p_user_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = p_user_id AND account_id = p_account_id
      ) THEN
        RAISE EXCEPTION 'Integrity error: requested_by user % is not a member of account %', p_user_id, p_account_id
          USING ERRCODE = '23503';
      END IF;
      v_effective_user_id := p_user_id;
    ELSE
      v_effective_user_id := NULL;
    END IF;
  END IF;

  -- 2. Verify Target Integrity
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

  -- 3. Verify Message Boundary Integrity
  IF p_message_boundary_id IS NOT NULL THEN
    SELECT conversation_id INTO v_msg_conv_id FROM public.messages WHERE id = p_message_boundary_id;
    IF v_msg_conv_id IS NULL OR (p_target_id IS NOT NULL AND v_msg_conv_id <> p_target_id) THEN
      RAISE EXCEPTION 'Integrity error: message % does not belong to conversation %', p_message_boundary_id, p_target_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 4. Check Tenant Settings & Gating
  SELECT * INTO v_settings FROM public.tenant_intelligence_settings WHERE account_id = p_account_id;
  IF NOT FOUND OR NOT v_settings.enabled OR v_settings.invocation_mode = 'off' THEN
    RAISE EXCEPTION 'Intelligence features are disabled for account %', p_account_id
      USING ERRCODE = '55000';
  END IF;

  -- 5. Check Daily/Monthly Limits and Budget
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

  -- 6. Check Cache (unless p_force_refresh)
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
        v_effective_user_id,
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

  -- 7. Check Active Lease (double-click concurrency protection < 30s)
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

  -- 8. Create New Running Request Record
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
    v_effective_user_id,
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


-- ------------------------------------------------------------
-- 2. HARDEN complete_internal_ai_request (Worker Only)
-- ------------------------------------------------------------
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
  v_req RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Strict worker-only authorization
  IF current_user NOT IN ('service_role', 'postgres')
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: complete_internal_ai_request is worker-only'
      USING ERRCODE = '42501';
  END IF;

  -- Update internal_ai_requests
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

  -- Record in ai_usage_log
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

-- Worker-only execute permissions
REVOKE ALL ON FUNCTION public.complete_internal_ai_request(UUID, UUID, JSONB, TEXT, INTEGER, INTEGER, INTEGER, NUMERIC, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_internal_ai_request(UUID, UUID, JSONB, TEXT, INTEGER, INTEGER, INTEGER, NUMERIC, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.complete_internal_ai_request(UUID, UUID, JSONB, TEXT, INTEGER, INTEGER, INTEGER, NUMERIC, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_internal_ai_request(UUID, UUID, JSONB, TEXT, INTEGER, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;


-- ------------------------------------------------------------
-- 3. HARDEN fail_internal_ai_request (Worker Only)
-- ------------------------------------------------------------
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
  v_req RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Strict worker-only authorization
  IF current_user NOT IN ('service_role', 'postgres')
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: fail_internal_ai_request is worker-only'
      USING ERRCODE = '42501';
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

-- Worker-only execute permissions
REVOKE ALL ON FUNCTION public.fail_internal_ai_request(UUID, UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_internal_ai_request(UUID, UUID, TEXT, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.fail_internal_ai_request(UUID, UUID, TEXT, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_internal_ai_request(UUID, UUID, TEXT, TEXT, INTEGER) TO service_role;
