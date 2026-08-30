-- ============================================================
-- Migration 080: Atomic AI Config & Intelligence Settings Save
--
-- Ensures that:
-- 1. save_tenant_intelligence_settings updates BOTH tenant_intelligence_settings
--    and ai_configs in a single atomic database transaction.
-- 2. If a new encrypted API key is provided, it is stored; otherwise the existing
--    encrypted key is safely preserved without being overwritten.
-- 3. ai_configs.is_active is consistently maintained as (enabled = true AND has_key).
-- 4. ai_configs.provider and model remain in 100% lockstep with tenant settings.
-- ============================================================

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
  v_encrypted_key TEXT := p_settings->>'encrypted_api_key';
  v_now TIMESTAMPTZ := clock_timestamp();
  v_existing_key TEXT;
  v_final_key TEXT;
  v_has_key BOOLEAN;
  v_is_active BOOLEAN;
BEGIN
  -- Authorization: admin+ or service_role
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

  -- 1. Atomic Upsert of tenant_intelligence_settings
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
  ON CONFLICT (account_id) DO UPDATE SET
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

  -- 2. Determine existing API key in ai_configs
  SELECT api_key INTO v_existing_key
  FROM public.ai_configs
  WHERE account_id = p_account_id;

  -- If new non-empty encrypted key passed, use it; otherwise preserve existing key
  IF v_encrypted_key IS NOT NULL AND length(trim(v_encrypted_key)) > 0 THEN
    v_final_key := trim(v_encrypted_key);
  ELSE
    v_final_key := v_existing_key;
  END IF;

  v_has_key := (v_final_key IS NOT NULL AND length(v_final_key) > 0);
  v_is_active := v_enabled AND v_has_key;

  -- 3. Atomic Upsert of ai_configs to maintain 100% consistency with tenant_intelligence_settings
  IF v_final_key IS NOT NULL THEN
    INSERT INTO public.ai_configs (
      account_id,
      provider,
      model,
      is_active,
      api_key,
      updated_at
    ) VALUES (
      p_account_id,
      v_provider,
      v_model,
      v_is_active,
      v_final_key,
      v_now
    )
    ON CONFLICT (account_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      is_active = EXCLUDED.is_active,
      api_key = EXCLUDED.api_key,
      updated_at = v_now;
  END IF;

  RETURN jsonb_build_object(
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
    'has_api_key', v_has_key,
    'is_active', v_is_active,
    'created_at', v_res.created_at,
    'updated_at', v_res.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_tenant_intelligence_settings(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_intelligence_settings(UUID, JSONB) TO authenticated, service_role;
