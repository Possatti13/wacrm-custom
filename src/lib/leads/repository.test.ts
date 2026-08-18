import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLeadProfile,
  upsertLeadProfile,
  deleteLeadProfile,
  recordCatalogInterest,
  updateCatalogInterestStatus,
  dismissCatalogInterest,
  reactivateCatalogInterest,
  listCatalogInterests,
  recordObjection,
  resolveObjection,
  dismissObjection,
  reactivateObjection,
  listObjections,
  getCommercialContext,
} from './repository'
import { LeadProfileService } from './service'
import type {
  ContactLeadProfile,
  ContactCatalogInterest,
  ContactObjection,
} from './types'

function createInMemoryLeadDb() {
  const contacts: Array<{ id: string; account_id: string; name: string }> = []
  const catalogItems: Array<{ id: string; account_id: string; name: string; status: string }> = []
  const profiles: ContactLeadProfile[] = []
  const interests: ContactCatalogInterest[] = []
  const objections: ContactObjection[] = []

  let idCounter = 1
  const genId = () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, '0')}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    _state: { contacts, catalogItems, profiles, interests, objections },
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        _table: table,
        _action: 'select',
        _filters: [] as Array<{ field: string; op: string; val: unknown }>,
        _data: null as unknown,
        _order: [] as Array<{ field: string; ascending: boolean }>,
        _single: false,
        _maybeSingle: false,
        _onConflict: '',

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
        upsert: (data: unknown, opts?: { onConflict?: string }) => {
          builder._action = 'upsert'
          builder._data = data
          builder._onConflict = opts?.onConflict || ''
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
        order: (field: string, opts?: { ascending?: boolean }) => {
          ;(builder._order as Array<{ field: string; ascending: boolean }>).push({
            field,
            ascending: opts?.ascending ?? true,
          })
          return builder
        },
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
                return true
              })
            }

            // INSERT
            if (builder._action === 'insert') {
              const row = { ...(builder._data as Record<string, unknown>) }
              row.id = row.id || genId()
              row.created_at = row.created_at || new Date().toISOString()
              row.updated_at = row.updated_at || new Date().toISOString()

              if (table === 'contact_lead_profiles') {
                profiles.push(row as unknown as ContactLeadProfile)
                return resolve({ data: row, error: null })
              }
              if (table === 'contact_catalog_interests') {
                interests.push(row as unknown as ContactCatalogInterest)
                return resolve({ data: row, error: null })
              }
              if (table === 'contact_objections') {
                objections.push(row as unknown as ContactObjection)
                return resolve({ data: row, error: null })
              }
            }

            // UPSERT
            if (builder._action === 'upsert') {
              const payload = { ...(builder._data as Record<string, unknown>) }
              if (table === 'contact_lead_profiles') {
                const existingIdx = profiles.findIndex(
                  (p) => p.account_id === payload.account_id && p.contact_id === payload.contact_id
                )
                if (existingIdx >= 0) {
                  const merged = {
                    ...profiles[existingIdx],
                    ...payload,
                    updated_at: new Date().toISOString(),
                  }
                  profiles[existingIdx] = merged as ContactLeadProfile
                  return resolve({ data: merged, error: null })
                } else {
                  payload.id = payload.id || genId()
                  payload.created_at = new Date().toISOString()
                  payload.updated_at = new Date().toISOString()
                  profiles.push(payload as unknown as ContactLeadProfile)
                  return resolve({ data: payload, error: null })
                }
              }
            }

            // SELECT
            if (builder._action === 'select') {
              let dataset: Array<Record<string, unknown>> = []
              if (table === 'contact_lead_profiles') dataset = profiles as unknown as Array<Record<string, unknown>>
              if (table === 'contact_catalog_interests') {
                // Populate joined catalog_items mock
                dataset = interests.map((i) => {
                  const it = catalogItems.find((c) => c.id === i.catalog_item_id && c.account_id === i.account_id)
                  return {
                    ...i,
                    catalog_items: it || null,
                  }
                }) as unknown as Array<Record<string, unknown>>
              }
              if (table === 'contact_objections') dataset = objections as unknown as Array<Record<string, unknown>>

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
              if (table === 'contact_lead_profiles') {
                target = profiles.find((p) => matchFilter(p as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
              }
              if (table === 'contact_catalog_interests') {
                target = interests.find((i) => matchFilter(i as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
              }
              if (table === 'contact_objections') {
                target = objections.find((o) => matchFilter(o as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
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
              if (table === 'contact_lead_profiles') {
                const idx = profiles.findIndex((p) => matchFilter(p as unknown as Record<string, unknown>))
                if (idx >= 0) profiles.splice(idx, 1)
              }
              if (table === 'contact_catalog_interests') {
                const idx = interests.findIndex((i) => matchFilter(i as unknown as Record<string, unknown>))
                if (idx >= 0) interests.splice(idx, 1)
              }
              if (table === 'contact_objections') {
                const idx = objections.findIndex((o) => matchFilter(o as unknown as Record<string, unknown>))
                if (idx >= 0) objections.splice(idx, 1)
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

describe('Lead Profiles & Commercial Context Repository', () => {
  const TENANT_A = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const TENANT_B = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONTACT_A1 = '33333333-1111-1111-1111-111111111111'
  const CONTACT_B1 = '33333333-2222-2222-2222-222222222222'
  const ITEM_A1 = '44444444-1111-1111-1111-111111111111'
  const ITEM_A2 = '44444444-1111-1111-1111-222222222222'
  const ITEM_B1 = '44444444-2222-2222-2222-111111111111'

  let db: ReturnType<typeof createInMemoryLeadDb>

  beforeEach(() => {
    db = createInMemoryLeadDb()
    db._state.contacts.push(
      { id: CONTACT_A1, account_id: TENANT_A, name: 'Lead A1' },
      { id: CONTACT_B1, account_id: TENANT_B, name: 'Lead B1' }
    )
    db._state.catalogItems.push(
      { id: ITEM_A1, account_id: TENANT_A, name: 'X-13 Electric Scooter', status: 'active' },
      { id: ITEM_A2, account_id: TENANT_A, name: 'X-14 Fast Scooter', status: 'active' },
      { id: ITEM_B1, account_id: TENANT_B, name: 'Tenant B Product', status: 'active' }
    )
  })

  describe('1. Contact Lead Profiles & Field-Level Provenance', () => {
    it('returns null when contact does not have a lead profile yet', async () => {
      const profile = await getLeadProfile(db, TENANT_A, CONTACT_A1)
      expect(profile).toBeNull()
    })

    it('creates lead profile with field-level provenance', async () => {
      const profile = await upsertLeadProfile(db, TENANT_A, CONTACT_A1, {
        summary: 'Interessado no modelo X-13 para entregas',
        summary_source: 'intelligence',
        current_intent: 'compra',
        current_intent_source: 'intelligence',
        urgency: 'high',
        urgency_source: 'intelligence',
        sentiment: 'positive',
        sentiment_source: 'intelligence',
        next_action: 'Enviar simulador de parcelamento',
        next_action_due_at: '2026-08-25T14:00:00.000Z',
        next_action_source: 'manual',
        source: 'manual',
      })

      expect(profile.summary).toBe('Interessado no modelo X-13 para entregas')
      expect(profile.summary_source).toBe('intelligence')
      expect(profile.current_intent).toBe('compra')
      expect(profile.current_intent_source).toBe('intelligence')
      expect(profile.urgency).toBe('high')
      expect(profile.urgency_source).toBe('intelligence')
      expect(profile.sentiment).toBe('positive')
      expect(profile.sentiment_source).toBe('intelligence')
      expect(profile.next_action).toBe('Enviar simulador de parcelamento')
      expect(profile.next_action_source).toBe('manual')
      expect(profile.last_update_source).toBe('manual')
    })

    it('editing next_action manually does not alter the provenance of summary or intent', async () => {
      // 1. Initial creation via intelligence
      await upsertLeadProfile(db, TENANT_A, CONTACT_A1, {
        summary: 'Lead qualificado pela IA',
        summary_source: 'intelligence',
        current_intent: 'orçamento',
        current_intent_source: 'intelligence',
        urgency: 'medium',
        urgency_source: 'intelligence',
        source: 'intelligence',
      })

      // 2. Human agent edits next_action manually
      const updated = await upsertLeadProfile(db, TENANT_A, CONTACT_A1, {
        next_action: 'Agendar test-ride para sábado',
        next_action_source: 'manual',
        source: 'manual',
      })

      // Summary and intent maintain 'intelligence' provenance
      expect(updated.summary).toBe('Lead qualificado pela IA')
      expect(updated.summary_source).toBe('intelligence')
      expect(updated.current_intent).toBe('orçamento')
      expect(updated.current_intent_source).toBe('intelligence')
      expect(updated.urgency).toBe('medium')
      expect(updated.urgency_source).toBe('intelligence')

      // Next action is marked 'manual'
      expect(updated.next_action).toBe('Agendar test-ride para sábado')
      expect(updated.next_action_source).toBe('manual')
      expect(updated.last_update_source).toBe('manual')
    })

    it('isolates lead profiles across tenants', async () => {
      await upsertLeadProfile(db, TENANT_A, CONTACT_A1, {
        summary: 'Tenant A Secret Summary',
      })

      // Tenant B querying CONTACT_A1 receives null
      const crossLookup = await getLeadProfile(db, TENANT_B, CONTACT_A1)
      expect(crossLookup).toBeNull()
    })

    it('deletes lead profile', async () => {
      await upsertLeadProfile(db, TENANT_A, CONTACT_A1, {
        summary: 'Para deletar',
      })
      const deleted = await deleteLeadProfile(db, TENANT_A, CONTACT_A1)
      expect(deleted).toBe(true)
      const after = await getLeadProfile(db, TENANT_A, CONTACT_A1)
      expect(after).toBeNull()
    })
  })

  describe('2. Catalog Interests State Transitions', () => {
    it('records new active catalog interest', async () => {
      const interest = await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
        source: 'intelligence',
        metadata: { channel: 'whatsapp' },
      })

      expect(interest.status).toBe('active')
      expect(interest.catalog_item_id).toBe(ITEM_A1)
      expect(interest.source).toBe('intelligence')
      expect(interest.first_seen_at).toBeDefined()
      expect(interest.last_seen_at).toBeDefined()
    })

    it('recording an existing active interest refreshes last_seen_at and source', async () => {
      const first = await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
        source: 'import',
      })

      const second = await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
        source: 'intelligence',
      })

      expect(second.id).toBe(first.id)
      expect(second.status).toBe('active')
      expect(second.source).toBe('intelligence')
      expect(new Date(second.last_seen_at).getTime()).toBeGreaterThanOrEqual(
        new Date(first.first_seen_at).getTime()
      )
    })

    it('inactive interest becomes active when recorded again', async () => {
      await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
      })
      await updateCatalogInterestStatus(db, TENANT_A, CONTACT_A1, ITEM_A1, 'inactive')

      const reRecorded = await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
        source: 'intelligence',
      })

      expect(reRecorded.status).toBe('active')
      expect(reRecorded.source).toBe('intelligence')
    })

    it('dismissed interest remains dismissed upon implicit recording', async () => {
      await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
      })
      await dismissCatalogInterest(db, TENANT_A, CONTACT_A1, ITEM_A1)

      // Implicit recording
      const recorded = await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
        source: 'intelligence',
      })

      // Remains dismissed
      expect(recorded.status).toBe('dismissed')
    })

    it('explicitly reactivates a dismissed interest', async () => {
      await recordCatalogInterest(db, TENANT_A, CONTACT_A1, {
        catalog_item_id: ITEM_A1,
      })
      await dismissCatalogInterest(db, TENANT_A, CONTACT_A1, ITEM_A1)

      const reactivated = await reactivateCatalogInterest(db, TENANT_A, CONTACT_A1, ITEM_A1, 'manual')
      expect(reactivated.status).toBe('active')
      expect(reactivated.source).toBe('manual')
    })

    it('lists interests with populated catalog items', async () => {
      await recordCatalogInterest(db, TENANT_A, CONTACT_A1, { catalog_item_id: ITEM_A1 })
      await recordCatalogInterest(db, TENANT_A, CONTACT_A1, { catalog_item_id: ITEM_A2 })

      const list = await listCatalogInterests(db, TENANT_A, CONTACT_A1)
      expect(list.length).toBe(2)
      expect(list[0].item?.name).toBeDefined()
    })
  })

  describe('3. Objections State Transitions', () => {
    it('records structured objection with automatic normalization', async () => {
      const obj = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'Preço Muito Alto!',
        source: 'intelligence',
      })

      expect(obj.objection).toBe('Preço Muito Alto!')
      expect(obj.normalized_objection).toBe('preco muito alto')
      expect(obj.status).toBe('open')
      expect(obj.resolved_at).toBeNull()
    })

    it('recording duplicate objection with different casing/spaces dedupes and updates timestamp', async () => {
      const obj1 = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'Preço Alto',
        source: 'intelligence',
      })

      const obj2 = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: '  PREÇO ALTO!  ',
        source: 'manual',
      })

      expect(obj2.id).toBe(obj1.id)
      expect(obj2.normalized_objection).toBe('preco alto')
      expect(obj2.source).toBe('manual')
      const all = await listObjections(db, TENANT_A, CONTACT_A1)
      expect(all.length).toBe(1)
    })

    it('resolved objection reopens when detected again', async () => {
      const obj = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'Sem garantia',
      })
      await resolveObjection(db, TENANT_A, obj.id)

      const resolvedLookup = (await listObjections(db, TENANT_A, CONTACT_A1))[0]
      expect(resolvedLookup.status).toBe('resolved')
      expect(resolvedLookup.resolved_at).toBeDefined()

      // Detected again in conversation
      const reopened = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'sem garantia',
        source: 'intelligence',
      })

      expect(reopened.status).toBe('open')
      expect(reopened.resolved_at).toBeNull()
    })

    it('dismissed objection remains dismissed upon implicit detection', async () => {
      const obj = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'Cor vermelha',
      })
      await dismissObjection(db, TENANT_A, obj.id)

      const reRecorded = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'cor vermelha',
      })
      expect(reRecorded.status).toBe('dismissed')
    })

    it('explicitly reactivates a dismissed objection', async () => {
      const obj = await recordObjection(db, TENANT_A, CONTACT_A1, {
        objection: 'Prazo longo',
      })
      await dismissObjection(db, TENANT_A, obj.id)

      const reactivated = await reactivateObjection(db, TENANT_A, obj.id, 'manual')
      expect(reactivated.status).toBe('open')
      expect(reactivated.resolved_at).toBeNull()
    })
  })

  describe('4. Full Commercial Context Aggregator & Service', () => {
    it('aggregates profile, interests and objections in a single context call', async () => {
      await upsertLeadProfile(db, TENANT_A, CONTACT_A1, {
        summary: 'Lead quente',
        urgency: 'high',
        sentiment: 'positive',
      })
      await recordCatalogInterest(db, TENANT_A, CONTACT_A1, { catalog_item_id: ITEM_A1 })
      await recordObjection(db, TENANT_A, CONTACT_A1, { objection: 'Frete caro' })

      const context = await getCommercialContext(db, TENANT_A, CONTACT_A1)
      expect(context.profile?.summary).toBe('Lead quente')
      expect(context.interests.length).toBe(1)
      expect(context.objections.length).toBe(1)
    })

    it('LeadProfileService scoped operations', async () => {
      const service = new LeadProfileService(db, TENANT_A)

      const prof = await service.upsertProfile(CONTACT_A1, {
        summary: 'Scoped via service',
        urgency: 'medium',
      })
      expect(prof.summary).toBe('Scoped via service')

      const interest = await service.recordInterest(CONTACT_A1, { catalog_item_id: ITEM_A1 })
      expect(interest.status).toBe('active')

      const obj = await service.recordObjection(CONTACT_A1, { objection: 'Taxa alta' })
      expect(obj.status).toBe('open')

      const ctx = await service.getCommercialContext(CONTACT_A1)
      expect(ctx.profile?.summary).toBe('Scoped via service')
      expect(ctx.interests.length).toBe(1)
      expect(ctx.objections.length).toBe(1)
    })
  })
})
