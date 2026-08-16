-- ============================================================
-- WAHA provider support
-- ============================================================
-- Adds a non-official WhatsApp provider option without removing the
-- existing Meta Cloud API integration. Meta rows keep provider='meta'.
-- WAHA rows store the WAHA API key encrypted in access_token and keep
-- the session/base URL in dedicated columns.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'waha'));

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS waha_base_url TEXT,
  ADD COLUMN IF NOT EXISTS waha_session_name TEXT;

-- Meta needs phone_number_id and access_token. WAHA has its own session
-- identity; allow these legacy Meta columns to be NULL for WAHA rows.
ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

-- One WAHA session per account on this CRM instance. Partial unique
-- indexes allow NULLs and keep existing Meta constraints untouched.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_waha_session_unique
  ON whatsapp_config (waha_session_name)
  WHERE provider = 'waha' AND waha_session_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_provider
  ON whatsapp_config (provider);
