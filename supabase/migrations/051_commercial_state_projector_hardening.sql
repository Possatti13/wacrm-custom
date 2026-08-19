-- ============================================================
-- Migration 051: Commercial State Projector Hardening (Phase 5B Hardening)
--
-- 1. Creates contact_lead_attribute_sources to decouple attribute ownership
--    from contact_lead_profiles.attributes (preserving canonical flat JSON values).
-- 2. Refines project_contact_commercial_state:
--    - Preserves canonical flat JSON in contact_lead_profiles.attributes.
--    - Consults contact_lead_attribute_sources for manual attribute overrides.
--    - Preserves source = 'manual' on interests and objections.
--    - Comprehensive fingerprint of human constraints + active insights.
-- 3. Atomic Reprojection on Mutational RPCs:
--    - persist_conversation_analysis_batch -> projects contact state in same transaction.
--    - supersede_conversation_insight -> projects contact state in same transaction.
--    - retract_conversation_insight -> projects contact state in same transaction.
-- ============================================================

-- 1. CONTACT_LEAD_ATTRIBUTE_SOURCES & HARDEN RUNS CONSTRAINT
ALTER TABLE public.commercial_state_projection_runs
  DROP CONSTRAINT IF EXISTS uq_commercial_state_projection_runs_fingerprint;

CREATE TABLE IF NOT EXISTS public.contact_lead_attribute_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  attribute_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'import', 'intelligence', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_lead_attribute_sources
    UNIQUE (account_id, contact_id, attribute_key),
  CONSTRAINT fk_contact_lead_attribute_sources_contact
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contact_lead_attr_sources_lookup
  ON public.contact_lead_attribute_sources(account_id, contact_id);

ALTER TABLE public.contact_lead_attribute_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_lead_attr_sources_select ON public.contact_lead_attribute_sources;
CREATE POLICY contact_lead_attr_sources_select ON public.contact_lead_attribute_sources
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS contact_lead_attr_sources_insert ON public.contact_lead_attribute_sources;
CREATE POLICY contact_lead_attr_sources_insert ON public.contact_lead_attribute_sources
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_lead_attr_sources_update ON public.contact_lead_attribute_sources;
CREATE POLICY contact_lead_attr_sources_update ON public.contact_lead_attribute_sources
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_lead_attr_sources_delete ON public.contact_lead_attribute_sources;
CREATE POLICY contact_lead_attr_sources_delete ON public.contact_lead_attribute_sources
  FOR DELETE USING (is_account_member(account_id, 'agent'));


-- 2. HARDENED PROJECT_CONTACT_COMMERCIAL_STATE
CREATE OR REPLACE FUNCTION public.project_contact_commercial_state(
  p_account_id UUID,
  p_contact_id UUID,
  p_trigger_source TEXT DEFAULT 'analysis_completed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact RECORD;
  v_profile RECORD;
  v_existing_run RECORD;
  v_projection_run_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.now();

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
BEGIN
  -- 1. Authorization: service_role or admin/agent
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock contact serialization
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('project_commercial_state:' || p_account_id::text || ':' || p_contact_id::text)
  );

  -- Verify contact exists
  SELECT * INTO v_contact
  FROM public.contacts
  WHERE account_id = p_account_id AND id = p_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'P0002';
  END IF;

  -- Ensure lead profile exists
  INSERT INTO public.contact_lead_profiles (
    account_id,
    contact_id,
    last_update_source
  ) VALUES (
    p_account_id,
    p_contact_id,
    'system'
  )
  ON CONFLICT (account_id, contact_id) DO NOTHING;

  SELECT * INTO v_profile
  FROM public.contact_lead_profiles
  WHERE account_id = p_account_id AND contact_id = p_contact_id
  FOR UPDATE;

  v_current_attributes := COALESCE(v_profile.attributes, '{}'::jsonb);

  -- 3. Collect active insights from all conversations of this contact
  WITH active_ins AS (
    SELECT
      i.id,
      i.conversation_id,
      i.insight_type,
      i.value_text,
      i.value_json,
      i.catalog_item_id,
      i.confidence,
      i.source,
      i.observed_at,
      i.created_at,
      i.updated_at
    FROM public.conversation_insights i
    JOIN public.conversations c
      ON c.account_id = i.account_id
     AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id
      AND c.contact_id = p_contact_id
      AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC, i.id DESC
  )
  SELECT
    COALESCE(pg_catalog.jsonb_agg(to_jsonb(active_ins)), '[]'::jsonb),
    pg_catalog.count(*)::integer
  INTO v_insights_raw, v_source_insights_count
  FROM active_ins;

  -- 4. Collect manual state for fingerprinting (only human constraints)
  SELECT pg_catalog.jsonb_build_object(
    'manual_summary', CASE WHEN v_profile.summary_source = 'manual' THEN v_profile.summary ELSE NULL END,
    'manual_current_intent', CASE WHEN v_profile.current_intent_source = 'manual' THEN v_profile.current_intent ELSE NULL END,
    'manual_urgency', CASE WHEN v_profile.urgency_source = 'manual' THEN v_profile.urgency ELSE NULL END,
    'manual_sentiment', CASE WHEN v_profile.sentiment_source = 'manual' THEN v_profile.sentiment ELSE NULL END,
    'manual_next_action', CASE WHEN v_profile.next_action_source = 'manual' THEN jsonb_build_object('action', v_profile.next_action, 'due', v_profile.next_action_due_at) ELSE NULL END,
    'manual_attributes', COALESCE(
      (
        SELECT pg_catalog.jsonb_object_agg(
          s.attribute_key,
          pg_catalog.jsonb_build_object(
            'source', s.source,
            'value', v_current_attributes->s.attribute_key
          )
        )
        FROM public.contact_lead_attribute_sources s
        WHERE s.account_id = p_account_id AND s.contact_id = p_contact_id AND s.source = 'manual'
      ),
      '{}'::jsonb
    ),
    'manual_interests', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('item_id', catalog_item_id, 'status', status, 'source', source)
          ORDER BY catalog_item_id
        )
        FROM public.contact_catalog_interests
        WHERE account_id = p_account_id AND contact_id = p_contact_id
          AND (source = 'manual' OR status = 'dismissed')
      ),
      '[]'::jsonb
    ),
    'manual_objections', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('norm', normalized_objection, 'status', status, 'source', source, 'resolved_at', resolved_at)
          ORDER BY normalized_objection
        )
        FROM public.contact_objections
        WHERE account_id = p_account_id AND contact_id = p_contact_id
          AND (source = 'manual' OR status IN ('dismissed', 'resolved'))
      ),
      '[]'::jsonb
    )
  ) INTO v_manual_state;

  -- 5. Calculate deterministic input fingerprint
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256((v_insights_raw::text || '#' || v_manual_state::text)::bytea),
    'hex'
  );

  -- Check if latest projection run for this contact already matches this fingerprint
  SELECT * INTO v_existing_run
  FROM public.commercial_state_projection_runs
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF FOUND AND v_existing_run.input_fingerprint = v_fingerprint THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'no_op',
      'reason', 'already_projected',
      'projection_run_id', v_existing_run.id,
      'input_fingerprint', v_fingerprint,
      'source_insights_count', v_source_insights_count
    );
  END IF;

  -- Create projection run record
  INSERT INTO public.commercial_state_projection_runs (
    account_id,
    contact_id,
    input_fingerprint,
    outcome,
    source_insights_count,
    trigger_source,
    created_at
  ) VALUES (
    p_account_id,
    p_contact_id,
    v_fingerprint,
    'applied',
    v_source_insights_count,
    p_trigger_source,
    v_now
  ) RETURNING id INTO v_projection_run_id;

  -- Clear previous derived provenance for this contact
  DELETE FROM public.contact_commercial_provenance
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  -- ============================================================
  -- 6. PROJECT SCALARS (contact_lead_profiles)
  -- ============================================================

  -- A. Intent Projection
  IF v_profile.current_intent_source = 'manual' THEN
    v_new_intent := v_profile.current_intent;
    v_new_intent_src := 'manual';
  ELSE
    SELECT i.id, i.conversation_id, i.value_text INTO v_latest_intent
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'intent' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC, i.id DESC
    LIMIT 1;

    IF FOUND AND v_latest_intent.value_text IS NOT NULL THEN
      v_new_intent := v_latest_intent.value_text;
      v_new_intent_src := 'intelligence';

      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_latest_intent.conversation_id, v_latest_intent.id, v_projection_run_id, 'profile_field', 'current_intent'
      ) ON CONFLICT DO NOTHING;
    ELSE
      v_new_intent := NULL;
      v_new_intent_src := NULL;
    END IF;
  END IF;

  -- B. Urgency Projection
  IF v_profile.urgency_source = 'manual' THEN
    v_new_urgency := v_profile.urgency;
    v_new_urgency_src := 'manual';
  ELSE
    SELECT i.id, i.conversation_id, i.value_text INTO v_latest_urgency
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'urgency' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC, i.id DESC
    LIMIT 1;

    IF FOUND AND v_latest_urgency.value_text IN ('low', 'medium', 'high') THEN
      v_new_urgency := v_latest_urgency.value_text;
      v_new_urgency_src := 'intelligence';

      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_latest_urgency.conversation_id, v_latest_urgency.id, v_projection_run_id, 'profile_field', 'urgency'
      ) ON CONFLICT DO NOTHING;
    ELSE
      v_new_urgency := NULL;
      v_new_urgency_src := NULL;
    END IF;
  END IF;

  -- C. Sentiment Projection
  IF v_profile.sentiment_source = 'manual' THEN
    v_new_sentiment := v_profile.sentiment;
    v_new_sentiment_src := 'manual';
  ELSE
    SELECT i.id, i.conversation_id, i.value_text INTO v_latest_sentiment
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'sentiment' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC, i.id DESC
    LIMIT 1;

    IF FOUND AND v_latest_sentiment.value_text IN ('negative', 'neutral', 'positive', 'mixed') THEN
      v_new_sentiment := v_latest_sentiment.value_text;
      v_new_sentiment_src := 'intelligence';

      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_latest_sentiment.conversation_id, v_latest_sentiment.id, v_projection_run_id, 'profile_field', 'sentiment'
      ) ON CONFLICT DO NOTHING;
    ELSE
      v_new_sentiment := NULL;
      v_new_sentiment_src := NULL;
    END IF;
  END IF;

  -- D. Next Action Projection
  IF v_profile.next_action_source = 'manual' THEN
    v_new_next_action := v_profile.next_action;
    v_new_next_action_due := v_profile.next_action_due_at;
    v_new_next_action_src := 'manual';
  ELSE
    SELECT i.id, i.conversation_id, i.value_text, i.value_json INTO v_latest_next_action
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'next_action' AND i.status = 'active'
    ORDER BY i.observed_at DESC, i.created_at DESC, i.id DESC
    LIMIT 1;

    IF FOUND AND v_latest_next_action.value_text IS NOT NULL THEN
      v_new_next_action := v_latest_next_action.value_text;
      v_new_next_action_due := NULLIF(v_latest_next_action.value_json->>'due_at', '')::timestamptz;
      v_new_next_action_src := 'intelligence';

      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_latest_next_action.conversation_id, v_latest_next_action.id, v_projection_run_id, 'profile_field', 'next_action'
      ) ON CONFLICT DO NOTHING;
    ELSE
      v_new_next_action := NULL;
      v_new_next_action_due := NULL;
      v_new_next_action_src := NULL;
    END IF;
  END IF;

  -- E. Attributes Projection (Canonical Flat JSON in profile.attributes + Relational Ownership)
  FOR v_latest_attr IN
    SELECT DISTINCT ON (i.value_json->>'attribute_key')
      i.id,
      i.conversation_id,
      i.value_json->>'attribute_key' AS attr_key,
      i.value_text,
      i.value_json
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'attribute' AND i.status = 'active'
      AND i.value_json->>'attribute_key' IS NOT NULL
    ORDER BY (i.value_json->>'attribute_key'), i.observed_at DESC, i.created_at DESC, i.id DESC
  LOOP
    -- Check if manual source exists in contact_lead_attribute_sources
    SELECT * INTO v_attr_src
    FROM public.contact_lead_attribute_sources
    WHERE account_id = p_account_id AND contact_id = p_contact_id AND attribute_key = v_latest_attr.attr_key;

    IF NOT FOUND OR v_attr_src.source <> 'manual' THEN
      v_attr_val := COALESCE(v_latest_attr.value_json->'value', to_jsonb(v_latest_attr.value_text));

      -- Set canonical flat value in profile.attributes
      v_current_attributes := jsonb_set(
        v_current_attributes,
        ARRAY[v_latest_attr.attr_key],
        v_attr_val
      );

      -- Upsert source in contact_lead_attribute_sources
      INSERT INTO public.contact_lead_attribute_sources (
        account_id, contact_id, attribute_key, source, updated_at
      ) VALUES (
        p_account_id, p_contact_id, v_latest_attr.attr_key, 'intelligence', v_now
      )
      ON CONFLICT (account_id, contact_id, attribute_key)
      DO UPDATE SET source = 'intelligence', updated_at = v_now;

      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_latest_attr.conversation_id, v_latest_attr.id, v_projection_run_id, 'attribute', v_latest_attr.attr_key
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Update Lead Profile row
  UPDATE public.contact_lead_profiles
  SET
    current_intent = v_new_intent,
    current_intent_source = v_new_intent_src,
    urgency = v_new_urgency,
    urgency_source = v_new_urgency_src,
    sentiment = v_new_sentiment,
    sentiment_source = v_new_sentiment_src,
    next_action = v_new_next_action,
    next_action_due_at = v_new_next_action_due,
    next_action_source = v_new_next_action_src,
    attributes = v_current_attributes,
    last_update_source = 'intelligence',
    updated_at = v_now
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  v_mutations_count := v_mutations_count + 1;

  -- ============================================================
  -- 7. PROJECT CATALOG INTERESTS (contact_catalog_interests)
  -- ============================================================
  FOR v_interest IN
    SELECT
      i.catalog_item_id,
      pg_catalog.min(i.observed_at) AS min_observed_at,
      pg_catalog.max(i.observed_at) AS max_observed_at,
      pg_catalog.array_agg(i.id) AS insight_ids,
      pg_catalog.array_agg(i.conversation_id) AS conv_ids
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'interest' AND i.status = 'active'
      AND i.catalog_item_id IS NOT NULL
    GROUP BY i.catalog_item_id
  LOOP
    SELECT * INTO v_existing_interest
    FROM public.contact_catalog_interests
    WHERE account_id = p_account_id AND contact_id = p_contact_id AND catalog_item_id = v_interest.catalog_item_id;

    IF FOUND THEN
      IF v_existing_interest.status <> 'dismissed' THEN
        UPDATE public.contact_catalog_interests
        SET
          status = 'active',
          first_seen_at = LEAST(v_existing_interest.first_seen_at, v_interest.min_observed_at),
          last_seen_at = GREATEST(v_existing_interest.last_seen_at, v_interest.max_observed_at),
          updated_at = v_now
        WHERE id = v_existing_interest.id;
      END IF;
    ELSE
      INSERT INTO public.contact_catalog_interests (
        account_id, contact_id, catalog_item_id, status, source, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        p_account_id, p_contact_id, v_interest.catalog_item_id, 'active', 'intelligence', v_interest.min_observed_at, v_interest.max_observed_at, v_now, v_now
      );
    END IF;

    -- Add provenance support links
    FOR i IN 1..pg_catalog.array_length(v_interest.insight_ids, 1)
    LOOP
      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_interest.conv_ids[i], v_interest.insight_ids[i], v_projection_run_id, 'catalog_interest', v_interest.catalog_item_id::text
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Inactivate derived interests that no longer have any active supporting insight
  UPDATE public.contact_catalog_interests
  SET status = 'inactive', updated_at = v_now
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
    AND source = 'intelligence'
    AND status = 'active'
    AND catalog_item_id NOT IN (
      SELECT i.catalog_item_id
      FROM public.conversation_insights i
      JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
      WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
        AND i.insight_type = 'interest' AND i.status = 'active'
        AND i.catalog_item_id IS NOT NULL
    );

  -- ============================================================
  -- 8. PROJECT OBJECTIONS (contact_objections)
  -- ============================================================
  FOR v_objection IN
    SELECT
      i.value_text AS objection_text,
      public.normalize_objection(i.value_text) AS norm_obj,
      pg_catalog.min(i.observed_at) AS min_observed_at,
      pg_catalog.max(i.observed_at) AS max_observed_at,
      pg_catalog.array_agg(i.id) AS insight_ids,
      pg_catalog.array_agg(i.conversation_id) AS conv_ids
    FROM public.conversation_insights i
    JOIN public.conversations c ON c.account_id = i.account_id AND c.id = i.conversation_id
    WHERE i.account_id = p_account_id AND c.contact_id = p_contact_id
      AND i.insight_type = 'objection' AND i.status = 'active'
      AND i.value_text IS NOT NULL
    GROUP BY i.value_text, public.normalize_objection(i.value_text)
  LOOP
    SELECT * INTO v_existing_objection
    FROM public.contact_objections
    WHERE account_id = p_account_id AND contact_id = p_contact_id AND normalized_objection = v_objection.norm_obj;

    IF FOUND THEN
      IF v_existing_objection.status = 'resolved' THEN
        -- Reopen if and only if new insight was observed after resolved_at
        IF v_objection.max_observed_at > v_existing_objection.resolved_at THEN
          UPDATE public.contact_objections
          SET
            status = 'open',
            resolved_at = NULL,
            last_seen_at = GREATEST(v_existing_objection.last_seen_at, v_objection.max_observed_at),
            updated_at = v_now
          WHERE id = v_existing_objection.id;
        END IF;
      ELSIF v_existing_objection.status = 'open' THEN
        UPDATE public.contact_objections
        SET
          first_seen_at = LEAST(v_existing_objection.first_seen_at, v_objection.min_observed_at),
          last_seen_at = GREATEST(v_existing_objection.last_seen_at, v_objection.max_observed_at),
          updated_at = v_now
        WHERE id = v_existing_objection.id;
      END IF;
    ELSE
      INSERT INTO public.contact_objections (
        account_id, contact_id, objection, normalized_objection, status, source, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        p_account_id, p_contact_id, v_objection.objection_text, v_objection.norm_obj, 'open', 'intelligence', v_objection.min_observed_at, v_objection.max_observed_at, v_now, v_now
      );
    END IF;

    -- Add provenance support links
    FOR i IN 1..pg_catalog.array_length(v_objection.insight_ids, 1)
    LOOP
      INSERT INTO public.contact_commercial_provenance (
        account_id, contact_id, source_conversation_id, source_insight_id, projection_run_id, target_type, target_key
      ) VALUES (
        p_account_id, p_contact_id, v_objection.conv_ids[i], v_objection.insight_ids[i], v_projection_run_id, 'objection', v_objection.norm_obj
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Update run mutations count
  UPDATE public.commercial_state_projection_runs
  SET mutations_count = v_mutations_count
  WHERE id = v_projection_run_id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'projection_run_id', v_projection_run_id,
    'input_fingerprint', v_fingerprint,
    'source_insights_count', v_source_insights_count,
    'mutations_count', v_mutations_count
  );
END;
$$;


-- 3. ENHANCE PERSIST_CONVERSATION_ANALYSIS_BATCH FOR ATOMIC PROJECTION DURABILITY
CREATE OR REPLACE FUNCTION public.persist_conversation_analysis_batch(
  p_account_id UUID,
  p_conversation_id UUID,
  p_run_id UUID,
  p_extractor_version TEXT,
  p_insights JSONB,
  p_analyzed_message_ids UUID[],
  p_last_message_id UUID,
  p_last_message_created_at TIMESTAMPTZ,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_total_tokens INTEGER DEFAULT NULL,
  p_latency_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version TEXT := COALESCE(NULLIF(pg_catalog.btrim(p_extractor_version), ''), 'v1');
  v_run RECORD;
  v_conv RECORD;
  v_ins JSONB;
  v_ev JSONB;
  v_new_insight_id UUID;
  v_insights_count INTEGER := 0;
  v_msg_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_proj_res JSONB;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock run for update
  SELECT * INTO v_run
  FROM public.conversation_analysis_runs
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
    AND id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analysis run not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: if already completed, return success
  IF v_run.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'already_completed',
      'run_id', p_run_id,
      'insights_count', v_run.insights_count
    );
  END IF;

  IF v_run.status <> 'processing' THEN
    RAISE EXCEPTION 'Run is in invalid status % (expected processing)', v_run.status
      USING ERRCODE = '22000';
  END IF;

  -- Resolve contact_id from conversation
  SELECT * INTO v_conv
  FROM public.conversations
  WHERE account_id = p_account_id AND id = p_conversation_id;

  -- 3. Insert Insights & Evidences
  IF p_insights IS NOT NULL AND pg_catalog.jsonb_array_length(p_insights) > 0 THEN
    FOR v_ins IN SELECT * FROM pg_catalog.jsonb_array_elements(p_insights)
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
        observed_at
      ) VALUES (
        p_account_id,
        p_conversation_id,
        v_ins->>'insight_type',
        v_ins->>'value_text',
        COALESCE(v_ins->'value_json', '{}'::jsonb),
        NULLIF(v_ins->>'catalog_item_id', '')::uuid,
        (v_ins->>'confidence')::numeric,
        COALESCE(v_ins->>'source', 'intelligence'),
        'active',
        p_run_id,
        v_ins->>'dedupe_key',
        COALESCE((v_ins->>'observed_at')::timestamptz, p_last_message_created_at, v_now)
      )
      ON CONFLICT (account_id, conversation_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'active'
      DO UPDATE SET updated_at = v_now
      RETURNING id INTO v_new_insight_id;

      v_insights_count := v_insights_count + 1;

      -- Insert evidence
      IF v_ins->'evidence' IS NOT NULL AND pg_catalog.jsonb_array_length(v_ins->'evidence') > 0 THEN
        FOR v_ev IN SELECT * FROM pg_catalog.jsonb_array_elements(v_ins->'evidence')
        LOOP
          INSERT INTO public.conversation_insight_evidence (
            account_id,
            conversation_id,
            insight_id,
            message_id,
            start_offset,
            end_offset,
            snippet
          ) VALUES (
            p_account_id,
            p_conversation_id,
            v_new_insight_id,
            (v_ev->>'message_id')::uuid,
            (v_ev->>'start_offset')::integer,
            (v_ev->>'end_offset')::integer,
            v_ev->>'snippet'
          )
          ON CONFLICT (account_id, insight_id, message_id, COALESCE(start_offset, -1), COALESCE(end_offset, -1))
          DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- 4. Mark Analyzed Messages in Ledger
  IF p_analyzed_message_ids IS NOT NULL AND pg_catalog.array_length(p_analyzed_message_ids, 1) > 0 THEN
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
        v_version,
        p_run_id,
        v_now
      )
      ON CONFLICT (conversation_id, message_id, extractor_version)
      DO UPDATE SET analysis_run_id = p_run_id, analyzed_at = v_now;
    END LOOP;
  END IF;

  -- 5. Update Conversation Analysis State Checkpoint
  IF p_last_message_id IS NOT NULL THEN
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
      v_version,
      p_last_message_id,
      p_last_message_created_at,
      p_run_id,
      v_now,
      v_now
    )
    ON CONFLICT (conversation_id, extractor_version)
    DO UPDATE SET
      last_analyzed_message_id = EXCLUDED.last_analyzed_message_id,
      last_analyzed_message_created_at = EXCLUDED.last_analyzed_message_created_at,
      last_analysis_run_id = EXCLUDED.last_analysis_run_id,
      last_analyzed_at = v_now,
      updated_at = v_now;
  END IF;

  -- 6. Mark Run Completed
  UPDATE public.conversation_analysis_runs
  SET status = 'completed',
      insights_count = v_insights_count,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      latency_ms = p_latency_ms,
      completed_at = v_now
  WHERE id = p_run_id;

  -- 7. ATOMIC REPROJECTION DURABILITY: Automatically project contact state in same transaction!
  IF v_conv.contact_id IS NOT NULL THEN
    v_proj_res := public.project_contact_commercial_state(p_account_id, v_conv.contact_id, 'analysis_completed');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'completed',
    'run_id', p_run_id,
    'insights_count', v_insights_count,
    'projection', v_proj_res
  );
END;
$$;


-- 4. ENHANCE SUPERSEDE & RETRACT WITH ATOMIC REPROJECTION
CREATE OR REPLACE FUNCTION public.supersede_conversation_insight(
  p_account_id UUID,
  p_conversation_id UUID,
  p_old_insight_id UUID,
  p_new_insight_type TEXT,
  p_new_value_text TEXT,
  p_new_value_json JSONB DEFAULT '{}'::jsonb,
  p_new_catalog_item_id UUID DEFAULT NULL,
  p_new_confidence NUMERIC DEFAULT NULL,
  p_new_source TEXT DEFAULT 'manual',
  p_evidence JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old RECORD;
  v_conv RECORD;
  v_new_id UUID;
  v_ev JSONB;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_proj_res JSONB;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions to manage insights' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock and validate old insight
  SELECT * INTO v_old
  FROM public.conversation_insights
  WHERE account_id = p_account_id AND conversation_id = p_conversation_id AND id = p_old_insight_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old insight not found in specified conversation' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot supersede an insight that is in % status', v_old.status USING ERRCODE = '22000';
  END IF;

  -- 3. Mark old insight as superseded
  UPDATE public.conversation_insights
  SET status = 'superseded', updated_at = v_now
  WHERE id = p_old_insight_id;

  -- 4. Insert new successor insight
  INSERT INTO public.conversation_insights (
    account_id, conversation_id, insight_type, value_text, value_json, catalog_item_id, confidence,
    source, status, supersedes_insight_id, observed_at, created_at, updated_at
  ) VALUES (
    p_account_id, p_conversation_id, p_new_insight_type, p_new_value_text, COALESCE(p_new_value_json, '{}'::jsonb),
    p_new_catalog_item_id, p_new_confidence, COALESCE(p_new_source, 'manual'), 'active', p_old_insight_id, v_now, v_now, v_now
  ) RETURNING id INTO v_new_id;

  -- 5. Insert evidence if provided
  IF p_evidence IS NOT NULL AND pg_catalog.jsonb_array_length(p_evidence) > 0 THEN
    FOR v_ev IN SELECT * FROM pg_catalog.jsonb_array_elements(p_evidence)
    LOOP
      INSERT INTO public.conversation_insight_evidence (
        account_id, conversation_id, insight_id, message_id, start_offset, end_offset, snippet
      ) VALUES (
        p_account_id, p_conversation_id, v_new_id, (v_ev->>'message_id')::uuid,
        (v_ev->>'start_offset')::integer, (v_ev->>'end_offset')::integer, v_ev->>'snippet'
      );
    END LOOP;
  END IF;

  -- 6. Atomic reprojection
  SELECT * INTO v_conv FROM public.conversations WHERE account_id = p_account_id AND id = p_conversation_id;
  IF v_conv.contact_id IS NOT NULL THEN
    v_proj_res := public.project_contact_commercial_state(p_account_id, v_conv.contact_id, 'insight_superseded');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'old_insight_id', p_old_insight_id,
    'new_insight_id', v_new_id,
    'status', 'superseded',
    'projection', v_proj_res
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.retract_conversation_insight(
  p_account_id UUID,
  p_conversation_id UUID,
  p_insight_id UUID,
  p_retracted_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ins RECORD;
  v_conv RECORD;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_proj_res JSONB;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'agent'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: insufficient permissions to manage insights' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate reason
  IF p_retracted_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_retracted_reason)) = 0 THEN
    RAISE EXCEPTION 'Retraction reason cannot be empty' USING ERRCODE = '22000';
  END IF;

  -- 2. Lock and validate insight
  SELECT * INTO v_ins
  FROM public.conversation_insights
  WHERE account_id = p_account_id AND conversation_id = p_conversation_id AND id = p_insight_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insight not found in specified conversation' USING ERRCODE = 'P0002';
  END IF;

  IF v_ins.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot retract an insight that is in % status', v_ins.status USING ERRCODE = '22000';
  END IF;

  -- 3. Mark as retracted
  UPDATE public.conversation_insights
  SET status = 'retracted',
      retracted_reason = pg_catalog.btrim(p_retracted_reason),
      updated_at = v_now
  WHERE id = p_insight_id;

  -- 4. Atomic reprojection
  SELECT * INTO v_conv FROM public.conversations WHERE account_id = p_account_id AND id = p_conversation_id;
  IF v_conv.contact_id IS NOT NULL THEN
    v_proj_res := public.project_contact_commercial_state(p_account_id, v_conv.contact_id, 'insight_retracted');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'insight_id', p_insight_id,
    'status', 'retracted',
    'reason', pg_catalog.btrim(p_retracted_reason),
    'projection', v_proj_res
  );
END;
$$;
