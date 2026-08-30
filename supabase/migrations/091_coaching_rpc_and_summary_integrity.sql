-- ============================================================
-- Migration 091: Coaching RPC Canonicalization & Summary Integrity (V1.6.3)
-- - Explicit DROP of overloaded update_manager_coaching_opportunity_status signatures
-- - Single canonical update_manager_coaching_opportunity_status (5 arguments)
-- - Strict Review Mutation Security: Human review statuses (reviewed/dismissed/resolved)
--   require authentic manager session (auth.uid()), zero actor fabrication on service_role
-- - Refactor get_manager_coaching_summary: Remove pagination dependency (>100 scale safe)
-- - Status Semantics: Explicit open, reviewed, dismissed, resolved counts
-- - Reconciled Category & Severity aggregation (status='open' only)
-- ============================================================

-- 1. DROP ALL EXISTING OVERLOADS OF UPDATE OPPORTUNITY STATUS
DROP FUNCTION IF EXISTS public.update_manager_coaching_opportunity_status(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.update_manager_coaching_opportunity_status(uuid, text, text, text, text, uuid);

-- 2. CREATE SINGLE CANONICAL UPDATE OPPORTUNITY STATUS RPC
CREATE OR REPLACE FUNCTION public.update_manager_coaching_opportunity_status(
  p_account_id UUID,
  p_opportunity_key TEXT,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_dismissed_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_res RECORD;
  v_reviewed_at TIMESTAMPTZ;
  v_reviewed_by UUID;
  v_dismissed_reason TEXT;
  v_notes TEXT;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Requires manager role' USING ERRCODE = '42501';
    END IF;
    v_reviewed_by := v_caller_id;
  ELSE
    IF COALESCE(v_jwt_role, '') <> 'service_role' AND session_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'Unauthorized: Requires manager role or service_role' USING ERRCODE = '42501';
    END IF;

    -- Non-authenticated / service_role callers cannot fabricate a human manager review
    IF p_status IN ('reviewed', 'dismissed', 'resolved') THEN
      RAISE EXCEPTION 'Forbidden: Human review status requires authenticated manager session' USING ERRCODE = '42501';
    END IF;
    v_reviewed_by := NULL;
  END IF;

  IF p_status NOT IN ('open', 'reviewed', 'dismissed', 'resolved') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  -- State Machine Transitions:
  IF p_status = 'open' THEN
    v_reviewed_at := NULL;
    v_reviewed_by := NULL;
    v_dismissed_reason := NULL;
    v_notes := p_notes;
  ELSIF p_status = 'reviewed' THEN
    v_reviewed_at := now();
    v_dismissed_reason := NULL;
    v_notes := p_notes;
  ELSIF p_status = 'dismissed' THEN
    IF p_dismissed_reason IS NULL OR trim(p_dismissed_reason) = '' THEN
      RAISE EXCEPTION 'Dismissed status requires a dismissed_reason' USING ERRCODE = '22023';
    END IF;
    v_reviewed_at := now();
    v_dismissed_reason := p_dismissed_reason;
    v_notes := p_notes;
  ELSIF p_status = 'resolved' THEN
    v_reviewed_at := now();
    v_dismissed_reason := NULL;
    v_notes := p_notes;
  END IF;

  INSERT INTO public.coaching_opportunity_reviews (
    account_id,
    opportunity_key,
    status,
    reviewed_by_user_id,
    reviewed_at,
    dismissed_reason,
    notes,
    updated_at
  )
  VALUES (
    p_account_id,
    p_opportunity_key,
    p_status,
    v_reviewed_by,
    v_reviewed_at,
    v_dismissed_reason,
    v_notes,
    now()
  )
  ON CONFLICT (account_id, opportunity_key) DO UPDATE SET
    status = EXCLUDED.status,
    reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
    reviewed_at = EXCLUDED.reviewed_at,
    dismissed_reason = EXCLUDED.dismissed_reason,
    notes = COALESCE(EXCLUDED.notes, coaching_opportunity_reviews.notes),
    updated_at = now()
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'success', true,
    'opportunity_key', v_res.opportunity_key,
    'status', v_res.status,
    'reviewed_at', v_res.reviewed_at,
    'reviewed_by_user_id', v_res.reviewed_by_user_id,
    'dismissed_reason', v_res.dismissed_reason,
    'notes', v_res.notes
  );
END;
$$;


-- 3. REFACTOR GET MANAGER COACHING SUMMARY RPC (NON-PAGINATED & SCALE-SAFE)
CREATE OR REPLACE FUNCTION public.get_manager_coaching_summary(
  p_account_id UUID,
  p_range TEXT DEFAULT '30d',
  p_custom_start TIMESTAMPTZ DEFAULT NULL,
  p_custom_end TIMESTAMPTZ DEFAULT NULL
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
  v_curr_start TIMESTAMPTZ;
  v_curr_end TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end TIMESTAMPTZ;
  v_tz TEXT;
  v_open_count INT := 0;
  v_reviewed_count INT := 0;
  v_dismissed_count INT := 0;
  v_resolved_count INT := 0;
  v_urgent_count INT := 0;
  v_high_count INT := 0;
  v_medium_count INT := 0;
  v_buying_signals_count INT := 0;
  v_overdue_followups_count INT := 0;
  v_unanswered_count INT := 0;
  v_buying_signals_severity TEXT := 'high';
  v_overdue_followups_severity TEXT := 'high';
  v_unanswered_severity TEXT := 'medium';
  v_focus_areas JSONB := '[]'::jsonb;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: Requires manager role' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF COALESCE(v_jwt_role, '') <> 'service_role' AND session_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'Unauthorized: Requires manager role or service_role' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT curr_start, curr_end, prev_start, prev_end, tz
  INTO v_curr_start, v_curr_end, v_prev_start, v_prev_end, v_tz
  FROM public.get_account_period_bounds(p_account_id, p_range, p_custom_start, p_custom_end);

  WITH raw_candidates AS (
    -- 1. BUYING SIGNAL WITHOUT ACTION (HISTORICAL EVENT ATTRIBUTION)
    -- Half-open interval: [v_curr_start, v_curr_end)
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      'buying_signal_missed' AS signal_type,
      1 AS priority_rank,
      CASE WHEN COALESCE(cls.score, 0) >= 70 THEN 'urgent' ELSE 'high' END AS severity,
      ci.observed_at AS detected_at
    FROM public.conversation_insights ci
    JOIN public.conversations c ON c.id = ci.conversation_id AND c.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = c.contact_id AND cls.account_id = p_account_id
    WHERE ci.account_id = p_account_id
      AND ci.insight_type = 'buying_signal'
      AND ci.status = 'active'
      AND ci.observed_at >= v_curr_start AND ci.observed_at < v_curr_end
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.conversation_id = c.id
          AND t.created_at >= ci.observed_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'agent'
          AND m.created_at >= ci.observed_at
      )

    UNION ALL

    -- 2. OVERDUE FOLLOW-UP (CURRENT OPERATIONAL ALERT)
    SELECT
      t.conversation_id,
      t.contact_id,
      'overdue_followup' AS signal_type,
      2 AS priority_rank,
      CASE WHEN t.priority = 'urgent' OR COALESCE(cls.score, 0) >= 70 THEN 'urgent' ELSE 'high' END AS severity,
      COALESCE(t.snoozed_until, t.due_at) AS detected_at
    FROM public.tasks t
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = t.contact_id AND cls.account_id = p_account_id
    WHERE t.account_id = p_account_id
      AND t.status = 'pending'
      AND COALESCE(t.snoozed_until, t.due_at) < now()
      AND t.conversation_id IS NOT NULL

    UNION ALL

    -- 3. HOT LEAD WITHOUT ACTION (CURRENT OPERATIONAL ALERT)
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      'hot_lead_unattended' AS signal_type,
      3 AS priority_rank,
      CASE WHEN cls.score >= 85 THEN 'urgent' ELSE 'high' END AS severity,
      cls.calculated_at AS detected_at
    FROM public.contact_lead_scores cls
    JOIN public.conversations c ON c.contact_id = cls.contact_id AND c.account_id = p_account_id AND c.status = 'open'
    WHERE cls.account_id = p_account_id
      AND cls.score >= 70
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.conversation_id = c.id AND t.status = 'pending'
      )
      AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)

    UNION ALL

    -- 4. UNANSWERED CUSTOMER / REPLIED AFTER FOLLOWUP (CURRENT OPERATIONAL ALERT)
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      'unanswered_customer' AS signal_type,
      4 AS priority_rank,
      CASE 
        WHEN now() - c.last_customer_message_at > interval '2 hours' THEN 'high'
        ELSE 'medium'
      END AS severity,
      c.last_customer_message_at AS detected_at
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND c.last_customer_message_at IS NOT NULL
      AND (c.last_agent_message_at IS NULL OR c.last_customer_message_at > c.last_agent_message_at)
      AND now() - c.last_customer_message_at > interval '10 minutes'

    UNION ALL

    -- 5. LOSS SIGNAL UNREVIEWED (HISTORICAL EVENT ATTRIBUTION)
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      'loss_signal_unreviewed' AS signal_type,
      5 AS priority_rank,
      'medium' AS severity,
      ci.observed_at AS detected_at
    FROM public.conversation_insights ci
    JOIN public.conversations c ON c.id = ci.conversation_id AND c.account_id = p_account_id
    WHERE ci.account_id = p_account_id
      AND ci.insight_type = 'loss_signal'
      AND ci.status = 'active'
      AND ci.observed_at >= v_curr_start AND ci.observed_at < v_curr_end

    UNION ALL

    -- 6. UNASSIGNED COMMERCIAL CONVERSATION (CURRENT OPERATIONAL ALERT)
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      'unassigned_commercial' AS signal_type,
      6 AS priority_rank,
      'medium' AS severity,
      c.created_at AS detected_at
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND c.assigned_agent_id IS NULL
      AND (c.unread_count > 0 OR c.pending_message_count > 0)
  ),

  ranked_candidates AS (
    SELECT
      rc.*,
      ROW_NUMBER() OVER (
        PARTITION BY rc.conversation_id
        ORDER BY
          rc.priority_rank ASC,
          rc.detected_at DESC,
          rc.signal_type ASC
      ) AS rn,
      CASE rc.severity
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END AS severity_rank
    FROM raw_candidates rc
    WHERE rc.conversation_id IS NOT NULL
  ),

  grouped_opportunities AS (
    SELECT
      p.conversation_id,
      p.contact_id,
      p.signal_type AS primary_category,
      p.detected_at,
      (
        SELECT rc_sub.severity
        FROM ranked_candidates rc_sub
        WHERE rc_sub.conversation_id = p.conversation_id
        ORDER BY rc_sub.severity_rank ASC, rc_sub.detected_at DESC
        LIMIT 1
      ) AS severity
    FROM ranked_candidates p
    WHERE p.rn = 1
  ),

  all_opportunities_with_review AS (
    SELECT
      go.*,
      COALESCE(cor.status, 'open') AS status
    FROM grouped_opportunities go
    LEFT JOIN public.coaching_opportunity_reviews cor 
      ON cor.account_id = p_account_id AND cor.opportunity_key = concat('conv:', go.conversation_id)
  )

  SELECT
    COALESCE(COUNT(*) FILTER (WHERE status = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE status = 'reviewed'), 0),
    COALESCE(COUNT(*) FILTER (WHERE status = 'dismissed'), 0),
    COALESCE(COUNT(*) FILTER (WHERE status = 'resolved'), 0),
    COALESCE(COUNT(*) FILTER (WHERE severity = 'urgent' AND status = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE severity = 'high' AND status = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE severity = 'medium' AND status = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE primary_category = 'buying_signal_missed' AND status = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE primary_category = 'overdue_followup' AND status = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE primary_category = 'unanswered_customer' AND status = 'open'), 0),
    COALESCE((
      SELECT CASE 
        WHEN bool_or(severity = 'urgent') THEN 'urgent'
        WHEN bool_or(severity = 'high') THEN 'high'
        WHEN bool_or(severity = 'medium') THEN 'medium'
        ELSE 'low'
      END
      FROM all_opportunities_with_review
      WHERE primary_category = 'buying_signal_missed' AND status = 'open'
    ), 'high'),
    COALESCE((
      SELECT CASE 
        WHEN bool_or(severity = 'urgent') THEN 'urgent'
        WHEN bool_or(severity = 'high') THEN 'high'
        WHEN bool_or(severity = 'medium') THEN 'medium'
        ELSE 'low'
      END
      FROM all_opportunities_with_review
      WHERE primary_category = 'overdue_followup' AND status = 'open'
    ), 'high'),
    COALESCE((
      SELECT CASE 
        WHEN bool_or(severity = 'urgent') THEN 'urgent'
        WHEN bool_or(severity = 'high') THEN 'high'
        WHEN bool_or(severity = 'medium') THEN 'medium'
        ELSE 'low'
      END
      FROM all_opportunities_with_review
      WHERE primary_category = 'unanswered_customer' AND status = 'open'
    ), 'medium')
  INTO
    v_open_count,
    v_reviewed_count,
    v_dismissed_count,
    v_resolved_count,
    v_urgent_count,
    v_high_count,
    v_medium_count,
    v_buying_signals_count,
    v_overdue_followups_count,
    v_unanswered_count,
    v_buying_signals_severity,
    v_overdue_followups_severity,
    v_unanswered_severity
  FROM all_opportunities_with_review;

  IF v_buying_signals_count > 0 THEN
    v_focus_areas := v_focus_areas || jsonb_build_object(
      'type', 'buying_signals',
      'label', concat(v_buying_signals_count, ' oportunidade(s) com sinais de compra sem retorno'),
      'severity', v_buying_signals_severity
    );
  END IF;

  IF v_overdue_followups_count > 0 THEN
    v_focus_areas := v_focus_areas || jsonb_build_object(
      'type', 'followup_gaps',
      'label', concat(v_overdue_followups_count, ' follow-up(s) com prazo estourado'),
      'severity', v_overdue_followups_severity
    );
  END IF;

  IF v_unanswered_count > 0 THEN
    v_focus_areas := v_focus_areas || jsonb_build_object(
      'type', 'unanswered',
      'label', concat(v_unanswered_count, ' conversa(s) aguardando resposta'),
      'severity', v_unanswered_severity
    );
  END IF;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'range', p_range,
      'curr_start', v_curr_start,
      'curr_end', v_curr_end,
      'timezone', v_tz
    ),
    'total_open_opportunities', v_open_count,
    'urgent_count', v_urgent_count,
    'high_count', v_high_count,
    'medium_count', v_medium_count,
    'reviewed_count', v_reviewed_count,
    'status_breakdown', jsonb_build_object(
      'open', v_open_count,
      'reviewed', v_reviewed_count,
      'dismissed', v_dismissed_count,
      'resolved', v_resolved_count
    ),
    'category_breakdown', jsonb_build_object(
      'buying_signals_missed', v_buying_signals_count,
      'overdue_followups', v_overdue_followups_count,
      'unanswered_customer', v_unanswered_count
    ),
    'top_focus_areas', v_focus_areas
  );
END;
$$;


-- 4. SECURITY DEFINER GRANTS HARDENING
REVOKE ALL ON FUNCTION public.get_manager_coaching_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_manager_coaching_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_manager_coaching_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_manager_coaching_opportunity_status(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_manager_coaching_opportunity_status(UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_manager_coaching_opportunity_status(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

