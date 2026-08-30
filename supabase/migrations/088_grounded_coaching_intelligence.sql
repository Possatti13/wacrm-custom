-- ============================================================
-- Migration 088: Grounded Coaching & Conversation Intelligence (V1.6)
-- Deterministic Commercial Event Candidate Detection,
-- Multi-Signal Deduplication, True Actor Attribution,
-- Non-Punitive Review Workflow, Manager Security
-- ============================================================

-- 1. Review Workflow State Table
CREATE TABLE IF NOT EXISTS public.coaching_opportunity_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  opportunity_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'resolved')),
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_coaching_review_account_key UNIQUE (account_id, opportunity_key)
);

CREATE INDEX IF NOT EXISTS idx_coaching_reviews_account_key
  ON public.coaching_opportunity_reviews (account_id, opportunity_key);

CREATE INDEX IF NOT EXISTS idx_coaching_reviews_account_status
  ON public.coaching_opportunity_reviews (account_id, status);

ALTER TABLE public.coaching_opportunity_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaching reviews select for owner and admin' AND tablename = 'coaching_opportunity_reviews') THEN
    CREATE POLICY "Coaching reviews select for owner and admin"
      ON public.coaching_opportunity_reviews
      FOR SELECT
      TO authenticated
      USING (
        public.is_manager_of_account(account_id)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Coaching reviews upsert for owner and admin' AND tablename = 'coaching_opportunity_reviews') THEN
    CREATE POLICY "Coaching reviews upsert for owner and admin"
      ON public.coaching_opportunity_reviews
      FOR ALL
      TO authenticated
      USING (
        public.is_manager_of_account(account_id)
      )
      WITH CHECK (
        public.is_manager_of_account(account_id)
      );
  END IF;
END $$;

REVOKE ALL ON public.coaching_opportunity_reviews FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_opportunity_reviews TO authenticated, service_role;


-- 2. UPDATE OPPORTUNITY STATUS RPC
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

  IF p_status NOT IN ('open', 'reviewed', 'dismissed', 'resolved') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = '22023';
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
    v_caller_id,
    now(),
    p_dismissed_reason,
    p_notes,
    now()
  )
  ON CONFLICT (account_id, opportunity_key) DO UPDATE SET
    status = EXCLUDED.status,
    reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
    reviewed_at = EXCLUDED.reviewed_at,
    dismissed_reason = COALESCE(EXCLUDED.dismissed_reason, coaching_opportunity_reviews.dismissed_reason),
    notes = COALESCE(EXCLUDED.notes, coaching_opportunity_reviews.notes),
    updated_at = now()
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'success', true,
    'opportunity_key', v_res.opportunity_key,
    'status', v_res.status,
    'reviewed_at', v_res.reviewed_at
  );
END;
$$;


-- 3. GET MANAGER COACHING OPPORTUNITIES RPC (DEDUPLICATED & TEMPORALLY RESOLVED)
CREATE OR REPLACE FUNCTION public.get_manager_coaching_opportunities(
  p_account_id UUID,
  p_range TEXT DEFAULT '30d',
  p_custom_start TIMESTAMPTZ DEFAULT NULL,
  p_custom_end TIMESTAMPTZ DEFAULT NULL,
  p_seller_id UUID DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'open',
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
  v_curr_start TIMESTAMPTZ;
  v_curr_end TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end TIMESTAMPTZ;
  v_tz TEXT;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_result JSONB;
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
    -- 1. BUYING SIGNAL WITHOUT ACTION
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      c.assigned_agent_id AS responsible_user_id,
      'buying_signal_missed' AS signal_type,
      1 AS priority_rank,
      CASE WHEN COALESCE(cls.score, 0) >= 70 THEN 'urgent' ELSE 'high' END AS severity,
      'Sinal de compra identificado sem ação posterior registrada' AS signal_label,
      ci.observed_at AS detected_at,
      jsonb_build_object(
        'type', 'buying_signal',
        'insight_id', ci.id,
        'value_text', ci.value_text,
        'observed_at', ci.observed_at,
        'confidence', ci.confidence,
        'evidence_snippet', (
          SELECT snippet FROM public.conversation_insight_evidence cie 
          WHERE cie.insight_id = ci.id LIMIT 1
        )
      ) AS evidence_item
    FROM public.conversation_insights ci
    JOIN public.conversations c ON c.id = ci.conversation_id AND c.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = c.contact_id AND cls.account_id = p_account_id
    WHERE ci.account_id = p_account_id
      AND ci.insight_type = 'buying_signal'
      AND ci.status = 'active'
      AND ci.observed_at >= v_curr_start AND ci.observed_at <= v_curr_end
      AND (p_seller_id IS NULL OR c.assigned_agent_id = p_seller_id)
      -- Temporal resolution: No pending/completed task after the signal AND no agent message after the signal
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

    -- 2. OVERDUE FOLLOW-UP
    SELECT
      t.conversation_id,
      t.contact_id,
      t.assigned_user_id AS responsible_user_id,
      'overdue_followup' AS signal_type,
      2 AS priority_rank,
      CASE WHEN t.priority = 'urgent' OR COALESCE(cls.score, 0) >= 70 THEN 'urgent' ELSE 'high' END AS severity,
      concat('Follow-up atrasado: ', t.title) AS signal_label,
      COALESCE(t.snoozed_until, t.due_at) AS detected_at,
      jsonb_build_object(
        'type', 'overdue_task',
        'task_id', t.id,
        'title', t.title,
        'due_at', t.due_at,
        'snoozed_until', t.snoozed_until,
        'priority', t.priority,
        'action_type', t.action_type
      ) AS evidence_item
    FROM public.tasks t
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = t.contact_id AND cls.account_id = p_account_id
    WHERE t.account_id = p_account_id
      AND t.status = 'pending'
      AND COALESCE(t.snoozed_until, t.due_at) < now()
      AND t.conversation_id IS NOT NULL
      AND (p_seller_id IS NULL OR t.assigned_user_id = p_seller_id)

    UNION ALL

    -- 3. HOT LEAD WITHOUT ACTION
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      c.assigned_agent_id AS responsible_user_id,
      'hot_lead_unattended' AS signal_type,
      3 AS priority_rank,
      CASE WHEN cls.score >= 85 THEN 'urgent' ELSE 'high' END AS severity,
      concat('Lead quente (Score ', cls.score, ') sem acompanhamento ativo') AS signal_label,
      cls.calculated_at AS detected_at,
      jsonb_build_object(
        'type', 'hot_lead',
        'score', cls.score,
        'calculated_at', cls.calculated_at,
        'summary', clp.summary,
        'intent', clp.current_intent
      ) AS evidence_item
    FROM public.contact_lead_scores cls
    JOIN public.conversations c ON c.contact_id = cls.contact_id AND c.account_id = p_account_id AND c.status = 'open'
    LEFT JOIN public.contact_lead_profiles clp ON clp.contact_id = cls.contact_id AND clp.account_id = p_account_id
    WHERE cls.account_id = p_account_id
      AND cls.score >= 70
      AND (p_seller_id IS NULL OR c.assigned_agent_id = p_seller_id)
      -- No pending task
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.conversation_id = c.id AND t.status = 'pending'
      )
      -- No recent agent message after customer message
      AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)

    UNION ALL

    -- 4. UNANSWERED CUSTOMER / REPLIED AFTER FOLLOWUP
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      c.assigned_agent_id AS responsible_user_id,
      'unanswered_customer' AS signal_type,
      4 AS priority_rank,
      CASE 
        WHEN now() - c.last_customer_message_at > interval '2 hours' THEN 'high'
        ELSE 'medium'
      END AS severity,
      'Cliente aguardando retorno após última mensagem' AS signal_label,
      c.last_customer_message_at AS detected_at,
      jsonb_build_object(
        'type', 'unanswered_message',
        'last_customer_message_at', c.last_customer_message_at,
        'last_message_text', c.last_message_text,
        'waiting_time_seconds', EXTRACT(EPOCH FROM (now() - c.last_customer_message_at))::int
      ) AS evidence_item
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND c.last_customer_message_at IS NOT NULL
      AND (c.last_agent_message_at IS NULL OR c.last_customer_message_at > c.last_agent_message_at)
      AND now() - c.last_customer_message_at > interval '10 minutes'
      AND (p_seller_id IS NULL OR c.assigned_agent_id = p_seller_id)

    UNION ALL

    -- 5. LOSS SIGNAL UNREVIEWED
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      c.assigned_agent_id AS responsible_user_id,
      'loss_signal_unreviewed' AS signal_type,
      5 AS priority_rank,
      'medium' AS severity,
      'Sinal de perda ou desinteresse comercial observado' AS signal_label,
      ci.observed_at AS detected_at,
      jsonb_build_object(
        'type', 'loss_signal',
        'insight_id', ci.id,
        'value_text', ci.value_text,
        'observed_at', ci.observed_at
      ) AS evidence_item
    FROM public.conversation_insights ci
    JOIN public.conversations c ON c.id = ci.conversation_id AND c.account_id = p_account_id
    WHERE ci.account_id = p_account_id
      AND ci.insight_type = 'loss_signal'
      AND ci.status = 'active'
      AND ci.observed_at >= v_curr_start AND ci.observed_at <= v_curr_end
      AND (p_seller_id IS NULL OR c.assigned_agent_id = p_seller_id)

    UNION ALL

    -- 6. UNASSIGNED COMMERCIAL CONVERSATION
    SELECT
      c.id AS conversation_id,
      c.contact_id,
      NULL::uuid AS responsible_user_id,
      'unassigned_commercial' AS signal_type,
      6 AS priority_rank,
      'medium' AS severity,
      'Conversa comercial ativa sem vendedor responsável' AS signal_label,
      c.created_at AS detected_at,
      jsonb_build_object(
        'type', 'unassigned_conversation',
        'created_at', c.created_at,
        'last_message_at', c.last_message_at
      ) AS evidence_item
    FROM public.conversations c
    WHERE c.account_id = p_account_id
      AND c.status = 'open'
      AND c.assigned_agent_id IS NULL
      AND (c.unread_count > 0 OR c.pending_message_count > 0)
      AND (p_seller_id IS NULL)
  ),

  -- Group and Deduplicate by conversation_id
  grouped_opportunities AS (
    SELECT
      rc.conversation_id,
      rc.contact_id,
      (ARRAY_AGG(rc.signal_type ORDER BY rc.priority_rank ASC))[1] AS primary_category,
      (ARRAY_AGG(rc.signal_label ORDER BY rc.priority_rank ASC))[1] AS primary_reason,
      (ARRAY_AGG(rc.severity ORDER BY 
        CASE rc.severity 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END ASC
      ))[1] AS severity,
      (ARRAY_AGG(rc.responsible_user_id ORDER BY rc.priority_rank ASC))[1] AS responsible_user_id,
      MIN(rc.detected_at) AS detected_at,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT rc.signal_type), (ARRAY_AGG(rc.signal_type ORDER BY rc.priority_rank ASC))[1]) AS secondary_signals,
      jsonb_agg(rc.evidence_item) AS evidence
    FROM raw_candidates rc
    WHERE rc.conversation_id IS NOT NULL
    GROUP BY rc.conversation_id, rc.contact_id
  ),

  filtered_with_review AS (
    SELECT
      go.*,
      concat('conv:', go.conversation_id) AS opportunity_key,
      COALESCE(cor.status, 'open') AS status,
      cor.reviewed_by_user_id,
      p_rev.full_name AS reviewed_by_user_name,
      cor.reviewed_at,
      cor.notes AS review_notes,
      cor.dismissed_reason,
      ct.name AS contact_name,
      ct.phone AS contact_phone,
      COALESCE(p_resp.full_name, 'Não atribuído') AS responsible_user_name,
      cls.score AS lead_score,
      (
        SELECT jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'due_at', t.due_at,
          'status', t.status
        )
        FROM public.tasks t
        WHERE t.conversation_id = go.conversation_id AND t.status = 'pending'
        ORDER BY t.due_at ASC LIMIT 1
      ) AS next_action
    FROM grouped_opportunities go
    LEFT JOIN public.coaching_opportunity_reviews cor 
      ON cor.account_id = p_account_id AND cor.opportunity_key = concat('conv:', go.conversation_id)
    LEFT JOIN public.contacts ct ON ct.id = go.contact_id
    LEFT JOIN public.profiles p_resp ON p_resp.user_id = go.responsible_user_id AND p_resp.account_id = p_account_id
    LEFT JOIN public.profiles p_rev ON p_rev.user_id = cor.reviewed_by_user_id AND p_rev.account_id = p_account_id
    LEFT JOIN public.contact_lead_scores cls ON cls.contact_id = go.contact_id AND cls.account_id = p_account_id
    WHERE (p_category IS NULL OR go.primary_category = p_category)
      AND (p_status IS NULL OR p_status = 'all' OR COALESCE(cor.status, 'open') = p_status)
  )

  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'range', p_range,
      'curr_start', v_curr_start,
      'curr_end', v_curr_end,
      'timezone', v_tz
    ),
    'total_count', (SELECT COUNT(*) FROM filtered_with_review),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'opportunity_key', f.opportunity_key,
          'conversation_id', f.conversation_id,
          'contact_id', f.contact_id,
          'contact_name', f.contact_name,
          'contact_phone', f.contact_phone,
          'responsible_user_id', f.responsible_user_id,
          'responsible_user_name', f.responsible_user_name,
          'category', f.primary_category,
          'severity', f.severity,
          'status', f.status,
          'primary_reason', f.primary_reason,
          'secondary_signals', f.secondary_signals,
          'lead_score', f.lead_score,
          'detected_at', f.detected_at,
          'evidence', f.evidence,
          'next_action', f.next_action,
          'review_info', jsonb_build_object(
            'reviewed_by_user_name', f.reviewed_by_user_name,
            'reviewed_at', f.reviewed_at,
            'notes', f.review_notes,
            'dismissed_reason', f.dismissed_reason
          )
        )
        ORDER BY 
          CASE f.severity 
            WHEN 'urgent' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            ELSE 4 
          END ASC,
          f.detected_at DESC
      )
      FROM (
        SELECT * FROM filtered_with_review
        ORDER BY 
          CASE severity 
            WHEN 'urgent' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            ELSE 4 
          END ASC,
          detected_at DESC
        LIMIT v_limit OFFSET v_offset
      ) f
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- 4. GET MANAGER COACHING SUMMARY RPC
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
  v_opps JSONB;
  v_items JSONB;
  v_total_count INT;
  v_urgent_count INT := 0;
  v_high_count INT := 0;
  v_buying_signals_count INT := 0;
  v_overdue_followups_count INT := 0;
  v_unanswered_count INT := 0;
  v_reviewed_count INT := 0;
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

  v_opps := public.get_manager_coaching_opportunities(
    p_account_id,
    p_range,
    p_custom_start,
    p_custom_end,
    NULL,
    NULL,
    'all',
    100,
    0
  );

  v_items := v_opps -> 'items';
  v_total_count := jsonb_array_length(v_items);

  SELECT
    COALESCE(COUNT(*) FILTER (WHERE item->>'severity' = 'urgent' AND item->>'status' = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE item->>'severity' = 'high' AND item->>'status' = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE item->>'category' = 'buying_signal_missed' AND item->>'status' = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE item->>'category' = 'overdue_followup' AND item->>'status' = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE item->>'category' = 'unanswered_customer' AND item->>'status' = 'open'), 0),
    COALESCE(COUNT(*) FILTER (WHERE item->>'status' IN ('reviewed', 'resolved')), 0)
  INTO
    v_urgent_count,
    v_high_count,
    v_buying_signals_count,
    v_overdue_followups_count,
    v_unanswered_count,
    v_reviewed_count
  FROM jsonb_array_elements(v_items) AS item;

  IF v_buying_signals_count > 0 THEN
    v_focus_areas := v_focus_areas || jsonb_build_object(
      'type', 'buying_signals',
      'label', concat(v_buying_signals_count, ' oportunidade(s) com sinais de compra sem retorno'),
      'severity', 'urgent'
    );
  END IF;

  IF v_overdue_followups_count > 0 THEN
    v_focus_areas := v_focus_areas || jsonb_build_object(
      'type', 'followup_gaps',
      'label', concat(v_overdue_followups_count, ' follow-up(s) com prazo estourado'),
      'severity', 'high'
    );
  END IF;

  IF v_unanswered_count > 0 THEN
    v_focus_areas := v_focus_areas || jsonb_build_object(
      'type', 'unanswered',
      'label', concat(v_unanswered_count, ' conversa(s) aguardando resposta'),
      'severity', 'medium'
    );
  END IF;

  RETURN jsonb_build_object(
    'period', v_opps -> 'period',
    'total_open_opportunities', v_total_count - v_reviewed_count,
    'urgent_count', v_urgent_count,
    'high_count', v_high_count,
    'reviewed_count', v_reviewed_count,
    'category_breakdown', jsonb_build_object(
      'buying_signals_missed', v_buying_signals_count,
      'overdue_followups', v_overdue_followups_count,
      'unanswered_customer', v_unanswered_count
    ),
    'top_focus_areas', v_focus_areas
  );
END;
$$;


-- 5. GET MANAGER COACHING PATTERNS RPC (HISTORICAL ATTRIBUTION & MINIMUM SAMPLES)
CREATE OR REPLACE FUNCTION public.get_manager_coaching_patterns(
  p_account_id UUID,
  p_range TEXT DEFAULT '30d',
  p_custom_start TIMESTAMPTZ DEFAULT NULL,
  p_custom_end TIMESTAMPTZ DEFAULT NULL,
  p_seller_id UUID DEFAULT NULL
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
  v_result JSONB;
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

  WITH 
  seller_objections AS (
    SELECT
      coo.responsible_user_id AS seller_id,
      p.full_name AS seller_name,
      tot.code AS objection_code,
      tot.name AS objection_name,
      COUNT(*) AS occurrences
    FROM public.conversation_objection_occurrences coo
    JOIN public.tenant_objection_taxonomy tot ON tot.id = coo.effective_taxonomy_id
    LEFT JOIN public.profiles p ON p.user_id = coo.responsible_user_id AND p.account_id = p_account_id
    WHERE coo.account_id = p_account_id
      AND coo.occurred_at >= v_curr_start AND coo.occurred_at <= v_curr_end
      AND coo.responsible_user_id IS NOT NULL
      AND (p_seller_id IS NULL OR coo.responsible_user_id = p_seller_id)
    GROUP BY coo.responsible_user_id, p.full_name, tot.code, tot.name
    HAVING COUNT(*) >= 3
  ),

  seller_tasks AS (
    SELECT
      t.assigned_user_id AS seller_id,
      p.full_name AS seller_name,
      COUNT(*) AS total_tasks,
      COUNT(*) FILTER (WHERE t.status = 'pending' AND COALESCE(t.snoozed_until, t.due_at) < now()) AS overdue_tasks,
      COUNT(*) FILTER (WHERE t.status = 'completed') AS completed_tasks
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.user_id = t.assigned_user_id AND p.account_id = p_account_id
    WHERE t.account_id = p_account_id
      AND t.created_at >= v_curr_start AND t.created_at <= v_curr_end
      AND t.assigned_user_id IS NOT NULL
      AND (p_seller_id IS NULL OR t.assigned_user_id = p_seller_id)
    GROUP BY t.assigned_user_id, p.full_name
    HAVING COUNT(*) >= 2
  ),

  seller_responses AS (
    SELECT
      m.sender_id AS seller_id,
      p.full_name AS seller_name,
      COUNT(*) AS verified_episodes,
      ROUND(AVG(c.first_response_duration_seconds)) AS avg_response_seconds,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.first_response_duration_seconds) AS median_response_seconds
    FROM public.conversations c
    JOIN public.messages m ON m.conversation_id = c.id AND m.created_at = c.first_response_at AND m.sender_type = 'agent'
    LEFT JOIN public.profiles p ON p.user_id = m.sender_id AND p.account_id = p_account_id
    WHERE c.account_id = p_account_id
      AND c.first_response_at >= v_curr_start AND c.first_response_at <= v_curr_end
      AND c.first_response_duration_seconds IS NOT NULL
      AND m.sender_id IS NOT NULL
      AND (p_seller_id IS NULL OR m.sender_id = p_seller_id)
    GROUP BY m.sender_id, p.full_name
  )

  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'range', p_range,
      'curr_start', v_curr_start,
      'curr_end', v_curr_end,
      'timezone', v_tz
    ),
    'objection_patterns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'seller_id', so.seller_id,
          'seller_name', COALESCE(so.seller_name, 'Vendedor'),
          'objection_code', so.objection_code,
          'objection_name', so.objection_name,
          'occurrences', so.occurrences,
          'pattern_type', 'repeated_objection'
        )
        ORDER BY so.occurrences DESC
      )
      FROM seller_objections so
    ), '[]'::jsonb),
    'followup_patterns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'seller_id', st.seller_id,
          'seller_name', COALESCE(st.seller_name, 'Vendedor'),
          'total_tasks', st.total_tasks,
          'overdue_tasks', st.overdue_tasks,
          'overdue_pct', CASE WHEN st.total_tasks > 0 THEN ROUND((st.overdue_tasks::numeric / st.total_tasks::numeric) * 100, 1) ELSE 0 END
        )
        ORDER BY st.overdue_tasks DESC
      )
      FROM seller_tasks st
    ), '[]'::jsonb),
    'response_patterns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'seller_id', sr.seller_id,
          'seller_name', COALESCE(sr.seller_name, 'Vendedor'),
          'verified_episodes', sr.verified_episodes,
          'avg_response_seconds', sr.avg_response_seconds,
          'median_response_seconds', sr.median_response_seconds
        )
        ORDER BY sr.median_response_seconds DESC
      )
      FROM seller_responses sr
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- 6. GET MANAGER COACHING CONVERSATION RPC (DETAILED REVIEW PAYLOAD)
CREATE OR REPLACE FUNCTION public.get_manager_coaching_conversation(
  p_account_id UUID,
  p_conversation_id UUID
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
  v_conv RECORD;
  v_contact RECORD;
  v_assigned_name TEXT;
  v_events JSONB := '[]'::jsonb;
  v_review RECORD;
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

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_contact
  FROM public.contacts
  WHERE id = v_conv.contact_id AND account_id = p_account_id;

  SELECT full_name INTO v_assigned_name
  FROM public.profiles
  WHERE user_id = v_conv.assigned_agent_id AND account_id = p_account_id;

  SELECT * INTO v_review
  FROM public.coaching_opportunity_reviews
  WHERE account_id = p_account_id AND opportunity_key = concat('conv:', p_conversation_id);

  WITH insight_events AS (
    SELECT
      ci.observed_at AS event_time,
      ci.insight_type AS event_type,
      ci.value_text AS description,
      jsonb_build_object(
        'insight_id', ci.id,
        'confidence', ci.confidence,
        'evidence_snippet', (
          SELECT snippet FROM public.conversation_insight_evidence cie WHERE cie.insight_id = ci.id LIMIT 1
        )
      ) AS metadata
    FROM public.conversation_insights ci
    WHERE ci.conversation_id = p_conversation_id AND ci.account_id = p_account_id
  ),

  objection_events AS (
    SELECT
      coo.occurred_at AS event_time,
      'objection' AS event_type,
      concat('Objeção: ', tot.name, ' (', coo.raw_objection, ')') AS description,
      jsonb_build_object(
        'objection_id', coo.id,
        'code', tot.code,
        'name', tot.name,
        'raw_objection', coo.raw_objection,
        'responsible_user_id', coo.responsible_user_id,
        'responsible_user_name', p.full_name
      ) AS metadata
    FROM public.conversation_objection_occurrences coo
    JOIN public.tenant_objection_taxonomy tot ON tot.id = coo.effective_taxonomy_id
    LEFT JOIN public.profiles p ON p.user_id = coo.responsible_user_id AND p.account_id = p_account_id
    WHERE coo.conversation_id = p_conversation_id AND coo.account_id = p_account_id
  ),

  task_events AS (
    SELECT
      t.created_at AS event_time,
      'task' AS event_type,
      concat('Tarefa: ', t.title, ' (', t.status, ')') AS description,
      jsonb_build_object(
        'task_id', t.id,
        'title', t.title,
        'due_at', t.due_at,
        'status', t.status,
        'priority', t.priority,
        'completed_at', t.completed_at
      ) AS metadata
    FROM public.tasks t
    WHERE t.conversation_id = p_conversation_id AND t.account_id = p_account_id
  ),

  all_events AS (
    SELECT * FROM insight_events
    UNION ALL
    SELECT * FROM objection_events
    UNION ALL
    SELECT * FROM task_events
  )

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_time', ae.event_time,
        'event_type', ae.event_type,
        'description', ae.description,
        'metadata', ae.metadata
      )
      ORDER BY ae.event_time ASC
    ), '[]'::jsonb
  ) INTO v_events
  FROM all_events ae;

  RETURN jsonb_build_object(
    'conversation_id', v_conv.id,
    'contact_id', v_conv.contact_id,
    'contact_name', COALESCE(v_contact.name, 'Contato'),
    'contact_phone', v_contact.phone,
    'assigned_agent_id', v_conv.assigned_agent_id,
    'assigned_agent_name', COALESCE(v_assigned_name, 'Não atribuído'),
    'status', v_conv.status,
    'first_customer_message_at', v_conv.first_customer_message_at,
    'first_response_at', v_conv.first_response_at,
    'first_response_duration_seconds', v_conv.first_response_duration_seconds,
    'last_message_at', v_conv.last_message_at,
    'timeline', v_events,
    'review_info', jsonb_build_object(
      'status', COALESCE(v_review.status, 'open'),
      'reviewed_at', v_review.reviewed_at,
      'notes', v_review.notes,
      'dismissed_reason', v_review.dismissed_reason
    )
  );
END;
$$;

-- 7. GRANTS AND REVOKES
REVOKE ALL ON FUNCTION public.get_manager_coaching_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.get_manager_coaching_opportunities(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.get_manager_coaching_patterns(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_manager_coaching_conversation(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.update_manager_coaching_opportunity_status(UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_manager_coaching_summary(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_manager_coaching_opportunities(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_manager_coaching_patterns(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_manager_coaching_conversation(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_manager_coaching_opportunity_status(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
