import { describe, it, expect, beforeEach } from 'vitest'
import {
  createConversationInsight,
  supersedeConversationInsight,
  retractConversationInsight,
  getInsightWithEvidence,
  listConversationInsights,
  getUnanalyzedMessages,
  recordAnalysisRun,
  recordAnalyzedMessages,
  getAnalysisState,
  updateAnalysisState,
} from './repository'
import { ConversationInsightsService } from './service'
import type {
  ConversationInsight,
  ConversationInsightEvidence,
  ConversationAnalysisRun,
  ConversationAnalysisMessage,
  ConversationAnalysisState,
} from './types'

function createInMemoryInsightsDb() {
  const conversations: Array<{ id: string; account_id: string }> = []
  const messages: Array<{ id: string; conversation_id: string; content_text: string | null; created_at: string }> = []
  const catalogItems: Array<{ id: string; account_id: string; name: string; type: string; sku: string | null; status: string }> = []
  const insights: ConversationInsight[] = []
  const evidence: ConversationInsightEvidence[] = []
  const runs: ConversationAnalysisRun[] = []
  const analysisMessages: ConversationAnalysisMessage[] = []
  const states: ConversationAnalysisState[] = []

  let idCounter = 1
  const genId = () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, '0')}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    _state: { conversations, messages, catalogItems, insights, evidence, runs, analysisMessages, states },

    rpc: async (functionName: string, params: Record<string, unknown>) => {
      if (functionName === 'supersede_conversation_insight') {
        const orig = insights.find(
          (i) =>
            i.account_id === params.p_account_id &&
            i.conversation_id === params.p_conversation_id &&
            i.id === params.p_original_insight_id
        )
        if (!orig) {
          return { data: null, error: { message: 'Original insight not found' } }
        }
        if (orig.status !== 'active') {
          return { data: null, error: { message: 'Cannot supersede an insight that is not active' } }
        }

        // 1. Mark original superseded
        orig.status = 'superseded'
        orig.updated_at = new Date().toISOString()

        // 2. Insert new insight
        const newId = genId()
        const now = new Date().toISOString()
        const newInsight: ConversationInsight = {
          id: newId,
          account_id: params.p_account_id as string,
          conversation_id: params.p_conversation_id as string,
          insight_type: params.p_new_insight_type as ConversationInsight['insight_type'],
          value_text: (params.p_new_value_text as string) || null,
          value_json: (params.p_new_value_json as Record<string, unknown>) || {},
          catalog_item_id: (params.p_new_catalog_item_id as string) || null,
          confidence: (params.p_new_confidence as number) || null,
          source: (params.p_new_source as ConversationInsight['source']) || 'manual',
          status: 'active',
          supersedes_insight_id: orig.id,
          retracted_reason: null,
          analysis_run_id: null,
          dedupe_key: (params.p_new_dedupe_key as string) || null,
          observed_at: now,
          created_at: now,
          updated_at: now,
        }
        insights.push(newInsight)

        // 3. Insert evidence
        const evList = (params.p_evidence as Array<Record<string, unknown>>) || []
        for (const ev of evList) {
          evidence.push({
            id: genId(),
            account_id: params.p_account_id as string,
            conversation_id: params.p_conversation_id as string,
            insight_id: newId,
            message_id: ev.message_id as string,
            start_offset: (ev.start_offset as number) ?? null,
            end_offset: (ev.end_offset as number) ?? null,
            snippet: (ev.snippet as string) || null,
            created_at: now,
          })
        }

        return {
          data: {
            original_insight_id: orig.id,
            new_insight_id: newId,
            status: 'superseded',
          },
          error: null,
        }
      }

      if (functionName === 'retract_conversation_insight') {
        const orig = insights.find(
          (i) =>
            i.account_id === params.p_account_id &&
            i.conversation_id === params.p_conversation_id &&
            i.id === params.p_insight_id
        )
        if (!orig) {
          return { data: null, error: { message: 'Insight not found' } }
        }
        if (orig.status !== 'active') {
          return { data: null, error: { message: 'Cannot retract non-active insight' } }
        }
        orig.status = 'retracted'
        orig.retracted_reason = (params.p_retracted_reason as string) || 'Retracted'
        orig.updated_at = new Date().toISOString()
        return {
          data: {
            insight_id: orig.id,
            status: 'retracted',
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
        in: (field: string, vals: unknown[]) => {
          ;(builder._filters as Array<{ field: string; op: string; val: unknown }>).push({
            field,
            op: 'in',
            val: vals,
          })
          return builder
        },
        not: (field: string, op: string, val: unknown) => {
          ;(builder._filters as Array<{ field: string; op: string; val: unknown }>).push({
            field,
            op: 'not_' + op,
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
                if (f.op === 'in') return (f.val as unknown[]).includes(row[f.field])
                if (f.op === 'not_in') {
                  const rawList = String(f.val).replace(/^\(|\)$/g, '').split(',')
                  return !rawList.includes(String(row[f.field]))
                }
                return true
              })
            }

            // INSERT
            if (builder._action === 'insert') {
              const raw = builder._data
              const rows = Array.isArray(raw) ? raw : [raw]
              const insertedRows: Array<Record<string, unknown>> = []

              for (const item of rows) {
                const row = { ...(item as Record<string, unknown>) }
                row.id = row.id || genId()
                row.created_at = row.created_at || new Date().toISOString()
                row.updated_at = row.updated_at || new Date().toISOString()

                if (table === 'conversation_insights') {
                  insights.push(row as unknown as ConversationInsight)
                }
                if (table === 'conversation_insight_evidence') {
                  evidence.push(row as unknown as ConversationInsightEvidence)
                }
                if (table === 'conversation_analysis_runs') {
                  runs.push(row as unknown as ConversationAnalysisRun)
                }
                insertedRows.push(row)
              }

              if (builder._single) {
                return resolve({ data: insertedRows[0], error: null })
              }
              return resolve({ data: insertedRows, error: null })
            }

            // UPSERT
            if (builder._action === 'upsert') {
              const raw = builder._data
              const rows = Array.isArray(raw) ? raw : [raw]
              const upsertedRows: Array<Record<string, unknown>> = []

              for (const item of rows) {
                const row = { ...(item as Record<string, unknown>) }
                if (table === 'conversation_analysis_messages') {
                  const idx = analysisMessages.findIndex(
                    (m) =>
                      m.conversation_id === row.conversation_id &&
                      m.message_id === row.message_id &&
                      m.extractor_version === row.extractor_version
                  )
                  if (idx >= 0) {
                    Object.assign(analysisMessages[idx], row)
                    upsertedRows.push(analysisMessages[idx] as unknown as Record<string, unknown>)
                  } else {
                    analysisMessages.push(row as unknown as ConversationAnalysisMessage)
                    upsertedRows.push(row)
                  }
                }
                if (table === 'conversation_analysis_state') {
                  const idx = states.findIndex(
                    (s) =>
                      s.conversation_id === row.conversation_id &&
                      s.extractor_version === row.extractor_version
                  )
                  if (idx >= 0) {
                    Object.assign(states[idx], row)
                    upsertedRows.push(states[idx] as unknown as Record<string, unknown>)
                  } else {
                    states.push(row as unknown as ConversationAnalysisState)
                    upsertedRows.push(row)
                  }
                }
              }

              if (builder._single) {
                return resolve({ data: upsertedRows[0], error: null })
              }
              return resolve({ data: upsertedRows, error: null })
            }

            // SELECT
            if (builder._action === 'select') {
              let dataset: Array<Record<string, unknown>> = []
              if (table === 'conversation_insights') {
                dataset = insights.map((i) => {
                  const cat = catalogItems.find((c) => c.id === i.catalog_item_id && c.account_id === i.account_id)
                  return {
                    ...i,
                    catalog_items: cat || null,
                  }
                })
              }
              if (table === 'conversation_insight_evidence') dataset = evidence as unknown as Array<Record<string, unknown>>
              if (table === 'conversation_analysis_runs') dataset = runs as unknown as Array<Record<string, unknown>>
              if (table === 'conversation_analysis_messages') dataset = analysisMessages as unknown as Array<Record<string, unknown>>
              if (table === 'conversation_analysis_state') dataset = states as unknown as Array<Record<string, unknown>>
              if (table === 'messages') dataset = messages as unknown as Array<Record<string, unknown>>

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

              if (builder._single || builder._maybeSingle) {
                return resolve({ data: result[0] || null, error: null })
              }
              return resolve({ data: result, error: null })
            }

            // UPDATE
            if (builder._action === 'update') {
              let target: Record<string, unknown> | undefined
              if (table === 'conversation_insights') {
                target = insights.find((i) => matchFilter(i as unknown as Record<string, unknown>)) as unknown as Record<string, unknown>
              }
              if (!target) {
                return resolve({ data: null, error: null })
              }
              Object.assign(target, builder._data as Record<string, unknown>)
              return resolve({ data: target, error: null })
            }

            // DELETE
            if (builder._action === 'delete') {
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

describe('Conversation Insights, Evidence & Analysis State Repository', () => {
  const TENANT_A = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const TENANT_B = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_A1 = '33333333-1111-1111-1111-111111111111'
  const CONV_B1 = '33333333-2222-2222-2222-222222222222'
  const MSG_A1 = '44444444-1111-1111-1111-111111111111'
  const MSG_A2 = '44444444-1111-1111-1111-222222222222'
  const ITEM_A1 = '55555555-1111-1111-1111-111111111111'

  let db: ReturnType<typeof createInMemoryInsightsDb>

  beforeEach(() => {
    db = createInMemoryInsightsDb()
    db._state.conversations.push(
      { id: CONV_A1, account_id: TENANT_A },
      { id: CONV_B1, account_id: TENANT_B }
    )
    db._state.messages.push(
      { id: MSG_A1, conversation_id: CONV_A1, content_text: 'Olá, gostei da scooter X-13 mas achei o preço alto', created_at: '2026-08-19T10:00:00.000Z' },
      { id: MSG_A2, conversation_id: CONV_A1, content_text: 'Teria parcelamento em 12x?', created_at: '2026-08-19T10:05:00.000Z' }
    )
    db._state.catalogItems.push(
      { id: ITEM_A1, account_id: TENANT_A, name: 'X-13 Scooter', type: 'product', sku: 'SKU-X13', status: 'active' }
    )
  })

  describe('1. Insight Creation & Evidence Linking', () => {
    it('creates insight with multiple non-contiguous spans on same message', async () => {
      const insight = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'objection',
        value_text: 'preço alto',
        confidence: 0.95,
        source: 'intelligence',
        evidence: [
          { message_id: MSG_A1, start_offset: 43, end_offset: 53, snippet: 'preço alto' },
          { message_id: MSG_A1, start_offset: 0, end_offset: 4, snippet: 'Olá' },
        ],
      })

      expect(insight.id).toBeDefined()
      expect(insight.status).toBe('active')
      expect(insight.insight_type).toBe('objection')
      expect(insight.evidence.length).toBe(2)
      expect(insight.dedupe_key).toBeDefined()
    })

    it('returns existing active insight upon duplicate creation (idempotency)', async () => {
      const first = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'intent',
        value_text: 'compra',
        confidence: 0.9,
        evidence: [{ message_id: MSG_A1, start_offset: 6, end_offset: 25 }],
      })

      // Attempt second identical creation
      const second = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'intent',
        value_text: 'compra',
        confidence: 0.9,
        evidence: [{ message_id: MSG_A1, start_offset: 6, end_offset: 25 }],
      })

      expect(second.id).toBe(first.id)
    })

    it('creates different insights for same semantic value on different messages', async () => {
      const insight1 = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'intent',
        value_text: 'parcelamento',
        evidence: [{ message_id: MSG_A1 }],
      })

      const insight2 = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'intent',
        value_text: 'parcelamento',
        evidence: [{ message_id: MSG_A2 }],
      })

      expect(insight2.id).not.toBe(insight1.id)
      expect(insight2.dedupe_key).not.toBe(insight1.dedupe_key)

      const list = await listConversationInsights(db, TENANT_A, CONV_A1)
      expect(list.length).toBe(2)
    })
  })

  describe('2. Supersede & Retract Lifecycle Operations', () => {
    it('supersedes active insight atomically', async () => {
      const original = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'interest',
        catalog_item_id: ITEM_A1,
        confidence: 0.7,
        source: 'intelligence',
        evidence: [{ message_id: MSG_A1, start_offset: 14, end_offset: 26 }],
      })

      // Supersede with higher confidence and manual verification
      const successor = await supersedeConversationInsight(db, TENANT_A, CONV_A1, original.id, {
        new_insight_type: 'interest',
        new_catalog_item_id: ITEM_A1,
        new_confidence: 1.0,
        new_source: 'manual',
        evidence: [{ message_id: MSG_A1, start_offset: 14, end_offset: 26 }],
      })

      expect(successor.status).toBe('active')
      expect(successor.supersedes_insight_id).toBe(original.id)
      expect(successor.confidence).toBe(1.0)
      expect(successor.source).toBe('manual')

      // Check that original is now superseded
      const origLookup = await getInsightWithEvidence(db, TENANT_A, CONV_A1, original.id)
      expect(origLookup?.status).toBe('superseded')
    })

    it('retracts active insight with required reason', async () => {
      const insight = await createConversationInsight(db, TENANT_A, CONV_A1, {
        insight_type: 'objection',
        value_text: 'cor feia',
        source: 'intelligence',
        evidence: [{ message_id: MSG_A1 }],
      })

      const retracted = await retractConversationInsight(
        db,
        TENANT_A,
        CONV_A1,
        insight.id,
        'Cliente apenas comentou sobre a cor de outro veículo'
      )

      expect(retracted.status).toBe('retracted')
      expect(retracted.retracted_reason).toBe(
        'Cliente apenas comentou sobre a cor de outro veículo'
      )
    })
  })

  describe('3. Versioned Analysis Ledger & Checkpoint', () => {
    it('manages unanalyzed messages per extractor version', async () => {
      // Initially, MSG_A1 and MSG_A2 are unanalyzed under v1
      const unanalyzedV1 = await getUnanalyzedMessages(db, TENANT_A, CONV_A1, 'v1')
      expect(unanalyzedV1.length).toBe(2)

      // Record analysis run and mark MSG_A1 as analyzed under v1
      const run = await recordAnalysisRun(db, TENANT_A, CONV_A1, {
        status: 'completed',
        messagesCount: 1,
        insightsCount: 1,
        extractorVersion: 'v1',
      })

      await recordAnalyzedMessages(db, TENANT_A, CONV_A1, [MSG_A1], run.id, 'v1')

      // Now only MSG_A2 is unanalyzed under v1
      const remainingV1 = await getUnanalyzedMessages(db, TENANT_A, CONV_A1, 'v1')
      expect(remainingV1.length).toBe(1)
      expect(remainingV1[0].id).toBe(MSG_A2)

      // Under v2, both MSG_A1 and MSG_A2 remain unanalyzed
      const unanalyzedV2 = await getUnanalyzedMessages(db, TENANT_A, CONV_A1, 'v2')
      expect(unanalyzedV2.length).toBe(2)
    })

    it('updates and retrieves conversation analysis state checkpoint', async () => {
      await updateAnalysisState(db, TENANT_A, CONV_A1, 'v1', {
        lastAnalyzedMessageCreatedAt: '2026-08-19T10:00:00.000Z',
        lastAnalyzedMessageId: MSG_A1,
      })

      const state = await getAnalysisState(db, TENANT_A, CONV_A1, 'v1')
      expect(state?.extractor_version).toBe('v1')
      expect(state?.last_analyzed_message_id).toBe(MSG_A1)
    })

    it('ConversationInsightsService wrapper operations', async () => {
      const service = new ConversationInsightsService(db, TENANT_A)

      const ins = await service.createInsight(CONV_A1, {
        insight_type: 'urgency',
        value_text: 'high',
        evidence: [{ message_id: MSG_A1 }],
      })
      expect(ins.insight_type).toBe('urgency')

      const list = await service.listInsights(CONV_A1)
      expect(list.length).toBe(1)
    })
  })
})
