-- ============================================================
-- 037_ai_xai_provider.sql — add Grok/xAI as an AI assistant provider
--
-- Keeps the app's model simple: one active AI provider per account/client,
-- now allowing OpenAI, Anthropic, or xAI/Grok.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'xai'));
