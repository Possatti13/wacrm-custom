export type CatalogItemType = 'product' | 'service'

export type CatalogItemStatus = 'active' | 'inactive' | 'archived'

export type CatalogTermKind = 'canonical' | 'alias'

export interface CatalogCategory {
  id: string
  account_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CatalogItem {
  id: string
  account_id: string
  category_id: string | null
  type: CatalogItemType
  name: string
  description: string | null
  sku: string | null
  status: CatalogItemStatus
  sort_order: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CatalogItemTerm {
  id: string
  account_id: string
  catalog_item_id: string
  term: string
  normalized_term: string
  kind: CatalogTermKind
  created_at: string
  updated_at: string
}

export interface CatalogItemWithDetails extends CatalogItem {
  category?: CatalogCategory | null
  terms?: CatalogItemTerm[]
}

export interface CreateCategoryInput {
  name: string
  description?: string | null
  sort_order?: number
}

export interface UpdateCategoryInput {
  name?: string
  description?: string | null
  sort_order?: number
}

export interface CreateCatalogItemInput {
  name: string
  type: CatalogItemType
  category_id?: string | null
  description?: string | null
  sku?: string | null
  status?: CatalogItemStatus
  sort_order?: number
  metadata?: Record<string, unknown>
  aliases?: string[]
}

export interface UpdateCatalogItemInput {
  name?: string
  type?: CatalogItemType
  category_id?: string | null
  description?: string | null
  sku?: string | null
  status?: CatalogItemStatus
  sort_order?: number
  metadata?: Record<string, unknown>
}

export interface ListCatalogItemsFilter {
  type?: CatalogItemType
  status?: CatalogItemStatus
  category_id?: string | null
  search?: string
  limit?: number
  offset?: number
}

export interface ResolvedCatalogTerm {
  item: CatalogItem
  matchedTerm: CatalogItemTerm
  matchKind: CatalogTermKind
}
