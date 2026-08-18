-- ============================================================
-- Migration 043: Canonical Products & Services Catalog Foundation
--
-- Introduces a multi-tenant catalog foundation with:
-- 1. catalog_categories (categories per account)
-- 2. catalog_items (products & services per account)
-- 3. catalog_item_terms (canonical & alias terms for AI resolution)
--
-- Enforces cross-tenant referential integrity, SKU uniqueness per
-- account, and single canonical term per item.
-- ============================================================

-- 1. CATALOG_CATEGORIES
CREATE TABLE IF NOT EXISTS catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_catalog_categories_account_id_id UNIQUE (account_id, id),
  CONSTRAINT uq_catalog_categories_account_name UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_catalog_categories_account_id
  ON catalog_categories(account_id);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_sort_order
  ON catalog_categories(account_id, sort_order);

DROP TRIGGER IF EXISTS catalog_categories_updated_at ON catalog_categories;
CREATE TRIGGER catalog_categories_updated_at
  BEFORE UPDATE ON catalog_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_categories_select ON catalog_categories;
CREATE POLICY catalog_categories_select ON catalog_categories
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS catalog_categories_insert ON catalog_categories;
CREATE POLICY catalog_categories_insert ON catalog_categories
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_categories_update ON catalog_categories;
CREATE POLICY catalog_categories_update ON catalog_categories
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_categories_delete ON catalog_categories;
CREATE POLICY catalog_categories_delete ON catalog_categories
  FOR DELETE USING (is_account_member(account_id, 'agent'));


-- 2. CATALOG_ITEMS
CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id UUID,
  type TEXT NOT NULL CHECK (type IN ('product', 'service')),
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_catalog_items_account_id_id UNIQUE (account_id, id),
  CONSTRAINT fk_catalog_items_category_same_account
    FOREIGN KEY (account_id, category_id)
    REFERENCES catalog_categories(account_id, id)
    ON DELETE SET NULL (category_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_account_id
  ON catalog_items(account_id);
CREATE INDEX IF NOT EXISTS idx_catalog_items_category_id
  ON catalog_items(category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_items_status
  ON catalog_items(account_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_items_type
  ON catalog_items(account_id, type);
CREATE INDEX IF NOT EXISTS idx_catalog_items_sort_order
  ON catalog_items(account_id, sort_order);

-- Scoped uniqueness for non-null SKUs per account
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_items_account_sku
  ON catalog_items (account_id, lower(trim(sku)))
  WHERE sku IS NOT NULL AND trim(sku) <> '';

DROP TRIGGER IF EXISTS catalog_items_updated_at ON catalog_items;
CREATE TRIGGER catalog_items_updated_at
  BEFORE UPDATE ON catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_items_select ON catalog_items;
CREATE POLICY catalog_items_select ON catalog_items
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS catalog_items_insert ON catalog_items;
CREATE POLICY catalog_items_insert ON catalog_items
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_items_update ON catalog_items;
CREATE POLICY catalog_items_update ON catalog_items
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_items_delete ON catalog_items;
CREATE POLICY catalog_items_delete ON catalog_items
  FOR DELETE USING (is_account_member(account_id, 'agent'));


-- 3. CATALOG_ITEM_TERMS (Canonical & Alias resolution)
CREATE TABLE IF NOT EXISTS catalog_item_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL,
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('canonical', 'alias')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_catalog_item_terms_item_same_account
    FOREIGN KEY (account_id, catalog_item_id)
    REFERENCES catalog_items(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT uq_catalog_item_terms_account_normalized_term
    UNIQUE (account_id, normalized_term)
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_terms_account_id
  ON catalog_item_terms(account_id);
CREATE INDEX IF NOT EXISTS idx_catalog_item_terms_item_id
  ON catalog_item_terms(catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_catalog_item_terms_lookup
  ON catalog_item_terms(account_id, normalized_term);

-- Ensure an item can only have at most one canonical term
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_item_canonical_term
  ON catalog_item_terms(catalog_item_id)
  WHERE kind = 'canonical';

DROP TRIGGER IF EXISTS catalog_item_terms_updated_at ON catalog_item_terms;
CREATE TRIGGER catalog_item_terms_updated_at
  BEFORE UPDATE ON catalog_item_terms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE catalog_item_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_item_terms_select ON catalog_item_terms;
CREATE POLICY catalog_item_terms_select ON catalog_item_terms
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS catalog_item_terms_insert ON catalog_item_terms;
CREATE POLICY catalog_item_terms_insert ON catalog_item_terms
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_item_terms_update ON catalog_item_terms;
CREATE POLICY catalog_item_terms_update ON catalog_item_terms
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_item_terms_delete ON catalog_item_terms;
CREATE POLICY catalog_item_terms_delete ON catalog_item_terms
  FOR DELETE USING (is_account_member(account_id, 'agent'));


-- 4. GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_categories, catalog_items, catalog_item_terms TO authenticated, service_role;
