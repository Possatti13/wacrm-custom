-- ============================================================
-- Migration 082: Commercial Intelligence Completeness & Provenance Integrity
--
-- 1. Creates ensure_tenant_default_commercial_intents RPC.
-- 2. Updates claim_conversation_analysis_run to guarantee default intents.
-- 3. Updates reproject_commercial_state with summary projection and strict provenance consistency.
-- 4. Updates sweep_and_enqueue_due_intelligence to skip empty conversations.
-- 5. Backfills existing contact_lead_profiles rows to clear orphan sources where value IS NULL.
-- ============================================================

-- 1. ENSURE DEFAULT COMMERCIAL INTENTS
CREATE OR REPLACE FUNCTION public.ensure_tenant_default_commercial_intents(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.commercial_intents
  WHERE account_id = p_account_id;

  IF v_count = 0 THEN
    INSERT INTO public.commercial_intents (
      account_id, key, label, description, status, sort_order
    ) VALUES
      (p_account_id, 'purchase', 'Compra / Fechamento', 'Cliente com intenção clara de compra, contratação ou fechamento de negócio', 'active', 10),
      (p_account_id, 'budget_quote', 'Cotação / Orçamento', 'Cliente solicitando propostas, orçamentos, valores ou condições comerciais', 'active', 20),
      (p_account_id, 'information', 'Informações / Dúvidas', 'Cliente buscando informações sobre produtos, serviços ou funcionamento', 'active', 30),
      (p_account_id, 'support', 'Suporte / Atendimento', 'Cliente com dúvidas de suporte, pós-venda ou operacionais', 'active', 40),
      (p_account_id, 'not_interested', 'Sem Interesse', 'Cliente informando desinteresse ou recusa no momento', 'active', 50)
    ON CONFLICT (account_id, key) DO NOTHING;

    -- Generate initial / updated canonical snapshot revision
    PERFORM public.generate_tenant_config_snapshot_internal(
      p_account_id,
      'Seeded default commercial intents',
      NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_tenant_default_commercial_intents(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_tenant_default_commercial_intents(UUID) TO service_role, postgres;


-- 2. UPDATE CLAIM_CONVERSATION_ANALYSIS_RUN TO ENSURE DEFAULT INTENTS
CREATE OR REPLACE FUNCTION public.claim_conversation_analysis_run(
  p_account_id UUID,
  p_conversation_id UUID,
  p_extractor_version TEXT,
  p_prompt_version TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_batch_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version TEXT := COALESCE(NULLIF(pg_catalog.btrim(p_extractor_version), ''), 'v1');
  v_prompt_ver TEXT := COALESCE(NULLIF(pg_catalog.btrim(p_prompt_version), ''), 'v1');
  v_limit INTEGER := COALESCE(p_batch_limit, 25);
  v_lease_secs INTEGER := COALESCE(p_lease_seconds, 300);

  v_active_run RECORD;
  v_config_rev RECORD;
  v_cat_res JSONB;
  v_cat_id UUID;
  v_cat_hash TEXT;
  v_cat_snapshot JSONB;

  v_messages_record RECORD;
  v_msg_ids UUID[];
  v_first_msg RECORD;
  v_last_msg RECORD;
  v_messages_json JSONB;
  v_messages_count INTEGER;

  v_sorted_ids_str TEXT;
  v_fingerprint TEXT;
  v_completed_run RECORD;
  v_new_run_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Authorization: service_role or admin
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Short transactional lock per conversation + extractor version
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('claim_analysis:' || p_account_id::text || ':' || p_conversation_id::text || ':' || v_version)
  );

  -- 3. Check for currently active processing run
  SELECT * INTO v_active_run
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND extractor_version = v_version
    AND status = 'processing'
    AND lease_expires_at > v_now
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_processing',
      'run_id', v_active_run.id,
      'lease_expires_at', v_active_run.lease_expires_at
    );
  END IF;

  -- 4. Expire any stale/crashed processing runs
  UPDATE public.conversation_analysis_runs
  SET status = 'failed',
      error_code = 'lease_expired',
      error_message = 'Previous worker lease expired without completion',
      completed_at = v_now
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND extractor_version = v_version
    AND status = 'processing'
    AND lease_expires_at <= v_now;

  -- 5. Query unanalyzed messages for this conversation + extractor version
  WITH unanalyzed AS (
    SELECT m.id, m.sender_type, m.content_text, m.created_at
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.conversation_analysis_messages cam
        WHERE cam.conversation_id = m.conversation_id
          AND cam.message_id = m.id
          AND cam.extractor_version = v_version
      )
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT v_limit
  )
  SELECT
    pg_catalog.array_agg(id ORDER BY created_at ASC, id ASC) AS msg_ids,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', id,
        'sender_type', sender_type,
        'content_text', content_text,
        'created_at', created_at
      ) ORDER BY created_at ASC, id ASC
    ) AS msgs_json,
    pg_catalog.count(*)::integer AS msg_count
  INTO v_messages_record
  FROM unanalyzed;

  v_msg_ids := v_messages_record.msg_ids;
  v_messages_count := COALESCE(v_messages_record.msg_count, 0);

  IF v_messages_count = 0 OR v_msg_ids IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'no_messages',
      'messages_count', 0
    );
  END IF;

  -- Ensure default commercial intents exist
  PERFORM public.ensure_tenant_default_commercial_intents(p_account_id);

  -- 6. Pin latest commercial config revision
  SELECT * INTO v_config_rev
  FROM public.tenant_config_revisions
  WHERE account_id = p_account_id
  ORDER BY revision_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.generate_tenant_config_snapshot_internal(
      p_account_id,
      'Initial zero-config revision',
      NULL
    );

    SELECT * INTO v_config_rev
    FROM public.tenant_config_revisions
    WHERE account_id = p_account_id
    ORDER BY revision_number DESC
    LIMIT 1;
  END IF;

  -- 7. Pin catalog context
  v_cat_res := public.get_or_create_tenant_catalog_context(p_account_id);
  v_cat_id := (v_cat_res->>'catalog_context_id')::uuid;
  v_cat_hash := v_cat_res->>'context_hash';
  v_cat_snapshot := v_cat_res->'snapshot';

  -- 8. Compute deterministic input_fingerprint
  v_sorted_ids_str := pg_catalog.array_to_string(v_msg_ids, ',');
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(
      (p_account_id::text || '#' ||
       p_conversation_id::text || '#' ||
       v_version || '#' ||
       v_prompt_ver || '#' ||
       v_config_rev.id::text || '#' ||
       v_cat_id::text || '#' ||
       v_sorted_ids_str)::bytea
    ),
    'hex'
  );

  -- 9. Check if already completed with this exact fingerprint
  SELECT * INTO v_completed_run
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND input_fingerprint = v_fingerprint
    AND status = 'completed'
  LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_completed',
      'run_id', v_completed_run.id,
      'input_fingerprint', v_fingerprint
    );
  END IF;

  -- First & Last message references for cursors
  SELECT created_at, id INTO v_first_msg FROM public.messages WHERE id = v_msg_ids[1];
  SELECT created_at, id INTO v_last_msg FROM public.messages WHERE id = v_msg_ids[v_messages_count];

  -- 10. Insert new processing run
  INSERT INTO public.conversation_analysis_runs (
    account_id,
    conversation_id,
    status,
    extractor_version,
    prompt_version,
    provider,
    model,
    commercial_config_revision_id,
    commercial_config_revision_number,
    commercial_config_snapshot_hash,
    analysis_catalog_context_id,
    catalog_context_hash,
    input_fingerprint,
    from_cursor_timestamp,
    from_cursor_message_id,
    to_cursor_timestamp,
    to_cursor_message_id,
    messages_count,
    lease_expires_at,
    created_at
  ) VALUES (
    p_account_id,
    p_conversation_id,
    'processing',
    v_version,
    v_prompt_ver,
    p_provider,
    p_model,
    v_config_rev.id,
    v_config_rev.revision_number,
    v_config_rev.snapshot_hash,
    v_cat_id,
    v_cat_hash,
    v_fingerprint,
    v_first_msg.created_at,
    v_first_msg.id,
    v_last_msg.created_at,
    v_last_msg.id,
    v_messages_count,
    v_now + (v_lease_secs || ' seconds')::interval,
    v_now
  ) RETURNING id INTO v_new_run_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'run_id', v_new_run_id,
    'input_fingerprint', v_fingerprint,
    'messages_count', v_messages_count,
    'messages', v_messages_record.msgs_json,
    'analyzed_message_ids', v_msg_ids,
    'first_message', pg_catalog.jsonb_build_object('id', v_first_msg.id, 'created_at', v_first_msg.created_at),
    'last_message', pg_catalog.jsonb_build_object('id', v_last_msg.id, 'created_at', v_last_msg.created_at),
    'config_revision', pg_catalog.jsonb_build_object(
      'id', v_config_rev.id,
      'revision_number', v_config_rev.revision_number,
      'snapshot_hash', v_config_rev.snapshot_hash,
      'snapshot', v_config_rev.snapshot
    ),
    'catalog_context', pg_catalog.jsonb_build_object(
      'id', v_cat_id,
      'context_hash', v_cat_hash,
      'snapshot', v_cat_snapshot
    )
  );
END;
$$;


-- 3. REPROJECT_COMMERCIAL_STATE WITH SUMMARY & PROVENANCE INTEGRITY
CREATE OR REPLACE FUNCTION public.reproject_commercial_state(
  p_account_id UUID,
  p_contact_id UUID,
  p_trigger_source TEXT DEFAULT 'analysis_batch_persisted'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_default_other_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_insights_raw JSONB;
  v_source_insights_count INTEGER := 0;
  v_manual_state JSONB;
  v_fingerprint TEXT;
  v_existing_run RECORD;
  v_profile RECORD;
  v_new_summary TEXT;
  v_new_summary_src TEXT;
  v_latest_summary RECORD;
  v_new_intent TEXT;
  v_new_intent_src TEXT;
  v_latest_intent RECORD;
  v_new_urgency TEXT;
  v_new_urgency_src TEXT;
  v_latest_urgency RECORD;
  v_new_sentiment TEXT;
  v_new_sentiment_src TEXT;
  v_latest_sentiment RECORD;
  v_new_next_action TEXT;
  v_new_next_action_due TIMESTAMPTZ;
  v_new_next_action_src TEXT;
  v_latest_next_action RECORD;
  v_current_attributes JSONB := '{}'::jsonb;
  v_attr_key TEXT;
  v_attr_src RECORD;
  v_latest_attr RECORD;
  v_mutations_count INTEGER := 0;
  v_interest RECORD;
  v_existing_interest RECORD;
  v_objection RECORD;
  v_raw_text TEXT;
  v_tax_code TEXT;
  v_tax_id UUID;
  v_responsible_user UUID;
  v_existing_occ RECORD;
  v_existing_objection RECORD;
  v_projection_run_id UUID;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization: member or service_role required
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Ensure Tenant Objection Taxonomy 'other' exists
  SELECT id INTO v_default_other_id
  FROM public.tenant_objection_taxonomy
  WHERE account_id = p_account_id AND code = 'other'
  LIMIT 1;

  IF v_default_other_id IS NULL THEN
    PERFORM public.ensure_tenant_default_objection_taxonomy(p_account_id);
    SELECT id INTO v_default_other_id
    FROM public.tenant_objection_taxonomy
    WHERE account_id = p_account_id AND code = 'other'
    LIMIT 1;
  END IF;

  -- 3. Gather Active Insights for Contact
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'type', i.insight_type,
        'value_text', i.value_text,
        'value_json', i.value_json,
        'catalog_item_id', i.catalog_item_id,
        'source', i.source,
        'confidence', i.confidence,
        'observed_at', i.observed_at,
        'dedupe_key', i.dedupe_key
      ) ORDER BY i.observed_at DESC, i.created_at DESC
    ), '[]'::jsonb),
    count(*)
  INTO v_insights_raw, v_source_insights_count
  FROM public.conversation_insights i
  JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
  WHERE c.contact_id = p_contact_id
    AND i.account_id = p_account_id
    AND i.status = 'active';

  -- 4. Gather Manual Overrides
  SELECT jsonb_build_object(
    'summary_source', summary_source,
    'intent_source', current_intent_source,
    'urgency_source', urgency_source,
    'sentiment_source', sentiment_source,
    'next_action_source', next_action_source,
    'manual_attributes', (
      SELECT COALESCE(jsonb_object_agg(attribute_key, source), '{}'::jsonb)
      FROM public.contact_lead_attribute_sources
      WHERE account_id = p_account_id AND contact_id = p_contact_id AND source = 'manual'
    )
  ) INTO v_manual_state
  FROM public.contact_lead_profiles
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  -- 5. Calculate Fingerprint
  v_fingerprint := md5(
    COALESCE(v_insights_raw::text, '[]') || '|' ||
    COALESCE(v_manual_state::text, '{}')
  );

  -- 6. Idempotency Check
  SELECT * INTO v_existing_run
  FROM public.commercial_state_projection_runs
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF FOUND AND v_existing_run.input_fingerprint = v_fingerprint THEN
    RETURN jsonb_build_object(
      'outcome', 'no_op',
      'reason', 'already_projected',
      'projection_run_id', v_existing_run.id,
      'input_fingerprint', v_fingerprint,
      'source_insights_count', v_source_insights_count
    );
  END IF;

  -- 7. Fetch Current Profile
  SELECT * INTO v_profile
  FROM public.contact_lead_profiles
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  -- 8. Resolve Dimensions (Summary, Intent, Urgency, Sentiment, Next Action)
  -- Summary
  IF v_profile.summary_source = 'manual' AND v_profile.summary IS NOT NULL THEN
    v_new_summary := v_profile.summary;
    v_new_summary_src := 'manual';
  ELSE
    SELECT i.value_text, i.source INTO v_latest_summary
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'summary' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC LIMIT 1;

    IF v_latest_summary.value_text IS NOT NULL AND length(trim(v_latest_summary.value_text)) > 0 THEN
      v_new_summary := trim(v_latest_summary.value_text);
      v_new_summary_src := COALESCE(v_latest_summary.source, 'intelligence');
    ELSE
      v_new_summary := NULL;
      v_new_summary_src := NULL;
    END IF;
  END IF;

  -- Intent
  IF v_profile.current_intent_source = 'manual' AND v_profile.current_intent IS NOT NULL THEN
    v_new_intent := v_profile.current_intent;
    v_new_intent_src := 'manual';
  ELSE
    SELECT i.value_text, i.source INTO v_latest_intent
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'intent' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC LIMIT 1;

    IF v_latest_intent.value_text IS NOT NULL AND length(trim(v_latest_intent.value_text)) > 0 THEN
      v_new_intent := trim(v_latest_intent.value_text);
      v_new_intent_src := COALESCE(v_latest_intent.source, 'intelligence');
    ELSE
      v_new_intent := NULL;
      v_new_intent_src := NULL;
    END IF;
  END IF;

  -- Urgency
  IF v_profile.urgency_source = 'manual' AND v_profile.urgency IS NOT NULL THEN
    v_new_urgency := v_profile.urgency;
    v_new_urgency_src := 'manual';
  ELSE
    SELECT i.value_text, i.source INTO v_latest_urgency
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'urgency' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC LIMIT 1;

    IF v_latest_urgency.value_text IS NOT NULL AND length(trim(v_latest_urgency.value_text)) > 0 THEN
      v_new_urgency := lower(trim(v_latest_urgency.value_text));
      IF v_new_urgency IN ('alta', 'urgente', 'altíssima', 'high', 'highest', 'urgent') THEN
        v_new_urgency := 'high';
      ELSIF v_new_urgency IN ('média', 'media', 'moderada', 'medium', 'moderate') THEN
        v_new_urgency := 'medium';
      ELSIF v_new_urgency IN ('baixa', 'baixa urgência', 'low', 'lowest') THEN
        v_new_urgency := 'low';
      ELSE
        v_new_urgency := NULL;
      END IF;
    ELSE
      v_new_urgency := NULL;
    END IF;

    IF v_new_urgency IS NOT NULL THEN
      v_new_urgency_src := COALESCE(v_latest_urgency.source, 'intelligence');
    ELSE
      v_new_urgency_src := NULL;
    END IF;
  END IF;

  -- Sentiment
  IF v_profile.sentiment_source = 'manual' AND v_profile.sentiment IS NOT NULL THEN
    v_new_sentiment := v_profile.sentiment;
    v_new_sentiment_src := 'manual';
  ELSE
    SELECT i.value_text, i.source INTO v_latest_sentiment
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'sentiment' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC LIMIT 1;

    IF v_latest_sentiment.value_text IS NOT NULL AND length(trim(v_latest_sentiment.value_text)) > 0 THEN
      v_new_sentiment := lower(trim(v_latest_sentiment.value_text));
      IF v_new_sentiment IN ('positivo', 'positiva', 'positive', 'good', 'ótima') THEN
        v_new_sentiment := 'positive';
      ELSIF v_new_sentiment IN ('negativo', 'negativa', 'negative', 'bad', 'ruim') THEN
        v_new_sentiment := 'negative';
      ELSIF v_new_sentiment IN ('misto', 'mista', 'mixed') THEN
        v_new_sentiment := 'mixed';
      ELSIF v_new_sentiment IN ('neutro', 'neutra', 'neutral') THEN
        v_new_sentiment := 'neutral';
      ELSE
        v_new_sentiment := NULL;
      END IF;
    ELSE
      v_new_sentiment := NULL;
    END IF;

    IF v_new_sentiment IS NOT NULL THEN
      v_new_sentiment_src := COALESCE(v_latest_sentiment.source, 'intelligence');
    ELSE
      v_new_sentiment_src := NULL;
    END IF;
  END IF;

  -- Next Action
  IF v_profile.next_action_source = 'manual' AND v_profile.next_action IS NOT NULL THEN
    v_new_next_action := v_profile.next_action;
    v_new_next_action_due := v_profile.next_action_due_at;
    v_new_next_action_src := 'manual';
  ELSE
    SELECT i.value_text, (i.value_json->>'due_at')::timestamptz AS due_at, i.source INTO v_latest_next_action
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'next_action' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC LIMIT 1;

    IF v_latest_next_action.value_text IS NOT NULL AND length(trim(v_latest_next_action.value_text)) > 0 THEN
      v_new_next_action := trim(v_latest_next_action.value_text);
      v_new_next_action_due := v_latest_next_action.due_at;
      v_new_next_action_src := COALESCE(v_latest_next_action.source, 'intelligence');
    ELSE
      v_new_next_action := NULL;
      v_new_next_action_due := NULL;
      v_new_next_action_src := NULL;
    END IF;
  END IF;

  -- Attributes
  IF v_profile.attributes IS NOT NULL THEN
    v_current_attributes := v_profile.attributes;
  END IF;

  FOR v_attr_key IN
    SELECT DISTINCT (i.value_json->>'attribute_key')
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'attribute' AND i.status = 'active'
      AND (i.value_json->>'attribute_key') IS NOT NULL
  LOOP
    SELECT * INTO v_attr_src
    FROM public.contact_lead_attribute_sources
    WHERE account_id = p_account_id AND contact_id = p_contact_id AND attribute_key = v_attr_key;

    IF v_attr_src IS NULL OR v_attr_src.source <> 'manual' THEN
      SELECT i.value_json->'attribute_value' AS val, i.source INTO v_latest_attr
      FROM public.conversation_insights i
      JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
      WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
        AND i.insight_type = 'attribute' AND i.status = 'active'
        AND (i.value_json->>'attribute_key') = v_attr_key
      ORDER BY i.observed_at DESC, i.created_at DESC LIMIT 1;

      IF v_latest_attr.val IS NOT NULL THEN
        v_current_attributes := jsonb_set(v_current_attributes, ARRAY[v_attr_key], v_latest_attr.val, true);
        INSERT INTO public.contact_lead_attribute_sources (
          account_id, contact_id, attribute_key, source, updated_at
        ) VALUES (
          p_account_id, p_contact_id, v_attr_key, COALESCE(v_latest_attr.source, 'intelligence'), v_now
        )
        ON CONFLICT (account_id, contact_id, attribute_key)
        DO UPDATE SET source = EXCLUDED.source, updated_at = v_now;
      END IF;
    END IF;
  END LOOP;

  -- 9. Upsert Contact Lead Profile with Summary & Strict Provenance
  INSERT INTO public.contact_lead_profiles (
    account_id, contact_id,
    summary, summary_source,
    current_intent, current_intent_source,
    urgency, urgency_source,
    sentiment, sentiment_source,
    next_action, next_action_due_at, next_action_source,
    attributes, updated_at
  ) VALUES (
    p_account_id, p_contact_id,
    v_new_summary, v_new_summary_src,
    v_new_intent, v_new_intent_src,
    v_new_urgency, v_new_urgency_src,
    v_new_sentiment, v_new_sentiment_src,
    v_new_next_action, v_new_next_action_due, v_new_next_action_src,
    v_current_attributes, v_now
  )
  ON CONFLICT (account_id, contact_id)
  DO UPDATE SET
    summary = EXCLUDED.summary,
    summary_source = EXCLUDED.summary_source,
    current_intent = EXCLUDED.current_intent,
    current_intent_source = EXCLUDED.current_intent_source,
    urgency = EXCLUDED.urgency,
    urgency_source = EXCLUDED.urgency_source,
    sentiment = EXCLUDED.sentiment,
    sentiment_source = EXCLUDED.sentiment_source,
    next_action = EXCLUDED.next_action,
    next_action_due_at = EXCLUDED.next_action_due_at,
    next_action_source = EXCLUDED.next_action_source,
    attributes = EXCLUDED.attributes,
    updated_at = v_now;

  v_mutations_count := v_mutations_count + 1;

  -- 10. Project Catalog Interests
  FOR v_interest IN
    SELECT
      i.catalog_item_id,
      i.source,
      MIN(i.observed_at) AS first_seen,
      MAX(i.observed_at) AS last_seen
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'interest' AND i.status = 'active'
      AND i.catalog_item_id IS NOT NULL
    GROUP BY i.catalog_item_id, i.source
  LOOP
    SELECT * INTO v_existing_interest
    FROM public.contact_catalog_interests
    WHERE account_id = p_account_id AND contact_id = p_contact_id AND catalog_item_id = v_interest.catalog_item_id;

    IF v_existing_interest IS NULL THEN
      INSERT INTO public.contact_catalog_interests (
        account_id, contact_id, catalog_item_id, status, source,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        p_account_id, p_contact_id, v_interest.catalog_item_id, 'active', v_interest.source,
        v_interest.first_seen, v_interest.last_seen, v_now, v_now
      );
      v_mutations_count := v_mutations_count + 1;
    ELSIF v_existing_interest.source <> 'manual' THEN
      UPDATE public.contact_catalog_interests
      SET
        last_seen_at = GREATEST(v_existing_interest.last_seen_at, v_interest.last_seen),
        first_seen_at = LEAST(v_existing_interest.first_seen_at, v_interest.first_seen),
        status = 'active',
        updated_at = v_now
      WHERE id = v_existing_interest.id;
      v_mutations_count := v_mutations_count + 1;
    END IF;
  END LOOP;

  -- 11. Project Objection Occurrences & Current Contact Objections
  FOR v_objection IN
    SELECT
      i.id AS insight_id,
      i.conversation_id,
      i.value_text,
      i.value_json,
      i.catalog_item_id,
      i.confidence,
      i.source,
      i.observed_at
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.id = i.conversation_id AND c.account_id = i.account_id
    WHERE c.contact_id = p_contact_id AND i.account_id = p_account_id
      AND i.insight_type = 'objection' AND i.status = 'active'
  LOOP
    v_raw_text := COALESCE(v_objection.value_text, v_objection.value_json->>'objection', 'Objeção');
    v_tax_code := COALESCE(v_objection.value_json->>'taxonomy_code', 'other');

    -- Find taxonomy ID for code
    SELECT id INTO v_tax_id
    FROM public.tenant_objection_taxonomy
    WHERE account_id = p_account_id AND code = v_tax_code
    LIMIT 1;

    IF v_tax_id IS NULL THEN
      v_tax_id := v_default_other_id;
    END IF;

    -- Resolve snapshot responsible user from assignment history at occurred_at
    SELECT to_user_id INTO v_responsible_user
    FROM public.conversation_assignment_history
    WHERE conversation_id = v_objection.conversation_id
      AND account_id = p_account_id
      AND created_at <= v_objection.observed_at
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_responsible_user IS NULL THEN
      SELECT assigned_agent_id INTO v_responsible_user
      FROM public.conversations
      WHERE id = v_objection.conversation_id;
    END IF;

    -- Upsert Objection Occurrence (preserves human override if already exists)
    SELECT * INTO v_existing_occ
    FROM public.conversation_objection_occurrences
    WHERE account_id = p_account_id AND insight_id = v_objection.insight_id;

    IF v_existing_occ IS NULL THEN
      INSERT INTO public.conversation_objection_occurrences (
        account_id, conversation_id, contact_id, insight_id,
        original_taxonomy_id, effective_taxonomy_id, catalog_item_id,
        responsible_user_id, raw_objection, confidence, source,
        occurred_at, created_at, updated_at
      ) VALUES (
        p_account_id, v_objection.conversation_id, p_contact_id, v_objection.insight_id,
        v_tax_id, v_tax_id, v_objection.catalog_item_id,
        v_responsible_user, v_raw_text, v_objection.confidence, v_objection.source,
        v_objection.observed_at, v_now, v_now
      );
      v_mutations_count := v_mutations_count + 1;
    ELSE
      -- Update non-override fields
      UPDATE public.conversation_objection_occurrences
      SET
        catalog_item_id = COALESCE(v_objection.catalog_item_id, conversation_objection_occurrences.catalog_item_id),
        confidence = COALESCE(v_objection.confidence, conversation_objection_occurrences.confidence),
        raw_objection = v_raw_text,
        updated_at = v_now
      WHERE id = v_existing_occ.id;
    END IF;

    -- Upsert into Contact Objections (Current Aggregated State)
    SELECT * INTO v_existing_objection
    FROM public.contact_objections
    WHERE account_id = p_account_id AND contact_id = p_contact_id
      AND normalized_objection = lower(trim(v_raw_text));

    IF v_existing_objection IS NULL THEN
      INSERT INTO public.contact_objections (
        account_id, contact_id, objection, normalized_objection,
        taxonomy_id, catalog_item_id, status, source,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        p_account_id, p_contact_id, v_raw_text, lower(trim(v_raw_text)),
        COALESCE(v_existing_occ.effective_taxonomy_id, v_tax_id),
        v_objection.catalog_item_id, 'open', v_objection.source,
        v_objection.observed_at, v_objection.observed_at, v_now, v_now
      );
      v_mutations_count := v_mutations_count + 1;
    ELSIF v_existing_objection.source <> 'manual' THEN
      UPDATE public.contact_objections
      SET
        taxonomy_id = COALESCE(v_existing_occ.effective_taxonomy_id, v_existing_objection.taxonomy_id, v_tax_id),
        catalog_item_id = COALESCE(v_objection.catalog_item_id, v_existing_objection.catalog_item_id),
        last_seen_at = GREATEST(v_existing_objection.last_seen_at, v_objection.observed_at),
        first_seen_at = LEAST(v_existing_objection.first_seen_at, v_objection.observed_at),
        status = 'open',
        updated_at = v_now
      WHERE id = v_existing_objection.id;
      v_mutations_count := v_mutations_count + 1;
    END IF;
  END LOOP;

  -- 12. Create Projection Run Record
  INSERT INTO public.commercial_state_projection_runs (
    account_id, contact_id, trigger_source,
    input_fingerprint, source_insights_count, mutations_count, outcome
  ) VALUES (
    p_account_id, p_contact_id, p_trigger_source,
    v_fingerprint, v_source_insights_count, v_mutations_count,
    CASE WHEN v_mutations_count > 0 THEN 'applied' ELSE 'no_op' END
  ) RETURNING id INTO v_projection_run_id;

  -- 13. Recalculate Lead Score Deterministically
  PERFORM public.calculate_and_persist_contact_score(p_account_id, p_contact_id, 'projection_completed');

  RETURN jsonb_build_object(
    'status', 'completed',
    'projection_run_id', v_projection_run_id,
    'source_insights_count', v_source_insights_count,
    'mutations_count', v_mutations_count,
    'fingerprint', v_fingerprint
  );
END;
$$;

-- 4. FORWARD-COMPATIBLE WRAPPER FOR PROJECT_CONTACT_COMMERCIAL_STATE
CREATE OR REPLACE FUNCTION public.project_contact_commercial_state(
  p_account_id UUID,
  p_contact_id UUID,
  p_trigger_source TEXT DEFAULT 'analysis_completed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.reproject_commercial_state(p_account_id, p_contact_id, p_trigger_source);
END;
$$;

REVOKE ALL ON FUNCTION public.project_contact_commercial_state(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_contact_commercial_state(UUID, UUID, TEXT) TO service_role;


-- 4. UPDATE SWEEP_AND_ENQUEUE_DUE_INTELLIGENCE TO PREVENT EMPTY CONVERSATIONS
CREATE OR REPLACE FUNCTION public.sweep_and_enqueue_due_intelligence(
  p_batch_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_claim_lease_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::interval;
  v_enqueued_count INTEGER := 0;
  v_conv RECORD;
  v_settings RECORD;
  v_budget_stats RECORD;
  v_payload JSONB;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- Strict Backend-Only Authorization: Global sweep can NEVER be invoked by end users
  IF v_caller_id IS NOT NULL OR (current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized: global intelligence sweep is backend-only' USING ERRCODE = '42501';
  END IF;

  -- Select eligible conversations with FOR UPDATE SKIP LOCKED
  -- Enforces pending_message_count > 0 so empty conversations are never enqueued
  FOR v_conv IN
    SELECT
      c.id AS conversation_id,
      c.account_id,
      c.pending_message_count,
      c.intelligence_eligible_at
    FROM public.conversations c
    JOIN public.tenant_intelligence_settings s ON s.account_id = c.account_id
    WHERE c.commercial_state_dirty = true
      AND c.pending_message_count > 0
      AND c.intelligence_eligible_at <= v_now
      AND (c.intelligence_claimed_at IS NULL OR c.intelligence_claimed_at < v_now)
      AND s.enabled = true
      AND s.invocation_mode = 'smart_auto'
    ORDER BY c.intelligence_eligible_at ASC
    LIMIT p_batch_limit
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    -- Verify tenant monthly budget before enqueuing
    SELECT monthly_budget_limit_usd INTO v_settings
    FROM public.tenant_intelligence_settings
    WHERE account_id = v_conv.account_id;

    IF v_settings.monthly_budget_limit_usd IS NOT NULL THEN
      SELECT COALESCE(SUM(estimated_cost), 0) AS total_cost
      INTO v_budget_stats
      FROM public.ai_usage_log
      WHERE account_id = v_conv.account_id
        AND created_at >= date_trunc('month', v_now);

      IF v_budget_stats.total_cost >= v_settings.monthly_budget_limit_usd THEN
        -- Budget exceeded: defer and do not enqueue
        UPDATE public.conversations
        SET intelligence_eligible_at = v_now + interval '1 hour'
        WHERE id = v_conv.conversation_id;
        CONTINUE;
      END IF;
    END IF;

    -- Set claim lease on conversation
    UPDATE public.conversations
    SET intelligence_claimed_at = v_claim_lease_until
    WHERE id = v_conv.conversation_id;

    -- Enqueue to PGMQ intelligence_extraction
    v_payload := jsonb_build_object(
      'accountId', v_conv.account_id,
      'conversationId', v_conv.conversation_id,
      'triggerReason', 'smart_auto_sweep',
      'enqueuedAt', v_now
    );

    PERFORM pgmq.send('intelligence_extraction', v_payload);
    v_enqueued_count := v_enqueued_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'enqueued_count', v_enqueued_count,
    'timestamp', v_now
  );
END;
$$;


-- 5. BACKFILL ORPHAN SOURCES IN CONTACT_LEAD_PROFILES
UPDATE public.contact_lead_profiles
SET summary_source = NULL
WHERE summary IS NULL AND summary_source IS NOT NULL;

UPDATE public.contact_lead_profiles
SET current_intent_source = NULL
WHERE current_intent IS NULL AND current_intent_source IS NOT NULL;

UPDATE public.contact_lead_profiles
SET urgency_source = NULL
WHERE urgency IS NULL AND urgency_source IS NOT NULL;

UPDATE public.contact_lead_profiles
SET sentiment_source = NULL
WHERE sentiment IS NULL AND sentiment_source IS NOT NULL;

UPDATE public.contact_lead_profiles
SET next_action_source = NULL
WHERE next_action IS NULL AND next_action_source IS NOT NULL;
