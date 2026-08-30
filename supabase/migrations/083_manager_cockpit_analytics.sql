-- ============================================================
-- Migration 083: Manager Cockpit & Commercial Operating View Analytics
-- Deterministic, indexed, and secure analytics RPCs for Ciclopes V1.4
-- ============================================================

-- 1. INDEXES FOR HIGH PERFORMANCE QUERY EXECUTION
CREATE INDEX IF NOT EXISTS idx_objection_occ_acc_occurred_tax 
  ON public.conversation_objection_occurrences (account_id, occurred_at DESC, effective_taxonomy_id);

CREATE INDEX IF NOT EXISTS idx_objection_occ_acc_cat_item 
  ON public.conversation_objection_occurrences (account_id, catalog_item_id, occurred_at DESC)
  WHERE catalog_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_acc_type_observed 
  ON public.conversation_insights (account_id, insight_type, observed_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_tasks_acc_status_due_at 
  ON public.tasks (account_id, status, due_at ASC);

CREATE INDEX IF NOT EXISTS idx_tasks_acc_completed_user 
  ON public.tasks (account_id, completed_at DESC, completed_by_user_id)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_conv_acc_assigned_updated 
  ON public.conversations (account_id, assigned_agent_id, updated_at DESC);

-- 2. PERIOD BOUNDS HELPER FUNCTION
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
  v_tz TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_local_now TIMESTAMP;
  v_local_day_start TIMESTAMP;
  v_local_month_start TIMESTAMP;
  v_dur INTERVAL;
BEGIN
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

  -- 2. Calculate bounds
  IF p_range = 'today' THEN
    curr_start := (v_local_day_start) AT TIME ZONE v_tz;
    curr_end := v_now;
    prev_start := (v_local_day_start - interval '1 day') AT TIME ZONE v_tz;
    prev_end := (v_local_day_start) AT TIME ZONE v_tz;

  ELSIF p_range = '7d' THEN
    curr_start := (v_local_day_start - interval '6 days') AT TIME ZONE v_tz;
    curr_end := v_now;
    prev_start := (v_local_day_start - interval '13 days') AT TIME ZONE v_tz;
    prev_end := (v_local_day_start - interval '6 days') AT TIME ZONE v_tz;

  ELSIF p_range = '30d' THEN
    curr_start := (v_local_day_start - interval '29 days') AT TIME ZONE v_tz;
    curr_end := v_now;
    prev_start := (v_local_day_start - interval '59 days') AT TIME ZONE v_tz;
    prev_end := (v_local_day_start - interval '29 days') AT TIME ZONE v_tz;

  ELSIF p_range = 'month' THEN
    curr_start := (v_local_month_start) AT TIME ZONE v_tz;
    curr_end := v_now;
    prev_start := (date_trunc('month', v_local_month_start - interval '1 day')) AT TIME ZONE v_tz;
    prev_end := (v_local_month_start) AT TIME ZONE v_tz;

  ELSIF p_range = 'custom' AND p_custom_start IS NOT NULL AND p_custom_end IS NOT NULL THEN
    curr_start := p_custom_start;
    curr_end := p_custom_end;
    v_dur := curr_end - curr_start;
    IF v_dur <= interval '0 seconds' THEN
      v_dur := interval '1 day';
    END IF;
    prev_start := curr_start - v_dur;
    prev_end := curr_start;
  ELSE
    -- Default to 30d
    curr_start := (v_local_day_start - interval '29 days') AT TIME ZONE v_tz;
    curr_end := v_now;
    prev_start := (v_local_day_start - interval '59 days') AT TIME ZONE v_tz;
    prev_end := (v_local_day_start - interval '29 days') AT TIME ZONE v_tz;
  END IF;
END;
$$;


-- 3. EXECUTIVE PULSE & SUMMARY RPC
CREATE OR REPLACE FUNCTION public.get_manager_cockpit_summary(
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

  -- Metrics
  v_active_leads_curr INT := 0;
  v_active_leads_prev INT := 0;

  v_hot_leads_curr INT := 0;
  v_warm_leads_curr INT := 0;
  v_cold_leads_curr INT := 0;

  v_overdue_followups_curr INT := 0;
  v_overdue_followups_prev INT := 0;

  v_leads_no_next_action_curr INT := 0;

  v_objections_curr INT := 0;
  v_objections_prev INT := 0;

  v_open_deals_count INT := 0;
  v_open_deals_value NUMERIC := 0;

  -- Operational Health
  v_unassigned_conversations INT := 0;
  v_unassigned_followups INT := 0;
  v_intelligence_settings RECORD;
  v_intelligence_backlog INT := 0;

  -- Freshness
  v_last_message_at TIMESTAMPTZ;
  v_last_analysis_at TIMESTAMPTZ;

  -- Attention counts
  v_urgent_attention_count INT := 0;
  v_high_attention_count INT := 0;
  v_medium_attention_count INT := 0;

  -- Highlights
  v_what_changed JSONB := '[]'::jsonb;
  v_obj_delta_pct NUMERIC;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check (owner or admin only)
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Manager Cockpit requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Calculate period bounds
  SELECT * INTO v_bounds
  FROM public.get_account_period_bounds(p_account_id, p_time_range, p_start_date, p_end_date);

  -- 1. Active Leads (Contacts with conversations having activity in period)
  SELECT COUNT(DISTINCT contact_id) INTO v_active_leads_curr
  FROM public.conversations
  WHERE account_id = p_account_id
    AND updated_at >= v_bounds.curr_start AND updated_at <= v_bounds.curr_end;

  SELECT COUNT(DISTINCT contact_id) INTO v_active_leads_prev
  FROM public.conversations
  WHERE account_id = p_account_id
    AND updated_at >= v_bounds.prev_start AND updated_at < v_bounds.prev_end;

  -- 2. Hot / Warm / Cold Leads (Snapshot from contact_lead_scores)
  SELECT
    COUNT(*) FILTER (WHERE score >= 70),
    COUNT(*) FILTER (WHERE score >= 40 AND score < 70),
    COUNT(*) FILTER (WHERE score < 40)
  INTO v_hot_leads_curr, v_warm_leads_curr, v_cold_leads_curr
  FROM public.contact_lead_scores
  WHERE account_id = p_account_id;

  -- 3. Overdue Follow-ups (Current open tasks past due)
  SELECT COUNT(*) INTO v_overdue_followups_curr
  FROM public.tasks
  WHERE account_id = p_account_id
    AND status = 'pending'
    AND due_at < v_now;

  -- Overdue in previous period cutoff
  SELECT COUNT(*) INTO v_overdue_followups_prev
  FROM public.tasks
  WHERE account_id = p_account_id
    AND status = 'pending'
    AND due_at < v_bounds.prev_end;

  -- 4. Leads Without Next Action (Active contacts without open task)
  SELECT COUNT(DISTINCT c.contact_id) INTO v_leads_no_next_action_curr
  FROM public.conversations c
  WHERE c.account_id = p_account_id
    AND c.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.account_id = p_account_id
        AND t.contact_id = c.contact_id
        AND t.status = 'pending'
    );

  -- 5. Period Objections (from event occurrence ledger)
  SELECT COUNT(*) INTO v_objections_curr
  FROM public.conversation_objection_occurrences
  WHERE account_id = p_account_id
    AND occurred_at >= v_bounds.curr_start AND occurred_at <= v_bounds.curr_end;

  SELECT COUNT(*) INTO v_objections_prev
  FROM public.conversation_objection_occurrences
  WHERE account_id = p_account_id
    AND occurred_at >= v_bounds.prev_start AND occurred_at < v_bounds.prev_end;

  -- 6. Open Deals Snapshot
  SELECT COUNT(*), COALESCE(SUM(value), 0)
  INTO v_open_deals_count, v_open_deals_value
  FROM public.deals
  WHERE account_id = p_account_id
    AND status = 'open';

  -- 7. Operational Health
  SELECT COUNT(*) INTO v_unassigned_conversations
  FROM public.conversations
  WHERE account_id = p_account_id
    AND status = 'open'
    AND assigned_agent_id IS NULL;

  SELECT COUNT(*) INTO v_unassigned_followups
  FROM public.tasks
  WHERE account_id = p_account_id
    AND status = 'pending'
    AND assigned_user_id IS NULL;

  SELECT enabled, invocation_mode, provider, model INTO v_intelligence_settings
  FROM public.tenant_intelligence_settings
  WHERE account_id = p_account_id;

  SELECT COUNT(*) INTO v_intelligence_backlog
  FROM public.conversations
  WHERE account_id = p_account_id
    AND commercial_state_dirty = true
    AND pending_message_count > 0;

  -- 8. Data Freshness Timestamps
  SELECT MAX(m.created_at) INTO v_last_message_at
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id;

  SELECT MAX(completed_at) INTO v_last_analysis_at
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id AND status = 'completed';

  -- 9. What Changed? Highlights (Deterministic template based on valid deltas)
  IF v_objections_prev > 0 THEN
    v_obj_delta_pct := ROUND(((v_objections_curr - v_objections_prev)::numeric / v_objections_prev::numeric) * 100, 1);
    IF v_obj_delta_pct > 10 THEN
      v_what_changed := v_what_changed || jsonb_build_object(
        'type', 'objections_up',
        'direction', 'up',
        'severity', 'warning',
        'text', format('Objeções registradas subiram %s%% em relação ao período anterior.', v_obj_delta_pct)
      );
    ELSIF v_obj_delta_pct < -10 THEN
      v_what_changed := v_what_changed || jsonb_build_object(
        'type', 'objections_down',
        'direction', 'down',
        'severity', 'positive',
        'text', format('Objeções registradas caíram %s%% em relação ao período anterior.', abs(v_obj_delta_pct))
      );
    END IF;
  END IF;

  IF v_overdue_followups_curr > 0 THEN
    v_what_changed := v_what_changed || jsonb_build_object(
      'type', 'followups_overdue',
      'direction', 'neutral',
      'severity', CASE WHEN v_overdue_followups_curr > 5 THEN 'danger' ELSE 'warning' END,
      'text', format('%s follow-ups atrasados exigem acompanhamento da equipe.', v_overdue_followups_curr)
    );
  END IF;

  IF v_hot_leads_curr > 0 AND v_leads_no_next_action_curr > 0 THEN
    v_what_changed := v_what_changed || jsonb_build_object(
      'type', 'hot_leads_attention',
      'direction', 'neutral',
      'severity', 'danger',
      'text', format('%s leads sem próxima ação definida na operação comercial.', v_leads_no_next_action_curr)
    );
  END IF;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'range', p_time_range,
      'timezone', v_bounds.tz,
      'curr_start', v_bounds.curr_start,
      'curr_end', v_bounds.curr_end,
      'prev_start', v_bounds.prev_start,
      'prev_end', v_bounds.prev_end
    ),
    'executive_pulse', jsonb_build_object(
      'active_leads', jsonb_build_object(
        'current', v_active_leads_curr,
        'previous', v_active_leads_prev,
        'delta_pct', CASE WHEN v_active_leads_prev > 0 THEN ROUND(((v_active_leads_curr - v_active_leads_prev)::numeric / v_active_leads_prev::numeric) * 100, 1) ELSE NULL END
      ),
      'hot_leads', jsonb_build_object(
        'current', v_hot_leads_curr,
        'warm', v_warm_leads_curr,
        'cold', v_cold_leads_curr
      ),
      'overdue_followups', jsonb_build_object(
        'current', v_overdue_followups_curr,
        'previous', v_overdue_followups_prev,
        'delta_pct', CASE WHEN v_overdue_followups_prev > 0 THEN ROUND(((v_overdue_followups_curr - v_overdue_followups_prev)::numeric / v_overdue_followups_prev::numeric) * 100, 1) ELSE NULL END
      ),
      'leads_without_next_action', jsonb_build_object(
        'current', v_leads_no_next_action_curr
      ),
      'period_objections', jsonb_build_object(
        'current', v_objections_curr,
        'previous', v_objections_prev,
        'delta_pct', CASE WHEN v_objections_prev > 0 THEN ROUND(((v_objections_curr - v_objections_prev)::numeric / v_objections_prev::numeric) * 100, 1) ELSE NULL END
      ),
      'pipeline_snapshot', jsonb_build_object(
        'open_deals_count', v_open_deals_count,
        'open_deals_value', v_open_deals_value
      )
    ),
    'what_changed', v_what_changed,
    'operational_health', jsonb_build_object(
      'unassigned_conversations', v_unassigned_conversations,
      'unassigned_followups', v_unassigned_followups,
      'leads_without_next_action', v_leads_no_next_action_curr,
      'intelligence_status', jsonb_build_object(
        'enabled', COALESCE(v_intelligence_settings.enabled, false),
        'invocation_mode', COALESCE(v_intelligence_settings.invocation_mode, 'manual'),
        'provider', v_intelligence_settings.provider,
        'model', v_intelligence_settings.model,
        'backlog_count', v_intelligence_backlog
      )
    ),
    'data_freshness', jsonb_build_object(
      'last_message_at', v_last_message_at,
      'last_analysis_at', v_last_analysis_at,
      'evaluated_at', v_now
    )
  );
END;
$$;


-- 4. ATTENTION QUEUE RPC (RANKED & PRIORITIZED)
CREATE OR REPLACE FUNCTION public.get_manager_attention_queue(
  p_account_id UUID,
  p_priority_filter TEXT DEFAULT 'all',
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
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
  v_now TIMESTAMPTZ := clock_timestamp();
  v_items JSONB := '[]'::jsonb;
  v_total_count INT := 0;
  v_urgent_count INT := 0;
  v_high_count INT := 0;
  v_medium_count INT := 0;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Manager Cockpit requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH raw_attention_items AS (
    -- Item Type 1: Hot Lead with Buying Signal and NO next action (URGENT)
    SELECT
      'buying_signal_no_action' AS reason_code,
      'Sinal de compra recente sem próxima ação' AS reason_label,
      'urgent' AS priority,
      1 AS priority_rank,
      c.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      c.id AS conversation_id,
      COALESCE(ls.score, 0) AS score,
      CASE WHEN COALESCE(ls.score, 0) >= 70 THEN 'hot' WHEN COALESCE(ls.score, 0) >= 40 THEN 'warm' ELSE 'cold' END AS score_tier,
      c.assigned_agent_id AS responsible_user_id,
      p.full_name AS responsible_user_name,
      ci.value_text AS signal_text,
      cat.id AS product_id,
      cat.name AS product_name,
      EXTRACT(EPOCH FROM (v_now - c.updated_at))::int AS idle_time_seconds,
      NULL::text AS next_action_text,
      NULL::timestamptz AS next_action_due_at,
      NULL::uuid AS task_id,
      c.updated_at AS event_time
    FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = p_account_id
    JOIN public.contact_lead_scores ls ON ls.contact_id = c.contact_id AND ls.account_id = p_account_id
    JOIN public.conversation_insights ci ON ci.conversation_id = c.id AND ci.account_id = p_account_id
      AND ci.insight_type = 'buying_signal' AND ci.status = 'active'
    LEFT JOIN public.profiles p ON p.user_id = c.assigned_agent_id AND p.account_id = p_account_id
    LEFT JOIN public.contact_catalog_interests cci ON cci.contact_id = c.contact_id AND cci.account_id = p_account_id
    LEFT JOIN public.catalog_items cat ON cat.id = cci.catalog_item_id AND cat.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND ls.score >= 70
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.account_id = p_account_id AND t.contact_id = c.contact_id AND t.status = 'pending'
      )

    UNION ALL

    -- Item Type 2: Overdue Follow-up (HIGH)
    SELECT
      'task_overdue' AS reason_code,
      'Follow-up atrasado' AS reason_label,
      'high' AS priority,
      2 AS priority_rank,
      t.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      t.conversation_id,
      COALESCE(ls.score, 0) AS score,
      CASE WHEN COALESCE(ls.score, 0) >= 70 THEN 'hot' WHEN COALESCE(ls.score, 0) >= 40 THEN 'warm' ELSE 'cold' END AS score_tier,
      t.assigned_user_id AS responsible_user_id,
      p.full_name AS responsible_user_name,
      t.title AS signal_text,
      NULL::uuid AS product_id,
      NULL::text AS product_name,
      EXTRACT(EPOCH FROM (v_now - t.due_at))::int AS idle_time_seconds,
      t.title AS next_action_text,
      t.due_at AS next_action_due_at,
      t.id AS task_id,
      t.due_at AS event_time
    FROM public.tasks t
    JOIN public.contacts ct ON ct.id = t.contact_id AND ct.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = t.contact_id AND ls.account_id = p_account_id
    LEFT JOIN public.profiles p ON p.user_id = t.assigned_user_id AND p.account_id = p_account_id
    WHERE t.account_id = p_account_id
      AND t.status = 'pending'
      AND t.due_at < v_now

    UNION ALL

    -- Item Type 3: Hot Lead Without Any Next Action (HIGH)
    SELECT
      'hot_lead_no_action' AS reason_code,
      'Lead quente sem próxima ação definida' AS reason_label,
      'high' AS priority,
      2 AS priority_rank,
      c.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      c.id AS conversation_id,
      COALESCE(ls.score, 0) AS score,
      'hot' AS score_tier,
      c.assigned_agent_id AS responsible_user_id,
      p.full_name AS responsible_user_name,
      'Lead com score alto sem tarefas abertas' AS signal_text,
      NULL::uuid AS product_id,
      NULL::text AS product_name,
      EXTRACT(EPOCH FROM (v_now - c.updated_at))::int AS idle_time_seconds,
      NULL::text AS next_action_text,
      NULL::timestamptz AS next_action_due_at,
      NULL::uuid AS task_id,
      c.updated_at AS event_time
    FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = p_account_id
    JOIN public.contact_lead_scores ls ON ls.contact_id = c.contact_id AND ls.account_id = p_account_id
    LEFT JOIN public.profiles p ON p.user_id = c.assigned_agent_id AND p.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND ls.score >= 70
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.account_id = p_account_id AND t.contact_id = c.contact_id AND t.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_insights ci
        WHERE ci.conversation_id = c.id AND ci.account_id = p_account_id AND ci.insight_type = 'buying_signal' AND ci.status = 'active'
      )

    UNION ALL

    -- Item Type 4: Open Conversation Without Assigned Agent (MEDIUM)
    SELECT
      'unassigned_conversation' AS reason_code,
      'Conversa aberta sem responsável' AS reason_label,
      'medium' AS priority,
      3 AS priority_rank,
      c.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      c.id AS conversation_id,
      COALESCE(ls.score, 0) AS score,
      CASE WHEN COALESCE(ls.score, 0) >= 70 THEN 'hot' WHEN COALESCE(ls.score, 0) >= 40 THEN 'warm' ELSE 'cold' END AS score_tier,
      NULL::uuid AS responsible_user_id,
      'Sem responsável' AS responsible_user_name,
      c.last_message_text AS signal_text,
      NULL::uuid AS product_id,
      NULL::text AS product_name,
      EXTRACT(EPOCH FROM (v_now - c.updated_at))::int AS idle_time_seconds,
      NULL::text AS next_action_text,
      NULL::timestamptz AS next_action_due_at,
      NULL::uuid AS task_id,
      c.updated_at AS event_time
    FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = c.contact_id AND ls.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND c.assigned_agent_id IS NULL
  ),
  deduped_items AS (
    SELECT DISTINCT ON (contact_id, reason_code)
      *
    FROM raw_attention_items
    ORDER BY contact_id, reason_code, priority_rank ASC, score DESC
  ),
  summary_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent_count,
      COUNT(*) FILTER (WHERE priority = 'high') AS high_count,
      COUNT(*) FILTER (WHERE priority = 'medium') AS medium_count,
      COUNT(*) AS total_count
    FROM deduped_items
  ),
  filtered_items AS (
    SELECT *
    FROM deduped_items
    WHERE (p_priority_filter = 'all' OR priority = p_priority_filter)
    ORDER BY priority_rank ASC, score DESC, idle_time_seconds DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    COALESCE(sc.total_count, 0),
    COALESCE(sc.urgent_count, 0),
    COALESCE(sc.high_count, 0),
    COALESCE(sc.medium_count, 0),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'contact_id', fi.contact_id,
          'contact_name', fi.contact_name,
          'contact_phone', fi.contact_phone,
          'conversation_id', fi.conversation_id,
          'reason_code', fi.reason_code,
          'reason_label', fi.reason_label,
          'priority', fi.priority,
          'score', fi.score,
          'score_tier', fi.score_tier,
          'responsible_user_id', fi.responsible_user_id,
          'responsible_user_name', fi.responsible_user_name,
          'signal_text', fi.signal_text,
          'product_id', fi.product_id,
          'product_name', fi.product_name,
          'idle_time_seconds', fi.idle_time_seconds,
          'next_action_text', fi.next_action_text,
          'next_action_due_at', fi.next_action_due_at,
          'task_id', fi.task_id,
          'event_time', fi.event_time
        )
      ) FROM filtered_items fi
    ), '[]'::jsonb)
  INTO v_total_count, v_urgent_count, v_high_count, v_medium_count, v_items
  FROM summary_counts sc;

  RETURN jsonb_build_object(
    'total_count', v_total_count,
    'urgent_count', v_urgent_count,
    'high_count', v_high_count,
    'medium_count', v_medium_count,
    'limit', p_limit,
    'offset', p_offset,
    'items', v_items
  );
END;
$$;


-- 5. OBJECTION ANALYTICS RPC (WITH CANONICAL TAXONOMY & REAL EVIDENCE QUOTES)
CREATE OR REPLACE FUNCTION public.get_manager_objection_analytics(
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
  v_total_curr INT := 0;
  v_total_prev INT := 0;
  v_top_objections JSONB := '[]'::jsonb;
  v_trend JSONB := '[]'::jsonb;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Manager Cockpit requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_bounds
  FROM public.get_account_period_bounds(p_account_id, p_time_range, p_start_date, p_end_date);

  -- Total counts
  SELECT COUNT(*) INTO v_total_curr
  FROM public.conversation_objection_occurrences
  WHERE account_id = p_account_id
    AND occurred_at >= v_bounds.curr_start AND occurred_at <= v_bounds.curr_end;

  SELECT COUNT(*) INTO v_total_prev
  FROM public.conversation_objection_occurrences
  WHERE account_id = p_account_id
    AND occurred_at >= v_bounds.prev_start AND occurred_at < v_bounds.prev_end;

  -- Top Objections by Taxonomy Code
  WITH curr_counts AS (
    SELECT
      COALESCE(t.id, '00000000-0000-0000-0000-000000000000'::uuid) AS taxonomy_id,
      COALESCE(t.code, 'other') AS code,
      COALESCE(t.name, 'Outras / Geral') AS name,
      COUNT(o.id) AS curr_count
    FROM public.conversation_objection_occurrences o
    LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
    GROUP BY t.id, t.code, t.name
  ),
  prev_counts AS (
    SELECT
      COALESCE(t.code, 'other') AS code,
      COUNT(o.id) AS prev_count
    FROM public.conversation_objection_occurrences o
    LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.prev_start AND o.occurred_at < v_bounds.prev_end
    GROUP BY t.code
  ),
  sample_quotes AS (
    SELECT DISTINCT ON (COALESCE(t.code, 'other'))
      COALESCE(t.code, 'other') AS code,
      COALESCE(e.snippet, o.raw_objection) AS quote_snippet
    FROM public.conversation_objection_occurrences o
    LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
    LEFT JOIN public.conversation_insight_evidence e ON e.insight_id = o.insight_id
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
    ORDER BY COALESCE(t.code, 'other'), o.occurred_at DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'taxonomy_id', c.taxonomy_id,
      'code', c.code,
      'name', c.name,
      'count', c.curr_count,
      'percentage', CASE WHEN v_total_curr > 0 THEN ROUND((c.curr_count::numeric / v_total_curr::numeric) * 100, 1) ELSE 0 END,
      'previous_count', COALESCE(p.prev_count, 0),
      'delta_pct', CASE WHEN COALESCE(p.prev_count, 0) > 0 THEN ROUND(((c.curr_count - p.prev_count)::numeric / p.prev_count::numeric) * 100, 1) ELSE NULL END,
      'sample_quote', sq.quote_snippet
    ) ORDER BY c.curr_count DESC
  ), '[]'::jsonb)
  INTO v_top_objections
  FROM curr_counts c
  LEFT JOIN prev_counts p ON p.code = c.code
  LEFT JOIN sample_quotes sq ON sq.code = c.code;

  -- Daily Trend for Chart
  WITH daily_series AS (
    SELECT
      to_char(date_trunc('day', timezone(v_bounds.tz, o.occurred_at)), 'YYYY-MM-DD') AS day_key,
      COALESCE(t.name, 'Outras') AS category,
      COUNT(*) AS day_count
    FROM public.conversation_objection_occurrences o
    LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
    GROUP BY day_key, category
    ORDER BY day_key ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', day_key,
      'category', category,
      'count', day_count
    )
  ), '[]'::jsonb)
  INTO v_trend
  FROM daily_series;

  RETURN jsonb_build_object(
    'total_count', v_total_curr,
    'previous_total_count', v_total_prev,
    'delta_pct', CASE WHEN v_total_prev > 0 THEN ROUND(((v_total_curr - v_total_prev)::numeric / v_total_prev::numeric) * 100, 1) ELSE NULL END,
    'top_objections', v_top_objections,
    'trend', v_trend
  );
END;
$$;


-- 6. OBJECTION DRILL-DOWN RPC (PAGINATED OCCURRENCES)
CREATE OR REPLACE FUNCTION public.get_manager_objection_drilldown(
  p_account_id UUID,
  p_taxonomy_id UUID DEFAULT NULL,
  p_taxonomy_code TEXT DEFAULT NULL,
  p_time_range TEXT DEFAULT '30d',
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
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
  v_total_count INT := 0;
  v_items JSONB := '[]'::jsonb;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Manager Cockpit requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_bounds
  FROM public.get_account_period_bounds(p_account_id, p_time_range, p_start_date, p_end_date);

  SELECT COUNT(o.id) INTO v_total_count
  FROM public.conversation_objection_occurrences o
  LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
  WHERE o.account_id = p_account_id
    AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
    AND (
      (p_taxonomy_id IS NOT NULL AND o.effective_taxonomy_id = p_taxonomy_id) OR
      (p_taxonomy_code IS NOT NULL AND (t.code = p_taxonomy_code OR (p_taxonomy_code = 'other' AND t.code IS NULL))) OR
      (p_taxonomy_id IS NULL AND p_taxonomy_code IS NULL)
    );

  WITH occurrences AS (
    SELECT
      o.id AS occurrence_id,
      o.conversation_id,
      o.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      o.raw_objection,
      o.confidence,
      o.occurred_at,
      COALESCE(t.name, 'Outras / Geral') AS taxonomy_name,
      COALESCE(t.code, 'other') AS taxonomy_code,
      cat.id AS catalog_item_id,
      cat.name AS catalog_item_name,
      o.responsible_user_id,
      COALESCE(p.full_name, 'Sem responsável identificado') AS responsible_user_name,
      o.override_at,
      o.override_reason,
      ovp.full_name AS override_by_user_name,
      e.snippet AS evidence_snippet
    FROM public.conversation_objection_occurrences o
    JOIN public.contacts ct ON ct.id = o.contact_id AND ct.account_id = p_account_id
    LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
    LEFT JOIN public.catalog_items cat ON cat.id = o.catalog_item_id AND cat.account_id = p_account_id
    LEFT JOIN public.profiles p ON p.user_id = o.responsible_user_id AND p.account_id = p_account_id
    LEFT JOIN public.profiles ovp ON ovp.user_id = o.override_by_user_id AND ovp.account_id = p_account_id
    LEFT JOIN public.conversation_insight_evidence e ON e.insight_id = o.insight_id
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
      AND (
        (p_taxonomy_id IS NOT NULL AND o.effective_taxonomy_id = p_taxonomy_id) OR
        (p_taxonomy_code IS NOT NULL AND (t.code = p_taxonomy_code OR (p_taxonomy_code = 'other' AND t.code IS NULL))) OR
        (p_taxonomy_id IS NULL AND p_taxonomy_code IS NULL)
      )
    ORDER BY o.occurred_at DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'occurrence_id', occurrence_id,
      'conversation_id', conversation_id,
      'contact_id', contact_id,
      'contact_name', contact_name,
      'contact_phone', contact_phone,
      'raw_objection', raw_objection,
      'confidence', confidence,
      'occurred_at', occurred_at,
      'taxonomy_name', taxonomy_name,
      'taxonomy_code', taxonomy_code,
      'catalog_item_id', catalog_item_id,
      'catalog_item_name', catalog_item_name,
      'responsible_user_id', responsible_user_id,
      'responsible_user_name', responsible_user_name,
      'override_at', override_at,
      'override_reason', override_reason,
      'override_by_user_name', override_by_user_name,
      'evidence_snippet', evidence_snippet
    )
  ), '[]'::jsonb)
  INTO v_items
  FROM occurrences;

  RETURN jsonb_build_object(
    'total_count', v_total_count,
    'limit', p_limit,
    'offset', p_offset,
    'items', v_items
  );
END;
$$;


-- 7. PRODUCT DEMAND & FRICTION INTELLIGENCE RPC
CREATE OR REPLACE FUNCTION public.get_manager_product_intelligence(
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
  v_products JSONB := '[]'::jsonb;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Manager Cockpit requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_bounds
  FROM public.get_account_period_bounds(p_account_id, p_time_range, p_start_date, p_end_date);

  WITH product_interests AS (
    SELECT
      i.catalog_item_id,
      COUNT(DISTINCT c.contact_id) AS unique_interested_contacts,
      COUNT(i.id) AS total_interest_occurrences
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = p_account_id
    WHERE i.account_id = p_account_id
      AND i.insight_type = 'interest'
      AND i.status = 'active'
      AND i.observed_at >= v_bounds.curr_start AND i.observed_at <= v_bounds.curr_end
      AND i.catalog_item_id IS NOT NULL
    GROUP BY i.catalog_item_id
  ),
  product_objections AS (
    SELECT
      o.catalog_item_id,
      COUNT(o.id) AS total_objection_occurrences,
      COUNT(DISTINCT o.contact_id) AS unique_objection_contacts
    FROM public.conversation_objection_occurrences o
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
      AND o.catalog_item_id IS NOT NULL
    GROUP BY o.catalog_item_id
  ),
  top_objection_per_product AS (
    SELECT DISTINCT ON (o.catalog_item_id)
      o.catalog_item_id,
      COALESCE(t.name, 'Outras') AS top_objection_name,
      COALESCE(t.code, 'other') AS top_objection_code,
      COUNT(*) AS top_objection_count
    FROM public.conversation_objection_occurrences o
    LEFT JOIN public.tenant_objection_taxonomy t ON t.id = o.effective_taxonomy_id
    WHERE o.account_id = p_account_id
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
      AND o.catalog_item_id IS NOT NULL
    GROUP BY o.catalog_item_id, t.name, t.code
    ORDER BY o.catalog_item_id, COUNT(*) DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'catalog_item_id', cat.id,
      'name', cat.name,
      'sku', cat.sku,
      'type', cat.type,
      'description', cat.description,
      'unique_interested_contacts', COALESCE(pi.unique_interested_contacts, 0),
      'interest_occurrences', COALESCE(pi.total_interest_occurrences, 0),
      'objection_occurrences', COALESCE(po.total_objection_occurrences, 0),
      'friction_rate', CASE 
        WHEN COALESCE(pi.unique_interested_contacts, 0) > 0 
        THEN ROUND((COALESCE(po.unique_objection_contacts, 0)::numeric / pi.unique_interested_contacts::numeric) * 100, 1) 
        ELSE 0 
      END,
      'top_objection_name', top_obj.top_objection_name,
      'top_objection_code', top_obj.top_objection_code,
      'top_objection_count', COALESCE(top_obj.top_objection_count, 0)
    ) ORDER BY COALESCE(pi.unique_interested_contacts, 0) DESC, COALESCE(po.total_objection_occurrences, 0) DESC
  ), '[]'::jsonb)
  INTO v_products
  FROM public.catalog_items cat
  LEFT JOIN product_interests pi ON pi.catalog_item_id = cat.id
  LEFT JOIN product_objections po ON po.catalog_item_id = cat.id
  LEFT JOIN top_objection_per_product top_obj ON top_obj.catalog_item_id = cat.id
  WHERE cat.account_id = p_account_id
    AND cat.status = 'active'
    AND (pi.total_interest_occurrences > 0 OR po.total_objection_occurrences > 0);

  RETURN jsonb_build_object(
    'products', v_products
  );
END;
$$;


-- 8. TEAM OPERATIONAL PERFORMANCE RPC
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
      p.email,
      p.avatar_url,
      p.account_role
    FROM public.profiles p
    WHERE p.account_id = p_account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
  ),
  conv_stats AS (
    -- Unique conversations where agent sent message in period OR is currently assigned
    SELECT
      m.sender_id AS user_id,
      COUNT(DISTINCT m.conversation_id) AS conversations_handled,
      COUNT(m.id) AS messages_sent
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id AND c.account_id = p_account_id
    WHERE m.sender_type = 'agent'
      AND m.created_at >= v_bounds.curr_start AND m.created_at <= v_bounds.curr_end
      AND m.sender_id IS NOT NULL
    GROUP BY m.sender_id
  ),
  response_times AS (
    -- Percentiles of first response duration
    SELECT
      c.assigned_agent_id AS user_id,
      ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY c.first_response_duration_seconds)::numeric, 0) AS median_response_seconds,
      ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY c.first_response_duration_seconds)::numeric, 0) AS p90_response_seconds
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND c.first_response_at >= v_bounds.curr_start AND c.first_response_at <= v_bounds.curr_end
      AND c.first_response_duration_seconds IS NOT NULL
      AND c.assigned_agent_id IS NOT NULL
    GROUP BY c.assigned_agent_id
  ),
  followup_stats AS (
    SELECT
      t.completed_by_user_id AS user_id,
      COUNT(t.id) AS followups_completed,
      COUNT(t.id) FILTER (WHERE t.completed_at <= t.due_at) AS followups_on_time
    FROM public.tasks t
    WHERE t.account_id = p_account_id
      AND t.status = 'completed'
      AND t.completed_at >= v_bounds.curr_start AND t.completed_at <= v_bounds.curr_end
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
      AND o.occurred_at >= v_bounds.curr_start AND o.occurred_at <= v_bounds.curr_end
      AND o.responsible_user_id IS NOT NULL
    GROUP BY o.responsible_user_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'full_name', COALESCE(m.full_name, 'Agente'),
      'email', m.email,
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


-- 9. SIGNALS & PIPELINE SNAPSHOT RPC
CREATE OR REPLACE FUNCTION public.get_manager_signals_and_pipeline(
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
  v_buying_signals JSONB := '[]'::jsonb;
  v_loss_signals JSONB := '[]'::jsonb;
  v_pipeline JSONB := '{}'::jsonb;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Authorization check
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Signals analytics requires owner or admin role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_bounds
  FROM public.get_account_period_bounds(p_account_id, p_time_range, p_start_date, p_end_date);

  -- 1. Buying Signals
  WITH raw_buying_signals AS (
    SELECT
      i.id AS insight_id,
      i.conversation_id,
      c.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      i.value_text AS signal_text,
      i.confidence,
      i.observed_at,
      COALESCE(ls.score, 0) AS score,
      CASE WHEN COALESCE(ls.score, 0) >= 70 THEN 'hot' WHEN COALESCE(ls.score, 0) >= 40 THEN 'warm' ELSE 'cold' END AS score_tier,
      COALESCE(p.full_name, 'Sem responsável') AS responsible_user_name,
      EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.account_id = p_account_id AND t.contact_id = c.contact_id AND t.status = 'pending'
      ) AS has_followup
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = p_account_id
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores ls ON ls.contact_id = c.contact_id AND ls.account_id = p_account_id
    LEFT JOIN public.profiles p ON p.user_id = c.assigned_agent_id AND p.account_id = p_account_id
    WHERE i.account_id = p_account_id
      AND i.insight_type = 'buying_signal'
      AND i.status = 'active'
      AND i.observed_at >= v_bounds.curr_start AND i.observed_at <= v_bounds.curr_end
    ORDER BY i.observed_at DESC
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'insight_id', insight_id,
      'conversation_id', conversation_id,
      'contact_id', contact_id,
      'contact_name', contact_name,
      'contact_phone', contact_phone,
      'signal_text', signal_text,
      'confidence', confidence,
      'observed_at', observed_at,
      'score', score,
      'score_tier', score_tier,
      'responsible_user_name', responsible_user_name,
      'has_followup', has_followup
    )
  ), '[]'::jsonb)
  INTO v_buying_signals
  FROM raw_buying_signals;

  -- 2. Loss Signals
  WITH raw_loss_signals AS (
    SELECT
      i.id AS insight_id,
      i.conversation_id,
      c.contact_id,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      i.value_text AS signal_text,
      i.confidence,
      i.observed_at,
      COALESCE(p.full_name, 'Sem responsável') AS responsible_user_name
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = p_account_id
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = p_account_id
    LEFT JOIN public.profiles p ON p.user_id = c.assigned_agent_id AND p.account_id = p_account_id
    WHERE i.account_id = p_account_id
      AND i.insight_type = 'loss_signal'
      AND i.status = 'active'
      AND i.observed_at >= v_bounds.curr_start AND i.observed_at <= v_bounds.curr_end
    ORDER BY i.observed_at DESC
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'insight_id', insight_id,
      'conversation_id', conversation_id,
      'contact_id', contact_id,
      'contact_name', contact_name,
      'contact_phone', contact_phone,
      'signal_text', signal_text,
      'confidence', confidence,
      'observed_at', observed_at,
      'responsible_user_name', responsible_user_name
    )
  ), '[]'::jsonb)
  INTO v_loss_signals
  FROM raw_loss_signals;

  -- 3. Pipeline Snapshot
  WITH stage_counts AS (
    SELECT
      s.id AS stage_id,
      s.name AS stage_name,
      s.position,
      COUNT(d.id) AS deals_count,
      COALESCE(SUM(d.value), 0) AS total_value
    FROM public.pipeline_stages s
    LEFT JOIN public.deals d ON d.stage_id = s.id AND d.account_id = p_account_id AND d.status = 'open'
    WHERE s.account_id = p_account_id
    GROUP BY s.id, s.name, s.position
    ORDER BY s.position ASC
  )
  SELECT jsonb_build_object(
    'is_snapshot', true,
    'stages', COALESCE(jsonb_agg(
      jsonb_build_object(
        'stage_id', stage_id,
        'stage_name', stage_name,
        'position', position,
        'deals_count', deals_count,
        'total_value', total_value
      )
    ), '[]'::jsonb),
    'total_open_deals', (SELECT COUNT(*) FROM public.deals WHERE account_id = p_account_id AND status = 'open'),
    'total_open_value', (SELECT COALESCE(SUM(value), 0) FROM public.deals WHERE account_id = p_account_id AND status = 'open')
  )
  INTO v_pipeline
  FROM stage_counts;

  RETURN jsonb_build_object(
    'buying_signals', v_buying_signals,
    'loss_signals', v_loss_signals,
    'pipeline_snapshot', v_pipeline
  );
END;
$$;

-- 10. SECURITY REVOKES & GRANTS
REVOKE ALL ON FUNCTION public.get_account_period_bounds(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_period_bounds(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_cockpit_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_cockpit_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_attention_queue(UUID, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_attention_queue(UUID, TEXT, INT, INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_objection_analytics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_objection_analytics(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_objection_drilldown(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_objection_drilldown(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_product_intelligence(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_product_intelligence(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_team_performance(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_team_performance(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_manager_signals_and_pipeline(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_signals_and_pipeline(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
