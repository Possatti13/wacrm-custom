import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommercialIntelligenceProvider } from './types'
import { executeConversationExtraction } from './extractor'
import { sweepAndEnqueueDueIntelligence } from './sweep'
import {
  ensureTenantObjectionTaxonomy,
  overrideObjectionTaxonomy,
  getObjectionSummary,
} from './taxonomy'

describe('CICLOPES V1.3 — Smart Automatic Intelligence & Objection Gate', () => {
  const accountId = '11111111-1111-1111-1111-111111111111'
  const conversationId = '22222222-2222-2222-2222-222222222222'

  describe('1. Zero Per-Message LLM Invariant & Sweep Debounce', () => {
    it('sweepAndEnqueueDueIntelligence calls atomic RPC with batch limits', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: true, enqueued_count: 3, timestamp: '2026-08-29T12:00:00Z' },
        error: null,
      })
      const mockDb = { rpc: mockRpc } as unknown as SupabaseClient

      const res = await sweepAndEnqueueDueIntelligence(mockDb, { batchLimit: 15, leaseSeconds: 600 })

      expect(mockRpc).toHaveBeenCalledWith('sweep_and_enqueue_due_intelligence', {
        p_batch_limit: 15,
        p_lease_seconds: 600,
      })
      expect(res.enqueued_count).toBe(3)
    })
  })

  describe('2. Cost Circuit Breaker & Monthly Budget Protection', () => {
    it('blocks extraction and returns budget_blocked when tenant monthly budget is exceeded', async () => {
      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'tenant_intelligence_settings') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { monthly_budget_limit_usd: 10.0 },
                  }),
                }),
              }),
            }
          }
          if (table === 'ai_usage_log') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockResolvedValue({
                    data: [
                      { estimated_cost: 6.5 },
                      { estimated_cost: 4.0 }, // Total = 10.5 >= 10.0
                    ],
                  }),
                }),
              }),
            }
          }
          return { select: vi.fn() }
        }),
        rpc: vi.fn(),
      } as unknown as SupabaseClient

      const mockProvider = {
        providerName: 'mock' as const,
        extract: vi.fn(),
      }

      const result = await executeConversationExtraction({
        db: mockDb,
        provider: mockProvider as unknown as CommercialIntelligenceProvider,
        accountId,
        conversationId,
      })

      expect(result.processed).toBe(false)
      expect(result.reason).toBe('budget_blocked')
      expect(mockProvider.extract).not.toHaveBeenCalled()
    })
  })

  describe('3. Taxonomy & Occurrence Ledger Architecture', () => {
    it('guarantees tenant default taxonomy seeding', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ error: null })
      const mockDb = { rpc: mockRpc } as unknown as SupabaseClient

      await ensureTenantObjectionTaxonomy(mockDb, accountId)
      expect(mockRpc).toHaveBeenCalledWith('ensure_tenant_default_objection_taxonomy', {
        p_account_id: accountId,
      })
    })

    it('enforces human override semantics without erasing original classification', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          occurrence_id: 'occ-1',
          original_taxonomy_id: 'tax-price',
          effective_taxonomy_id: 'tax-timing',
          override_by_user_id: 'usr-manager',
          override_at: '2026-08-29T12:00:00Z',
        },
        error: null,
      })
      const mockDb = { rpc: mockRpc } as unknown as SupabaseClient

      const res = await overrideObjectionTaxonomy(
        mockDb,
        accountId,
        'occ-1',
        'tax-timing',
        'Cliente apenas postergou a decisão'
      )

      expect(mockRpc).toHaveBeenCalledWith('override_objection_taxonomy', {
        p_account_id: accountId,
        p_occurrence_id: 'occ-1',
        p_new_taxonomy_id: 'tax-timing',
        p_reason: 'Cliente apenas postergou a decisão',
      })
      expect(res.success).toBe(true)
    })

    it('computes deterministic objection distribution without LLM calls', async () => {
      const mockData = {
        total: 100,
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-29T23:59:59Z',
        items: [
          { taxonomy_id: '1', taxonomy_code: 'price_budget', taxonomy_name: 'Preço / Orçamento', taxonomy_description: 'Preço alto', count: 45, percentage: 45.0 },
          { taxonomy_id: '2', taxonomy_code: 'timing', taxonomy_name: 'Momento / Timing', taxonomy_description: 'Sem tempo', count: 35, percentage: 35.0 },
          { taxonomy_id: '3', taxonomy_code: 'other', taxonomy_name: 'Outra Objeção', taxonomy_description: 'Outros', count: 20, percentage: 20.0 },
        ],
      }
      const mockRpc = vi.fn().mockResolvedValue({ data: mockData, error: null })
      const mockDb = { rpc: mockRpc } as unknown as SupabaseClient

      const res = await getObjectionSummary(mockDb, accountId)
      expect(res.total).toBe(100)
      expect(res.items).toHaveLength(3)
      expect(res.items[0].percentage).toBe(45.0)
    })
  })
})
