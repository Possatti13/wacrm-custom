-- Migration: 087_ask_ciclopes_privacy_sanitization.sql
-- Description: Sanitizes existing manager_ai_turns rows in STAGING to ensure strict separation
--              between ProviderFactPacket (in fact_packet) and PrivateEntityMap (in opaque_entities).
-- Date: 2026-08-30

-- 1. Backfill opaque_entities column from fact_packet.opaque_entities if opaque_entities is empty/null
UPDATE public.manager_ai_turns
SET opaque_entities = (fact_packet->'opaque_entities')::jsonb
WHERE (opaque_entities IS NULL OR opaque_entities = '{}'::jsonb)
  AND (fact_packet ? 'opaque_entities')
  AND (fact_packet->'opaque_entities') IS NOT NULL
  AND (fact_packet->'opaque_entities') != '{}'::jsonb;

-- 2. Strip opaque_entities from fact_packet JSONB across all records
UPDATE public.manager_ai_turns
SET fact_packet = fact_packet - 'opaque_entities'
WHERE fact_packet ? 'opaque_entities';

-- 3. Add comment documenting the privacy contract
COMMENT ON COLUMN public.manager_ai_turns.fact_packet IS 'Canonical ProviderFactPacket sent to LLM synthesis. Contains zero PII (all leads are masked as LEAD_1..LEAD_N).';
COMMENT ON COLUMN public.manager_ai_turns.opaque_entities IS 'PrivateEntityMap (LEAD_1 -> contact resolution). Kept strictly server-side, never sent to external LLMs.';
