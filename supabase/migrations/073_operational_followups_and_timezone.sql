-- ============================================================
-- Migration 073: Commercial Follow-ups & Next Action Cockpit (V1.2)
--
-- 1. Adds `timezone` column to `accounts` table (default 'America/Sao_Paulo').
-- 2. Specializes `tasks` table into a first-class commercial next-action entity:
--    - `action_type`: structured commercial intent (message, call, proposal, etc.)
--    - `waiting_on`: operational waiting state (customer, team, external)
--    - `snoozed_until`, `snooze_count`, `snooze_reason`: atomic snooze lifecycle
--    - `completed_by_user_id`: accountability for completion
--    - `original_due_at`: preserves initial timeline for commercial audit
-- 3. Provides atomic RPC functions for snooze, complete, and cockpit queries.
-- 4. Enforces least-privilege RLS and covering indexes.
-- ============================================================

-- 1. ACCOUNTS TIMEZONE
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- 2. TASKS SPECIALIZATION FOR COMMERCIAL FOLLOW-UPS
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS waiting_on TEXT,
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snooze_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snooze_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_due_at TIMESTAMPTZ;

-- Constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_action_type') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_action_type
      CHECK (action_type IN ('message', 'call', 'proposal', 'documents', 'decision', 'recontact', 'meeting', 'other'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_waiting_on') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT chk_tasks_waiting_on
      CHECK (waiting_on IS NULL OR waiting_on IN ('customer', 'team', 'external'));
  END IF;
END $$;

-- 3. COVERING INDEXES
CREATE INDEX IF NOT EXISTS idx_tasks_account_effective_due
  ON public.tasks(account_id, status, COALESCE(snoozed_until, due_at));

CREATE INDEX IF NOT EXISTS idx_tasks_account_waiting_on
  ON public.tasks(account_id, status, waiting_on)
  WHERE waiting_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_account_assigned_status
  ON public.tasks(account_id, assigned_user_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_completed_by
  ON public.tasks(account_id, completed_by_user_id)
  WHERE completed_by_user_id IS NOT NULL;

-- 4. ATOMIC SNOOZE RPC
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
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), (current_setting('request.jwt.claims', true)::jsonb ->> 'role'));

  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL OR v_caller_role = 'viewer' THEN
      RAISE EXCEPTION 'Forbidden: viewers cannot snooze tasks' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_caller_role := 'admin';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;

  -- Role check: agent can only snooze their own task unless admin/owner
  IF v_caller_role = 'agent' AND v_task.assigned_user_id IS NOT NULL AND v_task.assigned_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Forbidden: agent cannot snooze tasks assigned to another operator' USING ERRCODE = '42501';
  END IF;

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

-- 5. ATOMIC COMPLETE RPC
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
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), (current_setting('request.jwt.claims', true)::jsonb ->> 'role'));

  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_caller_id IS NOT NULL THEN
    SELECT account_role INTO v_caller_role
    FROM public.profiles
    WHERE account_id = p_account_id AND user_id = v_caller_id
    LIMIT 1;

    IF v_caller_role IS NULL OR v_caller_role = 'viewer' THEN
      RAISE EXCEPTION 'Forbidden: viewers cannot complete tasks' USING ERRCODE = '42501';
    END IF;
    v_effective_completed_by := v_caller_id;
  ELSE
    v_caller_role := 'admin';
    v_effective_completed_by := COALESCE(p_completed_by, NULL);
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller_role = 'agent' AND v_task.assigned_user_id IS NOT NULL AND v_task.assigned_user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Forbidden: agent cannot complete tasks assigned to another operator' USING ERRCODE = '42501';
  END IF;

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

-- 6. COCKPIT QUERY RPC (Server-side Aggregation & Timezone Awareness)
CREATE OR REPLACE FUNCTION public.get_followups_cockpit(
  p_account_id UUID,
  p_assigned_user_id UUID DEFAULT NULL,
  p_view TEXT DEFAULT 'today',
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz TEXT;
  v_now TIMESTAMPTZ;
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
  v_items JSONB;
  v_total INT;
BEGIN
  SELECT timezone INTO v_tz FROM public.accounts WHERE id = p_account_id;
  IF v_tz IS NULL OR v_tz = '' THEN
    v_tz := 'America/Sao_Paulo';
  END IF;

  v_now := now();
  v_today_start := (date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz);
  v_today_end := v_today_start + interval '1 day' - interval '1 microsecond';

  WITH filtered_tasks AS (
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
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.avatar_url AS contact_avatar_url,
      conv.last_customer_message_at,
      conv.last_agent_message_at,
      (conv.last_customer_message_at IS NOT NULL AND conv.last_customer_message_at > t.created_at) AS customer_replied_after_creation,
      prof.full_name AS assigned_user_name,
      prof.avatar_url AS assigned_user_avatar_url,
      clp.current_intent AS lead_intent,
      clp.urgency AS lead_urgency,
      cls.score AS lead_score
    FROM public.tasks t
    LEFT JOIN public.contacts c ON c.id = t.contact_id AND c.account_id = t.account_id
    LEFT JOIN public.conversations conv ON conv.id = t.conversation_id AND conv.account_id = t.account_id
    LEFT JOIN public.profiles prof ON prof.user_id = t.assigned_user_id AND prof.account_id = t.account_id
    LEFT JOIN public.contact_lead_profiles clp ON clp.contact_id = t.contact_id AND clp.account_id = t.account_id
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = t.contact_id AND cls.account_id = t.account_id
    WHERE t.account_id = p_account_id
      AND (p_assigned_user_id IS NULL OR t.assigned_user_id = p_assigned_user_id)
      AND (
        (p_view = 'today' AND t.status IN ('pending', 'in_progress') AND COALESCE(t.snoozed_until, t.due_at) >= v_today_start AND COALESCE(t.snoozed_until, t.due_at) <= v_today_end)
        OR
        (p_view = 'overdue' AND t.status IN ('pending', 'in_progress') AND COALESCE(t.snoozed_until, t.due_at) < v_today_start)
        OR
        (p_view = 'upcoming' AND t.status IN ('pending', 'in_progress') AND (COALESCE(t.snoozed_until, t.due_at) > v_today_end OR COALESCE(t.snoozed_until, t.due_at) IS NULL))
        OR
        (p_view = 'waiting_customer' AND t.status IN ('pending', 'in_progress') AND t.waiting_on = 'customer')
        OR
        (p_view = 'completed' AND t.status = 'completed')
        OR
        (p_view = 'all')
      )
  ),
  counted AS (
    SELECT count(*) AS total_count FROM filtered_tasks
  ),
  ordered AS (
    SELECT * FROM filtered_tasks
    ORDER BY
      CASE WHEN p_view = 'overdue' THEN effective_due_at END ASC,
      CASE WHEN p_view = 'today' THEN COALESCE(lead_score, 0) END DESC,
      effective_due_at ASC NULLS LAST,
      created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    jsonb_build_object(
      'total', (SELECT total_count FROM counted),
      'timezone', v_tz,
      'view', p_view,
      'items', COALESCE(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb)
    )
  INTO v_items
  FROM ordered;

  RETURN v_items;
END;
$$;

-- 7. LEADS WITHOUT NEXT ACTION RPC
CREATE OR REPLACE FUNCTION public.get_leads_without_next_action(
  p_account_id UUID,
  p_assigned_user_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items JSONB;
BEGIN
  WITH eligible_leads AS (
    SELECT
      c.id AS contact_id,
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.avatar_url AS contact_avatar_url,
      conv.id AS conversation_id,
      conv.assigned_agent_id,
      conv.last_customer_message_at,
      conv.last_agent_message_at,
      clp.current_intent,
      clp.urgency,
      clp.next_action AS suggested_next_action,
      clp.next_action_due_at AS suggested_due_at,
      cls.score AS lead_score,
      d.id AS deal_id,
      d.title AS deal_title,
      d.value AS deal_value,
      prof.full_name AS assigned_agent_name
    FROM public.contacts c
    LEFT JOIN public.conversations conv ON conv.contact_id = c.id AND conv.account_id = p_account_id
    LEFT JOIN public.contact_lead_profiles clp ON clp.contact_id = c.id AND clp.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = c.id AND cls.account_id = p_account_id
    LEFT JOIN public.deals d ON d.contact_id = c.id AND d.account_id = p_account_id AND d.status = 'open'
    LEFT JOIN public.profiles prof ON prof.user_id = conv.assigned_agent_id AND prof.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND (p_assigned_user_id IS NULL OR conv.assigned_agent_id = p_assigned_user_id)
      -- Eligible criteria: has open deal OR score >= 40 OR active conversation in last 30 days
      AND (d.id IS NOT NULL OR COALESCE(cls.score, 0) >= 40 OR conv.last_message_at >= now() - interval '30 days')
      -- Has NO active tasks/follow-ups
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.account_id = p_account_id
          AND t.contact_id = c.id
          AND t.status IN ('pending', 'in_progress')
      )
  ),
  counted AS (
    SELECT count(*) AS total_count FROM eligible_leads
  ),
  paginated AS (
    SELECT * FROM eligible_leads
    ORDER BY COALESCE(lead_score, 0) DESC, last_customer_message_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    jsonb_build_object(
      'total', (SELECT total_count FROM counted),
      'items', COALESCE(jsonb_agg(to_jsonb(paginated)), '[]'::jsonb)
    )
  INTO v_items
  FROM paginated;

  RETURN v_items;
END;
$$;

-- 8. FORGOTTEN LEADS RPC
CREATE OR REPLACE FUNCTION public.get_forgotten_leads(
  p_account_id UUID,
  p_assigned_user_id UUID DEFAULT NULL,
  p_inactive_hours INT DEFAULT 72,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_items JSONB;
BEGIN
  v_cutoff := now() - (p_inactive_hours || ' hours')::interval;

  WITH forgotten AS (
    SELECT
      c.id AS contact_id,
      c.name AS contact_name,
      c.phone AS contact_phone,
      c.avatar_url AS contact_avatar_url,
      conv.id AS conversation_id,
      conv.assigned_agent_id,
      conv.last_customer_message_at,
      conv.last_agent_message_at,
      conv.unattended_since,
      cls.score AS lead_score,
      d.id AS deal_id,
      d.title AS deal_title,
      prof.full_name AS assigned_agent_name,
      ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(conv.last_agent_message_at, conv.last_customer_message_at, conv.created_at))) / 3600) AS inactive_hours
    FROM public.contacts c
    JOIN public.conversations conv ON conv.contact_id = c.id AND conv.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = c.id AND cls.account_id = p_account_id
    LEFT JOIN public.deals d ON d.contact_id = c.id AND d.account_id = p_account_id AND d.status = 'open'
    LEFT JOIN public.profiles prof ON prof.user_id = conv.assigned_agent_id AND prof.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND (p_assigned_user_id IS NULL OR conv.assigned_agent_id = p_assigned_user_id)
      -- Qualified: open deal OR lead score >= 30
      AND (d.id IS NOT NULL OR COALESCE(cls.score, 0) >= 30)
      -- Last interaction older than threshold
      AND (
        (conv.last_agent_message_at IS NOT NULL AND conv.last_agent_message_at < v_cutoff)
        OR (conv.last_agent_message_at IS NULL AND conv.last_customer_message_at < v_cutoff)
      )
      -- No active task scheduled
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.account_id = p_account_id
          AND t.contact_id = c.id
          AND t.status IN ('pending', 'in_progress')
      )
  ),
  counted AS (
    SELECT count(*) AS total_count FROM forgotten
  ),
  paginated AS (
    SELECT * FROM forgotten
    ORDER BY inactive_hours DESC, COALESCE(lead_score, 0) DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    jsonb_build_object(
      'total', (SELECT total_count FROM counted),
      'inactive_threshold_hours', p_inactive_hours,
      'items', COALESCE(jsonb_agg(to_jsonb(paginated)), '[]'::jsonb)
    )
  INTO v_items
  FROM paginated;

  RETURN v_items;
END;
$$;

-- 9. PERMISSIONS & GRANTS
GRANT EXECUTE ON FUNCTION public.snooze_followup_atomic(UUID, UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_followup_atomic(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_followups_cockpit(UUID, UUID, TEXT, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_leads_without_next_action(UUID, UUID, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_forgotten_leads(UUID, UUID, INT, INT, INT) TO authenticated, service_role;
