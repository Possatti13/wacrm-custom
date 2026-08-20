-- ============================================================
-- Migration 052: Deterministic & Configurable Lead Scoring Engine (Phase 6)
--
-- 1. Adds occurred_at to messages for explicit provider/event chronology.
-- 2. lead_scoring_configs (tenant scoring master with strict range constraints & revision pointer).
-- 3. lead_scoring_revisions (immutable audit ledger of scoring snapshots).
-- 4. lead_scoring_rules (tenant scoring rules with stable keys and composite FKs).
-- 5. contact_lead_scores (current 1-to-0..1 lead score state).
-- 6. contact_lead_score_history (immutable append-only audit ledger with input_snapshot & unique fingerprint).
-- 7. Immutability triggers on ledgers (lead_scoring_revisions, contact_lead_score_history).
-- 8. Controlled transactional RPCs:
--    - save_lead_scoring_configuration (admin mutation, canonical snapshot, revision increment, sweep enqueue)
--    - calculate_and_persist_contact_score (atomic deterministic scoring & history ledger update)
-- ============================================================

-- 1. MESSAGE OCCURRED_AT CHRONOLOGY
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

-- Backfill occurred_at with created_at where null
UPDATE public.messages
SET occurred_at = created_at
WHERE occurred_at IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN occurred_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_messages_conversation_occurred
  ON public.messages(conversation_id, occurred_at DESC);


-- 2. LEAD SCORING CONFIGS (Preliminary Table for Composite FKs)
CREATE TABLE IF NOT EXISTS public.lead_scoring_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  base_score INTEGER NOT NULL DEFAULT 0,
  min_score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 100,
  current_revision_id UUID,
  current_revision_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_lead_scoring_configs_account
    UNIQUE (account_id),
  CONSTRAINT uq_lead_scoring_configs_account_id
    UNIQUE (account_id, id),
  CONSTRAINT chk_lead_scoring_configs_range
    CHECK (0 <= min_score AND min_score <= base_score AND base_score <= max_score AND max_score <= 100)
);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_configs_lookup
  ON public.lead_scoring_configs(account_id);

ALTER TABLE public.lead_scoring_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_scoring_configs_select ON public.lead_scoring_configs;
CREATE POLICY lead_scoring_configs_select ON public.lead_scoring_configs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 3. LEAD SCORING REVISIONS
CREATE TABLE IF NOT EXISTS public.lead_scoring_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
  snapshot JSONB NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_lead_scoring_revisions_account_number
    UNIQUE (account_id, revision_number),
  CONSTRAINT uq_lead_scoring_revisions_account_id_number
    UNIQUE (account_id, id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_revisions_lookup
  ON public.lead_scoring_revisions(account_id, revision_number DESC);

ALTER TABLE public.lead_scoring_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_scoring_revisions_select ON public.lead_scoring_revisions;
CREATE POLICY lead_scoring_revisions_select ON public.lead_scoring_revisions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- Add FK from lead_scoring_configs to lead_scoring_revisions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lead_scoring_configs_revision'
  ) THEN
    ALTER TABLE public.lead_scoring_configs
      ADD CONSTRAINT fk_lead_scoring_configs_revision
      FOREIGN KEY (account_id, current_revision_id, current_revision_number)
      REFERENCES public.lead_scoring_revisions(account_id, id, revision_number)
      ON DELETE RESTRICT;
  END IF;
END $$;


-- 4. LEAD SCORING RULES
CREATE TABLE IF NOT EXISTS public.lead_scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  config_id UUID NOT NULL,
  rule_key TEXT NOT NULL CHECK (rule_key ~ '^[a-z0-9_]{2,64}$'),
  label TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'profile_field',
    'attribute',
    'catalog_interest',
    'objection_presence',
    'objection_key',
    'engagement_metric'
  )),
  field_key TEXT,
  operator TEXT NOT NULL CHECK (operator IN (
    'equals',
    'not_equals',
    'in',
    'exists',
    'not_exists',
    'gt',
    'gte',
    'lt',
    'lte'
  )),
  expected_value JSONB,
  points INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_lead_scoring_rules_account_key
    UNIQUE (account_id, rule_key),
  CONSTRAINT fk_lead_scoring_rules_config
    FOREIGN KEY (account_id, config_id)
    REFERENCES public.lead_scoring_configs(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_rules_lookup
  ON public.lead_scoring_rules(account_id, config_id, sort_order ASC, rule_key ASC);

ALTER TABLE public.lead_scoring_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_scoring_rules_select ON public.lead_scoring_rules;
CREATE POLICY lead_scoring_rules_select ON public.lead_scoring_rules
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 5. CONTACT LEAD SCORES (Current State)
CREATE TABLE IF NOT EXISTS public.contact_lead_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  scoring_revision_id UUID NOT NULL,
  scoring_revision_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  breakdown JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_lead_scores
    UNIQUE (account_id, contact_id),
  CONSTRAINT fk_contact_lead_scores_contact
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_lead_scores_revision
    FOREIGN KEY (account_id, scoring_revision_id, scoring_revision_number)
    REFERENCES public.lead_scoring_revisions(account_id, id, revision_number)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_contact_lead_scores_lookup
  ON public.contact_lead_scores(account_id, contact_id);

ALTER TABLE public.contact_lead_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_lead_scores_select ON public.contact_lead_scores;
CREATE POLICY contact_lead_scores_select ON public.contact_lead_scores
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 6. CONTACT LEAD SCORE HISTORY (Immutable Ledger)
CREATE TABLE IF NOT EXISTS public.contact_lead_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  raw_score INTEGER NOT NULL,
  scoring_revision_id UUID NOT NULL,
  scoring_revision_number INTEGER NOT NULL,
  input_schema_version INTEGER NOT NULL DEFAULT 1,
  input_snapshot JSONB NOT NULL,
  input_fingerprint TEXT NOT NULL,
  breakdown JSONB NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'commercial_state_projected',
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_lead_score_history
    UNIQUE (account_id, contact_id, scoring_revision_id, input_fingerprint),
  CONSTRAINT fk_contact_lead_score_history_contact
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_lead_score_history_revision
    FOREIGN KEY (account_id, scoring_revision_id, scoring_revision_number)
    REFERENCES public.lead_scoring_revisions(account_id, id, revision_number)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_contact_lead_score_history_lookup
  ON public.contact_lead_score_history(account_id, contact_id, calculated_at DESC);

ALTER TABLE public.contact_lead_score_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_lead_score_history_select ON public.contact_lead_score_history;
CREATE POLICY contact_lead_score_history_select ON public.contact_lead_score_history
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 7. IMMUTABILITY TRIGGERS
CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Immutable ledger: UPDATE and DELETE operations are forbidden'
    USING ERRCODE = '22000';
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_scoring_revisions_immutable ON public.lead_scoring_revisions;
CREATE TRIGGER trg_lead_scoring_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.lead_scoring_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_contact_lead_score_history_immutable ON public.contact_lead_score_history;
CREATE TRIGGER trg_contact_lead_score_history_immutable
  BEFORE UPDATE OR DELETE ON public.contact_lead_score_history
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_ledger_mutation();


-- 8. TRANSACTIONAL CONFIGURATION RPC
CREATE OR REPLACE FUNCTION public.save_lead_scoring_configuration(
  p_account_id UUID,
  p_config JSONB,
  p_rules JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cfg_id UUID;
  v_enabled BOOLEAN := COALESCE((p_config->>'enabled')::boolean, true);
  v_base_score INTEGER := COALESCE((p_config->>'base_score')::integer, 0);
  v_min_score INTEGER := COALESCE((p_config->>'min_score')::integer, 0);
  v_max_score INTEGER := COALESCE((p_config->>'max_score')::integer, 100);

  v_next_rev INTEGER;
  v_rev_id UUID;
  v_snapshot JSONB;
  v_snapshot_hash TEXT;
  v_rule JSONB;
  v_now TIMESTAMPTZ := pg_catalog.now();
  v_user_id UUID := auth.uid();
BEGIN
  -- 1. Authorization
  IF v_user_id IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins or owners can configure lead scoring' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Range Validation
  IF NOT (0 <= v_min_score AND v_min_score <= v_base_score AND v_base_score <= v_max_score AND v_max_score <= 100) THEN
    RAISE EXCEPTION 'Invalid score range constraints: must satisfy 0 <= min_score <= base_score <= max_score <= 100'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock serialization for this account
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('lead_scoring_config:' || p_account_id::text)
  );

  -- 4. Upsert lead_scoring_configs record
  INSERT INTO public.lead_scoring_configs (
    account_id,
    enabled,
    base_score,
    min_score,
    max_score,
    created_at,
    updated_at
  ) VALUES (
    p_account_id,
    v_enabled,
    v_base_score,
    v_min_score,
    v_max_score,
    v_now,
    v_now
  )
  ON CONFLICT (account_id)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    base_score = EXCLUDED.base_score,
    min_score = EXCLUDED.min_score,
    max_score = EXCLUDED.max_score,
    updated_at = v_now
  RETURNING id INTO v_cfg_id;

  -- If disabled, clear current contact lead scores immediately (historical ledger remains intact)
  IF NOT v_enabled THEN
    DELETE FROM public.contact_lead_scores
    WHERE account_id = p_account_id;
  END IF;

  -- 5. Upsert / Replace Rules
  IF p_rules IS NOT NULL THEN
    FOR v_rule IN SELECT * FROM pg_catalog.jsonb_array_elements(p_rules)
    LOOP
      -- Validate rule_key
      IF NOT (v_rule->>'rule_key' ~ '^[a-z0-9_]{2,64}$') THEN
        RAISE EXCEPTION 'Invalid rule_key "%": must be 2-64 lowercase alphanumeric and underscore characters', v_rule->>'rule_key'
          USING ERRCODE = '22000';
      END IF;

      -- Validate signal_type
      IF v_rule->>'signal_type' NOT IN ('profile_field', 'attribute', 'catalog_interest', 'objection_presence', 'objection_key', 'engagement_metric') THEN
        RAISE EXCEPTION 'Invalid signal_type "%"', v_rule->>'signal_type' USING ERRCODE = '22000';
      END IF;

      -- Validate operator
      IF v_rule->>'operator' NOT IN ('equals', 'not_equals', 'in', 'exists', 'not_exists', 'gt', 'gte', 'lt', 'lte') THEN
        RAISE EXCEPTION 'Invalid operator "%"', v_rule->>'operator' USING ERRCODE = '22000';
      END IF;

      INSERT INTO public.lead_scoring_rules (
        account_id,
        config_id,
        rule_key,
        label,
        signal_type,
        field_key,
        operator,
        expected_value,
        points,
        status,
        sort_order,
        created_at,
        updated_at
      ) VALUES (
        p_account_id,
        v_cfg_id,
        v_rule->>'rule_key',
        COALESCE(v_rule->>'label', v_rule->>'rule_key'),
        v_rule->>'signal_type',
        v_rule->>'field_key',
        v_rule->>'operator',
        v_rule->'expected_value',
        COALESCE((v_rule->>'points')::integer, 0),
        COALESCE(v_rule->>'status', 'active'),
        COALESCE((v_rule->>'sort_order')::integer, 0),
        v_now,
        v_now
      )
      ON CONFLICT (account_id, rule_key)
      DO UPDATE SET
        label = EXCLUDED.label,
        signal_type = EXCLUDED.signal_type,
        field_key = EXCLUDED.field_key,
        operator = EXCLUDED.operator,
        expected_value = EXCLUDED.expected_value,
        points = EXCLUDED.points,
        status = EXCLUDED.status,
        sort_order = EXCLUDED.sort_order,
        updated_at = v_now;
    END LOOP;
  END IF;

  -- 6. Compute Next Revision Number
  SELECT COALESCE(pg_catalog.max(revision_number), 0) + 1 INTO v_next_rev
  FROM public.lead_scoring_revisions
  WHERE account_id = p_account_id;

  -- 7. Build Canonical Immutable Snapshot
  WITH active_rules AS (
    SELECT
      r.rule_key,
      r.label,
      r.signal_type,
      r.field_key,
      r.operator,
      r.expected_value,
      r.points,
      r.sort_order
    FROM public.lead_scoring_rules r
    WHERE r.account_id = p_account_id AND r.status = 'active'
    ORDER BY r.sort_order ASC, r.rule_key ASC
  )
  SELECT pg_catalog.jsonb_build_object(
    'account_id', p_account_id,
    'revision_number', v_next_rev,
    'enabled', v_enabled,
    'base_score', v_base_score,
    'min_score', v_min_score,
    'max_score', v_max_score,
    'rules', COALESCE(pg_catalog.jsonb_agg(to_jsonb(active_rules)), '[]'::jsonb)
  ) INTO v_snapshot
  FROM active_rules;

  -- Compute SHA-256 hash of snapshot
  v_snapshot_hash := pg_catalog.encode(
    pg_catalog.sha256(v_snapshot::text::bytea),
    'hex'
  );

  -- 8. Insert New Revision
  INSERT INTO public.lead_scoring_revisions (
    account_id,
    revision_number,
    snapshot_schema_version,
    snapshot,
    snapshot_hash,
    created_by,
    created_at
  ) VALUES (
    p_account_id,
    v_next_rev,
    1,
    v_snapshot,
    v_snapshot_hash,
    v_user_id,
    v_now
  ) RETURNING id INTO v_rev_id;

  -- 9. Update lead_scoring_configs pointer to current revision
  UPDATE public.lead_scoring_configs
  SET
    current_revision_id = v_rev_id,
    current_revision_number = v_next_rev,
    updated_at = v_now
  WHERE id = v_cfg_id;

  RETURN pg_catalog.jsonb_build_object(
    'config_id', v_cfg_id,
    'revision_id', v_rev_id,
    'revision_number', v_next_rev,
    'snapshot_hash', v_snapshot_hash,
    'enabled', v_enabled
  );
END;
$$;


-- 9. TRANSACTIONAL SCORE PERSISTENCE RPC
CREATE OR REPLACE FUNCTION public.calculate_and_persist_contact_score(
  p_account_id UUID,
  p_contact_id UUID,
  p_trigger_source TEXT DEFAULT 'commercial_state_projected'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cfg RECORD;
  v_rev RECORD;
  v_profile RECORD;
  v_contact RECORD;
  v_existing_score RECORD;

  v_input_snapshot JSONB;
  v_input_fingerprint TEXT;

  v_raw_score INTEGER := 0;
  v_final_score INTEGER := 0;
  v_breakdown JSONB;
  v_contributions JSONB := '[]'::jsonb;
  v_matched_rule_keys TEXT[] := ARRAY[]::text[];

  v_rule RECORD;
  v_matched BOOLEAN;
  v_val_text TEXT;
  v_now TIMESTAMPTZ := pg_catalog.now();

  v_active_item_ids JSONB;
  v_open_objections JSONB;
  v_active_interests_count INTEGER := 0;
  v_open_objections_count INTEGER := 0;
BEGIN
  -- 1. Authorization
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

  -- 2. Lock Contact Serialization for Scoring
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('lead_score:' || p_account_id::text || ':' || p_contact_id::text)
  );

  -- Verify contact exists
  SELECT * INTO v_contact
  FROM public.contacts
  WHERE account_id = p_account_id AND id = p_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Fetch Scoring Config & Current Revision
  SELECT * INTO v_cfg
  FROM public.lead_scoring_configs
  WHERE account_id = p_account_id;

  IF NOT FOUND OR NOT v_cfg.enabled OR v_cfg.current_revision_id IS NULL THEN
    -- If scoring is disabled or not configured, remove any current score record
    DELETE FROM public.contact_lead_scores
    WHERE account_id = p_account_id AND contact_id = p_contact_id;

    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'disabled',
      'contact_id', p_contact_id
    );
  END IF;

  SELECT * INTO v_rev
  FROM public.lead_scoring_revisions
  WHERE account_id = p_account_id AND id = v_cfg.current_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoring revision % not found', v_cfg.current_revision_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. Gather Current Commercial State for Input Builder
  SELECT * INTO v_profile
  FROM public.contact_lead_profiles
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  -- Collect active catalog interest item IDs (canonical sorted array)
  SELECT
    COALESCE(pg_catalog.jsonb_agg(catalog_item_id::text ORDER BY catalog_item_id), '[]'::jsonb),
    pg_catalog.count(*)::integer
  INTO v_active_item_ids, v_active_interests_count
  FROM public.contact_catalog_interests
  WHERE account_id = p_account_id AND contact_id = p_contact_id AND status = 'active';

  -- Collect open normalized objections (canonical sorted array)
  SELECT
    COALESCE(pg_catalog.jsonb_agg(normalized_objection ORDER BY normalized_objection), '[]'::jsonb),
    pg_catalog.count(*)::integer
  INTO v_open_objections, v_open_objections_count
  FROM public.contact_objections
  WHERE account_id = p_account_id AND contact_id = p_contact_id AND status = 'open';

  -- 5. Build Canonical Scoring Input Snapshot
  v_input_snapshot := pg_catalog.jsonb_build_object(
    'profile', pg_catalog.jsonb_build_object(
      'current_intent', v_profile.current_intent,
      'urgency', v_profile.urgency,
      'sentiment', v_profile.sentiment,
      'next_action', v_profile.next_action,
      'attributes', COALESCE(v_profile.attributes, '{}'::jsonb)
    ),
    'interests', pg_catalog.jsonb_build_object(
      'active_item_ids', v_active_item_ids
    ),
    'objections', pg_catalog.jsonb_build_object(
      'open_keys', v_open_objections,
      'has_open', (v_open_objections_count > 0)
    ),
    'engagement', pg_catalog.jsonb_build_object(
      'active_interests_count', v_active_interests_count,
      'open_objections_count', v_open_objections_count
    )
  );

  -- Compute deterministic input fingerprint
  v_input_fingerprint := pg_catalog.encode(
    pg_catalog.sha256((v_rev.id::text || '#' || v_rev.snapshot_hash || '#' || v_input_snapshot::text)::bytea),
    'hex'
  );

  -- Check idempotency against existing current score
  SELECT * INTO v_existing_score
  FROM public.contact_lead_scores
  WHERE account_id = p_account_id AND contact_id = p_contact_id;

  IF FOUND AND v_existing_score.scoring_revision_id = v_rev.id AND v_existing_score.input_fingerprint = v_input_fingerprint THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'no_op',
      'reason', 'already_calculated',
      'score', v_existing_score.score,
      'scoring_revision_number', v_rev.revision_number,
      'input_fingerprint', v_input_fingerprint
    );
  END IF;

  -- 6. Evaluate Scoring Rules Deterministically
  v_raw_score := v_cfg.base_score;

  FOR v_rule IN
    SELECT
      (elem->>'rule_key') AS rule_key,
      (elem->>'label') AS label,
      (elem->>'signal_type') AS signal_type,
      (elem->>'field_key') AS field_key,
      (elem->>'operator') AS operator,
      (elem->'expected_value') AS expected_value,
      (elem->>'points')::integer AS points
    FROM pg_catalog.jsonb_array_elements(v_rev.snapshot->'rules') AS elem
  LOOP
    v_matched := false;
    v_val_text := NULL;

    IF v_rule.signal_type = 'profile_field' THEN
      IF v_rule.field_key = 'current_intent' THEN
        v_val_text := v_profile.current_intent;
      ELSIF v_rule.field_key = 'urgency' THEN
        v_val_text := v_profile.urgency;
      ELSIF v_rule.field_key = 'sentiment' THEN
        v_val_text := v_profile.sentiment;
      ELSIF v_rule.field_key = 'next_action' THEN
        v_val_text := v_profile.next_action;
      END IF;

      IF v_rule.operator = 'equals' THEN
        v_matched := (v_val_text = v_rule.expected_value #>> '{}');
      ELSIF v_rule.operator = 'not_equals' THEN
        v_matched := (v_val_text IS NOT NULL AND v_val_text <> v_rule.expected_value #>> '{}');
      ELSIF v_rule.operator = 'in' THEN
        v_matched := (v_val_text IS NOT NULL AND v_rule.expected_value ? v_val_text);
      ELSIF v_rule.operator = 'exists' THEN
        v_matched := (v_val_text IS NOT NULL AND pg_catalog.length(v_val_text) > 0);
      ELSIF v_rule.operator = 'not_exists' THEN
        v_matched := (v_val_text IS NULL OR pg_catalog.length(v_val_text) = 0);
      END IF;

    ELSIF v_rule.signal_type = 'attribute' THEN
      IF v_profile.attributes ? v_rule.field_key THEN
        v_val_text := v_profile.attributes->>v_rule.field_key;

        IF v_rule.operator = 'equals' THEN
          v_matched := (v_val_text = v_rule.expected_value #>> '{}');
        ELSIF v_rule.operator = 'not_equals' THEN
          v_matched := (v_val_text <> v_rule.expected_value #>> '{}');
        ELSIF v_rule.operator = 'in' THEN
          v_matched := (v_rule.expected_value ? v_val_text);
        ELSIF v_rule.operator = 'exists' THEN
          v_matched := true;
        ELSIF v_rule.operator = 'not_exists' THEN
          v_matched := false;
        ELSIF v_rule.operator IN ('gt', 'gte', 'lt', 'lte') THEN
          IF (v_profile.attributes->v_rule.field_key)::text ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
            DECLARE
              v_num NUMERIC := (v_profile.attributes->>v_rule.field_key)::numeric;
              v_exp NUMERIC := (v_rule.expected_value #>> '{}')::numeric;
            BEGIN
              IF v_rule.operator = 'gt' THEN v_matched := (v_num > v_exp);
              ELSIF v_rule.operator = 'gte' THEN v_matched := (v_num >= v_exp);
              ELSIF v_rule.operator = 'lt' THEN v_matched := (v_num < v_exp);
              ELSIF v_rule.operator = 'lte' THEN v_matched := (v_num <= v_exp);
              END IF;
            END;
          END IF;
        END IF;
      ELSE
        IF v_rule.operator = 'not_exists' THEN
          v_matched := true;
        END IF;
      END IF;

    ELSIF v_rule.signal_type = 'catalog_interest' THEN
      IF v_rule.operator = 'exists' THEN
        IF v_rule.field_key IS NOT NULL AND pg_catalog.length(v_rule.field_key) > 0 THEN
          v_matched := (v_active_item_ids ? v_rule.field_key);
          v_val_text := v_rule.field_key;
        ELSE
          v_matched := (v_active_interests_count > 0);
          v_val_text := v_active_interests_count::text;
        END IF;
      ELSIF v_rule.operator = 'not_exists' THEN
        IF v_rule.field_key IS NOT NULL AND pg_catalog.length(v_rule.field_key) > 0 THEN
          v_matched := NOT (v_active_item_ids ? v_rule.field_key);
        ELSE
          v_matched := (v_active_interests_count = 0);
        END IF;
      ELSIF v_rule.operator = 'in' THEN
        DECLARE
          v_elem TEXT;
        BEGIN
          FOR v_elem IN SELECT jsonb_array_elements_text(v_rule.expected_value)
          LOOP
            IF v_active_item_ids ? v_elem THEN
              v_matched := true;
              v_val_text := v_elem;
              EXIT;
            END IF;
          END LOOP;
        END;
      END IF;

    ELSIF v_rule.signal_type = 'objection_presence' THEN
      IF v_rule.operator = 'equals' THEN
        v_matched := ((v_open_objections_count > 0) = (v_rule.expected_value #>> '{}')::boolean);
      ELSIF v_rule.operator = 'exists' THEN
        v_matched := (v_open_objections_count > 0);
      ELSIF v_rule.operator = 'not_exists' THEN
        v_matched := (v_open_objections_count = 0);
      END IF;
      v_val_text := (v_open_objections_count > 0)::text;

    ELSIF v_rule.signal_type = 'objection_key' THEN
      IF v_rule.operator = 'equals' OR v_rule.operator = 'exists' THEN
        v_matched := (v_open_objections ? (v_rule.expected_value #>> '{}'));
        v_val_text := (v_rule.expected_value #>> '{}');
      ELSIF v_rule.operator = 'not_exists' THEN
        v_matched := NOT (v_open_objections ? (v_rule.expected_value #>> '{}'));
      ELSIF v_rule.operator = 'in' THEN
        DECLARE
          v_elem TEXT;
        BEGIN
          FOR v_elem IN SELECT jsonb_array_elements_text(v_rule.expected_value)
          LOOP
            IF v_open_objections ? v_elem THEN
              v_matched := true;
              v_val_text := v_elem;
              EXIT;
            END IF;
          END LOOP;
        END;
      END IF;

    ELSIF v_rule.signal_type = 'engagement_metric' THEN
      DECLARE
        v_metric_val INTEGER := 0;
        v_exp_val INTEGER := (v_rule.expected_value #>> '{}')::integer;
      BEGIN
        IF v_rule.field_key = 'active_interests_count' THEN
          v_metric_val := v_active_interests_count;
        ELSIF v_rule.field_key = 'open_objections_count' THEN
          v_metric_val := v_open_objections_count;
        END IF;

        v_val_text := v_metric_val::text;

        IF v_rule.operator = 'gt' THEN v_matched := (v_metric_val > v_exp_val);
        ELSIF v_rule.operator = 'gte' THEN v_matched := (v_metric_val >= v_exp_val);
        ELSIF v_rule.operator = 'lt' THEN v_matched := (v_metric_val < v_exp_val);
        ELSIF v_rule.operator = 'lte' THEN v_matched := (v_metric_val <= v_exp_val);
        ELSIF v_rule.operator = 'equals' THEN v_matched := (v_metric_val = v_exp_val);
        END IF;
      END;
    END IF;

    -- Apply Points if matched
    IF v_matched THEN
      v_raw_score := v_raw_score + v_rule.points;
      v_matched_rule_keys := pg_catalog.array_append(v_matched_rule_keys, v_rule.rule_key);
      v_contributions := v_contributions || pg_catalog.jsonb_build_object(
        'rule_key', v_rule.rule_key,
        'label', v_rule.label,
        'signal_type', v_rule.signal_type,
        'field_key', v_rule.field_key,
        'matched_value', v_val_text,
        'points', v_rule.points
      );
    END IF;
  END LOOP;

  -- 7. Apply Clamping Constraints
  v_final_score := GREATEST(v_cfg.min_score, LEAST(v_cfg.max_score, v_raw_score));

  v_breakdown := pg_catalog.jsonb_build_object(
    'base_score', v_cfg.base_score,
    'raw_score', v_raw_score,
    'final_score', v_final_score,
    'min_score', v_cfg.min_score,
    'max_score', v_cfg.max_score,
    'contributions', v_contributions
  );

  -- 8. Atomic Persistence: History Ledger Insert & Current Score Upsert
  INSERT INTO public.contact_lead_score_history (
    account_id,
    contact_id,
    score,
    raw_score,
    scoring_revision_id,
    scoring_revision_number,
    input_schema_version,
    input_snapshot,
    input_fingerprint,
    breakdown,
    trigger_source,
    calculated_at
  ) VALUES (
    p_account_id,
    p_contact_id,
    v_final_score,
    v_raw_score,
    v_rev.id,
    v_rev.revision_number,
    1,
    v_input_snapshot,
    v_input_fingerprint,
    v_breakdown,
    p_trigger_source,
    v_now
  )
  ON CONFLICT (account_id, contact_id, scoring_revision_id, input_fingerprint)
  DO NOTHING;

  INSERT INTO public.contact_lead_scores (
    account_id,
    contact_id,
    score,
    scoring_revision_id,
    scoring_revision_number,
    input_fingerprint,
    breakdown,
    calculated_at,
    updated_at
  ) VALUES (
    p_account_id,
    p_contact_id,
    v_final_score,
    v_rev.id,
    v_rev.revision_number,
    v_input_fingerprint,
    v_breakdown,
    v_now,
    v_now
  )
  ON CONFLICT (account_id, contact_id)
  DO UPDATE SET
    score = EXCLUDED.score,
    scoring_revision_id = EXCLUDED.scoring_revision_id,
    scoring_revision_number = EXCLUDED.scoring_revision_number,
    input_fingerprint = EXCLUDED.input_fingerprint,
    breakdown = EXCLUDED.breakdown,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = v_now;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'contact_id', p_contact_id,
    'score', v_final_score,
    'raw_score', v_raw_score,
    'scoring_revision_number', v_rev.revision_number,
    'input_fingerprint', v_input_fingerprint,
    'breakdown', v_breakdown
  );
END;
$$;


-- 10. ATOMIC PROJECTION DURABILITY INTEGRATION (05B Projector -> Rescore)
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
  v_score_res JSONB;
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

  -- 9. ATOMIC DURABLE RESCORE: Trigger lead score calculation in same transaction!
  v_score_res := public.calculate_and_persist_contact_score(p_account_id, p_contact_id, 'commercial_state_projected');

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'projection_run_id', v_projection_run_id,
    'input_fingerprint', v_fingerprint,
    'source_insights_count', v_source_insights_count,
    'mutations_count', v_mutations_count,
    'score', v_score_res
  );
END;
$$;
