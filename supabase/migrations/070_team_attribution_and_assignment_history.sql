-- ============================================================
-- Migration 070: Team Attribution, Assignment History & Operational Metrics (V1.1)
--
-- 1. Adds FK and index on messages(sender_id) to link outbound CRM messages to auth.users.
-- 2. Adds operational metrics columns on conversations:
--    - first_customer_message_at
--    - first_response_at
--    - first_response_duration_seconds
--    - last_customer_message_at
--    - last_agent_message_at
--    - unattended_since
-- 3. Adds seller_conversation_visibility on accounts ('all', 'assigned_and_unassigned', 'assigned_only').
-- 4. Creates conversation_assignment_history audit table with multi-tenant RLS.
-- 5. Implements trigger on messages to maintain conversation metrics deterministically.
-- 6. Implements assign_conversation_atomic RPC with optimistic concurrency protection.
-- 7. Deterministic backfill of operational metrics for existing conversations.
-- ============================================================

-- 1. MESSAGES SENDER_ID FK & INDEX
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_sender_user'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT fk_messages_sender_user
      FOREIGN KEY (sender_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON public.messages(sender_id)
  WHERE sender_id IS NOT NULL;

-- 2. CONVERSATIONS OPERATIONAL METRICS COLUMNS
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS first_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_agent_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unattended_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_unattended
  ON public.conversations(account_id, unattended_since)
  WHERE unattended_since IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_first_response
  ON public.conversations(account_id, first_response_duration_seconds)
  WHERE first_response_duration_seconds IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent
  ON public.conversations(account_id, assigned_agent_id);

-- 3. ACCOUNTS SELLER VISIBILITY CONFIGURATION
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS seller_conversation_visibility TEXT NOT NULL DEFAULT 'all'
  CHECK (seller_conversation_visibility IN ('all', 'assigned_and_unassigned', 'assigned_only'));

-- 4. CONVERSATION ASSIGNMENT HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.conversation_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,

  assigned_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  event_type TEXT NOT NULL CHECK (
    event_type IN ('assigned', 'reassigned', 'unassigned', 'claimed', 'transferred')
  ),
  reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_cah_conversation_same_account
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cah_account_conversation
  ON public.conversation_assignment_history(account_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cah_account_to_user
  ON public.conversation_assignment_history(account_id, to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cah_account_event_date
  ON public.conversation_assignment_history(account_id, event_type, created_at DESC);

-- Enable RLS
ALTER TABLE public.conversation_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cah_select ON public.conversation_assignment_history;
CREATE POLICY cah_select ON public.conversation_assignment_history
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS cah_insert ON public.conversation_assignment_history;
CREATE POLICY cah_insert ON public.conversation_assignment_history
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- No UPDATE or DELETE policies: audit ledger is strictly immutable for all users

-- 5. DETERMINISTIC TRIGGER FOR OPERATIONAL MESSAGE METRICS
CREATE OR REPLACE FUNCTION public.update_conversation_message_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
BEGIN
  -- Read current state of the conversation
  SELECT id, account_id, first_customer_message_at, first_response_at,
         last_customer_message_at, last_agent_message_at, unattended_since
  INTO v_conv
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type = 'customer' THEN
    UPDATE public.conversations
    SET
      last_customer_message_at = NEW.created_at,
      first_customer_message_at = COALESCE(v_conv.first_customer_message_at, NEW.created_at),
      unattended_since = CASE
        WHEN v_conv.last_agent_message_at IS NULL OR v_conv.last_agent_message_at < NEW.created_at THEN
          COALESCE(v_conv.unattended_since, NEW.created_at)
        ELSE v_conv.unattended_since
      END,
      updated_at = now()
    WHERE id = NEW.conversation_id;

  ELSIF NEW.sender_type = 'agent' THEN
    UPDATE public.conversations
    SET
      last_agent_message_at = NEW.created_at,
      first_response_at = CASE
        WHEN v_conv.first_customer_message_at IS NOT NULL AND v_conv.first_response_at IS NULL THEN NEW.created_at
        ELSE v_conv.first_response_at
      END,
      first_response_duration_seconds = CASE
        WHEN v_conv.first_customer_message_at IS NOT NULL AND v_conv.first_response_at IS NULL THEN
          GREATEST(0, EXTRACT(EPOCH FROM (NEW.created_at - v_conv.first_customer_message_at))::INTEGER)
        ELSE v_conv.first_response_duration_seconds
      END,
      unattended_since = NULL, -- agent replied, no longer unattended
      updated_at = now()
    WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to update conversation message metrics for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_conversation_message_metrics ON public.messages;
CREATE TRIGGER trg_update_conversation_message_metrics
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_message_metrics();

-- 6. ATOMIC ASSIGNMENT & TRANSFER RPC WITH CONCURRENCY CHECK
CREATE OR REPLACE FUNCTION public.assign_conversation_atomic(
  p_account_id UUID,
  p_conversation_id UUID,
  p_target_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_expected_current_agent_id UUID DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role account_role_enum;
  v_conv RECORD;
  v_target_profile RECORD;
  v_event_type TEXT;
  v_history_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

  -- 1. Validate caller membership & role
  SELECT account_role INTO v_caller_role
  FROM public.profiles
  WHERE user_id = v_caller_id AND account_id = p_account_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Forbidden: caller is not a member of this account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role = 'viewer' THEN
    RAISE EXCEPTION 'Forbidden: viewers cannot assign or transfer conversations' USING ERRCODE = '42501';
  END IF;

  -- 2. Lock conversation row for update
  SELECT id, account_id, assigned_agent_id, status
  INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found in account' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate target user if not unassigning
  IF p_target_user_id IS NOT NULL THEN
    SELECT user_id, full_name, account_role
    INTO v_target_profile
    FROM public.profiles
    WHERE user_id = p_target_user_id AND account_id = p_account_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target user does not belong to this account' USING ERRCODE = '23503';
    END IF;

    IF v_target_profile.account_role = 'viewer' THEN
      RAISE EXCEPTION 'Target user is a viewer and cannot be assigned conversations' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 4. Optimistic concurrency check (if expected current agent is provided and not forced)
  IF NOT p_force AND p_expected_current_agent_id IS NOT NULL THEN
    IF v_conv.assigned_agent_id IS DISTINCT FROM p_expected_current_agent_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'CONCURRENCY_CONFLICT',
        'message', 'Conversation assignment was modified by another operator.',
        'current_assigned_agent_id', v_conv.assigned_agent_id
      );
    END IF;
  END IF;

  -- 5. Role-based assignment permission check for 'agent' role
  IF v_caller_role = 'agent' THEN
    -- Agent can only:
    -- A) Claim an unassigned conversation for themselves
    -- B) Transfer a conversation currently assigned to themselves to another agent/admin
    -- C) Unassign a conversation currently assigned to themselves
    IF v_conv.assigned_agent_id IS NULL THEN
      IF p_target_user_id <> v_caller_id THEN
        RAISE EXCEPTION 'Agents can only claim unassigned conversations for themselves' USING ERRCODE = '42501';
      END IF;
    ELSIF v_conv.assigned_agent_id <> v_caller_id THEN
      IF NOT p_force THEN
        RAISE EXCEPTION 'Agents cannot reassign conversations owned by other operators' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 6. Determine event type
  IF v_conv.assigned_agent_id IS NULL AND p_target_user_id = v_caller_id THEN
    v_event_type := 'claimed';
  ELSIF v_conv.assigned_agent_id IS NULL AND p_target_user_id IS NOT NULL THEN
    v_event_type := 'assigned';
  ELSIF p_target_user_id IS NULL THEN
    v_event_type := 'unassigned';
  ELSIF v_conv.assigned_agent_id = v_caller_id AND p_target_user_id <> v_caller_id THEN
    v_event_type := 'transferred';
  ELSE
    v_event_type := 'reassigned';
  END IF;

  -- If no change in assignment, return early
  IF v_conv.assigned_agent_id IS NOT DISTINCT FROM p_target_user_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'no_op', true,
      'conversation_id', p_conversation_id,
      'assigned_agent_id', p_target_user_id
    );
  END IF;

  -- 7. Update conversation
  UPDATE public.conversations
  SET
    assigned_agent_id = p_target_user_id,
    updated_at = now()
  WHERE id = p_conversation_id;

  -- 8. Insert history record
  INSERT INTO public.conversation_assignment_history (
    account_id,
    conversation_id,
    assigned_by_user_id,
    from_user_id,
    to_user_id,
    event_type,
    reason
  ) VALUES (
    p_account_id,
    p_conversation_id,
    v_caller_id,
    v_conv.assigned_agent_id,
    p_target_user_id,
    v_event_type,
    p_reason
  ) RETURNING id INTO v_history_id;

  RETURN jsonb_build_object(
    'success', true,
    'conversation_id', p_conversation_id,
    'previous_agent_id', v_conv.assigned_agent_id,
    'assigned_agent_id', p_target_user_id,
    'event_type', v_event_type,
    'history_id', v_history_id
  );
END;
$$;

-- 7. DETERMINISTIC BACKFILL OF OPERATIONAL METRICS FOR EXISTING CONVERSATIONS
DO $$
BEGIN
  WITH agg AS (
    SELECT
      conversation_id,
      MIN(CASE WHEN sender_type = 'customer' THEN created_at END) AS first_cust_at,
      MAX(CASE WHEN sender_type = 'customer' THEN created_at END) AS last_cust_at,
      MAX(CASE WHEN sender_type = 'agent' THEN created_at END) AS last_agent_at,
      MIN(CASE WHEN sender_type = 'agent' THEN created_at END) AS first_agent_at
    FROM public.messages
    GROUP BY conversation_id
  )
  UPDATE public.conversations c
  SET
    first_customer_message_at = COALESCE(c.first_customer_message_at, agg.first_cust_at),
    last_customer_message_at = COALESCE(c.last_customer_message_at, agg.last_cust_at),
    last_agent_message_at = COALESCE(c.last_agent_message_at, agg.last_agent_at),
    first_response_at = COALESCE(
      c.first_response_at,
      CASE WHEN agg.first_cust_at IS NOT NULL AND agg.first_agent_at >= agg.first_cust_at THEN agg.first_agent_at END
    ),
    first_response_duration_seconds = COALESCE(
      c.first_response_duration_seconds,
      CASE
        WHEN agg.first_cust_at IS NOT NULL AND agg.first_agent_at >= agg.first_cust_at THEN
          GREATEST(0, EXTRACT(EPOCH FROM (agg.first_agent_at - agg.first_cust_at))::INTEGER)
      END
    ),
    unattended_since = CASE
      WHEN agg.last_cust_at IS NOT NULL AND (agg.last_agent_at IS NULL OR agg.last_agent_at < agg.last_cust_at) THEN
        agg.last_cust_at
      ELSE NULL
    END
  FROM agg
  WHERE c.id = agg.conversation_id;
END $$;

-- 8. GRANTS & REALTIME
GRANT SELECT, INSERT ON public.conversation_assignment_history TO authenticated;
GRANT ALL ON public.conversation_assignment_history TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_conversation_atomic TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_assignment_history'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_assignment_history;
    END IF;
  END IF;
END $$;
