-- ============================================================
-- 067_whatsapp_lid_support.sql
-- Support WhatsApp Privacy LID (Local Identifier) Separation
-- ============================================================
-- WhatsApp LIDs (e.g. 25190000009361@lid) are private opaque
-- user identifiers, distinct from public E.164 phone numbers.
--
-- This migration:
-- 1. Makes contacts.phone nullable so contacts created purely
--    from unresolved LIDs do not store fake/truncated phone numbers.
-- 2. Adds whatsapp_lid column and index to contacts.
-- 3. Adds external_chat_id column and index to conversations so
--    replies always target the original WhatsApp chat destination.
-- ============================================================

-- 1. Allow contacts.phone to be nullable
ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;

-- 2. Add whatsapp_lid to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS whatsapp_lid TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_lid 
  ON public.contacts (account_id, whatsapp_lid) 
  WHERE (whatsapp_lid IS NOT NULL AND whatsapp_lid <> '');

-- 3. Add external_chat_id to conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS external_chat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_account_external_chat_id 
  ON public.conversations (account_id, external_chat_id) 
  WHERE (external_chat_id IS NOT NULL AND external_chat_id <> '');
