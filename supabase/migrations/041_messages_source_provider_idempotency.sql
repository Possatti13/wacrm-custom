-- ============================================================
-- Migration 041: Messages Source Provider & Scoped Idempotency
--
-- 1. Adds generic provenance column `source_provider` (TEXT).
-- 2. Replaces previous constraint with composite unique partial
--    index on (conversation_id, source_provider, message_id) to
--    prevent collisions between different providers, tenants, or
--    conversations while guaranteeing atomic deduplication.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS source_provider TEXT;

-- Drop previous index safely
DROP INDEX IF EXISTS uq_messages_conversation_message_id;

-- Create provider-scoped unique index for external messages
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_provider_message_id
  ON messages (conversation_id, source_provider, message_id)
  WHERE message_id IS NOT NULL AND source_provider IS NOT NULL;
