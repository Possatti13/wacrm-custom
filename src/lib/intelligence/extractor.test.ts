import { describe, it, expect, beforeEach } from 'vitest'
import { executeConversationExtraction } from './extractor'
import { MockStructuredExtractor } from './providers/mock'
import type {
  ClaimRunResult,
  FinalizeBatchResult,
} from './types'

function createInMemoryExtractorDb() {
  const runs: Array<Record<string, unknown>> = []
  const insights: Array<Record<string, unknown>> = []
  const evidence: Array<Record<string, unknown>> = []
  const messagesLedger: Array<Record<string, unknown>> = []
  const state: Array<Record<string, unknown>> = []

  let idCounter = 1
  const genId = () => `00000000-0000-0000-0000-${String(idCounter++).padStart(12, '0')}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    _state: { runs, insights, evidence, messagesLedger, state },

    rpc: async (functionName: string, params: Record<string, unknown>) => {
      const now = new Date().toISOString()
      const accountId = params.p_account_id as string
      const convId = params.p_conversation_id as string

      if (functionName === 'claim_conversation_analysis_run') {
        const runId = genId()
        const msgId = '44444444-4444-4444-4444-444444444444'

        const claimResult: ClaimRunResult = {
          status: 'claimed',
          run_id: runId,
          account_id: accountId,
          conversation_id: convId,
          extractor_version: (params.p_extractor_version as string) || 'v1',
          prompt_version: 'v1',
          input_fingerprint: 'mock-fingerprint',
          lease_expires_at: new Date(Date.now() + 300000).toISOString(),
          config_revision: {
            id: '22222222-2222-2222-2222-222222222222',
            revision_number: 1,
            snapshot_hash: 'hash-1',
            snapshot: {
              schemaVersion: 1,
              intents: [{ id: '1', key: 'purchase', label: 'Compra', description: null, status: 'active', sort_order: 0, metadata: {} }],
              attributes: [],
              context: { company_description: null, commercial_objectives: null, qualification_guidelines: null, prohibited_assumptions: null, terminology_notes: null, metadata: {} },
              terminology: { contact_label_singular: 'Lead', contact_label_plural: 'Leads', catalog_item_label_singular: 'Item', catalog_item_label_plural: 'Itens', metadata: {} },
            },
          },
          catalog_context: {
            id: '33333333-3333-3333-3333-333333333333',
            context_hash: 'cat-hash-1',
            snapshot: [
              {
                id: '55555555-5555-5555-5555-555555555555',
                name: 'Scooter X-13',
                type: 'product',
                sku: 'SKU-X13',
                terms: [{ term: 'X-13', normalized_term: 'x 13', kind: 'alias' }],
              },
            ],
          },
          messages: [
            {
              id: msgId,
              sender_type: 'customer',
              content_text: 'Olá! Gostei muito da scooter X-13, mas achei o preço alto.',
              created_at: now,
            },
          ],
          analyzed_message_ids: [msgId],
          first_message: { id: msgId, created_at: now },
          last_message: { id: msgId, created_at: now },
        }

        runs.push({
          id: runId,
          account_id: accountId,
          conversation_id: convId,
          status: 'processing',
          extractor_version: params.p_extractor_version || 'v1',
          created_at: now,
        })

        return { data: claimResult, error: null }
      }

      if (functionName === 'persist_conversation_analysis_batch') {
        const runId = params.p_run_id as string
        const run = runs.find((r) => r.id === runId)
        if (run) {
          run.status = 'completed'
          run.completed_at = now
        }

        const res: FinalizeBatchResult = {
          status: 'completed',
          run_id: runId,
          insights_count: 2,
        }
        return { data: res, error: null }
      }

      if (functionName === 'fail_conversation_analysis_run') {
        const runId = params.p_run_id as string
        const run = runs.find((r) => r.id === runId)
        if (run) {
          run.status = 'failed'
          run.error_code = params.p_error_code as string
          run.error_message = params.p_error_message as string
        }
        return { data: { status: 'failed', run_id: runId }, error: null }
      }

      return { data: null, error: { message: `Unknown RPC ${functionName}` } }
    },
  }

  return client
}

describe('Intelligence Extractor Orchestration', () => {
  const TENANT_A = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_A1 = '33333333-1111-1111-1111-111111111111'

  let db: ReturnType<typeof createInMemoryExtractorDb>

  beforeEach(() => {
    db = createInMemoryExtractorDb()
  })

  it('orchestrates end-to-end extraction successfully with Mock provider', async () => {
    const provider = new MockStructuredExtractor()

    const result = await executeConversationExtraction({
      db,
      provider,
      accountId: TENANT_A,
      conversationId: CONV_A1,
    })

    expect(result.processed).toBe(true)
    expect(result.reason).toBe('succeeded')
    expect(result.runId).toBeDefined()
    expect(result.insightsCount).toBe(2)

    const completedRun = db._state.runs.find((r: Record<string, unknown>) => r.id === result.runId)
    expect(completedRun?.status).toBe('completed')
  })

  it('handles provider failure gracefully and marks run failed', async () => {
    const provider = new MockStructuredExtractor(undefined, true) // shouldFail = true

    const result = await executeConversationExtraction({
      db,
      provider,
      accountId: TENANT_A,
      conversationId: CONV_A1,
    })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('failed')
    expect(result.error).toContain('Mock extraction provider failure')

    const failedRun = db._state.runs.find((r: Record<string, unknown>) => r.id === result.runId)
    expect(failedRun?.status).toBe('failed')
  })
})
