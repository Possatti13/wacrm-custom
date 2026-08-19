import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveCommercialIntent,
  archiveCommercialIntent,
  listCommercialIntents,
  saveCommercialAttributeDefinition,
  archiveCommercialAttributeDefinition,
  listCommercialAttributeDefinitions,
  saveTenantCommercialContext,
  getTenantCommercialContext,
  saveTenantCommercialTerminology,
  getTenantCommercialTerminology,
  getLatestConfigRevision,
  listConfigRevisions,
} from './repository'
import { CommercialConfigService } from './service'
import { buildCanonicalSnapshot, computeSnapshotHash } from './snapshot'
import type {
  CommercialIntent,
  CommercialAttributeDefinition,
  TenantCommercialContext,
  TenantCommercialTerminology,
  TenantConfigRevision,
  SelectOption,
} from './types'

function createInMemoryConfigDb() {
  const intents: CommercialIntent[] = []
  const attributes: CommercialAttributeDefinition[] = []
  const contexts: TenantCommercialContext[] = []
  const terminologies: TenantCommercialTerminology[] = []
  const revisions: TenantConfigRevision[] = []

  let idCounter = 1
  const genId = () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, '0')}`

  const bumpRevision = (accountId: string, summary: string) => {
    const accIntents = intents.filter((i) => i.account_id === accountId)
    const accAttrs = attributes.filter((a) => a.account_id === accountId)
    const accCtx = contexts.find((c) => c.account_id === accountId) || null
    const accTerm = terminologies.find((t) => t.account_id === accountId) || null

    const snapshot = buildCanonicalSnapshot({
      intents: accIntents,
      attributes: accAttrs,
      context: accCtx,
      terminology: accTerm,
    })

    const hash = computeSnapshotHash(snapshot)
    const accRevs = revisions.filter((r) => r.account_id === accountId)
    const nextRevNum = accRevs.length > 0 ? Math.max(...accRevs.map((r) => r.revision_number)) + 1 : 1

    const rev: TenantConfigRevision = {
      id: genId(),
      account_id: accountId,
      revision_number: nextRevNum,
      snapshot_schema_version: 1,
      snapshot,
      snapshot_hash: hash,
      change_summary: summary,
      created_by: null,
      created_at: new Date().toISOString(),
    }

    revisions.push(rev)
    return {
      revision_id: rev.id,
      revision_number: rev.revision_number,
      snapshot_hash: rev.snapshot_hash,
      snapshot: rev.snapshot,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    _state: { intents, attributes, contexts, terminologies, revisions },

    rpc: async (functionName: string, params: Record<string, unknown>) => {
      const now = new Date().toISOString()
      const accountId = params.p_account_id as string

      if (functionName === 'save_commercial_intent') {
        const id = (params.p_id as string) || genId()
        const existingIdx = intents.findIndex((i) => i.account_id === accountId && (i.id === id || i.key === params.p_key))

        let intentId = id
        if (existingIdx >= 0) {
          intentId = intents[existingIdx].id
          intents[existingIdx].label = params.p_label as string
          intents[existingIdx].description = (params.p_description as string) || null
          intents[existingIdx].status = (params.p_status as CommercialIntent['status']) || 'active'
          intents[existingIdx].sort_order = (params.p_sort_order as number) || 0
          intents[existingIdx].metadata = (params.p_metadata as Record<string, unknown>) || {}
          intents[existingIdx].updated_at = now
        } else {
          intents.push({
            id: intentId,
            account_id: accountId,
            key: params.p_key as string,
            label: params.p_label as string,
            description: (params.p_description as string) || null,
            status: (params.p_status as CommercialIntent['status']) || 'active',
            sort_order: (params.p_sort_order as number) || 0,
            metadata: (params.p_metadata as Record<string, unknown>) || {},
            created_at: now,
            updated_at: now,
          })
        }

        const rev = bumpRevision(accountId, (params.p_change_summary as string) || `Saved intent ${params.p_key}`)
        return {
          data: {
            intent_id: intentId,
            key: params.p_key,
            status: params.p_status || 'active',
            revision: rev,
          },
          error: null,
        }
      }

      if (functionName === 'save_commercial_attribute_definition') {
        const id = (params.p_id as string) || genId()
        const existingIdx = attributes.findIndex((a) => a.account_id === accountId && (a.id === id || a.key === params.p_key))

        let attrId = id
        if (existingIdx >= 0) {
          attrId = attributes[existingIdx].id
          attributes[existingIdx].label = params.p_label as string
          attributes[existingIdx].description = (params.p_description as string) || null
          attributes[existingIdx].options = (params.p_options as SelectOption[]) || []
          attributes[existingIdx].status = (params.p_status as CommercialAttributeDefinition['status']) || 'active'
          attributes[existingIdx].sort_order = (params.p_sort_order as number) || 0
          attributes[existingIdx].metadata = (params.p_metadata as Record<string, unknown>) || {}
          attributes[existingIdx].updated_at = now
        } else {
          attributes.push({
            id: attrId,
            account_id: accountId,
            key: params.p_key as string,
            label: params.p_label as string,
            description: (params.p_description as string) || null,
            value_type: params.p_value_type as CommercialAttributeDefinition['value_type'],
            options: (params.p_options as SelectOption[]) || [],
            status: (params.p_status as CommercialAttributeDefinition['status']) || 'active',
            sort_order: (params.p_sort_order as number) || 0,
            metadata: (params.p_metadata as Record<string, unknown>) || {},
            created_at: now,
            updated_at: now,
          })
        }

        const rev = bumpRevision(accountId, (params.p_change_summary as string) || `Saved attribute ${params.p_key}`)
        return {
          data: {
            attribute_id: attrId,
            key: params.p_key,
            status: params.p_status || 'active',
            revision: rev,
          },
          error: null,
        }
      }

      if (functionName === 'save_tenant_commercial_context') {
        const existingIdx = contexts.findIndex((c) => c.account_id === accountId)
        const ctxData: TenantCommercialContext = {
          account_id: accountId,
          company_description: (params.p_company_description as string) || null,
          commercial_objectives: (params.p_commercial_objectives as string) || null,
          qualification_guidelines: (params.p_qualification_guidelines as string) || null,
          prohibited_assumptions: (params.p_prohibited_assumptions as string) || null,
          terminology_notes: (params.p_terminology_notes as string) || null,
          metadata: (params.p_metadata as Record<string, unknown>) || {},
          created_at: now,
          updated_at: now,
        }

        if (existingIdx >= 0) {
          contexts[existingIdx] = ctxData
        } else {
          contexts.push(ctxData)
        }

        const rev = bumpRevision(accountId, (params.p_change_summary as string) || 'Saved context')
        return {
          data: {
            account_id: accountId,
            status: 'saved',
            revision: rev,
          },
          error: null,
        }
      }

      if (functionName === 'save_tenant_commercial_terminology') {
        const existingIdx = terminologies.findIndex((t) => t.account_id === accountId)
        const termData: TenantCommercialTerminology = {
          account_id: accountId,
          contact_label_singular: (params.p_contact_label_singular as string) || 'Contato',
          contact_label_plural: (params.p_contact_label_plural as string) || 'Contatos',
          catalog_item_label_singular: (params.p_catalog_item_label_singular as string) || 'Produto / Serviço',
          catalog_item_label_plural: (params.p_catalog_item_label_plural as string) || 'Produtos e Serviços',
          metadata: (params.p_metadata as Record<string, unknown>) || {},
          created_at: now,
          updated_at: now,
        }

        if (existingIdx >= 0) {
          terminologies[existingIdx] = termData
        } else {
          terminologies.push(termData)
        }

        const rev = bumpRevision(accountId, (params.p_change_summary as string) || 'Saved terminology')
        return {
          data: {
            account_id: accountId,
            status: 'saved',
            revision: rev,
          },
          error: null,
        }
      }

      return { data: null, error: { message: `Unknown RPC ${functionName}` } }
    },

    from: (table: string) => {
      const builder: Record<string, unknown> = {
        _table: table,
        _action: 'select',
        _filters: [] as Array<{ field: string; op: string; val: unknown }>,
        _order: [] as Array<{ field: string; ascending: boolean }>,
        _limit: null as number | null,
        _single: false,
        _maybeSingle: false,

        select: () => builder,
        eq: (field: string, val: unknown) => {
          ;(builder._filters as Array<{ field: string; op: string; val: unknown }>).push({ field, op: 'eq', val })
          return builder
        },
        order: (field: string, opts?: { ascending?: boolean }) => {
          ;(builder._order as Array<{ field: string; ascending: boolean }>).push({
            field,
            ascending: opts?.ascending ?? true,
          })
          return builder
        },
        limit: (n: number) => {
          builder._limit = n
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

            let dataset: Array<Record<string, unknown>> = []
            if (table === 'commercial_intents') dataset = intents as unknown as Array<Record<string, unknown>>
            if (table === 'commercial_attribute_definitions') dataset = attributes as unknown as Array<Record<string, unknown>>
            if (table === 'tenant_commercial_context') dataset = contexts as unknown as Array<Record<string, unknown>>
            if (table === 'tenant_commercial_terminology') dataset = terminologies as unknown as Array<Record<string, unknown>>
            if (table === 'tenant_config_revisions') dataset = revisions as unknown as Array<Record<string, unknown>>

            let result = dataset.filter(matchFilter)

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

            if (builder._limit) {
              result = result.slice(0, builder._limit as number)
            }

            if (builder._single || builder._maybeSingle) {
              return resolve({ data: result[0] || null, error: null })
            }
            return resolve({ data: result, error: null })
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

describe('Tenant Commercial Config Repository & Service', () => {
  const TENANT_A = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const TENANT_B = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  let db: ReturnType<typeof createInMemoryConfigDb>

  beforeEach(() => {
    db = createInMemoryConfigDb()
  })

  describe('1. Intents Management & Revisions', () => {
    it('creates intent and generates initial monotonic revision 1 with snapshot', async () => {
      const res = await saveCommercialIntent(db, TENANT_A, {
        key: 'purchase',
        label: 'Compra de Produto',
        description: 'Interesse explícito em comprar',
      })

      expect(res.intent.key).toBe('purchase')
      expect(res.intent.status).toBe('active')
      expect(res.revision.revision_number).toBe(1)
      expect(res.revision.snapshot_hash).toBeDefined()

      const list = await listCommercialIntents(db, TENANT_A)
      expect(list.length).toBe(1)

      const latestRev = await getLatestConfigRevision(db, TENANT_A)
      expect(latestRev?.revision_number).toBe(1)
      expect(latestRev?.snapshot.intents.length).toBe(1)
    })

    it('increments revision number monotonically on subsequent intent saves', async () => {
      await saveCommercialIntent(db, TENANT_A, {
        key: 'purchase',
        label: 'Compra',
      })

      const res2 = await saveCommercialIntent(db, TENANT_A, {
        key: 'financing',
        label: 'Financiamento',
      })

      expect(res2.revision.revision_number).toBe(2)

      const revs = await listConfigRevisions(db, TENANT_A)
      expect(revs.length).toBe(2)
      expect(revs[0].revision_number).toBe(2)
      expect(revs[1].revision_number).toBe(1)
    })

    it('archives intent and preserves archived entity in the canonical snapshot', async () => {
      const created = await saveCommercialIntent(db, TENANT_A, {
        key: 'old_intent',
        label: 'Intent Antigo',
      })

      const archived = await archiveCommercialIntent(db, TENANT_A, created.intent.id)
      expect(archived.intent.status).toBe('archived')
      expect(archived.revision.revision_number).toBe(2)

      const activeOnly = await listCommercialIntents(db, TENANT_A, { status: 'active' })
      expect(activeOnly.length).toBe(0)

      const latestRev = await getLatestConfigRevision(db, TENANT_A)
      expect(latestRev?.snapshot.intents.length).toBe(1)
      expect(latestRev?.snapshot.intents[0].status).toBe('archived')
    })
  })

  describe('2. Attribute Definitions & Multi-Tenant Isolation', () => {
    it('creates attribute definitions with select options and bumps revision', async () => {
      const res = await saveCommercialAttributeDefinition(db, TENANT_A, {
        key: 'payment_preference',
        label: 'Preferência de Pagamento',
        value_type: 'single_select',
        options: [
          { key: 'cash', label: 'À vista' },
          { key: 'financing', label: 'Financiamento' },
        ],
      })

      expect(res.attribute.key).toBe('payment_preference')
      expect(res.attribute.options.length).toBe(2)
      expect(res.revision.revision_number).toBe(1)

      const list = await listCommercialAttributeDefinitions(db, TENANT_A)
      expect(list.length).toBe(1)
    })

    it('maintains strict multi-tenant isolation for configurations and revisions', async () => {
      await saveCommercialIntent(db, TENANT_A, {
        key: 'intent_tenant_a',
        label: 'Intent A',
      })

      await saveCommercialIntent(db, TENANT_B, {
        key: 'intent_tenant_b',
        label: 'Intent B',
      })

      const listA = await listCommercialIntents(db, TENANT_A)
      const listB = await listCommercialIntents(db, TENANT_B)

      expect(listA.length).toBe(1)
      expect(listA[0].key).toBe('intent_tenant_a')

      expect(listB.length).toBe(1)
      expect(listB[0].key).toBe('intent_tenant_b')

      const revA = await getLatestConfigRevision(db, TENANT_A)
      const revB = await getLatestConfigRevision(db, TENANT_B)

      expect(revA?.revision_number).toBe(1)
      expect(revB?.revision_number).toBe(1)
      expect(revA?.snapshot.intents[0].key).toBe('intent_tenant_a')
      expect(revB?.snapshot.intents[0].key).toBe('intent_tenant_b')
    })

    it('archives attribute definition and increments revision', async () => {
      const created = await saveCommercialAttributeDefinition(db, TENANT_A, {
        key: 'old_attr',
        label: 'Atributo Antigo',
        value_type: 'text',
      })

      const archived = await archiveCommercialAttributeDefinition(db, TENANT_A, created.attribute.id)
      expect(archived.attribute.status).toBe('archived')
      expect(archived.revision.revision_number).toBe(2)
    })
  })

  describe('3. Context & Terminology Management', () => {
    it('saves and retrieves tenant business context and terminology', async () => {
      await saveTenantCommercialContext(db, TENANT_A, {
        company_description: 'Venda de veículos elétricos',
        commercial_objectives: 'Qualificar leads para test drive',
      })

      await saveTenantCommercialTerminology(db, TENANT_A, {
        contact_label_singular: 'Lead',
        contact_label_plural: 'Leads',
        catalog_item_label_singular: 'Veículo',
        catalog_item_label_plural: 'Veículos',
      })

      const ctx = await getTenantCommercialContext(db, TENANT_A)
      const term = await getTenantCommercialTerminology(db, TENANT_A)

      expect(ctx?.company_description).toBe('Venda de veículos elétricos')
      expect(term?.catalog_item_label_singular).toBe('Veículo')

      const latestRev = await getLatestConfigRevision(db, TENANT_A)
      expect(latestRev?.revision_number).toBe(2)
      expect(latestRev?.snapshot.context.company_description).toBe('Venda de veículos elétricos')
      expect(latestRev?.snapshot.terminology.catalog_item_label_singular).toBe('Veículo')
    })
  })

  describe('4. CommercialConfigService Scoped Wrapper', () => {
    it('operates seamlessly with service instance', async () => {
      const service = new CommercialConfigService(db, TENANT_A)

      await service.saveIntent({
        key: 'purchase',
        label: 'Compra',
      })

      await service.saveAttribute({
        key: 'budget',
        label: 'Orçamento',
        value_type: 'number',
      })

      const validatedAttrs = await service.validateAttributes({
        budget: 25000,
      })
      expect(validatedAttrs).toEqual({ budget: 25000 })

      const validatedIntent = await service.validateCurrentIntent('purchase')
      expect(validatedIntent).toBe('purchase')
    })
  })
})
