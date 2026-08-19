-- ============================================================
-- Migration 048: Tenant Commercial Configuration Layer (Phase 4)
--
-- 1. commercial_intents (stable business intent vocabulary).
-- 2. commercial_attribute_definitions (lead profile attributes schema).
-- 3. tenant_commercial_context (company description, objectives, qualification).
-- 4. tenant_commercial_terminology (custom labels for UI / semantics).
-- 5. tenant_config_revisions (immutable canonical snapshots & monotonic revisions).
-- 6. Immutability triggers on keys, types, and revision ledger.
-- 7. Controlled RPCs for atomic mutations, tenant locking, snapshot generation, and revision bump.
-- ============================================================

-- 1. COMMERCIAL_INTENTS
CREATE TABLE IF NOT EXISTS public.commercial_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_commercial_intents_account_id_id UNIQUE (account_id, id),
  CONSTRAINT uq_commercial_intents_account_key UNIQUE (account_id, key),
  CONSTRAINT chk_commercial_intents_key_format CHECK (key ~ '^[a-z0-9_]{2,64}$')
);

CREATE INDEX IF NOT EXISTS idx_commercial_intents_lookup
  ON public.commercial_intents(account_id, status, sort_order);

ALTER TABLE public.commercial_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_intents_select ON public.commercial_intents;
CREATE POLICY commercial_intents_select ON public.commercial_intents
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- Direct client INSERT/UPDATE/DELETE is denied to authenticated (all mutations through controlled RPCs)


-- 2. COMMERCIAL_ATTRIBUTE_DEFINITIONS
CREATE TABLE IF NOT EXISTS public.commercial_attribute_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL CHECK (value_type IN ('text', 'number', 'boolean', 'date', 'single_select', 'multi_select')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_commercial_attribute_defs_account_id_id UNIQUE (account_id, id),
  CONSTRAINT uq_commercial_attribute_defs_account_key UNIQUE (account_id, key),
  CONSTRAINT chk_commercial_attribute_defs_key_format CHECK (key ~ '^[a-z0-9_]{2,64}$')
);

CREATE INDEX IF NOT EXISTS idx_commercial_attribute_defs_lookup
  ON public.commercial_attribute_definitions(account_id, status, sort_order);

ALTER TABLE public.commercial_attribute_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_attribute_defs_select ON public.commercial_attribute_definitions;
CREATE POLICY commercial_attribute_defs_select ON public.commercial_attribute_definitions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 3. TENANT_COMMERCIAL_CONTEXT
CREATE TABLE IF NOT EXISTS public.tenant_commercial_context (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  company_description TEXT,
  commercial_objectives TEXT,
  qualification_guidelines TEXT,
  prohibited_assumptions TEXT,
  terminology_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_commercial_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_commercial_context_select ON public.tenant_commercial_context;
CREATE POLICY tenant_commercial_context_select ON public.tenant_commercial_context
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 4. TENANT_COMMERCIAL_TERMINOLOGY
CREATE TABLE IF NOT EXISTS public.tenant_commercial_terminology (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_label_singular TEXT NOT NULL DEFAULT 'Contato',
  contact_label_plural TEXT NOT NULL DEFAULT 'Contatos',
  catalog_item_label_singular TEXT NOT NULL DEFAULT 'Produto / Serviço',
  catalog_item_label_plural TEXT NOT NULL DEFAULT 'Produtos e Serviços',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_commercial_terminology ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_commercial_terminology_select ON public.tenant_commercial_terminology;
CREATE POLICY tenant_commercial_terminology_select ON public.tenant_commercial_terminology
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 5. TENANT_CONFIG_REVISIONS (Immutable Ledger of Snapshots)
CREATE TABLE IF NOT EXISTS public.tenant_config_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
  snapshot JSONB NOT NULL,
  snapshot_hash TEXT NOT NULL,
  change_summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tenant_config_revisions_account_revision UNIQUE (account_id, revision_number),
  CONSTRAINT uq_tenant_config_revisions_account_id_id UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_config_revisions_lookup
  ON public.tenant_config_revisions(account_id, revision_number DESC);

ALTER TABLE public.tenant_config_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_config_revisions_select ON public.tenant_config_revisions;
CREATE POLICY tenant_config_revisions_select ON public.tenant_config_revisions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));


-- 6. IMMUTABILITY TRIGGERS
CREATE OR REPLACE FUNCTION public.trg_protect_commercial_config_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'commercial_intents' THEN
    IF NEW.key <> OLD.key THEN
      RAISE EXCEPTION 'Key on commercial_intents is immutable after creation'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'commercial_attribute_definitions' THEN
    IF NEW.key <> OLD.key THEN
      RAISE EXCEPTION 'Key on commercial_attribute_definitions is immutable after creation'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.value_type <> OLD.value_type THEN
      RAISE EXCEPTION 'value_type on commercial_attribute_definitions is immutable after creation. Archive and create a new attribute instead.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'tenant_config_revisions' THEN
    RAISE EXCEPTION 'tenant_config_revisions is an append-only immutable ledger. Updates and deletes are forbidden.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commercial_intents_immutability ON public.commercial_intents;
CREATE TRIGGER trg_commercial_intents_immutability
  BEFORE UPDATE ON public.commercial_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_commercial_config_immutability();

DROP TRIGGER IF EXISTS trg_commercial_attribute_defs_immutability ON public.commercial_attribute_definitions;
CREATE TRIGGER trg_commercial_attribute_defs_immutability
  BEFORE UPDATE ON public.commercial_attribute_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_commercial_config_immutability();

DROP TRIGGER IF EXISTS trg_tenant_config_revisions_no_update ON public.tenant_config_revisions;
CREATE TRIGGER trg_tenant_config_revisions_no_update
  BEFORE UPDATE OR DELETE ON public.tenant_config_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_commercial_config_immutability();


-- 7. INTERNAL HELPER TO GENERATE SNAPSHOT AND BUMP REVISION
CREATE OR REPLACE FUNCTION public.generate_tenant_config_snapshot_internal(
  p_account_id UUID,
  p_change_summary TEXT,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intents JSONB;
  v_attributes JSONB;
  v_context RECORD;
  v_terminology RECORD;
  v_snapshot JSONB;
  v_hash TEXT;
  v_next_rev INTEGER;
  v_rev_id UUID;
BEGIN
  -- 1. Lock tenant revision sequence
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tenant_config_revision:' || p_account_id::text));

  -- 2. Build sorted intents array (all statuses)
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'key', i.key,
        'label', i.label,
        'description', i.description,
        'status', i.status,
        'sort_order', i.sort_order,
        'metadata', i.metadata
      ) ORDER BY i.sort_order ASC, i.key ASC
    ),
    '[]'::jsonb
  ) INTO v_intents
  FROM public.commercial_intents i
  WHERE i.account_id = p_account_id;

  -- 3. Build sorted attributes array (all statuses)
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', a.id,
        'key', a.key,
        'label', a.label,
        'description', a.description,
        'value_type', a.value_type,
        'options', a.options,
        'status', a.status,
        'sort_order', a.sort_order,
        'metadata', a.metadata
      ) ORDER BY a.sort_order ASC, a.key ASC
    ),
    '[]'::jsonb
  ) INTO v_attributes
  FROM public.commercial_attribute_definitions a
  WHERE a.account_id = p_account_id;

  -- 4. Get business context
  SELECT * INTO v_context
  FROM public.tenant_commercial_context
  WHERE account_id = p_account_id;

  -- 5. Get terminology
  SELECT * INTO v_terminology
  FROM public.tenant_commercial_terminology
  WHERE account_id = p_account_id;

  -- 6. Build canonical snapshot
  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'intents', v_intents,
    'attributes', v_attributes,
    'context', pg_catalog.jsonb_build_object(
      'company_description', v_context.company_description,
      'commercial_objectives', v_context.commercial_objectives,
      'qualification_guidelines', v_context.qualification_guidelines,
      'prohibited_assumptions', v_context.prohibited_assumptions,
      'terminology_notes', v_context.terminology_notes,
      'metadata', COALESCE(v_context.metadata, '{}'::jsonb)
    ),
    'terminology', pg_catalog.jsonb_build_object(
      'contact_label_singular', COALESCE(v_terminology.contact_label_singular, 'Contato'),
      'contact_label_plural', COALESCE(v_terminology.contact_label_plural, 'Contatos'),
      'catalog_item_label_singular', COALESCE(v_terminology.catalog_item_label_singular, 'Produto / Serviço'),
      'catalog_item_label_plural', COALESCE(v_terminology.catalog_item_label_plural, 'Produtos e Serviços'),
      'metadata', COALESCE(v_terminology.metadata, '{}'::jsonb)
    )
  );

  -- 7. Deterministic SHA-256 hash using encode(sha256(...), 'hex')
  v_hash := pg_catalog.encode(pg_catalog.sha256(v_snapshot::text::bytea), 'hex');

  -- 8. Compute monotonic revision number
  SELECT COALESCE(pg_catalog.max(revision_number), 0) + 1 INTO v_next_rev
  FROM public.tenant_config_revisions
  WHERE account_id = p_account_id;

  -- 9. Insert revision
  INSERT INTO public.tenant_config_revisions (
    account_id,
    revision_number,
    snapshot_schema_version,
    snapshot,
    snapshot_hash,
    change_summary,
    created_by
  ) VALUES (
    p_account_id,
    v_next_rev,
    1,
    v_snapshot,
    v_hash,
    p_change_summary,
    p_user_id
  ) RETURNING id INTO v_rev_id;

  RETURN pg_catalog.jsonb_build_object(
    'revision_id', v_rev_id,
    'revision_number', v_next_rev,
    'snapshot_hash', v_hash,
    'snapshot', v_snapshot
  );
END;
$$;


-- 8. CONTROLLED RPCs (ATOMIC CONFIG MUTATION + REVISION BUMP)

-- 8A. SAVE COMMERCIAL INTENT
CREATE OR REPLACE FUNCTION public.save_commercial_intent(
  p_account_id UUID,
  p_id UUID,
  p_key TEXT,
  p_label TEXT,
  p_description TEXT,
  p_status TEXT,
  p_sort_order INTEGER,
  p_metadata JSONB,
  p_change_summary TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_intent_id UUID;
  v_rev_result JSONB;
  v_status TEXT := COALESCE(p_status, 'active');
  v_clean_key TEXT := pg_catalog.lower(pg_catalog.btrim(p_key));
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins can manage commercial configuration'
        USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Validation
  IF v_clean_key IS NULL OR v_clean_key !~ '^[a-z0-9_]{2,64}$' THEN
    RAISE EXCEPTION 'Invalid intent key: must be 2-64 lowercase alphanumeric and underscore characters'
      USING ERRCODE = '22000';
  END IF;

  IF p_label IS NULL OR pg_catalog.length(pg_catalog.btrim(p_label)) = 0 THEN
    RAISE EXCEPTION 'Intent label is required'
      USING ERRCODE = '22000';
  END IF;

  IF v_status NOT IN ('active', 'inactive', 'archived') THEN
    RAISE EXCEPTION 'Invalid intent status: must be active, inactive, or archived'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Lock tenant
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tenant_config_revision:' || p_account_id::text));

  -- 4. Insert or Update intent
  IF p_id IS NOT NULL THEN
    UPDATE public.commercial_intents
    SET label = pg_catalog.btrim(p_label),
        description = p_description,
        status = v_status,
        sort_order = COALESCE(p_sort_order, 0),
        metadata = COALESCE(p_metadata, '{}'::jsonb),
        updated_at = pg_catalog.now()
    WHERE account_id = p_account_id AND id = p_id
    RETURNING id INTO v_intent_id;

    IF v_intent_id IS NULL THEN
      RAISE EXCEPTION 'Intent not found in account'
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO public.commercial_intents (
      account_id,
      key,
      label,
      description,
      status,
      sort_order,
      metadata
    ) VALUES (
      p_account_id,
      v_clean_key,
      pg_catalog.btrim(p_label),
      p_description,
      v_status,
      COALESCE(p_sort_order, 0),
      COALESCE(p_metadata, '{}'::jsonb)
    ) RETURNING id INTO v_intent_id;
  END IF;

  -- 5. Generate snapshot and bump revision
  v_rev_result := public.generate_tenant_config_snapshot_internal(
    p_account_id,
    COALESCE(p_change_summary, 'Updated intent ' || v_clean_key),
    v_user_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'intent_id', v_intent_id,
    'key', v_clean_key,
    'status', v_status,
    'revision', v_rev_result
  );
END;
$$;


-- 8B. SAVE COMMERCIAL ATTRIBUTE DEFINITION
CREATE OR REPLACE FUNCTION public.save_commercial_attribute_definition(
  p_account_id UUID,
  p_id UUID,
  p_key TEXT,
  p_label TEXT,
  p_description TEXT,
  p_value_type TEXT,
  p_options JSONB,
  p_status TEXT,
  p_sort_order INTEGER,
  p_metadata JSONB,
  p_change_summary TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_attr_id UUID;
  v_rev_result JSONB;
  v_status TEXT := COALESCE(p_status, 'active');
  v_clean_key TEXT := pg_catalog.lower(pg_catalog.btrim(p_key));
  v_options JSONB := COALESCE(p_options, '[]'::jsonb);
  v_opt RECORD;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins can manage commercial configuration'
        USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Validation
  IF v_clean_key IS NULL OR v_clean_key !~ '^[a-z0-9_]{2,64}$' THEN
    RAISE EXCEPTION 'Invalid attribute key: must be 2-64 lowercase alphanumeric and underscore characters'
      USING ERRCODE = '22000';
  END IF;

  IF p_label IS NULL OR pg_catalog.length(pg_catalog.btrim(p_label)) = 0 THEN
    RAISE EXCEPTION 'Attribute label is required'
      USING ERRCODE = '22000';
  END IF;

  IF p_value_type NOT IN ('text', 'number', 'boolean', 'date', 'single_select', 'multi_select') THEN
    RAISE EXCEPTION 'Invalid attribute value_type'
      USING ERRCODE = '22000';
  END IF;

  IF v_status NOT IN ('active', 'inactive', 'archived') THEN
    RAISE EXCEPTION 'Invalid attribute status'
      USING ERRCODE = '22000';
  END IF;

  -- Validate options structure for select types
  IF p_value_type IN ('single_select', 'multi_select') THEN
    IF pg_catalog.jsonb_array_length(v_options) = 0 THEN
      RAISE EXCEPTION 'Select attribute must have at least one option'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 3. Lock tenant
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tenant_config_revision:' || p_account_id::text));

  -- 4. Insert or Update attribute
  IF p_id IS NOT NULL THEN
    UPDATE public.commercial_attribute_definitions
    SET label = pg_catalog.btrim(p_label),
        description = p_description,
        options = v_options,
        status = v_status,
        sort_order = COALESCE(p_sort_order, 0),
        metadata = COALESCE(p_metadata, '{}'::jsonb),
        updated_at = pg_catalog.now()
    WHERE account_id = p_account_id AND id = p_id
    RETURNING id INTO v_attr_id;

    IF v_attr_id IS NULL THEN
      RAISE EXCEPTION 'Attribute definition not found in account'
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO public.commercial_attribute_definitions (
      account_id,
      key,
      label,
      description,
      value_type,
      options,
      status,
      sort_order,
      metadata
    ) VALUES (
      p_account_id,
      v_clean_key,
      pg_catalog.btrim(p_label),
      p_description,
      p_value_type,
      v_options,
      v_status,
      COALESCE(p_sort_order, 0),
      COALESCE(p_metadata, '{}'::jsonb)
    ) RETURNING id INTO v_attr_id;
  END IF;

  -- 5. Generate snapshot and bump revision
  v_rev_result := public.generate_tenant_config_snapshot_internal(
    p_account_id,
    COALESCE(p_change_summary, 'Updated attribute ' || v_clean_key),
    v_user_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'attribute_id', v_attr_id,
    'key', v_clean_key,
    'status', v_status,
    'revision', v_rev_result
  );
END;
$$;


-- 8C. SAVE TENANT COMMERCIAL CONTEXT
CREATE OR REPLACE FUNCTION public.save_tenant_commercial_context(
  p_account_id UUID,
  p_company_description TEXT,
  p_commercial_objectives TEXT,
  p_qualification_guidelines TEXT,
  p_prohibited_assumptions TEXT,
  p_terminology_notes TEXT,
  p_metadata JSONB,
  p_change_summary TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_rev_result JSONB;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins can manage commercial configuration'
        USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock tenant
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tenant_config_revision:' || p_account_id::text));

  -- 3. Upsert context
  INSERT INTO public.tenant_commercial_context (
    account_id,
    company_description,
    commercial_objectives,
    qualification_guidelines,
    prohibited_assumptions,
    terminology_notes,
    metadata,
    updated_at
  ) VALUES (
    p_account_id,
    p_company_description,
    p_commercial_objectives,
    p_qualification_guidelines,
    p_prohibited_assumptions,
    p_terminology_notes,
    COALESCE(p_metadata, '{}'::jsonb),
    pg_catalog.now()
  )
  ON CONFLICT (account_id) DO UPDATE
  SET company_description = EXCLUDED.company_description,
      commercial_objectives = EXCLUDED.commercial_objectives,
      qualification_guidelines = EXCLUDED.qualification_guidelines,
      prohibited_assumptions = EXCLUDED.prohibited_assumptions,
      terminology_notes = EXCLUDED.terminology_notes,
      metadata = EXCLUDED.metadata,
      updated_at = pg_catalog.now();

  -- 4. Generate snapshot and bump revision
  v_rev_result := public.generate_tenant_config_snapshot_internal(
    p_account_id,
    COALESCE(p_change_summary, 'Updated business context'),
    v_user_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'account_id', p_account_id,
    'status', 'saved',
    'revision', v_rev_result
  );
END;
$$;


-- 8D. SAVE TENANT COMMERCIAL TERMINOLOGY
CREATE OR REPLACE FUNCTION public.save_tenant_commercial_terminology(
  p_account_id UUID,
  p_contact_label_singular TEXT,
  p_contact_label_plural TEXT,
  p_catalog_item_label_singular TEXT,
  p_catalog_item_label_plural TEXT,
  p_metadata JSONB,
  p_change_summary TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_rev_result JSONB;
BEGIN
  -- 1. Authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_account_member(p_account_id, 'admin'::public.account_role_enum) THEN
      RAISE EXCEPTION 'Forbidden: only admins can manage commercial configuration'
        USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  ELSE
    IF current_user NOT IN ('service_role', 'postgres')
       AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lock tenant
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tenant_config_revision:' || p_account_id::text));

  -- 3. Upsert terminology
  INSERT INTO public.tenant_commercial_terminology (
    account_id,
    contact_label_singular,
    contact_label_plural,
    catalog_item_label_singular,
    catalog_item_label_plural,
    metadata,
    updated_at
  ) VALUES (
    p_account_id,
    COALESCE(pg_catalog.btrim(p_contact_label_singular), 'Contato'),
    COALESCE(pg_catalog.btrim(p_contact_label_plural), 'Contatos'),
    COALESCE(pg_catalog.btrim(p_catalog_item_label_singular), 'Produto / Serviço'),
    COALESCE(pg_catalog.btrim(p_catalog_item_label_plural), 'Produtos e Serviços'),
    COALESCE(p_metadata, '{}'::jsonb),
    pg_catalog.now()
  )
  ON CONFLICT (account_id) DO UPDATE
  SET contact_label_singular = EXCLUDED.contact_label_singular,
      contact_label_plural = EXCLUDED.contact_label_plural,
      catalog_item_label_singular = EXCLUDED.catalog_item_label_singular,
      catalog_item_label_plural = EXCLUDED.catalog_item_label_plural,
      metadata = EXCLUDED.metadata,
      updated_at = pg_catalog.now();

  -- 4. Generate snapshot and bump revision
  v_rev_result := public.generate_tenant_config_snapshot_internal(
    p_account_id,
    COALESCE(p_change_summary, 'Updated terminology labels'),
    v_user_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'account_id', p_account_id,
    'status', 'saved',
    'revision', v_rev_result
  );
END;
$$;
