-- ============================================================
-- Migration 077: Fix Conflict Targets & Schema Alignment in Projector and Persist Batch
-- ============================================================

-- 1. FIX PERSIST_CONVERSATION_ANALYSIS_BATCH
CREATE OR REPLACE FUNCTION public.persist_conversation_analysis_batch(
  p_account_id UUID,
  p_conversation_id UUID,
  p_run_id UUID,
  p_extractor_version TEXT,
  p_insights JSONB,
  p_analyzed_message_ids UUID[],
  p_last_message_id UUID DEFAULT NULL,
  p_last_message_created_at TIMESTAMPTZ DEFAULT NULL,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_total_tokens INTEGER DEFAULT NULL,
  p_latency_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run RECORD;
  v_insight_elem JSONB;
  v_new_insight_id UUID;
  v_insights_count INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_msg_id UUID;
  v_evidence_elem JSONB;
  v_contact_id UUID;
  v_newer_messages_count INTEGER;
BEGIN
  -- 1. Verify Run Identity & State
  SELECT * INTO v_run
  FROM public.conversation_analysis_runs
  WHERE id = p_run_id
    AND account_id = p_account_id
    AND conversation_id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analysis run % not found for conversation %', p_run_id, p_conversation_id USING ERRCODE = 'P0002';
  END IF;

  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed', 'run_id', p_run_id, 'insights_count', v_run.insights_count);
  END IF;

  IF v_run.status <> 'processing' AND v_run.status <> 'pending' THEN
    RAISE EXCEPTION 'Run is not in processing or pending state (current: %)', v_run.status USING ERRCODE = '22023';
  END IF;

  SELECT contact_id INTO v_contact_id
  FROM public.conversations
  WHERE id = p_conversation_id AND account_id = p_account_id;

  -- 2. Insert Conversation Insights & Evidence
  IF p_insights IS NOT NULL AND jsonb_array_length(p_insights) > 0 THEN
    FOR v_insight_elem IN SELECT * FROM jsonb_array_elements(p_insights)
    LOOP
      INSERT INTO public.conversation_insights (
        account_id,
        conversation_id,
        insight_type,
        value_text,
        value_json,
        catalog_item_id,
        confidence,
        source,
        status,
        analysis_run_id,
        dedupe_key,
        observed_at,
        created_at,
        updated_at
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_insight_elem->>'insight_type',
        v_insight_elem->>'value_text',
        COALESCE(v_insight_elem->'value_json', '{}'::jsonb),
        (v_insight_elem->>'catalog_item_id')::uuid,
        (v_insight_elem->>'confidence')::numeric,
        COALESCE(v_insight_elem->>'source', 'intelligence'),
        'active',
        p_run_id,
        v_insight_elem->>'dedupe_key',
        COALESCE((v_insight_elem->>'observed_at')::timestamptz, p_last_message_created_at, v_now),
        v_now,
        v_now
      )
      ON CONFLICT (account_id, conversation_id, dedupe_key)
      WHERE (dedupe_key IS NOT NULL AND status = 'active')
      DO UPDATE SET
        value_text = EXCLUDED.value_text,
        value_json = EXCLUDED.value_json,
        confidence = EXCLUDED.confidence,
        catalog_item_id = EXCLUDED.catalog_item_id,
        analysis_run_id = EXCLUDED.analysis_run_id,
        observed_at = EXCLUDED.observed_at,
        updated_at = v_now
      RETURNING id INTO v_new_insight_id;

      IF v_new_insight_id IS NOT NULL THEN
        v_insights_count := v_insights_count + 1;

        -- Insert Evidence
        IF v_insight_elem->'evidence' IS NOT NULL AND jsonb_array_length(v_insight_elem->'evidence') > 0 THEN
          FOR v_evidence_elem IN SELECT * FROM jsonb_array_elements(v_insight_elem->'evidence')
          LOOP
            INSERT INTO public.conversation_insight_evidence (
              account_id,
              conversation_id,
              insight_id,
              message_id,
              start_offset,
              end_offset,
              snippet,
              created_at
            ) VALUES (
              p_account_id,
              p_conversation_id,
              v_new_insight_id,
              (v_evidence_elem->>'message_id')::uuid,
              (v_evidence_elem->>'start_offset')::integer,
              (v_evidence_elem->>'end_offset')::integer,
              v_evidence_elem->>'snippet',
              v_now
            )
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 3. Record Analyzed Messages
  IF p_analyzed_message_ids IS NOT NULL AND array_length(p_analyzed_message_ids, 1) > 0 THEN
    FOREACH v_msg_id IN ARRAY p_analyzed_message_ids
    LOOP
      INSERT INTO public.conversation_analysis_messages (
        account_id,
        conversation_id,
        message_id,
        extractor_version,
        analysis_run_id,
        analyzed_at
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_msg_id,
        p_extractor_version,
        p_run_id,
        v_now
      )
      ON CONFLICT (conversation_id, message_id, extractor_version) DO NOTHING;
    END LOOP;
  END IF;

  -- 4. Update Conversation Analysis State Checkpoint
  INSERT INTO public.conversation_analysis_state (
    account_id,
    conversation_id,
    extractor_version,
    last_analyzed_message_id,
    last_analyzed_message_created_at,
    last_analysis_run_id,
    last_analyzed_at,
    updated_at
  ) VALUES (
    p_account_id,
    p_conversation_id,
    p_extractor_version,
    p_last_message_id,
    p_last_message_created_at,
    p_run_id,
    v_now,
    v_now
  )
  ON CONFLICT (conversation_id, extractor_version)
  DO UPDATE SET
    account_id = EXCLUDED.account_id,
    last_analyzed_message_id = COALESCE(EXCLUDED.last_analyzed_message_id, conversation_analysis_state.last_analyzed_message_id),
    last_analyzed_message_created_at = COALESCE(EXCLUDED.last_analyzed_message_created_at, conversation_analysis_state.last_analyzed_message_created_at),
    last_analysis_run_id = EXCLUDED.last_analysis_run_id,
    last_analyzed_at = EXCLUDED.last_analyzed_at,
    updated_at = v_now;

  -- 5. Mark Run as Completed
  UPDATE public.conversation_analysis_runs
  SET
    status = 'completed',
    insights_count = v_insights_count,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    total_tokens = p_total_tokens,
    latency_ms = p_latency_ms,
    completed_at = v_now,
    lease_expires_at = NULL
  WHERE id = p_run_id;

  -- 6. Trigger Commercial State Projection for Contact
  IF v_contact_id IS NOT NULL THEN
    PERFORM public.project_contact_commercial_state(p_account_id, v_contact_id, 'analysis_completed');
  END IF;

  -- 7. Conditionally Reset Conversation Dirty State
  IF p_last_message_created_at IS NOT NULL THEN
    SELECT COUNT(*) INTO v_newer_messages_count
    FROM public.messages
    WHERE conversation_id = p_conversation_id
      AND sender_type IN ('customer', 'agent')
      AND created_at > p_last_message_created_at;

    IF v_newer_messages_count = 0 THEN
      UPDATE public.conversations
      SET
        commercial_state_dirty = false,
        pending_message_count = 0,
        intelligence_claimed_at = NULL,
        intelligence_eligible_at = NULL
      WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations
      SET
        commercial_state_dirty = true,
        pending_message_count = v_newer_messages_count,
        intelligence_claimed_at = NULL,
        intelligence_eligible_at = v_now + interval '15 minutes'
      WHERE id = p_conversation_id;
    END IF;
  ELSE
    UPDATE public.conversations
    SET
      commercial_state_dirty = false,
      pending_message_count = 0,
      intelligence_claimed_at = NULL,
      intelligence_eligible_at = NULL
    WHERE id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'completed',
    'run_id', p_run_id,
    'insights_count', v_insights_count
  );
END;
$$;


-- 2. ALIGN PROJECT_CONTACT_COMMERCIAL_STATE
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
DECLARE
  v_contact RECORD;
  v_profile RECORD;
  v_existing_run RECORD;
  v_projection_run_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();

  -- Active insights collector
  v_insights_raw JSONB;
  v_manual_state JSONB;
  v_fingerprint TEXT;
  v_source_insights_count INTEGER := 0;
  v_mutations_count INTEGER := 0;

  -- Working variables for projection
  v_latest_intent RECORD;
  v_latest_urgency RECORD;
  v_latest_sentiment RECORD;
  v_latest_next_action RECORD;

  v_new_intent TEXT;
  v_new_intent_src TEXT;
  v_new_urgency TEXT;
  v_new_urgency_src TEXT;
  v_new_sentiment TEXT;
  v_new_sentiment_src TEXT;
  v_new_next_action TEXT;
  v_new_next_action_due TIMESTAMPTZ;
  v_new_next_action_src TEXT;

  v_current_attributes JSONB := '{}'::jsonb;
  v_attr_key TEXT;
  v_latest_attr RECORD;
  v_attr_src RECORD;
  v_attr_val JSONB;

  v_interest RECORD;
  v_existing_interest RECORD;
  v_objection RECORD;
  v_existing_objection RECORD;

  -- Objection occurrence resolution
  v_taxonomy RECORD;
  v_default_other_id UUID;
  v_tax_id UUID;
  v_responsible_user UUID;
  v_existing_occ RECORD;
  v_raw_text TEXT;
  v_tax_code TEXT;
BEGIN
  -- 1. Authorization: service_role or member
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify Contact Exists in Account
  SELECT * INTO v_contact
  FROM public.contacts
  WHERE id = p_contact_id AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact % not found in account %', p_contact_id, p_account_id USING ERRCODE = 'P0002';
  END IF;

  -- Get Default Other Taxonomy ID
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

  -- 8. Resolve Dimensions (Intent, Urgency, Sentiment, Next Action)
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

    v_new_intent := v_latest_intent.value_text;
    v_new_intent_src := COALESCE(v_latest_intent.source, 'intelligence');
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

    v_new_urgency := v_latest_urgency.value_text;
    v_new_urgency_src := COALESCE(v_latest_urgency.source, 'intelligence');
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

    v_new_sentiment := v_latest_sentiment.value_text;
    v_new_sentiment_src := COALESCE(v_latest_sentiment.source, 'intelligence');
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

    v_new_next_action := v_latest_next_action.value_text;
    v_new_next_action_due := v_latest_next_action.due_at;
    v_new_next_action_src := COALESCE(v_latest_next_action.source, 'intelligence');
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

  -- 9. Upsert Contact Lead Profile
  INSERT INTO public.contact_lead_profiles (
    account_id, contact_id,
    current_intent, current_intent_source,
    urgency, urgency_source,
    sentiment, sentiment_source,
    next_action, next_action_due_at, next_action_source,
    attributes, updated_at
  ) VALUES (
    p_account_id, p_contact_id,
    v_new_intent, v_new_intent_src,
    v_new_urgency, v_new_urgency_src,
    v_new_sentiment, v_new_sentiment_src,
    v_new_next_action, v_new_next_action_due, v_new_next_action_src,
    v_current_attributes, v_now
  )
  ON CONFLICT (account_id, contact_id)
  DO UPDATE SET
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


-- 3. ALIGN OVERRIDE_OBJECTION_TAXONOMY
CREATE OR REPLACE FUNCTION public.override_objection_taxonomy(
  p_account_id UUID,
  p_occurrence_id UUID,
  p_new_taxonomy_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_occ RECORD;
  v_tax RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  -- 1. Authorization: member required
  IF v_caller_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres') AND v_jwt_role <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify Taxonomy Belongs to Same Account
  SELECT * INTO v_tax
  FROM public.tenant_objection_taxonomy
  WHERE id = p_new_taxonomy_id AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Taxonomy category % not found in account %', p_new_taxonomy_id, p_account_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock & Update Occurrence
  SELECT * INTO v_occ
  FROM public.conversation_objection_occurrences
  WHERE id = p_occurrence_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objection occurrence % not found in account %', p_occurrence_id, p_account_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.conversation_objection_occurrences
  SET
    effective_taxonomy_id = p_new_taxonomy_id,
    override_by_user_id = v_caller_id,
    override_at = v_now,
    override_reason = p_reason,
    updated_at = v_now
  WHERE id = p_occurrence_id AND account_id = p_account_id;

  -- 4. Update Current Contact Objection Taxonomy Reference
  UPDATE public.contact_objections
  SET
    taxonomy_id = p_new_taxonomy_id,
    updated_at = v_now
  WHERE account_id = p_account_id
    AND contact_id = v_occ.contact_id
    AND normalized_objection = lower(trim(v_occ.raw_objection));

  -- 5. Recalculate Lead Score
  PERFORM public.calculate_and_persist_contact_score(p_account_id, v_occ.contact_id, 'taxonomy_override');

  RETURN jsonb_build_object(
    'success', true,
    'occurrence_id', p_occurrence_id,
    'original_taxonomy_id', v_occ.original_taxonomy_id,
    'effective_taxonomy_id', p_new_taxonomy_id,
    'override_by_user_id', v_caller_id,
    'override_at', v_now
  );
END;
$$;
