-- ============================================================
-- Migration 054: Tenant Intelligence Settings & Durable Queue (Phase 7A)
--
-- 1. Creates tenant_intelligence_settings table with enabled = false by default.
-- 2. Creates PGMQ queues: intelligence_extraction and intelligence_extraction_dead.
-- 3. Controlled RPCs:
--    - save_tenant_intelligence_settings (admin+)
--    - enqueue_intelligence_extraction (checks enabled flag & enqueues to PGMQ)
--    - read_intelligence_extraction (service_role)
--    - archive_intelligence_extraction (service_role)
--    - set_intelligence_extraction_visibility (service_role)
--    - dead_letter_intelligence_extraction (service_role)
-- ============================================================

-- 1. TENANT INTELLIGENCE SETTINGS
CREATE TABLE IF NOT EXISTS public.tenant_intelligence_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'anthropic', 'xai', 'mock')),
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  extractor_version TEXT NOT NULL DEFAULT 'v1',
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  temperature NUMERIC NOT NULL DEFAULT 0.1 CHECK (temperature >= 0.0 AND temperature <= 2.0),
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms >= 1000 AND timeout_ms <= 120000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tenant_intelligence_settings_account UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_intelligence_settings_lookup
  ON public.tenant_intelligence_settings(account_id);

ALTER TABLE public.tenant_intelligence_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_intelligence_settings_select ON public.tenant_intelligence_settings;
CREATE POLICY tenant_intelligence_settings_select ON public.tenant_intelligence_settings
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 2. PGMQ QUEUES SETUP
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'intelligence_extraction') THEN
    PERFORM pgmq.create('intelligence_extraction');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'intelligence_extraction_dead') THEN
    PERFORM pgmq.create('intelligence_extraction_dead');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      PERFORM pgmq.create('intelligence_extraction');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM pgmq.create('intelligence_extraction_dead');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;


-- 3. TRANSACTIONAL RPC: save_tenant_intelligence_settings
CREATE OR REPLACE FUNCTION public.save_tenant_intelligence_settings(
  p_account_id UUID,
  p_settings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res RECORD;
  v_user_id UUID := auth.uid();
  v_enabled BOOLEAN := COALESCE((p_settings->>'enabled')::boolean, false);
  v_provider TEXT := COALESCE(p_settings->>'provider', 'openai');
  v_model TEXT := COALESCE(p_settings->>'model', 'gpt-4o-mini');
  v_extractor_version TEXT := COALESCE(p_settings->>'extractor_version', 'v1');
  v_prompt_version TEXT := COALESCE(p_settings->>'prompt_version', 'v1');
  v_temp NUMERIC := COALESCE((p_settings->>'temperature')::numeric, 0.1);
  v_timeout INTEGER := COALESCE((p_settings->>'timeout_ms')::integer, 30000);
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  -- Authorization: admin+
  IF v_user_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins or owners can configure intelligence settings' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.tenant_intelligence_settings (
    account_id,
    enabled,
    provider,
    model,
    extractor_version,
    prompt_version,
    temperature,
    timeout_ms,
    created_at,
    updated_at
  ) VALUES (
    p_account_id,
    v_enabled,
    v_provider,
    v_model,
    v_extractor_version,
    v_prompt_version,
    v_temp,
    v_timeout,
    v_now,
    v_now
  )
  ON CONFLICT (account_id)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    extractor_version = EXCLUDED.extractor_version,
    prompt_version = EXCLUDED.prompt_version,
    temperature = EXCLUDED.temperature,
    timeout_ms = EXCLUDED.timeout_ms,
    updated_at = v_now
  RETURNING * INTO v_res;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_res.id,
    'account_id', v_res.account_id,
    'enabled', v_res.enabled,
    'provider', v_res.provider,
    'model', v_res.model,
    'extractor_version', v_res.extractor_version,
    'prompt_version', v_res.prompt_version,
    'temperature', v_res.temperature,
    'timeout_ms', v_res.timeout_ms,
    'updated_at', v_res.updated_at
  );
END;
$$;


-- 4. PURPOSE-SPECIFIC RPC: enqueue_intelligence_extraction (With Feature Gate)
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
  -- 1. Check Tenant Intelligence Feature Gate
  SELECT * INTO v_settings
  FROM public.tenant_intelligence_settings
  WHERE account_id = p_account_id;

  IF NOT FOUND OR NOT v_settings.enabled THEN
    -- Disabled for this tenant: instant no-op, zero overhead
    RETURN jsonb_build_object(
      'enqueued', false,
      'reason', 'intelligence_disabled_for_tenant'
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


-- 5. PGMQ CONSUMER RPCs (service_role only)
CREATE OR REPLACE FUNCTION public.read_intelligence_extraction(
  p_vt integer,
  p_limit integer
) RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.msg_id,
    r.read_ct,
    r.enqueued_at,
    r.vt,
    r.message
  FROM pgmq.read('intelligence_extraction', p_vt, p_limit) r;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_intelligence_extraction_visibility(
  p_msg_id bigint,
  p_vt integer
) RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN pgmq.set_vt('intelligence_extraction', p_msg_id, p_vt);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_intelligence_extraction(
  p_msg_id bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN pgmq.archive('intelligence_extraction', p_msg_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.dead_letter_intelligence_extraction(
  p_msg_id bigint,
  p_message jsonb,
  p_error_info jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
DECLARE
  v_dlq_payload jsonb;
BEGIN
  v_dlq_payload := jsonb_build_object(
    'original_msg_id', p_msg_id,
    'original_envelope', p_message,
    'dead_letter_metadata', p_error_info,
    'moved_to_dlq_at', clock_timestamp()
  );

  PERFORM pgmq.send('intelligence_extraction_dead', v_dlq_payload);
  RETURN pgmq.archive('intelligence_extraction', p_msg_id);
END;
$$;

-- Security Grants: Revoke from public, allow service_role
REVOKE ALL ON FUNCTION public.read_intelligence_extraction(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_intelligence_extraction(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_intelligence_extraction_visibility(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_intelligence_extraction_visibility(bigint, integer) TO service_role;

REVOKE ALL ON FUNCTION public.archive_intelligence_extraction(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_intelligence_extraction(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.dead_letter_intelligence_extraction(bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dead_letter_intelligence_extraction(bigint, jsonb, jsonb) TO service_role;
