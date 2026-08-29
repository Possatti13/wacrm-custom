-- ============================================================
-- Migration 074: Follow-up Security & Migration Integrity Hardening (V1.2.1)
--
-- 1. Generic Timezone Default & IANA Validation:
--    - Sets default accounts.timezone to 'UTC' (preserves 'America/Sao_Paulo' on pilot).
--    - Adds is_valid_timezone IMMUTABLE validation function and CHECK constraint.
-- 2. Single Write Path Guard on tasks:
--    - Trigger trg_guard_tasks_lifecycle_updates blocks direct updates to status='completed',
--      snoozed_until, snooze_count, and completed_by_user_id unless authorized by atomic RPC.
-- 3. Hardens RPC Security (SECURITY DEFINER with Caller Authentication & Scope):
--    - snooze_followup_atomic
--    - complete_followup_atomic (prevents caller spoofing completed_by_user_id)
--    - get_followups_cockpit (validates membership, enforces seller scope, validates timezone)
--    - get_leads_without_next_action (validates membership, enforces seller & visibility scope)
--    - get_forgotten_leads (validates membership, enforces seller & visibility scope)
-- 4. RPC Grants Least Privilege:
--    - Revokes execute from PUBLIC, anon.
--    - Grants execute to authenticated, service_role.
-- 5. Table Privileges Least Privilege:
--    - Revokes TRUNCATE, TRIGGER, REFERENCES, DELETE on tasks from authenticated.
-- 6. Hardened Task RLS:
--    - Strict seller data ownership on tasks_select, tasks_insert, tasks_update.
--    - Hard delete restricted to admin/owner.
-- ============================================================

-- ------------------------------------------------------------
-- 1. GENERIC TIMEZONE DEFAULT & IANA VALIDATION
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF tz IS NULL OR trim(tz) = '' THEN
    RETURN FALSE;
  END IF;
  PERFORM now() AT TIME ZONE tz;
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

-- Set core default to UTC
ALTER TABLE public.accounts
  ALTER COLUMN timezone SET DEFAULT 'UTC';

-- Validate existing accounts timezone, fallback invalid to UTC
UPDATE public.accounts
SET timezone = 'UTC'
WHERE NOT public.is_valid_timezone(timezone);

-- Preserve pilot account timezone
UPDATE public.accounts
SET timezone = 'America/Sao_Paulo'
WHERE id = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';

-- Add check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_accounts_valid_timezone'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT chk_accounts_valid_timezone
      CHECK (public.is_valid_timezone(timezone));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. SINGLE WRITE PATH GUARD TRIGGER ON TASKS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_tasks_lifecycle_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role TEXT;
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Only enforce guard for authenticated PostgREST user calls
  IF v_caller_id IS NOT NULL AND v_jwt_role <> 'service_role' THEN
    -- Check if session flag is set by atomic RPC
    IF current_setting('ciclopes.allow_task_lifecycle_update', true) IS DISTINCT FROM 'on' THEN
      -- Direct completion check
      IF (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed')
         OR (OLD.completed_at IS DISTINCT FROM NEW.completed_at AND NEW.completed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Direct completion of task is forbidden. Use complete_followup_atomic procedure.'
          USING ERRCODE = '42501';
      END IF;

      -- Direct completed_by_user_id check
      IF OLD.completed_by_user_id IS DISTINCT FROM NEW.completed_by_user_id THEN
        RAISE EXCEPTION 'Direct update of completed_by_user_id is forbidden. Use complete_followup_atomic procedure.'
          USING ERRCODE = '42501';
      END IF;

      -- Direct snooze check
      IF (OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until)
         OR (OLD.snooze_count IS DISTINCT FROM NEW.snooze_count) THEN
        RAISE EXCEPTION 'Direct snooze of task is forbidden. Use snooze_followup_atomic procedure.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tasks_lifecycle ON public.tasks;
CREATE TRIGGER trg_guard_tasks_lifecycle
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tasks_lifecycle_updates();

-- ------------------------------------------------------------
-- 3. HARDEN SNOOZE & COMPLETE ATOMIC RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snooze_followup_atomic(
  p_account_id UUID,
  p_task_id UUID,
  p_snooze_until TIMESTAMPTZ,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_jwt_role TEXT;
  v_task RECORD;
  v_updated RECORD;
BEGIN
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization: Require authenticated user or service_role
  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Validate tenant membership & role
  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
    END IF;

    IF v_caller_role = 'viewer' THEN
      RAISE EXCEPTION 'Forbidden: viewers cannot snooze tasks' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_caller_role := 'admin';
  END IF;

  -- 3. Lock task row for update
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found in account' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Scope check: agent can only snooze their own task or unassigned task
  IF v_caller_role = 'agent' AND v_task.assigned_user_id IS NOT NULL AND v_task.assigned_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Forbidden: agent cannot snooze tasks assigned to another operator' USING ERRCODE = '42501';
  END IF;

  -- 5. Set session flag for trigger
  PERFORM set_config('ciclopes.allow_task_lifecycle_update', 'on', true);

  -- 6. Atomic update
  UPDATE public.tasks
  SET
    original_due_at = COALESCE(original_due_at, due_at),
    snoozed_until = p_snooze_until,
    snooze_count = snooze_count + 1,
    snooze_reason = COALESCE(p_reason, snooze_reason),
    updated_at = now()
  WHERE id = p_task_id AND account_id = p_account_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', v_updated.id,
    'snoozed_until', v_updated.snoozed_until,
    'snooze_count', v_updated.snooze_count,
    'original_due_at', v_updated.original_due_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_followup_atomic(
  p_account_id UUID,
  p_task_id UUID,
  p_completed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_jwt_role TEXT;
  v_effective_completed_by UUID;
  v_task RECORD;
  v_updated RECORD;
BEGIN
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization: Require authenticated user or service_role
  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Validate tenant membership & role
  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
    END IF;

    IF v_caller_role = 'viewer' THEN
      RAISE EXCEPTION 'Forbidden: viewers cannot complete tasks' USING ERRCODE = '42501';
    END IF;

    -- Anti-spoofing: Authenticated caller can ONLY record themselves as completer
    v_effective_completed_by := v_caller_id;
  ELSE
    v_caller_role := 'admin';
    v_effective_completed_by := p_completed_by;
  END IF;

  -- 3. Lock task row for update
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found in account' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Scope check: agent cannot complete tasks assigned to another operator
  IF v_caller_role = 'agent' AND v_task.assigned_user_id IS NOT NULL AND v_task.assigned_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Forbidden: agent cannot complete tasks assigned to another operator' USING ERRCODE = '42501';
  END IF;

  -- 5. Set session flag for trigger
  PERFORM set_config('ciclopes.allow_task_lifecycle_update', 'on', true);

  -- 6. Atomic complete update
  UPDATE public.tasks
  SET
    status = 'completed',
    completed_at = now(),
    completed_by_user_id = v_effective_completed_by,
    updated_at = now()
  WHERE id = p_task_id AND account_id = p_account_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'success', true,
    'task_id', v_updated.id,
    'status', v_updated.status,
    'completed_at', v_updated.completed_at,
    'completed_by_user_id', v_updated.completed_by_user_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. HARDEN ANALYTICAL / COCKPIT RPCs (SECURITY DEFINER)
-- ------------------------------------------------------------

-- A. get_followups_cockpit
CREATE OR REPLACE FUNCTION public.get_followups_cockpit(
  p_account_id UUID,
  p_assigned_user_id UUID DEFAULT NULL,
  p_view TEXT DEFAULT 'today',
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_jwt_role TEXT;
  v_effective_assigned_user UUID;
  v_tz TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
  v_total INTEGER;
  v_items JSONB;
BEGIN
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization check
  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Tenant membership validation
  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
    END IF;
  ELSE
    v_caller_role := 'admin';
  END IF;

  -- 3. Seller Scope Enforcement
  IF v_caller_role = 'agent' THEN
    IF p_assigned_user_id IS NOT NULL AND p_assigned_user_id <> v_caller_id THEN
      RAISE EXCEPTION 'Forbidden: agents cannot query follow-ups assigned to other operators' USING ERRCODE = '42501';
    END IF;
    v_effective_assigned_user := v_caller_id;
  ELSE
    v_effective_assigned_user := p_assigned_user_id;
  END IF;

  -- 4. Get tenant timezone with validation fallback
  SELECT timezone INTO v_tz
  FROM public.accounts
  WHERE id = p_account_id;

  IF NOT public.is_valid_timezone(v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- 5. Calculate day boundaries in tenant timezone
  v_today_start := (date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz);
  v_today_end := v_today_start + interval '1 day' - interval '1 microsecond';

  -- 6. Count query
  SELECT count(*)
  INTO v_total
  FROM public.tasks t
  WHERE t.account_id = p_account_id
    AND (v_effective_assigned_user IS NULL OR t.assigned_user_id = v_effective_assigned_user)
    AND (
      CASE
        WHEN p_view = 'today' THEN
          t.status IN ('pending', 'in_progress')
          AND COALESCE(t.snoozed_until, t.due_at) >= v_today_start
          AND COALESCE(t.snoozed_until, t.due_at) <= v_today_end
        WHEN p_view = 'overdue' THEN
          t.status IN ('pending', 'in_progress')
          AND COALESCE(t.snoozed_until, t.due_at) < v_today_start
        WHEN p_view = 'upcoming' THEN
          t.status IN ('pending', 'in_progress')
          AND (
            COALESCE(t.snoozed_until, t.due_at) > v_today_end
            OR COALESCE(t.snoozed_until, t.due_at) IS NULL
          )
        WHEN p_view = 'waiting_customer' THEN
          t.status IN ('pending', 'in_progress')
          AND t.waiting_on = 'customer'
        WHEN p_view = 'completed' THEN
          t.status = 'completed'
        ELSE
          TRUE
      END
    );

  -- 7. Fetch query with enrichment
  SELECT COALESCE(jsonb_agg(item_row), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      t.id,
      t.account_id,
      t.contact_id,
      t.conversation_id,
      t.deal_id,
      t.assigned_user_id,
      t.created_by_user_id,
      t.completed_by_user_id,
      t.title,
      t.description,
      t.priority,
      t.status,
      t.action_type,
      t.waiting_on,
      t.due_at,
      t.original_due_at,
      t.snoozed_until,
      t.snooze_count,
      t.snooze_reason,
      t.completed_at,
      t.source,
      t.ai_suggestion_provenance,
      t.created_at,
      t.updated_at,
      COALESCE(t.snoozed_until, t.due_at) AS effective_due_at,
      CASE
        WHEN t.contact_id IS NOT NULL THEN jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'phone', c.phone,
          'avatar_url', c.avatar_url
        )
        ELSE NULL
      END AS contact,
      CASE
        WHEN t.assigned_user_id IS NOT NULL THEN p.full_name
        ELSE NULL
      END AS assigned_user_name,
      ls.score AS lead_score,
      lp.current_intent AS lead_intent,
      lp.urgency AS lead_urgency,
      CASE
        WHEN conv.last_customer_message_at IS NOT NULL
             AND t.created_at IS NOT NULL
             AND conv.last_customer_message_at > t.created_at THEN TRUE
        ELSE FALSE
      END AS customer_replied_after_creation
    FROM public.tasks t
    LEFT JOIN public.contacts c ON c.id = t.contact_id
    LEFT JOIN public.profiles p ON p.user_id = t.assigned_user_id AND p.account_id = t.account_id
    LEFT JOIN public.conversations conv ON conv.id = t.conversation_id
    LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = t.contact_id AND ls.account_id = t.account_id
    LEFT JOIN public.contact_lead_profiles lp ON lp.contact_id = t.contact_id AND lp.account_id = t.account_id
    WHERE t.account_id = p_account_id
      AND (v_effective_assigned_user IS NULL OR t.assigned_user_id = v_effective_assigned_user)
      AND (
        CASE
          WHEN p_view = 'today' THEN
            t.status IN ('pending', 'in_progress')
            AND COALESCE(t.snoozed_until, t.due_at) >= v_today_start
            AND COALESCE(t.snoozed_until, t.due_at) <= v_today_end
          WHEN p_view = 'overdue' THEN
            t.status IN ('pending', 'in_progress')
            AND COALESCE(t.snoozed_until, t.due_at) < v_today_start
          WHEN p_view = 'upcoming' THEN
            t.status IN ('pending', 'in_progress')
            AND (
              COALESCE(t.snoozed_until, t.due_at) > v_today_end
              OR COALESCE(t.snoozed_until, t.due_at) IS NULL
            )
          WHEN p_view = 'waiting_customer' THEN
            t.status IN ('pending', 'in_progress')
            AND t.waiting_on = 'customer'
          WHEN p_view = 'completed' THEN
            t.status = 'completed'
          ELSE
            TRUE
        END
      )
    ORDER BY
      CASE
        WHEN p_view = 'overdue' THEN COALESCE(t.snoozed_until, t.due_at)
        ELSE NULL
      END ASC NULLS LAST,
      CASE
        WHEN p_view <> 'overdue' THEN COALESCE(t.snoozed_until, t.due_at)
        ELSE NULL
      END ASC NULLS LAST,
      t.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) item_row;

  RETURN jsonb_build_object(
    'total', v_total,
    'timezone', v_tz,
    'view', p_view,
    'items', v_items
  );
END;
$$;

-- B. get_leads_without_next_action
CREATE OR REPLACE FUNCTION public.get_leads_without_next_action(
  p_account_id UUID,
  p_assigned_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_min_lead_score INTEGER DEFAULT 40,
  p_max_conversation_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_jwt_role TEXT;
  v_effective_assigned_user UUID;
  v_visibility TEXT;
  v_cutoff TIMESTAMPTZ;
  v_total INTEGER;
  v_items JSONB;
BEGIN
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization check
  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Tenant membership validation
  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
    END IF;
  ELSE
    v_caller_role := 'admin';
  END IF;

  -- 3. Scope & Visibility Enforcement
  IF v_caller_role = 'agent' THEN
    IF p_assigned_user_id IS NOT NULL AND p_assigned_user_id <> v_caller_id THEN
      RAISE EXCEPTION 'Forbidden: agents cannot query leads assigned to other operators' USING ERRCODE = '42501';
    END IF;
    v_effective_assigned_user := v_caller_id;

    SELECT seller_conversation_visibility INTO v_visibility
    FROM public.accounts WHERE id = p_account_id;
    v_visibility := COALESCE(v_visibility, 'all');
  ELSE
    v_effective_assigned_user := p_assigned_user_id;
    v_visibility := 'all';
  END IF;

  v_cutoff := clock_timestamp() - (p_max_conversation_days || ' days')::interval;

  -- 4. Count leads without active follow-up
  SELECT count(DISTINCT c.id)
  INTO v_total
  FROM public.contacts c
  JOIN public.conversations conv ON conv.contact_id = c.id AND conv.account_id = c.account_id
  LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = c.id AND ls.account_id = c.account_id
  LEFT JOIN public.deals d ON d.contact_id = c.id AND d.account_id = c.account_id AND d.status = 'open'
  WHERE c.account_id = p_account_id
    AND (
      v_caller_role IN ('owner', 'admin', 'viewer')
      OR v_visibility = 'all'
      OR (v_visibility = 'assigned_and_unassigned' AND (conv.assigned_agent_id IS NULL OR conv.assigned_agent_id = v_caller_id))
      OR (v_visibility = 'assigned_only' AND conv.assigned_agent_id = v_caller_id)
    )
    AND (v_effective_assigned_user IS NULL OR conv.assigned_agent_id = v_effective_assigned_user)
    AND (d.id IS NOT NULL OR COALESCE(ls.score, 0) >= p_min_lead_score OR conv.last_message_at >= v_cutoff)
    AND NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.contact_id = c.id
        AND t.account_id = c.account_id
        AND t.status IN ('pending', 'in_progress')
    );

  -- 5. Fetch enriched records
  SELECT COALESCE(jsonb_agg(lead_row), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT DISTINCT ON (c.id)
      c.id AS contact_id,
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.avatar_url AS contact_avatar_url,
      conv.id AS conversation_id,
      conv.assigned_agent_id,
      p.full_name AS assigned_agent_name,
      conv.last_customer_message_at,
      conv.last_agent_message_at,
      lp.current_intent,
      lp.urgency,
      lp.next_action AS suggested_next_action,
      lp.next_action_due_at AS suggested_due_at,
      COALESCE(ls.score, 0) AS lead_score,
      d.id AS deal_id,
      d.title AS deal_title,
      d.value AS deal_value
    FROM public.contacts c
    JOIN public.conversations conv ON conv.contact_id = c.id AND conv.account_id = c.account_id
    LEFT JOIN public.profiles p ON p.user_id = conv.assigned_agent_id AND p.account_id = c.account_id
    LEFT JOIN public.contact_lead_profiles lp ON lp.contact_id = c.id AND lp.account_id = c.account_id
    LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = c.id AND ls.account_id = c.account_id
    LEFT JOIN public.deals d ON d.contact_id = c.id AND d.account_id = c.account_id AND d.status = 'open'
    WHERE c.account_id = p_account_id
      AND (
        v_caller_role IN ('owner', 'admin', 'viewer')
        OR v_visibility = 'all'
        OR (v_visibility = 'assigned_and_unassigned' AND (conv.assigned_agent_id IS NULL OR conv.assigned_agent_id = v_caller_id))
        OR (v_visibility = 'assigned_only' AND conv.assigned_agent_id = v_caller_id)
      )
      AND (v_effective_assigned_user IS NULL OR conv.assigned_agent_id = v_effective_assigned_user)
      AND (d.id IS NOT NULL OR COALESCE(ls.score, 0) >= p_min_lead_score OR conv.last_message_at >= v_cutoff)
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.contact_id = c.id
          AND t.account_id = c.account_id
          AND t.status IN ('pending', 'in_progress')
      )
    ORDER BY c.id, COALESCE(ls.score, 0) DESC, conv.last_message_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) lead_row;

  RETURN jsonb_build_object(
    'total', v_total,
    'items', v_items
  );
END;
$$;

-- C. get_forgotten_leads
CREATE OR REPLACE FUNCTION public.get_forgotten_leads(
  p_account_id UUID,
  p_assigned_user_id UUID DEFAULT NULL,
  p_inactive_hours INTEGER DEFAULT 72,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_min_lead_score INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_jwt_role TEXT;
  v_effective_assigned_user UUID;
  v_visibility TEXT;
  v_cutoff TIMESTAMPTZ;
  v_total INTEGER;
  v_items JSONB;
BEGIN
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization check
  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2. Tenant membership validation
  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL THEN
      RAISE EXCEPTION 'Forbidden: caller is not a member of account %', p_account_id USING ERRCODE = '42501';
    END IF;
  ELSE
    v_caller_role := 'admin';
  END IF;

  -- 3. Scope & Visibility Enforcement
  IF v_caller_role = 'agent' THEN
    IF p_assigned_user_id IS NOT NULL AND p_assigned_user_id <> v_caller_id THEN
      RAISE EXCEPTION 'Forbidden: agents cannot query leads assigned to other operators' USING ERRCODE = '42501';
    END IF;
    v_effective_assigned_user := v_caller_id;

    SELECT seller_conversation_visibility INTO v_visibility
    FROM public.accounts WHERE id = p_account_id;
    v_visibility := COALESCE(v_visibility, 'all');
  ELSE
    v_effective_assigned_user := p_assigned_user_id;
    v_visibility := 'all';
  END IF;

  v_cutoff := clock_timestamp() - (p_inactive_hours || ' hours')::interval;

  -- 4. Count forgotten leads
  SELECT count(DISTINCT c.id)
  INTO v_total
  FROM public.contacts c
  JOIN public.conversations conv ON conv.contact_id = c.id AND conv.account_id = c.account_id
  LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = c.id AND ls.account_id = c.account_id
  LEFT JOIN public.deals d ON d.contact_id = c.id AND d.account_id = c.account_id AND d.status = 'open'
  WHERE c.account_id = p_account_id
    AND (
      v_caller_role IN ('owner', 'admin', 'viewer')
      OR v_visibility = 'all'
      OR (v_visibility = 'assigned_and_unassigned' AND (conv.assigned_agent_id IS NULL OR conv.assigned_agent_id = v_caller_id))
      OR (v_visibility = 'assigned_only' AND conv.assigned_agent_id = v_caller_id)
    )
    AND (v_effective_assigned_user IS NULL OR conv.assigned_agent_id = v_effective_assigned_user)
    AND (d.id IS NOT NULL OR COALESCE(ls.score, 0) >= p_min_lead_score)
    AND (conv.last_agent_message_at IS NULL OR conv.last_agent_message_at < v_cutoff)
    AND NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.contact_id = c.id
        AND t.account_id = c.account_id
        AND t.status IN ('pending', 'in_progress')
        AND COALESCE(t.snoozed_until, t.due_at) >= clock_timestamp()
    );

  -- 5. Fetch enriched forgotten leads
  SELECT COALESCE(jsonb_agg(lead_row), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT DISTINCT ON (c.id)
      c.id AS contact_id,
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.avatar_url AS contact_avatar_url,
      conv.id AS conversation_id,
      conv.assigned_agent_id,
      p.full_name AS assigned_agent_name,
      conv.last_customer_message_at,
      conv.last_agent_message_at,
      conv.unattended_since,
      COALESCE(ls.score, 0) AS lead_score,
      d.id AS deal_id,
      d.title AS deal_title,
      GREATEST(
        p_inactive_hours,
        EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(conv.last_agent_message_at, conv.created_at))) / 3600
      )::INTEGER AS inactive_hours
    FROM public.contacts c
    JOIN public.conversations conv ON conv.contact_id = c.id AND conv.account_id = c.account_id
    LEFT JOIN public.profiles p ON p.user_id = conv.assigned_agent_id AND p.account_id = c.account_id
    LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = c.id AND ls.account_id = c.account_id
    LEFT JOIN public.deals d ON d.contact_id = c.id AND d.account_id = c.account_id AND d.status = 'open'
    WHERE c.account_id = p_account_id
      AND (
        v_caller_role IN ('owner', 'admin', 'viewer')
        OR v_visibility = 'all'
        OR (v_visibility = 'assigned_and_unassigned' AND (conv.assigned_agent_id IS NULL OR conv.assigned_agent_id = v_caller_id))
        OR (v_visibility = 'assigned_only' AND conv.assigned_agent_id = v_caller_id)
      )
      AND (v_effective_assigned_user IS NULL OR conv.assigned_agent_id = v_effective_assigned_user)
      AND (d.id IS NOT NULL OR COALESCE(ls.score, 0) >= p_min_lead_score)
      AND (conv.last_agent_message_at IS NULL OR conv.last_agent_message_at < v_cutoff)
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.contact_id = c.id
          AND t.account_id = c.account_id
          AND t.status IN ('pending', 'in_progress')
          AND COALESCE(t.snoozed_until, t.due_at) >= clock_timestamp()
      )
    ORDER BY c.id, COALESCE(ls.score, 0) DESC, conv.last_customer_message_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) lead_row;

  RETURN jsonb_build_object(
    'total', v_total,
    'inactive_threshold_hours', p_inactive_hours,
    'items', v_items
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. REVOKE ANONYMOUS EXECUTE & LEAST PRIVILEGE GRANTS
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.snooze_followup_atomic(UUID, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_followup_atomic(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_followups_cockpit(UUID, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_leads_without_next_action(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_forgotten_leads(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.snooze_followup_atomic(UUID, UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_followup_atomic(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_followups_cockpit(UUID, UUID, TEXT, INTEGER, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_leads_without_next_action(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_forgotten_leads(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. TABLE PRIVILEGES LEAST PRIVILEGE ON TASKS
-- ------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.tasks FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES, DELETE ON TABLE public.tasks FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tasks TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.tasks TO service_role, postgres;

-- ------------------------------------------------------------
-- 7. HARDENED TASK ROW LEVEL SECURITY POLICIES
-- ------------------------------------------------------------
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

-- tasks_select: viewers/admins/owners see all tasks in tenant; agents see tasks assigned to them, unassigned, created by them, or all if visibility='all'
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.account_id = tasks.account_id
        AND p.user_id = auth.uid()
        AND (
          p.account_role IN ('owner', 'admin', 'viewer')
          OR tasks.assigned_user_id = auth.uid()
          OR tasks.created_by_user_id = auth.uid()
          OR tasks.assigned_user_id IS NULL
          OR (
            SELECT seller_conversation_visibility
            FROM public.accounts a
            WHERE a.id = tasks.account_id
          ) = 'all'
        )
    )
  );

-- tasks_insert: agents can only create tasks for themselves or unassigned, cannot insert completed tasks
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.account_id = tasks.account_id
        AND p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND (
          p.account_role IN ('owner', 'admin')
          OR (
            (tasks.assigned_user_id IS NULL OR tasks.assigned_user_id = auth.uid())
            AND (tasks.created_by_user_id IS NULL OR tasks.created_by_user_id = auth.uid())
            AND tasks.completed_by_user_id IS NULL
            AND tasks.completed_at IS NULL
          )
        )
    )
  );

-- tasks_update: agents can only update tasks assigned to them or unassigned, cannot reassign to another agent
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.account_id = tasks.account_id
        AND p.user_id = auth.uid()
        AND (
          p.account_role IN ('owner', 'admin')
          OR (tasks.assigned_user_id IS NULL OR tasks.assigned_user_id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.account_id = tasks.account_id
        AND p.user_id = auth.uid()
        AND (
          p.account_role IN ('owner', 'admin')
          OR (tasks.assigned_user_id IS NULL OR tasks.assigned_user_id = auth.uid())
        )
    )
  );

-- tasks_delete: only admins and owners can hard delete tasks
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    is_account_member(account_id, 'admin'::account_role_enum)
  );
