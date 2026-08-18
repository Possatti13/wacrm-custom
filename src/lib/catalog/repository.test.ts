import { describe, expect, it, beforeEach } from 'vitest'
import {
  createCategory,
  updateCategory,
  deleteCategory,
  listCategories,
  getCategory,
  createCatalogItem,
  updateCatalogItem,
  archiveCatalogItem,
  getCatalogItem,
  listCatalogItems,
  addCatalogItemAlias,
  removeCatalogItemAlias,
  listCatalogItemTerms,
  resolveCatalogTerm,
} from './repository'
import { CatalogValidationError } from './validation'
import type { CatalogCategory, CatalogItem, CatalogItemTerm } from './types'

// In-Memory Test Database mimicking PostgreSQL constraints & triggers
function createInMemoryCatalogDb() {
  const categories: CatalogCategory[] = []
  const items: CatalogItem[] = []
  const terms: CatalogItemTerm[] = []

  let nextId = 1
  const genId = () => `uuid-${nextId++}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    _state: { categories, items, terms },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn === 'create_catalog_item_with_terms') {
        const accountId = params.p_account_id as string
        const categoryId = params.p_category_id as string | null
        const name = params.p_name as string
        const normName = params.p_normalized_name as string
        const sku = params.p_sku as string | null
        const aliases = (params.p_aliases as Array<{ term: string; normalized_term: string }>) || []

        // Category check
        if (categoryId) {
          const catExists = categories.find((c) => c.id === categoryId && c.account_id === accountId)
          if (!catExists) {
            return { data: null, error: { code: '23503', message: `Category ${categoryId} not found in this account` } }
          }
        }
        // SKU check
        if (sku) {
          const skuExists = items.find((i) => i.account_id === accountId && i.sku?.toLowerCase() === sku.toLowerCase())
          if (skuExists) {
            return { data: null, error: { code: '23505', message: `duplicate key value for sku` } }
          }
        }
        // Canonical term uniqueness check
        const termExists = terms.find((t) => t.account_id === accountId && t.normalized_term === normName)
        if (termExists) {
          return { data: null, error: { code: '23505', message: `duplicate key value for normalized_term` } }
        }
        // Aliases check
        for (const a of aliases) {
          const aliasExists = terms.find((t) => t.account_id === accountId && t.normalized_term === a.normalized_term)
          if (aliasExists || a.normalized_term === normName) {
            return { data: null, error: { code: '23505', message: `duplicate key value for normalized_term` } }
          }
        }

        // All checks passed -> Transactionally create item & terms
        const itemId = genId()
        const newItem: CatalogItem = {
          id: itemId,
          account_id: accountId,
          category_id: categoryId,
          type: params.p_type as CatalogItem['type'],
          name,
          description: (params.p_description as string) || null,
          sku,
          status: (params.p_status as CatalogItem['status']) || 'active',
          sort_order: (params.p_sort_order as number) || 0,
          metadata: (params.p_metadata as Record<string, unknown>) || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        items.push(newItem)

        const createdTerms: CatalogItemTerm[] = []
        const canonicalTerm: CatalogItemTerm = {
          id: genId(),
          account_id: accountId,
          catalog_item_id: itemId,
          term: name,
          normalized_term: normName,
          kind: 'canonical',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        terms.push(canonicalTerm)
        createdTerms.push(canonicalTerm)

        for (const a of aliases) {
          const aliasTerm: CatalogItemTerm = {
            id: genId(),
            account_id: accountId,
            catalog_item_id: itemId,
            term: a.term,
            normalized_term: a.normalized_term,
            kind: 'alias',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          terms.push(aliasTerm)
          createdTerms.push(aliasTerm)
        }

        return { data: { item: newItem, terms: createdTerms }, error: null }
      }

      if (fn === 'update_catalog_item_with_canonical') {
        const accountId = params.p_account_id as string
        const itemId = params.p_item_id as string
        const categoryId = params.p_category_id as string | null
        const name = params.p_name as string | null
        const normName = params.p_normalized_name as string | null
        const updateName = Boolean(params.p_update_name)

        const item = items.find((i) => i.id === itemId && i.account_id === accountId)
        if (!item) {
          return { data: null, error: { code: 'P0002', message: 'Item not found' } }
        }

        if (categoryId) {
          const catExists = categories.find((c) => c.id === categoryId && c.account_id === accountId)
          if (!catExists) {
            return { data: null, error: { code: '23503', message: `Category ${categoryId} not found in this account` } }
          }
        }

        if (updateName && normName) {
          const termExists = terms.find(
            (t) => t.account_id === accountId && t.normalized_term === normName && t.catalog_item_id !== itemId
          )
          if (termExists) {
            return { data: null, error: { code: '23505', message: 'duplicate key value for normalized_term' } }
          }
        }

        // Apply updates
        if (params.p_category_id !== undefined) item.category_id = categoryId
        if (params.p_type) item.type = params.p_type as CatalogItem['type']
        if (name) item.name = name
        if (params.p_description !== undefined) item.description = params.p_description as string | null
        if (params.p_sku !== undefined) item.sku = params.p_sku as string | null
        if (params.p_status) item.status = params.p_status as CatalogItem['status']
        if (params.p_sort_order !== undefined && params.p_sort_order !== null) item.sort_order = params.p_sort_order as number
        if (params.p_metadata) item.metadata = params.p_metadata as Record<string, unknown>
        item.updated_at = new Date().toISOString()

        if (updateName && normName && name) {
          const cTerm = terms.find((t) => t.catalog_item_id === itemId && t.kind === 'canonical')
          if (cTerm) {
            cTerm.term = name
            cTerm.normalized_term = normName
            cTerm.updated_at = new Date().toISOString()
          }
        }

        return { data: item, error: null }
      }

      return { data: null, error: new Error(`Unknown RPC ${fn}`) }
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        _table: table,
        _action: 'select',
        _filters: [] as Array<{ field: string; op: string; val: unknown }>,
        _data: null as unknown,
        _order: [] as Array<{ field: string; ascending: boolean }>,
        _single: false,
        _maybeSingle: false,

        select: (cols = '*') => {
          builder._cols = cols
          return builder
        },
        insert: (data: unknown) => {
          builder._action = 'insert'
          builder._data = data
          return builder
        },
        update: (data: unknown) => {
          builder._action = 'update'
          builder._data = data
          return builder
        },
        delete: () => {
          builder._action = 'delete'
          return builder
        },
        eq: (field: string, val: unknown) => {
          ;(builder._filters as Array<{ field: string; op: string; val: unknown }>).push({
            field,
            op: 'eq',
            val,
          })
          return builder
        },
        is: (field: string, val: unknown) => {
          ;(builder._filters as Array<{ field: string; op: string; val: unknown }>).push({
            field,
            op: 'is',
            val,
          })
          return builder
        },
        ilike: (field: string, val: unknown) => {
          ;(builder._filters as Array<{ field: string; op: string; val: unknown }>).push({
            field,
            op: 'ilike',
            val,
          })
          return builder
        },
        order: (field: string, opts?: { ascending?: boolean }) => {
          ;(builder._order as Array<{ field: string; ascending: boolean }>).push({
            field,
            ascending: opts?.ascending ?? true,
          })
          return builder
        },
        limit: () => builder,
        range: () => builder,
        single: () => {
          builder._single = true
          return builder
        },
        maybeSingle: () => {
          builder._maybeSingle = true
          return builder
        },

        then: (resolve: (res: { data: unknown; error: unknown }) => void) => {
          try {
            const filters = builder._filters as Array<{ field: string; op: string; val: unknown }>
            const matchFilter = (row: Record<string, unknown>) => {
              return filters.every((f) => {
                if (f.op === 'eq') return row[f.field] === f.val
                if (f.op === 'is') return row[f.field] === f.val
                if (f.op === 'ilike') {
                  const query = String(f.val).replace(/%/g, '').toLowerCase()
                  return String(row[f.field] || '').toLowerCase().includes(query)
                }
                return true
              })
            }

            // INSERT
            if (builder._action === 'insert') {
              const row = { ...(builder._data as Record<string, unknown>) }
              row.id = row.id || genId()
              row.created_at = new Date().toISOString()
              row.updated_at = new Date().toISOString()

              if (table === 'catalog_categories') {
                // Check uniqueness (account_id, lower(trim(name)))
                const normName = String(row.name).trim().toLowerCase().replace(/\s+/g, ' ')
                const exists = categories.find(
                  (c) => c.account_id === row.account_id && c.name.trim().toLowerCase().replace(/\s+/g, ' ') === normName
                )
                if (exists) {
                  return resolve({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                  })
                }
                categories.push(row as unknown as CatalogCategory)
                return resolve({ data: row, error: null })
              }

              if (table === 'catalog_items') {
                // Check FK composite (account_id, category_id)
                if (row.category_id) {
                  const catExists = categories.find(
                    (c) => c.id === row.category_id && c.account_id === row.account_id
                  )
                  if (!catExists) {
                    return resolve({
                      data: null,
                      error: { code: '23503', message: 'foreign key violation' },
                    })
                  }
                }
                // Check SKU uniqueness per account
                if (row.sku) {
                  const skuExists = items.find(
                    (i) => i.account_id === row.account_id && i.sku?.toLowerCase() === String(row.sku).toLowerCase()
                  )
                  if (skuExists) {
                    return resolve({
                      data: null,
                      error: { code: '23505', message: 'duplicate key value for sku' },
                    })
                  }
                }
                items.push(row as unknown as CatalogItem)
                return resolve({ data: row, error: null })
              }

              if (table === 'catalog_item_terms') {
                // Check FK composite (account_id, catalog_item_id)
                const itemExists = items.find(
                  (i) => i.id === row.catalog_item_id && i.account_id === row.account_id
                )
                if (!itemExists) {
                  return resolve({
                    data: null,
                    error: { code: '23503', message: 'foreign key violation' },
                  })
                }
                // Check unique (account_id, normalized_term)
                const termExists = terms.find(
                  (t) => t.account_id === row.account_id && t.normalized_term === row.normalized_term
                )
                if (termExists) {
                  return resolve({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value for normalized_term' },
                  })
                }
                // Check unique canonical term per item
                if (row.kind === 'canonical') {
                  const hasCanonical = terms.find(
                    (t) => t.catalog_item_id === row.catalog_item_id && t.kind === 'canonical'
                  )
                  if (hasCanonical) {
                    return resolve({
                      data: null,
                      error: { code: '23505', message: 'only one canonical term per item allowed' },
                    })
                  }
                }
                terms.push(row as unknown as CatalogItemTerm)
                return resolve({ data: row, error: null })
              }
            }

            // SELECT
            if (builder._action === 'select') {
              let dataset: Array<Record<string, unknown>> = []
              if (table === 'catalog_categories') dataset = categories as unknown as Array<Record<string, unknown>>
              if (table === 'catalog_items') dataset = items as unknown as Array<Record<string, unknown>>
              if (table === 'catalog_item_terms') dataset = terms as unknown as Array<Record<string, unknown>>

              let result = dataset.filter(matchFilter)

              // Sorting
              const orders = builder._order as Array<{ field: string; ascending: boolean }>
              if (orders.length > 0) {
                result = [...result].sort((a, b) => {
                  for (const ord of orders) {
                    const va = String(a[ord.field] ?? '')
                    const vb = String(b[ord.field] ?? '')
                    if (va !== vb) {
                      if (ord.ascending) return va > vb ? 1 : -1
                      return va < vb ? 1 : -1
                    }
                  }
                  return 0
                })
              }

              if (builder._single || builder._maybeSingle) {
                return resolve({ data: result[0] || null, error: null })
              }
              return resolve({ data: result, error: null })
            }

            // UPDATE
            if (builder._action === 'update') {
              let target: Record<string, unknown> | undefined
              if (table === 'catalog_categories') {
                target = categories.find((c) => matchFilter(c as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
              }
              if (table === 'catalog_items') {
                target = items.find((i) => matchFilter(i as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
              }
              if (table === 'catalog_item_terms') {
                target = terms.find((t) => matchFilter(t as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
              }

              if (!target) {
                return resolve({ data: null, error: null })
              }

              const updateData = builder._data as Record<string, unknown>
              Object.assign(target, updateData)
              return resolve({ data: target, error: null })
            }

            // DELETE
            if (builder._action === 'delete') {
              if (table === 'catalog_categories') {
                const idx = categories.findIndex((c) => matchFilter(c as unknown as Record<string, unknown>))
                if (idx >= 0) {
                  const deletedCat = categories.splice(idx, 1)[0]
                  // Emulate Postgres ON DELETE SET NULL (category_id):
                  items.forEach((it) => {
                    if (it.category_id === deletedCat.id && it.account_id === deletedCat.account_id) {
                      it.category_id = null
                    }
                  })
                }
              }
              if (table === 'catalog_items') {
                const idx = items.findIndex((i) => matchFilter(i as unknown as Record<string, unknown>))
                if (idx >= 0) {
                  const deletedItem = items.splice(idx, 1)[0]
                  // Emulate ON DELETE CASCADE on terms
                  for (let i = terms.length - 1; i >= 0; i--) {
                    if (terms[i].catalog_item_id === deletedItem.id) {
                      terms.splice(i, 1)
                    }
                  }
                }
              }
              if (table === 'catalog_item_terms') {
                const idx = terms.findIndex((t) => matchFilter(t as unknown as Record<string, unknown>))
                if (idx >= 0) terms.splice(idx, 1)
              }
              return resolve({ data: null, error: null })
            }
          } catch (e) {
            resolve({ data: null, error: e })
          }
        },
      }
      return builder
    },
  }

  return client
}

describe('Products & Services Catalog Repository', () => {
  const TENANT_A = 'acc-tenant-a-111'
  const TENANT_B = 'acc-tenant-b-222'
  let db: ReturnType<typeof createInMemoryCatalogDb>

  beforeEach(() => {
    db = createInMemoryCatalogDb()
  })

  describe('Categories CRUD', () => {
    it('creates, lists, updates, and deletes categories per account', async () => {
      const catA = await createCategory(db, TENANT_A, {
        name: 'Motos Elétricas',
        description: 'Veículos 100% elétricos',
        sort_order: 1,
      })
      expect(catA.id).toBeDefined()
      expect(catA.name).toBe('Motos Elétricas')
      expect(catA.account_id).toBe(TENANT_A)

      // Category for Tenant B with identical name is allowed
      const catB = await createCategory(db, TENANT_B, {
        name: 'Motos Elétricas',
      })
      expect(catB.account_id).toBe(TENANT_B)

      // Listing Tenant A returns only catA
      const listA = await listCategories(db, TENANT_A)
      expect(listA.length).toBe(1)
      expect(listA[0].id).toBe(catA.id)

      // Update category
      const updated = await updateCategory(db, TENANT_A, catA.id, {
        name: 'Motos & Scooters',
      })
      expect(updated.name).toBe('Motos & Scooters')

      // Delete category
      await deleteCategory(db, TENANT_A, catA.id)
      const listAfterDelete = await listCategories(db, TENANT_A)
      expect(listAfterDelete.length).toBe(0)
    })

    it('rejects duplicate category name in the same account (including case and whitespace variations)', async () => {
      await createCategory(db, TENANT_A, { name: 'Motos' })

      // Same name with different casing
      await expect(createCategory(db, TENANT_A, { name: 'MOTOS' })).rejects.toThrow(
        CatalogValidationError
      )

      // Same name with leading/trailing spaces
      await expect(createCategory(db, TENANT_A, { name: '  motos  ' })).rejects.toThrow(
        CatalogValidationError
      )

      // Different tenant is allowed
      const catB = await createCategory(db, TENANT_B, { name: 'motos' })
      expect(catB.account_id).toBe(TENANT_B)
    })
  })

  describe('Items & Automatic Canonical Term', () => {
    it('creates product, automatically creates canonical term, and supports aliases', async () => {
      const cat = await createCategory(db, TENANT_A, { name: 'Veículos' })

      const item = await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
        category_id: cat.id,
        sku: 'MOTO-X13',
        sort_order: 10,
        aliases: ['X13', 'Moto X13'],
      })

      expect(item.id).toBeDefined()
      expect(item.name).toBe('X-13')
      expect(item.sku).toBe('moto-x13')
      expect(item.terms?.length).toBe(3)

      // Verify canonical term
      const canonical = item.terms?.find((t) => t.kind === 'canonical')
      expect(canonical).toBeDefined()
      expect(canonical?.term).toBe('X-13')
      expect(canonical?.normalized_term).toBe('x 13')

      // Verify alias terms
      const aliasTerms = item.terms?.filter((t) => t.kind === 'alias')
      expect(aliasTerms?.length).toBe(2)
      expect(aliasTerms?.map((t) => t.normalized_term)).toContain('x13')
      expect(aliasTerms?.map((t) => t.normalized_term)).toContain('moto x13')
    })

    it('creates service without category', async () => {
      const service = await createCatalogItem(db, TENANT_A, {
        name: 'Consultoria Financeira',
        type: 'service',
      })
      expect(service.type).toBe('service')
      expect(service.category_id).toBeNull()
      expect(service.terms?.[0].kind).toBe('canonical')
    })

    it('updates item name and atomically updates its canonical term', async () => {
      const item = await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
      })

      const updated = await updateCatalogItem(db, TENANT_A, item.id, {
        name: 'X-13 Pro',
      })
      expect(updated.name).toBe('X-13 Pro')

      const terms = await listCatalogItemTerms(db, TENANT_A, item.id)
      const canonical = terms.find((t) => t.kind === 'canonical')
      expect(canonical?.term).toBe('X-13 Pro')
      expect(canonical?.normalized_term).toBe('x 13 pro')
    })

    it('archives catalog item', async () => {
      const item = await createCatalogItem(db, TENANT_A, {
        name: 'X-10',
        type: 'product',
      })
      const archived = await archiveCatalogItem(db, TENANT_A, item.id)
      expect(archived.status).toBe('archived')
    })

    it('lists catalog items with filters (type, status, search)', async () => {
      await createCatalogItem(db, TENANT_A, {
        name: 'Scooter Alpha',
        type: 'product',
        status: 'active',
      })
      await createCatalogItem(db, TENANT_A, {
        name: 'Manutenção Preventiva',
        type: 'service',
        status: 'active',
      })

      const all = await listCatalogItems(db, TENANT_A)
      expect(all.length).toBe(2)

      const productsOnly = await listCatalogItems(db, TENANT_A, { type: 'product' })
      expect(productsOnly.length).toBe(1)
      expect(productsOnly[0].name).toBe('Scooter Alpha')

      const searchRes = await listCatalogItems(db, TENANT_A, { search: 'Preventiva' })
      expect(searchRes.length).toBe(1)
      expect(searchRes[0].name).toBe('Manutenção Preventiva')
    })

    it('rolls back completely when creating an item with a conflicting canonical term (0 items created)', async () => {
      // 1. First item
      await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
      })

      // 2. Second item with identical canonical term name
      await expect(
        createCatalogItem(db, TENANT_A, {
          name: 'x 13',
          type: 'product',
        })
      ).rejects.toThrow(CatalogValidationError)

      // Verify that ONLY 1 item exists in Tenant A (no orphaned second item)
      const itemsList = await listCatalogItems(db, TENANT_A)
      expect(itemsList.length).toBe(1)
      expect(itemsList[0].name).toBe('X-13')
    })

    it('rolls back completely when renaming an item conflicts with another existing canonical term', async () => {
      await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
      })
      const item2 = await createCatalogItem(db, TENANT_A, {
        name: 'X-14',
        type: 'product',
      })

      // Attempting to rename item2 to "X-13" (which collides with item1's canonical term)
      await expect(
        updateCatalogItem(db, TENANT_A, item2.id, {
          name: 'X-13',
        })
      ).rejects.toThrow(CatalogValidationError)

      // Verify that item2's name and canonical term remained intact as 'X-14'
      const item2Lookup = await getCatalogItem(db, TENANT_A, item2.id)
      expect(item2Lookup?.name).toBe('X-14')

      const terms2 = await listCatalogItemTerms(db, TENANT_A, item2.id)
      const canonical2 = terms2.find((t) => t.kind === 'canonical')
      expect(canonical2?.term).toBe('X-14')
      expect(canonical2?.normalized_term).toBe('x 14')
    })
  })

  describe('Aliases & Term Resolver (resolveCatalogTerm)', () => {
    it('resolves raw query terms by canonical name or alias', async () => {
      const item = await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
        aliases: ['Moto X13', 'Scooter X-13'],
      })

      // 1. Resolve canonical term
      const res1 = await resolveCatalogTerm(db, TENANT_A, '  x-13  ')
      expect(res1).not.toBeNull()
      expect(res1?.item.id).toBe(item.id)
      expect(res1?.matchKind).toBe('canonical')

      // 2. Resolve alias with accent/symbols
      const res2 = await resolveCatalogTerm(db, TENANT_A, 'MOTO   X13')
      expect(res2).not.toBeNull()
      expect(res2?.item.id).toBe(item.id)
      expect(res2?.matchKind).toBe('alias')

      // 3. Resolve alias with hyphen/spaces
      const res3 = await resolveCatalogTerm(db, TENANT_A, 'scooter x 13')
      expect(res3).not.toBeNull()
      expect(res3?.item.id).toBe(item.id)
      expect(res3?.matchKind).toBe('alias')

      // 4. Non-matching term returns null
      const res4 = await resolveCatalogTerm(db, TENANT_A, 'Yamaha R1')
      expect(res4).toBeNull()
    })

    it('rejects alias if it collides with an existing canonical term in same account', async () => {
      await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
      })

      const item2 = await createCatalogItem(db, TENANT_A, {
        name: 'X-14',
        type: 'product',
      })

      // Attempting to add "X-13" as an alias to Item 2 should fail
      await expect(addCatalogItemAlias(db, TENANT_A, item2.id, 'X 13')).rejects.toThrow(
        CatalogValidationError
      )
    })

    it('allows deleting an alias but protects canonical term from direct deletion', async () => {
      const item = await createCatalogItem(db, TENANT_A, {
        name: 'Plano Plus',
        type: 'service',
        aliases: ['Plus'],
      })

      const terms = await listCatalogItemTerms(db, TENANT_A, item.id)
      const aliasTerm = terms.find((t) => t.kind === 'alias')!
      const canonicalTerm = terms.find((t) => t.kind === 'canonical')!

      // Delete alias succeeds
      const deleted = await removeCatalogItemAlias(db, TENANT_A, aliasTerm.id)
      expect(deleted).toBe(true)

      // Delete canonical term directly fails
      await expect(removeCatalogItemAlias(db, TENANT_A, canonicalTerm.id)).rejects.toThrow(
        CatalogValidationError
      )
    })
  })

  describe('Multi-Tenant Isolation & Referential Integrity', () => {
    it('prevents Tenant A from linking item to Tenant B category', async () => {
      const catB = await createCategory(db, TENANT_B, { name: 'Categoria Externa' })

      await expect(
        createCatalogItem(db, TENANT_A, {
          name: 'Produto Invasor',
          type: 'product',
          category_id: catB.id,
        })
      ).rejects.toThrow(/Category .* not found in this account/)
    })

    it('prevents Tenant A from adding alias to Tenant B item', async () => {
      const itemB = await createCatalogItem(db, TENANT_B, {
        name: 'Item do Tenant B',
        type: 'product',
      })

      await expect(
        addCatalogItemAlias(db, TENANT_A, itemB.id, 'Alias Invasor')
      ).rejects.toThrow(/Catalog item .* not found in this account/)
    })

    it('allows identical SKUs and Aliases across different tenants without collision', async () => {
      const itemA = await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
        sku: 'SKU-COMMON',
        aliases: ['Super X'],
      })

      const itemB = await createCatalogItem(db, TENANT_B, {
        name: 'X-13',
        type: 'product',
        sku: 'SKU-COMMON',
        aliases: ['Super X'],
      })

      expect(itemA.sku).toBe('sku-common')
      expect(itemB.sku).toBe('sku-common')

      // Term resolution in Tenant A matches itemA only
      const resA = await resolveCatalogTerm(db, TENANT_A, 'super x')
      expect(resA?.item.id).toBe(itemA.id)
      expect(resA?.item.account_id).toBe(TENANT_A)

      // Term resolution in Tenant B matches itemB only
      const resB = await resolveCatalogTerm(db, TENANT_B, 'super x')
      expect(resB?.item.id).toBe(itemB.id)
      expect(resB?.item.account_id).toBe(TENANT_B)
    })

    it('on category deletion, item category_id becomes null while item and account_id remain intact', async () => {
      const cat = await createCategory(db, TENANT_A, { name: 'Motos' })
      const item = await createCatalogItem(db, TENANT_A, {
        name: 'X-13',
        type: 'product',
        category_id: cat.id,
      })

      expect(item.category_id).toBe(cat.id)

      // Delete category
      await deleteCategory(db, TENANT_A, cat.id)

      // Category is gone
      const catLookup = await getCategory(db, TENANT_A, cat.id)
      expect(catLookup).toBeNull()

      // Item still exists, account_id intact, category_id is null
      const itemLookup = await getCatalogItem(db, TENANT_A, item.id)
      expect(itemLookup).not.toBeNull()
      expect(itemLookup?.account_id).toBe(TENANT_A)
      expect(itemLookup?.category_id).toBeNull()
    })
  })

  describe('CatalogService class wrapper', () => {
    it('provides contextual operations scoped to accountId', async () => {
      const { CatalogService } = await import('./service')
      const service = new CatalogService(db, TENANT_A)

      const cat = await service.createCategory({ name: 'Planos' })
      expect(cat.name).toBe('Planos')

      const item = await service.createItem({
        name: 'Plano Mensal',
        type: 'service',
        category_id: cat.id,
      })
      expect(item.name).toBe('Plano Mensal')

      const alias = await service.addAlias(item.id, 'Mensalidade')
      expect(alias.term).toBe('Mensalidade')

      const resolved = await service.resolveTerm('mensalidade')
      expect(resolved?.item.id).toBe(item.id)

      const list = await service.listItems()
      expect(list.length).toBe(1)
    })

    it('throws when initialized without accountId', async () => {
      const { CatalogService } = await import('./service')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => new CatalogService(db, '' as any)).toThrow('CatalogService requires a valid accountId')
    })
  })
})
