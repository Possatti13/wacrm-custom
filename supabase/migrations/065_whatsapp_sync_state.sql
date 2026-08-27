-- ============================================================
-- 065_whatsapp_sync_state.sql
-- WhatsApp Resilient Reconciliation & Recovery State
-- ============================================================
-- Tracks message sync boundaries, cursors, timestamps, and recovery
-- statistics per tenant and provider (WAHA / Meta) to enable resilient
-- startup, reconnect, and scheduled history recovery.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'waha' CHECK (provider IN ('meta', 'waha')),
  session_name TEXT,
  last_sync_started_at TIMESTAMPTZ,
  last_sync_completed_at TIMESTAMPTZ,
  last_sync_cursor TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'error')),
  last_sync_error TEXT,
  sync_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_sync_state_account_provider UNIQUE (account_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sync_state_account ON public.whatsapp_sync_state (account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sync_state_session ON public.whatsapp_sync_state (provider, session_name);

-- RLS: Settings-class, mirroring whatsapp_config
ALTER TABLE public.whatsapp_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sync_state_select ON public.whatsapp_sync_state;
CREATE POLICY whatsapp_sync_state_select ON public.whatsapp_sync_state
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_sync_state_insert ON public.whatsapp_sync_state;
CREATE POLICY whatsapp_sync_state_insert ON public.whatsapp_sync_state
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_sync_state_update ON public.whatsapp_sync_state;
CREATE POLICY whatsapp_sync_state_update ON public.whatsapp_sync_state
  FOR UPDATE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_sync_state_delete ON public.whatsapp_sync_state;
CREATE POLICY whatsapp_sync_state_delete ON public.whatsapp_sync_state
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_sync_state TO authenticated;
GRANT ALL ON public.whatsapp_sync_state TO service_role;
