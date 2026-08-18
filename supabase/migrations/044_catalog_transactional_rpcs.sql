-- ============================================================
-- Migration 044: Harden Catalog Transactional Integrity & Category Uniqueness
--
-- 1. Endurece a unicidade de nome de categorias para desconsiderar
--    case e espaços redundantes ("Motos", " motos ", "MOTOS").
-- 2. Cria RPCs transacionais atômicas para:
--    - create_catalog_item_with_terms (item + canonical term + aliases)
--    - update_catalog_item_with_canonical (item + canonical term)
--    Garantindo que operações ocorram tudo-ou-nada dentro do PostgreSQL.
-- ============================================================

-- 1. Endurecer Unicidade de Categorias
DROP INDEX IF EXISTS idx_catalog_categories_account_normalized_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_categories_account_normalized_name
  ON catalog_categories (account_id, lower(trim(regexp_replace(name, '\s+', ' ', 'g'))));


-- 2. RPC Transacional: create_catalog_item_with_terms
CREATE OR REPLACE FUNCTION public.create_catalog_item_with_terms(
  p_account_id UUID,
  p_category_id UUID,
  p_type TEXT,
  p_name TEXT,
  p_normalized_name TEXT,
  p_description TEXT,
  p_sku TEXT,
  p_status TEXT,
  p_sort_order INTEGER,
  p_metadata JSONB,
  p_aliases JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item_id UUID;
  v_item_record RECORD;
  v_alias_entry JSONB;
  v_alias_text TEXT;
  v_alias_norm TEXT;
  v_terms JSONB := '[]'::jsonb;
  v_term_record RECORD;
BEGIN
  -- 1. Se category_id foi fornecido, validar que pertence à mesma conta
  IF p_category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.catalog_categories
      WHERE id = p_category_id AND account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Category % not found in this account', p_category_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 2. Inserir o item no catálogo
  INSERT INTO public.catalog_items (
    account_id,
    category_id,
    type,
    name,
    description,
    sku,
    status,
    sort_order,
    metadata
  ) VALUES (
    p_account_id,
    p_category_id,
    p_type,
    p_name,
    p_description,
    p_sku,
    COALESCE(p_status, 'active'),
    COALESCE(p_sort_order, 0),
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO v_item_record;

  v_item_id := v_item_record.id;

  -- 3. Inserir Termo Canônico atomicamente
  INSERT INTO public.catalog_item_terms (
    account_id,
    catalog_item_id,
    term,
    normalized_term,
    kind
  ) VALUES (
    p_account_id,
    v_item_id,
    p_name,
    p_normalized_name,
    'canonical'
  ) RETURNING * INTO v_term_record;

  v_terms := v_terms || to_jsonb(v_term_record);

  -- 4. Inserir aliases se fornecidos
  IF p_aliases IS NOT NULL AND jsonb_array_length(p_aliases) > 0 THEN
    FOR v_alias_entry IN SELECT * FROM jsonb_array_elements(p_aliases)
    LOOP
      v_alias_text := v_alias_entry->>'term';
      v_alias_norm := v_alias_entry->>'normalized_term';
      IF v_alias_text IS NOT NULL AND v_alias_norm IS NOT NULL AND length(trim(v_alias_norm)) > 0 THEN
        INSERT INTO public.catalog_item_terms (
          account_id,
          catalog_item_id,
          term,
          normalized_term,
          kind
        ) VALUES (
          p_account_id,
          v_item_id,
          v_alias_text,
          v_alias_norm,
          'alias'
        ) RETURNING * INTO v_term_record;

        v_terms := v_terms || to_jsonb(v_term_record);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item_record),
    'terms', v_terms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_catalog_item_with_terms FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_catalog_item_with_terms TO authenticated, service_role;


-- 3. RPC Transacional: update_catalog_item_with_canonical
CREATE OR REPLACE FUNCTION public.update_catalog_item_with_canonical(
  p_account_id UUID,
  p_item_id UUID,
  p_category_id UUID,
  p_type TEXT,
  p_name TEXT,
  p_normalized_name TEXT,
  p_description TEXT,
  p_sku TEXT,
  p_status TEXT,
  p_sort_order INTEGER,
  p_metadata JSONB,
  p_update_name BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item_record RECORD;
BEGIN
  -- 1. Se category_id foi fornecido, validar que pertence à mesma conta
  IF p_category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.catalog_categories
      WHERE id = p_category_id AND account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'Category % not found in this account', p_category_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- 2. Atualizar o item
  UPDATE public.catalog_items
  SET
    category_id = p_category_id,
    type = p_type,
    name = p_name,
    description = p_description,
    sku = p_sku,
    status = p_status,
    sort_order = p_sort_order,
    metadata = p_metadata,
    updated_at = now()
  WHERE id = p_item_id AND account_id = p_account_id
  RETURNING * INTO v_item_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalog item % not found in this account', p_item_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Se o nome mudou, atualizar o termo canônico atomicamente
  IF p_update_name AND p_normalized_name IS NOT NULL THEN
    UPDATE public.catalog_item_terms
    SET
      term = p_name,
      normalized_term = p_normalized_name,
      updated_at = now()
    WHERE catalog_item_id = p_item_id
      AND account_id = p_account_id
      AND kind = 'canonical';
  END IF;

  RETURN to_jsonb(v_item_record);
END;
$$;

REVOKE ALL ON FUNCTION public.update_catalog_item_with_canonical FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_catalog_item_with_canonical TO authenticated, service_role;
