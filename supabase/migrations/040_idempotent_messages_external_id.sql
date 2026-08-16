-- ============================================================
-- Migration 040: Atomic Idempotency for Messages External ID
--
-- Guarantees that within a single conversation (and tenant), the
-- same provider external message ID (message_id) cannot be inserted
-- more than once, even under high concurrency or webhook replays.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_message_id
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL;
