-- ============================================================
-- Migration 085: Manager Cockpit First Response Integrity (V1.4.2)
-- Strict Message Ledger First Response Episode Derivation,
-- True Actor & Duration Pairing, Elimination of Legacy Unproven Attribution,
-- Strict Custom Period Parameter Validation
-- ============================================================

-- Index to optimize first customer and first agent message lookups per conversation
CREATE INDEX IF NOT EXISTS idx_messages_conv_sender_created
ON public.messages (conversation_id, sender_type, created_at);

-- 1. PERIOD BOUNDS HELPER FUNCTION (STRICT CUSTOM VALIDATION)
CREATE OR REPLACE FUNCTION public.get_account_period_bounds(
  p_account_id UUID,
  p_range TEXT,
  p_custom_start TIMESTAMPTZ DEFAULT NULL,
  p_custom_end TIMESTAMPTZ DEFAULT NULL,
  OUT curr_start TIMESTAMPTZ,
  OUT curr_end TIMESTAMPTZ,
  OUT prev_start TIMESTAMPTZ,
  OUT prev_end TIMESTAMPTZ,
  OUT tz TEXT
)
RETURNS RECORD
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_tz TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_local_now TIMESTAMP;
  v_local_day_start TIMESTAMP;
  v_local_month_start TIMESTAMP;
  v_local_prev_month_start TIMESTAMP;
  v_prev_month_days INT;
  v_curr_day INT;
  v_dur INTERVAL;
  v_prev_point TIMESTAMP;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Role authorization check (Owner and Admin only)
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Manager Cockpit requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Fetch account timezone (fallback to America/Sao_Paulo)
  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.accounts
  WHERE id = p_account_id;

  IF v_tz IS NULL THEN
    v_tz := 'America/Sao_Paulo';
  END IF;

  tz := v_tz;
  v_local_now := timezone(v_tz, v_now);
  v_local_day_start := date_trunc('day', v_local_now);
  v_local_month_start := date_trunc('month', v_local_now);

  -- 2. Calculate bounds with exact comparative semantics
  IF p_range = 'today' THEN
    -- Today: [today 00:00 local, now] vs [yesterday 00:00 local, yesterday at same time]
    curr_start := (v_local_day_start) AT TIME ZONE v_tz;
    curr_end := v_now;
    prev_start := (v_local_day_start - interval '1 day') AT TIME ZONE v_tz;
    prev_end := (v_local_now - interval '1 day') AT TIME ZONE v_tz;

  ELSIF p_range = '7d' THEN
    -- 7 Days: rolling 7 days [now - 7d, now] vs [now - 14d, now - 7d]
    curr_start := v_now - interval '7 days';
    curr_end := v_now;
    prev_start := v_now - interval '14 days';
    prev_end := v_now - interval '7 days';

  ELSIF p_range = '30d' THEN
    -- 30 Days: rolling 30 days [now - 30d, now] vs [now - 60d, now - 30d]
    curr_start := v_now - interval '30 days';
    curr_end := v_now;
    prev_start := v_now - interval '60 days';
    prev_end := v_now - interval '30 days';

  ELSIF p_range = 'month' THEN
    -- Month to date: [first of this month 00:00 local, now] vs [first of prev month, equivalent elapsed point]
    curr_start := (v_local_month_start) AT TIME ZONE v_tz;
    curr_end := v_now;
    v_local_prev_month_start := date_trunc('month', v_local_month_start - interval '1 day');
    prev_start := (v_local_prev_month_start) AT TIME ZONE v_tz;

    -- Days in previous month clamp
    v_prev_month_days := EXTRACT(DAY FROM (v_local_month_start - interval '1 day'))::int;
    v_curr_day := EXTRACT(DAY FROM v_local_now)::int;

    IF v_curr_day > v_prev_month_days THEN
      -- Clamp to end of previous month (e.g. Aug 31 -> July 31, or March 31 -> Feb 28/29)
      v_prev_point := (v_local_month_start - interval '1 second');
    ELSE
      v_prev_point := v_local_prev_month_start + (v_local_now - v_local_month_start);
    END IF;
    prev_end := (v_prev_point) AT TIME ZONE v_tz;

  ELSIF p_range = 'custom' THEN
    -- Strict custom range parameter validation
    IF p_custom_start IS NULL OR p_custom_end IS NULL THEN
      RAISE EXCEPTION 'Invalid custom period: custom_start and custom_end are required' USING ERRCODE = '22023';
    END IF;
    IF p_custom_start >= p_custom_end THEN
      RAISE EXCEPTION 'Invalid custom period: custom_end must be strictly greater than custom_start' USING ERRCODE = '22023';
    END IF;

    curr_start := p_custom_start;
    curr_end := p_custom_end;
    v_dur := curr_end - curr_start;
    prev_start := curr_start - v_dur;
    prev_end := curr_start;

  ELSE
    -- Default fallback to 30d rolling
    curr_start := v_now - interval '30 days';
    curr_end := v_now;
    prev_start := v_now - interval '60 days';
    prev_end := v_now - interval '30 days';
  END IF;
END;
$$;


-- 2. TEAM OPERATIONAL PERFORMANCE RPC (STRICT LEDGER FIRST RESPONSE EPISODE TRUTH)
CREATE OR REPLACE FUNCTION public.get_manager_team_performance(
  p_account_id UUID,
  p_time_range TEXT DEFAULT '30d',
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_bounds RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_team JSONB := '[]'::jsonb;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check (Strictly Owner and Admin only)
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Team operational analytics requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_bounds
  FROM public.get_account_period_bounds(p_account_id, p_time_range, p_start_date, p_end_date);

  WITH members AS (
    SELECT
      p.user_id,
      p.full_name,
      p.avatar_url,
      p.account_role
    FROM public.profiles p
    WHERE p.account_id = p_account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
  ),
  conv_stats AS (
    -- Unique conversations where agent sent message in period
    SELECT
      m.sender_id AS user_id,
      COUNT(DISTINCT m.conversation_id) AS conversations_handled,
      COUNT(m.id) AS messages_sent
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id AND c.account_id = p_account_id
    WHERE m.sender_type = 'agent'
      AND m.created_at >= v_bounds.curr_start AND m.created_at < v_bounds.curr_end
      AND m.sender_id IS NOT NULL
    GROUP BY m.sender_id
  ),
  first_customer_msgs AS (
    -- 1. Initial customer turn start timestamp per conversation (handles customer bursts cleanly)
    SELECT
      m.conversation_id,
      MIN(m.created_at) AS first_customer_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id AND c.account_id = p_account_id
    WHERE m.sender_type = 'customer'
    GROUP BY m.conversation_id
  ),
  first_agent_msgs AS (
    -- 2. First agent message responding to the initial customer turn
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.id AS message_id,
      m.sender_id,
      m.created_at AS first_response_at,
      ROUND(EXTRACT(EPOCH FROM (m.created_at - fcm.first_customer_at)))::numeric AS response_duration_seconds
    FROM public.messages m
    JOIN first_customer_msgs fcm ON fcm.conversation_id = m.conversation_id
    JOIN public.conversations c ON c.id = m.conversation_id AND c.account_id = p_account_id
    WHERE m.sender_type = 'agent'
      AND m.created_at >= fcm.first_customer_at
    ORDER BY m.conversation_id, m.created_at ASC
  ),
  first_responses AS (
    -- 3. Filter strictly to human-attributed responses occurring within the requested period bounds
    SELECT
      fam.conversation_id,
      fam.sender_id AS first_responder_id,
      fam.first_response_at,
      fam.response_duration_seconds
    FROM first_agent_msgs fam
    WHERE fam.sender_id IS NOT NULL
      AND fam.first_response_at >= v_bounds.curr_start 
      AND fam.first_response_at < v_bounds.curr_end
      AND fam.response_duration_seconds >= 0
  ),
  response_times AS (
    -- 4. P50 / P90 percentiles per verified human responder
    SELECT
      first_responder_id AS user_id,
      ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY response_duration_seconds)::numeric, 0) AS median_response_seconds,
      ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY response_duration_seconds)::numeric, 0) AS p90_response_seconds
    FROM first_responses
    GROUP BY first_responder_id
  ),
  followup_stats AS (
    SELECT
      t.completed_by_user_id AS user_id,
      COUNT(t.id) AS followups_completed,
      COUNT(t.id) FILTER (WHERE t.completed_at <= t.due_at) AS followups_on_time
    FROM public.tasks t
    WHERE t.account_id = p_account_id
      AND t.status = 'completed'
      AND t.completed_at >= v_bounds.curr_start AND t.completed_at < v_bounds.curr_end
      AND t.completed_by_user_id IS NOT NULL
    GROUP BY t.completed_by_user_id
  ),
  current_task_backlog AS (
    SELECT
      t.assigned_user_id AS user_id,
      COUNT(t.id) FILTER (WHERE t.due_at < v_now) AS followups_overdue,
      COUNT(t.id) AS followups_pending_total
    FROM public.tasks t
    WHERE t.account_id = p_account_id
      AND t.status = 'pending'
      AND t.assigned_user_id IS NOT NULL
    GROUP BY t.assigned_user_id
  ),
  hot_leads_no_action AS (
    SELECT
      c.assigned_agent_id AS user_id,
      COUNT(DISTINCT c.contact_id) AS hot_leads_without_action
    FROM public.conversations c
    JOIN public.contact_lead_scores ls ON ls.contact_id = c.contact_id AND ls.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND c.assigned_agent_id IS NOT NULL
      AND ls.score >= 70
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.account_id = p_account_id AND t.contact_id = c.contact_id AND t.status = 'pending'
      )
    GROUP BY c.assigned_agent_id
  ),
  objections_handled AS (
    SELECT
      o.responsible_user_id AS user_id,
      COUNT(o.id) AS objections_encountered
    FROM public.conversation_objection_occurrences o
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at < v_bounds.curr_end
      AND o.responsible_user_id IS NOT NULL
    GROUP BY o.responsible_user_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'full_name', COALESCE(m.full_name, 'Agente'),
      'avatar_url', m.avatar_url,
      'role', m.account_role,
      'conversations_handled', COALESCE(cs.conversations_handled, 0),
      'messages_sent', COALESCE(cs.messages_sent, 0),
      'median_response_seconds', rt.median_response_seconds,
      'p90_response_seconds', rt.p90_response_seconds,
      'followups_completed', COALESCE(fs.followups_completed, 0),
      'followups_on_time', COALESCE(fs.followups_on_time, 0),
      'followups_on_time_pct', CASE 
        WHEN COALESCE(fs.followups_completed, 0) > 0 
        THEN ROUND((COALESCE(fs.followups_on_time, 0)::numeric / fs.followups_completed::numeric) * 100, 1) 
        ELSE NULL 
      END,
      'followups_overdue', COALESCE(tb.followups_overdue, 0),
      'hot_leads_without_action', COALESCE(hl.hot_leads_without_action, 0),
      'objections_encountered', COALESCE(oh.objections_encountered, 0)
    ) ORDER BY COALESCE(cs.conversations_handled, 0) DESC, COALESCE(fs.followups_completed, 0) DESC
  ), '[]'::jsonb)
  INTO v_team
  FROM members m
  LEFT JOIN conv_stats cs ON cs.user_id = m.user_id
  LEFT JOIN response_times rt ON rt.user_id = m.user_id
  LEFT JOIN followup_stats fs ON fs.user_id = m.user_id
  LEFT JOIN current_task_backlog tb ON tb.user_id = m.user_id
  LEFT JOIN hot_leads_no_action hl ON hl.user_id = m.user_id
  LEFT JOIN objections_handled oh ON oh.user_id = m.user_id;

  RETURN jsonb_build_object(
    'team', v_team
  );
END;
$$;

-- Security grants & revokes
REVOKE ALL ON FUNCTION public.get_account_period_bounds(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_period_bounds(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.get_manager_team_performance(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_team_performance(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
