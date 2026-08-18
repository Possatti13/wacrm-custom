-- ============================================================
-- Migration 046: Lead Profiles & Commercial Context Layer (Phase 3B)
--
-- 1. Adds composite unique constraint (account_id, id) to contacts
--    to enable strict multi-tenant composite foreign keys.
-- 2. Creates contact_lead_profiles with field-level provenance,
--    invariants and strict multi-tenant isolation.
-- 3. Creates contact_catalog_interests linking contacts to canonical
--    catalog items with ON DELETE RESTRICT to protect commercial history.
-- 4. Creates contact_objections with normalized uniqueness per contact
--    and resolution status coherence invariants.
-- 5. Enables RLS on all new tables with standard account-sharing policies.
-- ============================================================

-- 1. Pre-requisite on contacts: composite unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_contacts_account_id_id'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT uq_contacts_account_id_id UNIQUE (account_id, id);
  END IF;
END $$;


-- 2. CONTACT_LEAD_PROFILES
CREATE TABLE IF NOT EXISTS public.contact_lead_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,

  -- Commercial context
  summary TEXT,
  summary_source TEXT CHECK (summary_source IS NULL OR summary_source IN ('manual', 'import', 'intelligence', 'system')),

  current_intent TEXT,
  current_intent_source TEXT CHECK (current_intent_source IS NULL OR current_intent_source IN ('manual', 'import', 'intelligence', 'system')),

  urgency TEXT CHECK (urgency IS NULL OR urgency IN ('low', 'medium', 'high')),
  urgency_source TEXT CHECK (urgency_source IS NULL OR urgency_source IN ('manual', 'import', 'intelligence', 'system')),

  sentiment TEXT CHECK (sentiment IS NULL OR sentiment IN ('negative', 'neutral', 'positive', 'mixed')),
  sentiment_source TEXT CHECK (sentiment_source IS NULL OR sentiment_source IN ('manual', 'import', 'intelligence', 'system')),

  -- Commercial next action
  next_action TEXT,
  next_action_due_at TIMESTAMPTZ,
  next_action_source TEXT CHECK (next_action_source IS NULL OR next_action_source IN ('manual', 'import', 'intelligence', 'system')),

  -- Context attributes escape hatch
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Overall profile mutation provenance
  last_update_source TEXT NOT NULL DEFAULT 'manual' CHECK (last_update_source IN ('manual', 'import', 'intelligence', 'system')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_lead_profiles_account_contact
    UNIQUE (account_id, contact_id),
  CONSTRAINT fk_contact_lead_profiles_contact_same_account
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chk_contact_lead_profiles_next_action_coherence
    CHECK ((next_action_due_at IS NULL) OR (next_action IS NOT NULL AND length(trim(next_action)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_contact_lead_profiles_account_id
  ON public.contact_lead_profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_contact_lead_profiles_contact_id
  ON public.contact_lead_profiles(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_lead_profiles_urgency
  ON public.contact_lead_profiles(account_id, urgency)
  WHERE urgency IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_lead_profiles_intent
  ON public.contact_lead_profiles(account_id, current_intent)
  WHERE current_intent IS NOT NULL;

DROP TRIGGER IF EXISTS contact_lead_profiles_updated_at ON public.contact_lead_profiles;
CREATE TRIGGER contact_lead_profiles_updated_at
  BEFORE UPDATE ON public.contact_lead_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.contact_lead_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_lead_profiles_select ON public.contact_lead_profiles;
CREATE POLICY contact_lead_profiles_select ON public.contact_lead_profiles
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS contact_lead_profiles_insert ON public.contact_lead_profiles;
CREATE POLICY contact_lead_profiles_insert ON public.contact_lead_profiles
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_lead_profiles_update ON public.contact_lead_profiles;
CREATE POLICY contact_lead_profiles_update ON public.contact_lead_profiles
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_lead_profiles_delete ON public.contact_lead_profiles;
CREATE POLICY contact_lead_profiles_delete ON public.contact_lead_profiles
  FOR DELETE USING (is_account_member(account_id, 'agent'));


-- 3. CONTACT_CATALOG_INTERESTS
CREATE TABLE IF NOT EXISTS public.contact_catalog_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'dismissed')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'intelligence', 'system')),

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_catalog_interests_account_contact_item
    UNIQUE (account_id, contact_id, catalog_item_id),
  CONSTRAINT fk_contact_catalog_interests_contact_same_account
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_catalog_interests_item_same_account
    FOREIGN KEY (account_id, catalog_item_id)
    REFERENCES public.catalog_items(account_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_contact_catalog_interests_dates
    CHECK (last_seen_at >= first_seen_at)
);

CREATE INDEX IF NOT EXISTS idx_contact_catalog_interests_lookup
  ON public.contact_catalog_interests(account_id, contact_id, status);
CREATE INDEX IF NOT EXISTS idx_contact_catalog_interests_item
  ON public.contact_catalog_interests(account_id, catalog_item_id);

DROP TRIGGER IF EXISTS contact_catalog_interests_updated_at ON public.contact_catalog_interests;
CREATE TRIGGER contact_catalog_interests_updated_at
  BEFORE UPDATE ON public.contact_catalog_interests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.contact_catalog_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_catalog_interests_select ON public.contact_catalog_interests;
CREATE POLICY contact_catalog_interests_select ON public.contact_catalog_interests
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS contact_catalog_interests_insert ON public.contact_catalog_interests;
CREATE POLICY contact_catalog_interests_insert ON public.contact_catalog_interests
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_catalog_interests_update ON public.contact_catalog_interests;
CREATE POLICY contact_catalog_interests_update ON public.contact_catalog_interests
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_catalog_interests_delete ON public.contact_catalog_interests;
CREATE POLICY contact_catalog_interests_delete ON public.contact_catalog_interests
  FOR DELETE USING (is_account_member(account_id, 'agent'));


-- 4. CONTACT_OBJECTIONS
CREATE TABLE IF NOT EXISTS public.contact_objections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,

  objection TEXT NOT NULL,
  normalized_objection TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'intelligence', 'system')),

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_objections_account_contact_norm
    UNIQUE (account_id, contact_id, normalized_objection),
  CONSTRAINT fk_contact_objections_contact_same_account
    FOREIGN KEY (account_id, contact_id)
    REFERENCES public.contacts(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chk_contact_objections_dates
    CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT chk_contact_objections_resolved_coherence
    CHECK ((status = 'resolved' AND resolved_at IS NOT NULL) OR (status <> 'resolved' AND resolved_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_contact_objections_lookup
  ON public.contact_objections(account_id, contact_id, status);

DROP TRIGGER IF EXISTS contact_objections_updated_at ON public.contact_objections;
CREATE TRIGGER contact_objections_updated_at
  BEFORE UPDATE ON public.contact_objections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.contact_objections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_objections_select ON public.contact_objections;
CREATE POLICY contact_objections_select ON public.contact_objections
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS contact_objections_insert ON public.contact_objections;
CREATE POLICY contact_objections_insert ON public.contact_objections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_objections_update ON public.contact_objections;
CREATE POLICY contact_objections_update ON public.contact_objections
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_objections_delete ON public.contact_objections;
CREATE POLICY contact_objections_delete ON public.contact_objections
  FOR DELETE USING (is_account_member(account_id, 'agent'));
