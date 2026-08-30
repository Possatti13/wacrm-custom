-- ============================================================
-- Migration 079: Add Google Gemini as Official AI Provider
--
-- Updates check constraints on:
-- 1. tenant_intelligence_settings (provider check)
-- 2. ai_configs (provider check)
-- 3. ai_usage_log (provider check)
-- ============================================================

ALTER TABLE public.tenant_intelligence_settings
  DROP CONSTRAINT IF EXISTS tenant_intelligence_settings_provider_check;

ALTER TABLE public.tenant_intelligence_settings
  ADD CONSTRAINT tenant_intelligence_settings_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'xai', 'mock', 'gemini'));


ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'xai', 'gemini'));


ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'xai', 'mock', 'gemini'));
