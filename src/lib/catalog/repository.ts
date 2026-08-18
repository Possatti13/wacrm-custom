import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CatalogCategory,
  CatalogItem,
  CatalogItemTerm,
  CatalogItemWithDetails,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
  ListCatalogItemsFilter,
  ResolvedCatalogTerm,
} from './types'
import { normalizeCatalogTerm, normalizeSku } from './normalization'
import {
  validateCreateCategory,
  validateUpdateCategory,
  validateCreateCatalogItem,
  validateUpdateCatalogItem,
  validateAlias,
  CatalogValidationError,
} from './validation'

// ============================================================
// Categories
// ============================================================

export async function createCategory(
  db: SupabaseClient,
  accountId: string,
  rawInput: CreateCategoryInput
): Promise<CatalogCategory> {
  const input = validateCreateCategory(rawInput)

  const { data, error } = await db
    .from('catalog_categories')
    .insert({
      account_id: accountId,
      name: input.name,
      description: input.description || null,
      sort_order: input.sort_order ?? 0,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new CatalogValidationError(`A category with the name "${input.name}" already exists in this account`)
    }
    throw new Error(`createCategory failed: ${error.message}`)
  }

  return data as CatalogCategory
}

export async function updateCategory(
  db: SupabaseClient,
  accountId: string,
  categoryId: string,
  rawInput: UpdateCategoryInput
): Promise<CatalogCategory> {
  const input = validateUpdateCategory(rawInput)

  const { data, error } = await db
    .from('catalog_categories')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', categoryId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new CatalogValidationError(`A category with the name "${input.name}" already exists in this account`)
    }
    throw new Error(`updateCategory failed: ${error.message}`)
  }
  if (!data) {
    throw new Error(`Category not found or does not belong to this account`)
  }

  return data as CatalogCategory
}

export async function deleteCategory(
  db: SupabaseClient,
  accountId: string,
  categoryId: string
): Promise<boolean> {
  const { error } = await db
    .from('catalog_categories')
    .delete()
    .eq('id', categoryId)
    .eq('account_id', accountId)

  if (error) {
    throw new Error(`deleteCategory failed: ${error.message}`)
  }

  return true
}

export async function getCategory(
  db: SupabaseClient,
  accountId: string,
  categoryId: string
): Promise<CatalogCategory | null> {
  const { data, error } = await db
    .from('catalog_categories')
    .select('*')
    .eq('id', categoryId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new Error(`getCategory failed: ${error.message}`)
  }

  return (data as CatalogCategory) || null
}

export async function listCategories(
  db: SupabaseClient,
  accountId: string
): Promise<CatalogCategory[]> {
  const { data, error } = await db
    .from('catalog_categories')
    .select('*')
    .eq('account_id', accountId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    throw new Error(`listCategories failed: ${error.message}`)
  }

  return (data as CatalogCategory[]) || []
}

// ============================================================
// Items (Products & Services)
// ============================================================

export async function createCatalogItem(
  db: SupabaseClient,
  accountId: string,
  rawInput: CreateCatalogItemInput
): Promise<CatalogItemWithDetails> {
  const input = validateCreateCatalogItem(rawInput)
  const canonicalNorm = normalizeCatalogTerm(input.name)
  const sku = normalizeSku(input.sku)

  const aliasesPayload = (input.aliases || [])
    .map((a) => ({
      term: a.trim(),
      normalized_term: normalizeCatalogTerm(a),
    }))
    .filter((a) => a.normalized_term.length > 0)

  // 1. Transactional RPC execution (single Postgres transaction)
  if (typeof db.rpc === 'function') {
    const { data: rpcResult, error: rpcError } = await db.rpc(
      'create_catalog_item_with_terms',
      {
        p_account_id: accountId,
        p_category_id: input.category_id || null,
        p_type: input.type,
        p_name: input.name,
        p_normalized_name: canonicalNorm,
        p_description: input.description || null,
        p_sku: sku || null,
        p_status: input.status || 'active',
        p_sort_order: input.sort_order ?? 0,
        p_metadata: input.metadata || {},
        p_aliases: aliasesPayload,
      }
    )

    if (rpcError) {
      if (rpcError.code === '23505' && rpcError.message?.includes('sku')) {
        throw new CatalogValidationError(`An item with SKU "${input.sku}" already exists in this account`)
      }
      if (rpcError.code === '23505' && rpcError.message?.includes('normalized_term')) {
        throw new CatalogValidationError(`A catalog term matching "${input.name}" already exists in this account`)
      }
      if (rpcError.code === '23503' || rpcError.message?.includes('Category')) {
        throw new CatalogValidationError(`Category ${input.category_id} not found in this account`)
      }
      throw new Error(`createCatalogItem failed: ${rpcError.message}`)
    }

    const item = rpcResult.item as CatalogItem
    const terms = (rpcResult.terms as CatalogItemTerm[]) || []

    return {
      ...item,
      terms,
    }
  }

  // Fallback direct execution (for environments where RPC is mocked or not bound)
  if (input.category_id) {
    const category = await getCategory(db, accountId, input.category_id)
    if (!category) {
      throw new CatalogValidationError(`Category ${input.category_id} not found in this account`)
    }
  }

  const { data: itemData, error: itemError } = await db
    .from('catalog_items')
    .insert({
      account_id: accountId,
      category_id: input.category_id || null,
      type: input.type,
      name: input.name,
      description: input.description || null,
      sku: sku || null,
      status: input.status || 'active',
      sort_order: input.sort_order ?? 0,
      metadata: input.metadata || {},
    })
    .select('*')
    .single()

  if (itemError) {
    if (itemError.code === '23505' && itemError.message?.includes('sku')) {
      throw new CatalogValidationError(`An item with SKU "${input.sku}" already exists in this account`)
    }
    throw new Error(`createCatalogItem failed: ${itemError.message}`)
  }

  const item = itemData as CatalogItem
  const createdTerms: CatalogItemTerm[] = []

  const { data: canonicalTermData, error: canonicalTermError } = await db
    .from('catalog_item_terms')
    .insert({
      account_id: accountId,
      catalog_item_id: item.id,
      term: item.name,
      normalized_term: canonicalNorm,
      kind: 'canonical',
    })
    .select('*')
    .single()

  if (canonicalTermError) {
    await db.from('catalog_items').delete().eq('id', item.id)
    if (canonicalTermError.code === '23505') {
      throw new CatalogValidationError(
        `A catalog term matching "${item.name}" already exists in this account`
      )
    }
    throw new Error(`Failed to create canonical term: ${canonicalTermError.message}`)
  }

  createdTerms.push(canonicalTermData as CatalogItemTerm)

  return {
    ...item,
    terms: createdTerms,
  }
}

export async function updateCatalogItem(
  db: SupabaseClient,
  accountId: string,
  itemId: string,
  rawInput: UpdateCatalogItemInput
): Promise<CatalogItemWithDetails> {
  const input = validateUpdateCatalogItem(rawInput)
  const canonicalNorm = input.name !== undefined ? normalizeCatalogTerm(input.name) : null
  const sku = input.sku !== undefined ? normalizeSku(input.sku) : undefined

  // 1. Transactional RPC execution (single Postgres transaction)
  if (typeof db.rpc === 'function') {
    const { error: rpcError } = await db.rpc('update_catalog_item_with_canonical', {
      p_account_id: accountId,
      p_item_id: itemId,
      p_category_id: input.category_id ?? null,
      p_type: input.type ?? null,
      p_name: input.name ?? null,
      p_normalized_name: canonicalNorm,
      p_description: input.description ?? null,
      p_sku: sku ?? null,
      p_status: input.status ?? null,
      p_sort_order: input.sort_order ?? null,
      p_metadata: input.metadata ?? null,
      p_update_name: input.name !== undefined,
    })

    if (rpcError) {
      if (rpcError.code === '23505' && rpcError.message?.includes('sku')) {
        throw new CatalogValidationError(`An item with SKU "${input.sku}" already exists in this account`)
      }
      if (rpcError.code === '23505' && rpcError.message?.includes('normalized_term')) {
        throw new CatalogValidationError(
          `A catalog term matching "${input.name}" already exists in this account`
        )
      }
      if (rpcError.code === '23503' || rpcError.message?.includes('Category')) {
        throw new CatalogValidationError(`Category ${input.category_id} not found in this account`)
      }
      throw new Error(`updateCatalogItem failed: ${rpcError.message}`)
    }

    return getCatalogItem(db, accountId, itemId) as Promise<CatalogItemWithDetails>
  }

  // Fallback direct execution
  if (input.category_id) {
    const category = await getCategory(db, accountId, input.category_id)
    if (!category) {
      throw new CatalogValidationError(`Category ${input.category_id} not found in this account`)
    }
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (input.name !== undefined) payload.name = input.name
  if (input.type !== undefined) payload.type = input.type
  if (input.category_id !== undefined) payload.category_id = input.category_id
  if (input.description !== undefined) payload.description = input.description
  if (input.sku !== undefined) payload.sku = sku
  if (input.status !== undefined) payload.status = input.status
  if (input.sort_order !== undefined) payload.sort_order = input.sort_order
  if (input.metadata !== undefined) payload.metadata = input.metadata

  const { data: itemData, error: itemError } = await db
    .from('catalog_items')
    .update(payload)
    .eq('id', itemId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (itemError) {
    if (itemError.code === '23505' && itemError.message?.includes('sku')) {
      throw new CatalogValidationError(`An item with SKU "${input.sku}" already exists in this account`)
    }
    throw new Error(`updateCatalogItem failed: ${itemError.message}`)
  }
  if (!itemData) {
    throw new Error(`Catalog item not found or does not belong to this account`)
  }

  if (input.name !== undefined && canonicalNorm) {
    const { error: termError } = await db
      .from('catalog_item_terms')
      .update({
        term: input.name,
        normalized_term: canonicalNorm,
        updated_at: new Date().toISOString(),
      })
      .eq('catalog_item_id', itemId)
      .eq('account_id', accountId)
      .eq('kind', 'canonical')

    if (termError) {
      if (termError.code === '23505') {
        throw new CatalogValidationError(
          `A catalog term matching "${input.name}" already exists in this account`
        )
      }
      throw new Error(`Failed to update canonical term: ${termError.message}`)
    }
  }

  return getCatalogItem(db, accountId, itemId) as Promise<CatalogItemWithDetails>
}

export async function archiveCatalogItem(
  db: SupabaseClient,
  accountId: string,
  itemId: string
): Promise<CatalogItem> {
  const { data, error } = await db
    .from('catalog_items')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (error) {
    throw new Error(`archiveCatalogItem failed: ${error.message}`)
  }
  if (!data) {
    throw new Error(`Catalog item not found or does not belong to this account`)
  }

  return data as CatalogItem
}

export async function getCatalogItem(
  db: SupabaseClient,
  accountId: string,
  itemId: string
): Promise<CatalogItemWithDetails | null> {
  const { data: item, error: itemError } = await db
    .from('catalog_items')
    .select('*')
    .eq('id', itemId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (itemError) {
    throw new Error(`getCatalogItem failed: ${itemError.message}`)
  }
  if (!item) return null

  let category: CatalogCategory | null = null
  if (item.category_id) {
    category = await getCategory(db, accountId, item.category_id)
  }

  const { data: terms, error: termsError } = await db
    .from('catalog_item_terms')
    .select('*')
    .eq('catalog_item_id', itemId)
    .eq('account_id', accountId)
    .order('kind', { ascending: false })
    .order('created_at', { ascending: true })

  if (termsError) {
    throw new Error(`Failed to load catalog item terms: ${termsError.message}`)
  }

  return {
    ...(item as CatalogItem),
    category,
    terms: (terms as CatalogItemTerm[]) || [],
  }
}

export async function listCatalogItems(
  db: SupabaseClient,
  accountId: string,
  filter?: ListCatalogItemsFilter
): Promise<CatalogItem[]> {
  let query = db
    .from('catalog_items')
    .select('*')
    .eq('account_id', accountId)

  if (filter?.type) {
    query = query.eq('type', filter.type)
  }
  if (filter?.status) {
    query = query.eq('status', filter.status)
  }
  if (filter?.category_id !== undefined) {
    if (filter.category_id === null) {
      query = query.is('category_id', null)
    } else {
      query = query.eq('category_id', filter.category_id)
    }
  }
  if (filter?.search && filter.search.trim().length > 0) {
    query = query.ilike('name', `%${filter.search.trim()}%`)
  }

  query = query
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (filter?.limit) {
    query = query.limit(filter.limit)
  }
  if (filter?.offset) {
    query = query.range(filter.offset, filter.offset + (filter.limit || 20) - 1)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`listCatalogItems failed: ${error.message}`)
  }

  return (data as CatalogItem[]) || []
}

// ============================================================
// Terms and Aliases
// ============================================================

export async function addCatalogItemAlias(
  db: SupabaseClient,
  accountId: string,
  itemId: string,
  rawAlias: string
): Promise<CatalogItemTerm> {
  const alias = validateAlias(rawAlias)
  const normalized = normalizeCatalogTerm(alias)

  const item = await getCatalogItem(db, accountId, itemId)
  if (!item) {
    throw new CatalogValidationError(`Catalog item ${itemId} not found in this account`)
  }

  const { data, error } = await db
    .from('catalog_item_terms')
    .insert({
      account_id: accountId,
      catalog_item_id: itemId,
      term: alias,
      normalized_term: normalized,
      kind: 'alias',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new CatalogValidationError(
        `The term/alias "${alias}" (normalized: "${normalized}") is already registered in this account`
      )
    }
    throw new Error(`addCatalogItemAlias failed: ${error.message}`)
  }

  return data as CatalogItemTerm
}

export async function removeCatalogItemAlias(
  db: SupabaseClient,
  accountId: string,
  termId: string
): Promise<boolean> {
  const { data: term, error: fetchErr } = await db
    .from('catalog_item_terms')
    .select('id, kind')
    .eq('id', termId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (fetchErr) {
    throw new Error(`removeCatalogItemAlias lookup failed: ${fetchErr.message}`)
  }
  if (!term) {
    throw new Error(`Term ${termId} not found in this account`)
  }
  if (term.kind === 'canonical') {
    throw new CatalogValidationError(`Cannot delete the canonical term of an item directly. Rename the item instead.`)
  }

  const { error: deleteErr } = await db
    .from('catalog_item_terms')
    .delete()
    .eq('id', termId)
    .eq('account_id', accountId)

  if (deleteErr) {
    throw new Error(`removeCatalogItemAlias delete failed: ${deleteErr.message}`)
  }

  return true
}

export async function listCatalogItemTerms(
  db: SupabaseClient,
  accountId: string,
  itemId?: string
): Promise<CatalogItemTerm[]> {
  let query = db
    .from('catalog_item_terms')
    .select('*')
    .eq('account_id', accountId)

  if (itemId) {
    query = query.eq('catalog_item_id', itemId)
  }

  query = query
    .order('kind', { ascending: false })
    .order('term', { ascending: true })

  const { data, error } = await query

  if (error) {
    throw new Error(`listCatalogItemTerms failed: ${error.message}`)
  }

  return (data as CatalogItemTerm[]) || []
}

export async function resolveCatalogTerm(
  db: SupabaseClient,
  accountId: string,
  rawTerm: string
): Promise<ResolvedCatalogTerm | null> {
  const normalized = normalizeCatalogTerm(rawTerm)
  if (normalized.length === 0) return null

  const { data: termRow, error: termErr } = await db
    .from('catalog_item_terms')
    .select('*')
    .eq('account_id', accountId)
    .eq('normalized_term', normalized)
    .maybeSingle()

  if (termErr) {
    throw new Error(`resolveCatalogTerm lookup failed: ${termErr.message}`)
  }
  if (!termRow) return null

  const item = await getCatalogItem(db, accountId, termRow.catalog_item_id)
  if (!item || item.status === 'archived') {
    return null
  }

  return {
    item,
    matchedTerm: termRow as CatalogItemTerm,
    matchKind: termRow.kind as CatalogItemTerm['kind'],
  }
}
