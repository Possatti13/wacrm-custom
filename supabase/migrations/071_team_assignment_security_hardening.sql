-- ============================================================
-- Migration 071: Team Assignment Security Hardening (V1.1.1)
--
-- 1. Hardens assign_conversation_atomic against privilege escalation:
--    - Rejects p_force if caller role is 'agent' (only owner/admin may force override).
--    - Enforces least-privilege execute grants (REVOKE FROM PUBLIC, anon).
-- 2. Closes assigned_agent_id direct update bypass:
--    - Adds BEFORE UPDATE trigger on conversations preventing direct modification
--      of assigned_agent_id outside assign_conversation_atomic (via transaction-local setting).
-- 3. Protects conversation_assignment_history ledger:
--    - Drops direct INSERT policy for authenticated users so history can ONLY be
--      created by assign_conversation_atomic or service_role.
-- 4. Enforces seller_conversation_visibility at the database RLS layer:
--    - check_conversation_visibility function evaluates tenant policy for 'agent' role.
--    - Updates conversations_select policy to enforce visibility in PostgREST and Realtime.
-- ============================================================

-- 1. HARDEN assign_conversation_atomic
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

  -- 2. Privilege escalation check: agent can NEVER force reassignment
  IF p_force AND v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Forbidden: only owners and managers can force assignment override' USING ERRCODE = '42501';
  END IF;

  -- 3. Lock conversation row for update
  SELECT id, account_id, assigned_agent_id, status
  INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found in account' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate target user if not unassigning
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

  -- 5. Optimistic concurrency check (if expected current agent is provided and not forced by owner/admin)
  IF NOT (p_force AND v_caller_role IN ('owner', 'admin')) AND p_expected_current_agent_id IS NOT NULL THEN
    IF v_conv.assigned_agent_id IS DISTINCT FROM p_expected_current_agent_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'CONCURRENCY_CONFLICT',
        'message', 'Conversation assignment was modified by another operator.',
        'current_assigned_agent_id', v_conv.assigned_agent_id
      );
    END IF;
  END IF;

  -- 6. Role-based assignment permission check for 'agent' role
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
      RAISE EXCEPTION 'Agents cannot reassign conversations owned by other operators' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 7. Determine event type
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

  -- 8. Set session authorization flag so the guard trigger permits updating assigned_agent_id
  PERFORM set_config('app.assignment_in_progress', 'true', true);

  -- 9. Update conversation
  UPDATE public.conversations
  SET
    assigned_agent_id = p_target_user_id,
    updated_at = now()
  WHERE id = p_conversation_id;

  -- 10. Insert history record
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

-- 2. REVOKE ANONYMOUS EXECUTE GRANTS
REVOKE ALL ON FUNCTION public.assign_conversation_atomic(UUID, UUID, UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_conversation_atomic(UUID, UUID, UUID, TEXT, UUID, BOOLEAN) TO authenticated, service_role;

-- 3. ASSIGNMENT DIRECT UPDATE GUARD ON CONVERSATIONS
CREATE OR REPLACE FUNCTION public.guard_assigned_agent_id_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    IF current_setting('app.assignment_in_progress', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Direct update to assigned_agent_id is prohibited. Use assign_conversation_atomic procedure.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_assigned_agent_id ON public.conversations;
CREATE TRIGGER trg_guard_assigned_agent_id
  BEFORE UPDATE OF assigned_agent_id ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_assigned_agent_id_update();

-- 4. AUDIT LEDGER DIRECT INSERT/UPDATE/DELETE PROHIBITION
DROP POLICY IF EXISTS cah_insert ON public.conversation_assignment_history;
DROP POLICY IF EXISTS cah_select ON public.conversation_assignment_history;

CREATE POLICY cah_select ON public.conversation_assignment_history
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

REVOKE INSERT, UPDATE, DELETE ON public.conversation_assignment_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_assignment_history TO authenticated;
GRANT ALL ON public.conversation_assignment_history TO service_role;

-- 5. SELLER CONVERSATION VISIBILITY RLS POLICY
CREATE OR REPLACE FUNCTION public.check_conversation_visibility(
  p_account_id UUID,
  p_assigned_agent_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role account_role_enum;
  v_visibility TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Get caller role in this account
  SELECT account_role INTO v_role
  FROM public.profiles
  WHERE user_id = v_user_id AND account_id = p_account_id;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 2. Owner, Admin and Viewer see all conversations within their tenant
  IF v_role IN ('owner', 'admin', 'viewer') THEN
    RETURN TRUE;
  END IF;

  -- 3. Role is 'agent' (seller) - evaluate tenant visibility policy
  SELECT seller_conversation_visibility INTO v_visibility
  FROM public.accounts
  WHERE id = p_account_id;

  v_visibility := COALESCE(v_visibility, 'all');

  IF v_visibility = 'all' THEN
    RETURN TRUE;
  ELSIF v_visibility = 'assigned_and_unassigned' THEN
    RETURN (p_assigned_agent_id IS NULL OR p_assigned_agent_id = v_user_id);
  ELSIF v_visibility = 'assigned_only' THEN
    RETURN (p_assigned_agent_id IS NOT NULL AND p_assigned_agent_id = v_user_id);
  END IF;

  RETURN TRUE;
END;
$$;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT
  USING (
    check_conversation_visibility(account_id, assigned_agent_id)
  );
