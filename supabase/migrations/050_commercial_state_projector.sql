-- ============================================================
-- Migration 050: Commercial State Projector (Phase 5B)
--
-- 1. Pre-requisite unique constraint on conversations for strict (account_id, contact_id, id) composite FKs.
-- 2. contact_commercial_provenance (proves contact + conversation + insight linkage).
-- 3. commercial_state_projection_runs (auditable projection ledger with unique input_fingerprint).
-- 4. Controlled RPCs:
--    - project_contact_commercial_state (atomic deterministic projector)
--    - request_project_commercial_state (enqueuer & synch entrypoint)
-- ============================================================

-- 1. PRE-REQUISITE CONSTRAINT ON CONVERSATIONS & NORMALIZATION HELPER
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_conversations_account_contact_id'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT uq_conversations_account_contact_id UNIQUE (account_id, contact_id, id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.normalize_objection(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(
          pg_catalog.translate(
            pg_catalog.btrim(COALESCE(p_text, '')),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
          )
        ),
        '[^a-z0-9\s]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;


-- 2. PROJECTION RUN LEDGER
CREATE TABLE IF NOT EXISTS public.commercial_state_projection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  input_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'no_op')),
  source_insights_count INTEGER NOT NULL DEFAULT 0,
  mutations_count INTEGER NOT NULL DEFAULT 0,
  trigger_source TEXT NOT NULL DEFAULT 'analysis_completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_commercial_state_projection_runs_fingerprint
    UNIQUE (account_id, contact_id, input_fingerprint),
  CONSTRAINT fk_commercial_state_projection_runs_contact
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commercial_state_projection_runs_lookup
  ON public.commercial_state_projection_runs(account_id, contact_id, created_at DESC);

ALTER TABLE public.commercial_state_projection_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_state_projection_runs_select ON public.commercial_state_projection_runs;
CREATE POLICY commercial_state_projection_runs_select ON public.commercial_state_projection_runs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 3. CONTACT COMMERCIAL PROVENANCE
CREATE TABLE IF NOT EXISTS public.contact_commercial_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  source_conversation_id UUID NOT NULL,
  source_insight_id UUID NOT NULL,
  projection_run_id UUID REFERENCES public.commercial_state_projection_runs(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile_field', 'catalog_interest', 'objection', 'attribute')),
  target_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_commercial_provenance_link
    UNIQUE (account_id, contact_id, target_type, target_key, source_insight_id),
  CONSTRAINT fk_contact_commercial_provenance_conv_contact
    FOREIGN KEY (account_id, contact_id, source_conversation_id)
    REFERENCES public.conversations(account_id, contact_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_commercial_provenance_conv_insight
    FOREIGN KEY (account_id, source_conversation_id, source_insight_id)
    REFERENCES public.conversation_insights(account_id, conversation_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contact_commercial_provenance_lookup
  ON public.contact_commercial_provenance(account_id, contact_id, target_type);

ALTER TABLE public.contact_commercial_provenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_commercial_provenance_select ON public.contact_commercial_provenance;
CREATE POLICY contact_commercial_provenance_select ON public.contact_commercial_provenance
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 4. DETERMINISTIC COMMERCIAL STATE PROJECTOR RPC
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

  -- 4. Collect manual state for fingerprinting (only human overrides that constrain projection)
  SELECT pg_catalog.jsonb_build_object(
    'manual_summary', CASE WHEN v_profile.summary_source = 'manual' THEN v_profile.summary ELSE NULL END,
    'manual_current_intent', CASE WHEN v_profile.current_intent_source = 'manual' THEN v_profile.current_intent ELSE NULL END,
    'manual_urgency', CASE WHEN v_profile.urgency_source = 'manual' THEN v_profile.urgency ELSE NULL END,
    'manual_sentiment', CASE WHEN v_profile.sentiment_source = 'manual' THEN v_profile.sentiment ELSE NULL END,
    'manual_next_action', CASE WHEN v_profile.next_action_source = 'manual' THEN jsonb_build_object('action', v_profile.next_action, 'due', v_profile.next_action_due_at) ELSE NULL END,
    'manual_attributes', COALESCE(
      (
        SELECT pg_catalog.jsonb_object_agg(key, value)
        FROM jsonb_each(v_current_attributes)
        WHERE value->>'source' = 'manual'
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

  -- Check if already projected with this fingerprint
  SELECT * INTO v_existing_run
  FROM public.commercial_state_projection_runs
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
    AND input_fingerprint = v_fingerprint
  LIMIT 1;

  IF FOUND THEN
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

  -- E. Attributes Projection (with per-attribute source preservation)
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
    -- If existing attribute has source = 'manual', preserve it
    IF (v_current_attributes->v_latest_attr.attr_key->>'source') <> 'manual' THEN
      v_current_attributes := jsonb_set(
        v_current_attributes,
        ARRAY[v_latest_attr.attr_key],
        jsonb_build_object(
          'value', COALESCE(v_latest_attr.value_json->'value', to_jsonb(v_latest_attr.value_text)),
          'source', 'intelligence',
          'updated_at', v_now
        )
      );

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
  -- Iterate through distinct catalog items observed in active insights
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
      -- If dismissed manually, never reactivate
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


-- 5. ATOMIC REPROJECTION ENQUEUE HOOK / ENTRYPOINT
CREATE OR REPLACE FUNCTION public.request_project_commercial_state(
  p_account_id UUID,
  p_contact_id UUID,
  p_trigger_source TEXT DEFAULT 'api'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Re-executes projection directly in current transaction
  RETURN public.project_contact_commercial_state(p_account_id, p_contact_id, p_trigger_source);
END;
$$;
