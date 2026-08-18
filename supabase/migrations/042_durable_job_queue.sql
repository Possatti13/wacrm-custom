-- ============================================================
-- Migration 042: Durable WhatsApp Job Queue (PGMQ)
--
-- Sets up PostgreSQL Message Queue (PGMQ) for WhatsApp inbound
-- processing with purpose-specific internal RPCs restricted
-- exclusively to service_role.
-- ============================================================

-- 1. Enable pgmq extension if available
CREATE EXTENSION IF NOT EXISTS pgmq;

-- 2. Create durable logged queues
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'whatsapp_inbound') THEN
    PERFORM pgmq.create('whatsapp_inbound');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'whatsapp_inbound_dead') THEN
    PERFORM pgmq.create('whatsapp_inbound_dead');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Resilient fallback if pgmq.meta is created differently
    BEGIN
      PERFORM pgmq.create('whatsapp_inbound');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM pgmq.create('whatsapp_inbound_dead');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;

-- 3. Purpose-specific RPC: enqueue_whatsapp_inbound_batch
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
  IF p_messages IS NULL OR array_length(p_messages, 1) = 0 THEN
    RETURN ARRAY[]::bigint[];
  END IF;

  v_ids := pgmq.send_batch('whatsapp_inbound', p_messages);
  RETURN v_ids;
END;
$$;

-- 4. Purpose-specific RPC: read_whatsapp_inbound
CREATE OR REPLACE FUNCTION public.read_whatsapp_inbound(
  p_vt integer,
  p_limit integer
) RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.msg_id,
    r.read_ct,
    r.enqueued_at,
    r.vt,
    r.message
  FROM pgmq.read('whatsapp_inbound', p_vt, p_limit) r;
END;
$$;

-- 5. Purpose-specific RPC: set_whatsapp_inbound_visibility
CREATE OR REPLACE FUNCTION public.set_whatsapp_inbound_visibility(
  p_msg_id bigint,
  p_vt integer
) RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN pgmq.set_vt('whatsapp_inbound', p_msg_id, p_vt);
END;
$$;

-- 6. Purpose-specific RPC: archive_whatsapp_inbound
CREATE OR REPLACE FUNCTION public.archive_whatsapp_inbound(
  p_msg_id bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
BEGIN
  RETURN pgmq.archive('whatsapp_inbound', p_msg_id);
END;
$$;

-- 7. Purpose-specific RPC: dead_letter_whatsapp_inbound
-- Atomically copies envelope + error metadata to DLQ and archives the original job.
CREATE OR REPLACE FUNCTION public.dead_letter_whatsapp_inbound(
  p_msg_id bigint,
  p_message jsonb,
  p_error_info jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
DECLARE
  v_dlq_payload jsonb;
BEGIN
  v_dlq_payload := jsonb_build_object(
    'original_msg_id', p_msg_id,
    'original_envelope', p_message,
    'dead_letter_metadata', p_error_info,
    'moved_to_dlq_at', clock_timestamp()
  );

  -- 1. Enqueue to DLQ
  PERFORM pgmq.send('whatsapp_inbound_dead', v_dlq_payload);

  -- 2. Archive original job in the same transaction
  RETURN pgmq.archive('whatsapp_inbound', p_msg_id);
END;
$$;

-- 8. Strict Security Hardening: Revoke from all public roles, Grant only to service_role
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_inbound_batch(jsonb[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_inbound_batch(jsonb[]) TO service_role;

REVOKE ALL ON FUNCTION public.read_whatsapp_inbound(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_whatsapp_inbound(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_whatsapp_inbound_visibility(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_inbound_visibility(bigint, integer) TO service_role;

REVOKE ALL ON FUNCTION public.archive_whatsapp_inbound(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_whatsapp_inbound(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.dead_letter_whatsapp_inbound(bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dead_letter_whatsapp_inbound(bigint, jsonb, jsonb) TO service_role;
