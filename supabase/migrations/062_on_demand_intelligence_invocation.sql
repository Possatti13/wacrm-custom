-- ============================================================
-- Migration 062: Internal On-Demand AI & Invocation Mode Control (Phase 16)
--
-- 1. Adds invocation_mode ('off', 'on_demand', 'automatic') to tenant_intelligence_settings (default 'on_demand').
-- 2. Gates automatic background extraction so incoming messages do NOT trigger LLMs in on_demand mode.
-- 3. Creates internal_ai_requests table for on-demand actions with caching, idempotency, and audit trails.
-- 4. Enhances ai_usage_log with action_type, request_id, cached flag, and estimated_cost.
-- 5. Adds get_tenant_ai_cost_stats RPC for tenant cost observability.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TENANT INTELLIGENCE SETTINGS ENHANCEMENTS
-- ------------------------------------------------------------
ALTER TABLE public.tenant_intelligence_settings
  ADD COLUMN IF NOT EXISTS invocation_mode TEXT NOT NULL DEFAULT 'on_demand'
    CHECK (invocation_mode IN ('off', 'on_demand', 'automatic')),
  ADD COLUMN IF NOT EXISTS max_ai_actions_per_day INTEGER DEFAULT 1000
    CHECK (max_ai_actions_per_day >= 0),
  ADD COLUMN IF NOT EXISTS max_ai_actions_per_month INTEGER DEFAULT 25000
    CHECK (max_ai_actions_per_month >= 0),
  ADD COLUMN IF NOT EXISTS monthly_budget_limit_usd NUMERIC(10,2) DEFAULT NULL;

-- Update save_tenant_intelligence_settings RPC
CREATE OR REPLACE FUNCTION public.save_tenant_intelligence_settings(
  p_account_id UUID,
  p_settings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_res RECORD;
  v_user_id UUID := auth.uid();
  v_enabled BOOLEAN := COALESCE((p_settings->>'enabled')::boolean, false);
  v_invocation_mode TEXT := COALESCE(p_settings->>'invocation_mode', 'on_demand');
  v_provider TEXT := COALESCE(p_settings->>'provider', 'openai');
  v_model TEXT := COALESCE(p_settings->>'model', 'gpt-4o-mini');
  v_extractor_version TEXT := COALESCE(p_settings->>'extractor_version', 'v1');
  v_prompt_version TEXT := COALESCE(p_settings->>'prompt_version', 'v1');
  v_temp NUMERIC := COALESCE((p_settings->>'temperature')::numeric, 0.1);
  v_timeout INTEGER := COALESCE((p_settings->>'timeout_ms')::integer, 30000);
  v_max_day INTEGER := COALESCE((p_settings->>'max_ai_actions_per_day')::integer, 1000);
  v_max_month INTEGER := COALESCE((p_settings->>'max_ai_actions_per_month')::integer, 25000);
  v_budget NUMERIC := (p_settings->>'monthly_budget_limit_usd')::numeric;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Authorization: admin+
  IF v_user_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins or owners can configure intelligence settings' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.tenant_intelligence_settings (
    account_id,
    enabled,
    invocation_mode,
    provider,
    model,
    extractor_version,
    prompt_version,
    temperature,
    timeout_ms,
    max_ai_actions_per_day,
    max_ai_actions_per_month,
    monthly_budget_limit_usd,
    created_at,
    updated_at
  ) VALUES (
    p_account_id,
    v_enabled,
    v_invocation_mode,
    v_provider,
    v_model,
    v_extractor_version,
    v_prompt_version,
    v_temp,
    v_timeout,
    v_max_day,
    v_max_month,
    v_budget,
    v_now,
    v_now
  )
  ON CONFLICT (account_id)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    invocation_mode = EXCLUDED.invocation_mode,
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    extractor_version = EXCLUDED.extractor_version,
    prompt_version = EXCLUDED.prompt_version,
    temperature = EXCLUDED.temperature,
    timeout_ms = EXCLUDED.timeout_ms,
    max_ai_actions_per_day = EXCLUDED.max_ai_actions_per_day,
    max_ai_actions_per_month = EXCLUDED.max_ai_actions_per_month,
    monthly_budget_limit_usd = EXCLUDED.monthly_budget_limit_usd,
    updated_at = v_now
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'id', v_res.id,
    'account_id', v_res.account_id,
    'enabled', v_res.enabled,
    'invocation_mode', v_res.invocation_mode,
    'provider', v_res.provider,
    'model', v_res.model,
    'extractor_version', v_res.extractor_version,
    'prompt_version', v_res.prompt_version,
    'temperature', v_res.temperature,
    'timeout_ms', v_res.timeout_ms,
    'max_ai_actions_per_day', v_res.max_ai_actions_per_day,
    'max_ai_actions_per_month', v_res.max_ai_actions_per_month,
    'monthly_budget_limit_usd', v_res.monthly_budget_limit_usd,
    'updated_at', v_res.updated_at
  );
END;
$$;

-- ------------------------------------------------------------
-- 2. GATED AUTOMATIC INGESTION TRIGGER RPC
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
BEGIN
  -- 1. Check Tenant Intelligence Feature Gate and Invocation Mode
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

  -- 2. Build Standard Job Envelope
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

  -- 3. Enqueue to PGMQ
  v_msg_id := pgmq.send('intelligence_extraction', v_envelope);

  RETURN jsonb_build_object(
    'enqueued', true,
    'pgmq_msg_id', v_msg_id,
    'provider', v_settings.provider,
    'model', v_settings.model
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. INTERNAL AI REQUESTS (On-Demand Actions, Caching & Ledger)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.internal_ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('conversation', 'contact', 'account', 'query')),
  target_id UUID,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cached')),
  input_fingerprint TEXT NOT NULL,
  message_boundary_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  cached_from_request_id UUID REFERENCES public.internal_ai_requests(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  result_json JSONB,
  result_text TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  estimated_cost NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT uq_internal_ai_requests_account_id UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_internal_ai_requests_cache_lookup
  ON public.internal_ai_requests(account_id, target_type, target_id, action_type, input_fingerprint, status);

CREATE INDEX IF NOT EXISTS idx_internal_ai_requests_account_created
  ON public.internal_ai_requests(account_id, created_at DESC);

ALTER TABLE public.internal_ai_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_ai_requests_select ON public.internal_ai_requests;
CREATE POLICY internal_ai_requests_select ON public.internal_ai_requests
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS internal_ai_requests_insert ON public.internal_ai_requests;
CREATE POLICY internal_ai_requests_insert ON public.internal_ai_requests
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS internal_ai_requests_update ON public.internal_ai_requests;
CREATE POLICY internal_ai_requests_update ON public.internal_ai_requests
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 4. AI USAGE LOG ENHANCEMENTS
-- ------------------------------------------------------------
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check,
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
    CHECK (mode IN ('auto_reply', 'draft', 'internal_on_demand', 'automatic')),
  ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'xai', 'mock'));

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cached BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_account_created
  ON public.ai_usage_log(account_id, created_at DESC);

-- ------------------------------------------------------------
-- 5. OBSERVABILITY RPC: get_tenant_ai_cost_stats
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_ai_cost_stats(
  p_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_stats RECORD;
  v_month_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  IF NOT public.is_account_member(p_account_id, 'viewer') THEN
    RAISE EXCEPTION 'Access denied: viewer role required for account %', p_account_id
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COUNT(*) AS total_requests,
    COUNT(*) FILTER (WHERE cached = true) AS cached_requests,
    COUNT(*) FILTER (WHERE cached = false) AS provider_calls,
    COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
    COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(estimated_cost), 0) AS total_estimated_cost
  INTO v_stats
  FROM public.ai_usage_log
  WHERE account_id = p_account_id
    AND created_at >= v_month_start;

  RETURN jsonb_build_object(
    'account_id', p_account_id,
    'month_start', v_month_start,
    'total_requests', v_stats.total_requests,
    'cached_requests', v_stats.cached_requests,
    'provider_calls', v_stats.provider_calls,
    'total_prompt_tokens', v_stats.total_prompt_tokens,
    'total_completion_tokens', v_stats.total_completion_tokens,
    'total_tokens', v_stats.total_tokens,
    'total_estimated_cost', v_stats.total_estimated_cost
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. PRIVILEGE & GRANT HARDENING
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_tenant_ai_cost_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tenant_ai_cost_stats(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_ai_cost_stats(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.enqueue_intelligence_extraction(UUID, UUID, UUID) TO authenticated, service_role;

GRANT ALL ON public.internal_ai_requests TO service_role;
GRANT ALL ON public.tenant_intelligence_settings TO service_role;
GRANT ALL ON public.ai_usage_log TO service_role;
