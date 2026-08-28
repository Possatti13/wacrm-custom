-- ============================================================
-- 066_fix_enqueue_whatsapp_inbound_batch.sql
-- Fix return value assignment for pgmq.send_batch in PL/pgSQL
-- ============================================================
-- pgmq.send_batch returns SETOF bigint. In PL/pgSQL, assigning a
-- set-returning function directly to a bigint[] variable causes
-- PostgreSQL to treat the first scalar row as an array literal string,
-- resulting in: ERROR: malformed array literal: "<msg_id>".
--
-- This migration wraps pgmq.send_batch in ARRAY(SELECT ...) so the
-- set of bigint values is correctly aggregated into bigint[].
-- ============================================================

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_inbound_batch(
  p_messages jsonb[]
) RETURNS bigint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_messages IS NULL OR cardinality(p_messages) = 0 THEN
    RETURN ARRAY[]::bigint[];
  END IF;

  SELECT ARRAY(
    SELECT pgmq.send_batch('whatsapp_inbound', p_messages)
  ) INTO v_ids;

  RETURN COALESCE(v_ids, ARRAY[]::bigint[]);
END;
$$;

-- Enforce strict service_role execution privileges
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_inbound_batch(jsonb[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_inbound_batch(jsonb[]) TO service_role;
