-- ============================================================
-- Migration 076: Objection Taxonomy & Occurrence Ledger (V1.3)
--
-- 1. Creates tenant_objection_taxonomy with canonical per-tenant codes & localized defaults.
-- 2. Helper RPC ensure_tenant_default_objection_taxonomy to seed canonical taxonomy.
-- 3. Creates conversation_objection_occurrences (the historical event ledger):
--    - insight_id uniqueness
--    - original_taxonomy_id and effective_taxonomy_id (human override support)
--    - catalog_item_id and responsible_user_id snapshots
--    - occurred_at (from source message/evidence)
-- 4. Enhances contact_objections with taxonomy_id and catalog_item_id.
-- 5. Updates project_contact_commercial_state to project occurrences & contact state with taxonomy.
-- 6. Implements override_objection_taxonomy RPC for human categorization correction.
-- 7. Implements get_objection_summary deterministic aggregation RPC.
-- 8. Strict RLS policies and privilege revokes.
-- ============================================================

-- 1. TENANT OBJECTION TAXONOMY TABLE
CREATE TABLE IF NOT EXISTS public.tenant_objection_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tenant_objection_taxonomy_account_code
    UNIQUE (account_id, code),
  CONSTRAINT uq_tenant_objection_taxonomy_account_id
    UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_objection_taxonomy_lookup
  ON public.tenant_objection_taxonomy(account_id, is_active, position);

ALTER TABLE public.tenant_objection_taxonomy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_objection_taxonomy_select ON public.tenant_objection_taxonomy;
CREATE POLICY tenant_objection_taxonomy_select ON public.tenant_objection_taxonomy
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS tenant_objection_taxonomy_insert ON public.tenant_objection_taxonomy;
CREATE POLICY tenant_objection_taxonomy_insert ON public.tenant_objection_taxonomy
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tenant_objection_taxonomy_update ON public.tenant_objection_taxonomy;
CREATE POLICY tenant_objection_taxonomy_update ON public.tenant_objection_taxonomy
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tenant_objection_taxonomy_delete ON public.tenant_objection_taxonomy;
CREATE POLICY tenant_objection_taxonomy_delete ON public.tenant_objection_taxonomy
  FOR DELETE USING (is_account_member(account_id, 'admin'));


-- 2. SEED DEFAULT TAXONOMY RPC
CREATE OR REPLACE FUNCTION public.ensure_tenant_default_objection_taxonomy(
  p_account_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.tenant_objection_taxonomy (
    account_id, code, name, description, is_active, is_default, position
  ) VALUES
    (p_account_id, 'price_budget', 'Preço / Orçamento', 'Preço elevado, fora do orçamento ou capacidade financeira', true, true, 10),
    (p_account_id, 'payment_financing', 'Pagamento / Financiamento', 'Condições de parcelamento, taxa de juros ou recusa de crédito', true, true, 20),
    (p_account_id, 'timing', 'Momento / Timing', 'Não é o momento ideal, vai adiar compra ou priorizar outro gasto', true, true, 30),
    (p_account_id, 'competition', 'Concorrência', 'Comparando com concorrente, proposta concorrente mais vantajosa', true, true, 40),
    (p_account_id, 'trust', 'Confiança / Segurança', 'Insegurança sobre reputação, garantia, procedência ou entrega', true, true, 50),
    (p_account_id, 'decision_authority', 'Alçada de Decisão', 'Precisa consultar sócio, cônjuge, diretoria ou terceiros', true, true, 60),
    (p_account_id, 'fit_requirements', 'Aderência / Requisitos', 'Dúvidas se produto/serviço atende necessidades específicas', true, true, 70),
    (p_account_id, 'availability_delivery', 'Disponibilidade / Prazo', 'Prazo de entrega longo, indisponibilidade ou falta de estoque', true, true, 80),
    (p_account_id, 'other', 'Outra Objeção', 'Objeção não enquadrada nas categorias padronizadas acima', true, true, 99)
  ON CONFLICT (account_id, code) DO NOTHING;
END;
$$;

-- Seed for all existing accounts
DO $$
DECLARE
  v_acc RECORD;
BEGIN
  FOR v_acc IN SELECT id FROM public.accounts LOOP
    PERFORM public.ensure_tenant_default_objection_taxonomy(v_acc.id);
  END LOOP;
END $$;


-- 3. CONVERSATION OBJECTION OCCURRENCES (Historical Ledger)
CREATE TABLE IF NOT EXISTS public.conversation_objection_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  insight_id UUID NOT NULL,

  original_taxonomy_id UUID NOT NULL,
  effective_taxonomy_id UUID NOT NULL,
  catalog_item_id UUID,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  raw_objection TEXT NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  source TEXT NOT NULL DEFAULT 'intelligence' CHECK (source IN ('manual', 'import', 'intelligence', 'system')),

  occurred_at TIMESTAMPTZ NOT NULL,

  override_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  override_at TIMESTAMPTZ,
  override_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_conversation_objection_occurrences_account_id
    UNIQUE (account_id, id),
  CONSTRAINT uq_conversation_objection_occurrences_insight
    UNIQUE (account_id, insight_id),
  CONSTRAINT fk_objection_occurrences_conv
    FOREIGN KEY (account_id, conversation_id)
    REFERENCES public.conversations(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_objection_occurrences_contact
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_objection_occurrences_insight
    FOREIGN KEY (account_id, conversation_id, insight_id)
    REFERENCES public.conversation_insights(account_id, conversation_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_objection_occurrences_original_taxonomy
    FOREIGN KEY (account_id, original_taxonomy_id)
    REFERENCES public.tenant_objection_taxonomy(account_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_objection_occurrences_effective_taxonomy
    FOREIGN KEY (account_id, effective_taxonomy_id)
    REFERENCES public.tenant_objection_taxonomy(account_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_objection_occurrences_catalog_item
    FOREIGN KEY (account_id, catalog_item_id)
    REFERENCES public.catalog_items(account_id, id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_objection_occurrences_lookup
  ON public.conversation_objection_occurrences(account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_objection_occurrences_taxonomy
  ON public.conversation_objection_occurrences(account_id, effective_taxonomy_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_objection_occurrences_seller
  ON public.conversation_objection_occurrences(account_id, responsible_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_objection_occurrences_catalog
  ON public.conversation_objection_occurrences(account_id, catalog_item_id, occurred_at DESC);

ALTER TABLE public.conversation_objection_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS objection_occurrences_select ON public.conversation_objection_occurrences;
CREATE POLICY objection_occurrences_select ON public.conversation_objection_occurrences
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 4. ENHANCE CONTACT_OBJECTIONS WITH TAXONOMY REFERENCE
ALTER TABLE public.contact_objections
  ADD COLUMN IF NOT EXISTS taxonomy_id UUID,
  ADD COLUMN IF NOT EXISTS catalog_item_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_objections_taxonomy'
  ) THEN
    ALTER TABLE public.contact_objections
      ADD CONSTRAINT fk_contact_objections_taxonomy
      FOREIGN KEY (account_id, taxonomy_id)
      REFERENCES public.tenant_objection_taxonomy(account_id, id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_objections_catalog_item'
  ) THEN
    ALTER TABLE public.contact_objections
      ADD CONSTRAINT fk_contact_objections_catalog_item
      FOREIGN KEY (account_id, catalog_item_id)
      REFERENCES public.catalog_items(account_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;


-- 5. REFINED PROJECT_CONTACT_COMMERCIAL_STATE (WITH OCCURRENCE LEDGER & TAXONOMY)
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
    AND input_fingerprint = v_fingerprint
    AND status = 'completed'
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_projected',
      'projection_run_id', v_existing_run.id,
      'fingerprint', v_fingerprint
    );
  END IF;

  -- 7. Create Projection Run Record
  INSERT INTO public.commercial_state_projection_runs (
    account_id, contact_id, trigger_source, status,
    input_fingerprint, source_insights_count, started_at
  ) VALUES (
    p_account_id, p_contact_id, p_trigger_source, 'running',
    v_fingerprint, v_source_insights_count, v_now
  ) RETURNING id INTO v_projection_run_id;

  -- 8. Fetch Current Profile
  SELECT * INTO v_profile
  FROM public.contact_lead_profiles
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  -- 9. Resolve Dimensions (Intent, Urgency, Sentiment, Next Action)
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

  -- 10. Upsert Contact Lead Profile
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

  -- 11. Project Catalog Interests
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

  -- 12. Project Objection Occurrences & Current Contact Objections
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

  -- 13. Mark Projection Run Completed
  UPDATE public.commercial_state_projection_runs
  SET
    status = 'completed',
    mutations_count = v_mutations_count,
    completed_at = v_now
  WHERE id = v_projection_run_id;

  -- 14. Recalculate Lead Score Deterministically
  PERFORM public.calculate_contact_lead_score(p_account_id, p_contact_id, 'projection_completed');

  RETURN jsonb_build_object(
    'status', 'completed',
    'projection_run_id', v_projection_run_id,
    'source_insights_count', v_source_insights_count,
    'mutations_count', v_mutations_count,
    'fingerprint', v_fingerprint
  );
END;
$$;


-- 6. HUMAN TAXONOMY OVERRIDE RPC
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
  PERFORM public.calculate_contact_lead_score(p_account_id, v_occ.contact_id, 'taxonomy_override');

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


-- 7. DETERMINISTIC ANALYTICAL OBJECTION SUMMARY RPC
CREATE OR REPLACE FUNCTION public.get_objection_summary(
  p_account_id UUID,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_catalog_item_id UUID DEFAULT NULL,
  p_seller_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_role TEXT;
  v_jwt_role TEXT;
  v_effective_seller UUID;
  v_from TIMESTAMPTZ := COALESCE(p_from, date_trunc('month', clock_timestamp()));
  v_to TIMESTAMPTZ := COALESCE(p_to, clock_timestamp());
  v_total INTEGER;
  v_items JSONB;
BEGIN
  v_jwt_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );

  IF v_caller_id IS NULL AND v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '28000';
  END IF;

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

  IF v_caller_role = 'agent' THEN
    IF p_seller_user_id IS NOT NULL AND p_seller_user_id <> v_caller_id THEN
      RAISE EXCEPTION 'Forbidden: agents cannot query objections of other operators' USING ERRCODE = '42501';
    END IF;
    v_effective_seller := v_caller_id;
  ELSE
    v_effective_seller := p_seller_user_id;
  END IF;

  SELECT COUNT(*)
  INTO v_total
  FROM public.conversation_objection_occurrences o
  WHERE o.account_id = p_account_id
    AND o.occurred_at >= v_from
    AND o.occurred_at <= v_to
    AND (p_catalog_item_id IS NULL OR o.catalog_item_id = p_catalog_item_id)
    AND (v_effective_seller IS NULL OR o.responsible_user_id = v_effective_seller);

  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      t.id AS taxonomy_id,
      t.code AS taxonomy_code,
      t.name AS taxonomy_name,
      t.description AS taxonomy_description,
      COUNT(o.id) AS count,
      CASE
        WHEN v_total > 0 THEN ROUND((COUNT(o.id)::numeric / v_total::numeric) * 100, 2)
        ELSE 0
      END AS percentage
    FROM public.tenant_objection_taxonomy t
    LEFT JOIN public.conversation_objection_occurrences o
      ON o.effective_taxonomy_id = t.id
      AND o.account_id = p_account_id
      AND o.occurred_at >= v_from
      AND o.occurred_at <= v_to
      AND (p_catalog_item_id IS NULL OR o.catalog_item_id = p_catalog_item_id)
      AND (v_effective_seller IS NULL OR o.responsible_user_id = v_effective_seller)
    WHERE t.account_id = p_account_id
      AND t.is_active = true
    GROUP BY t.id, t.code, t.name, t.description, t.position
    ORDER BY count DESC, t.position ASC
  ) sub;

  RETURN jsonb_build_object(
    'total', v_total,
    'from', v_from,
    'to', v_to,
    'items', v_items
  );
END;
$$;


-- 8. GRANTS & REVOCATIONS
REVOKE ALL ON FUNCTION public.ensure_tenant_default_objection_taxonomy(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.override_objection_taxonomy(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_objection_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ensure_tenant_default_objection_taxonomy(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.override_objection_taxonomy(UUID, UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_objection_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE public.tenant_objection_taxonomy FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.tenant_objection_taxonomy FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_objection_taxonomy TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.tenant_objection_taxonomy TO service_role, postgres;

REVOKE ALL PRIVILEGES ON TABLE public.conversation_objection_occurrences FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES, DELETE ON TABLE public.conversation_objection_occurrences FROM authenticated;
GRANT SELECT ON TABLE public.conversation_objection_occurrences TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.conversation_objection_occurrences TO service_role, postgres;
