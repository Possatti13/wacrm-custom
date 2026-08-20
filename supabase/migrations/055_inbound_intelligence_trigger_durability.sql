-- ============================================================
-- Migration 055: Inbound Message -> Intelligence Enqueue Transactional Durability (Phase 7A Final)
--
-- Ensures atomic durability between customer message persistence and
-- intelligence job enqueue in PGMQ within the EXACT SAME database transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_after_customer_message_insert_enqueue_intelligence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, pg_catalog
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  -- Only customer inbound messages generate intelligence extraction eligibility
  IF NEW.sender_type = 'customer' THEN
    SELECT c.account_id INTO v_account_id
    FROM public.conversations c
    WHERE c.id = NEW.conversation_id;

    IF v_account_id IS NOT NULL THEN
      -- Evaluates tenant feature gate and atomically enqueues to PGMQ if enabled
      PERFORM public.enqueue_intelligence_extraction(
        v_account_id,
        NEW.conversation_id,
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_message_enqueue_intelligence ON public.messages;
CREATE TRIGGER trg_customer_message_enqueue_intelligence
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_after_customer_message_insert_enqueue_intelligence();
