-- ============================================================
-- Migration 068: WhatsApp Sync State Status Expansion
-- ============================================================
-- Expands last_sync_status check constraint on whatsapp_sync_state
-- to support 'partial' and 'failed' statuses alongside 'idle',
-- 'syncing', 'success', and 'error'.
-- ============================================================

ALTER TABLE public.whatsapp_sync_state DROP CONSTRAINT IF EXISTS whatsapp_sync_state_last_sync_status_check;

ALTER TABLE public.whatsapp_sync_state ADD CONSTRAINT whatsapp_sync_state_last_sync_status_check 
  CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'partial', 'failed', 'error'));
