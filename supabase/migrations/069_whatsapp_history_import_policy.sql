-- ============================================================
-- Migration 069: WhatsApp History Import Policy & Scoped Recovery
-- ============================================================
-- Adds persistent history import mode, started_at, and recovery_not_before
-- to whatsapp_config to enforce strict temporal boundaries and prevent
-- historical pollution during auto-recovery or initial sync.
-- ============================================================

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS history_import_mode TEXT NOT NULL DEFAULT 'now'
    CHECK (history_import_mode IN ('now', '24h', '7d', '30d')),
  ADD COLUMN IF NOT EXISTS history_import_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_not_before TIMESTAMPTZ;

-- Backfill recovery_not_before and history_import_started_at from connected_at or created_at
UPDATE public.whatsapp_config
SET
  history_import_started_at = COALESCE(history_import_started_at, connected_at, created_at, now()),
  recovery_not_before = COALESCE(recovery_not_before, connected_at, created_at, now())
WHERE recovery_not_before IS NULL;
