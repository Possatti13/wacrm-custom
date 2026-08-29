import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_OBJECTION_TAXONOMY_CODES,
  ensureTenantObjectionTaxonomy,
  listTenantObjectionTaxonomy,
  overrideObjectionTaxonomy,
  getObjectionSummary,
} from './taxonomy'

describe('Objection Taxonomy Domain Service (V1.3)', () => {
  it('defines the 9 canonical default commercial objection codes', () => {
    const codes = DEFAULT_OBJECTION_TAXONOMY_CODES.map((c) => c.code)
    expect(codes).toEqual([
      'price_budget',
      'payment_financing',
      'timing',
      'competition',
      'trust',
      'decision_authority',
      'fit_requirements',
      'availability_delivery',
      'other',
    ])
  })

  it('calls ensure_tenant_default_objection_taxonomy RPC properly', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ error: null })
    const mockDb = { rpc: mockRpc } as any

    await ensureTenantObjectionTaxonomy(mockDb, 'acc-123')
    expect(mockRpc).toHaveBeenCalledWith('ensure_tenant_default_objection_taxonomy', {
      p_account_id: 'acc-123',
    })
  })

  it('lists active taxonomy categories for account ordered by position', async () => {
    const mockData = [
      { id: 'tax-1', code: 'price_budget', name: 'Preço / Orçamento', position: 10, is_active: true },
      { id: 'tax-2', code: 'timing', name: 'Momento / Timing', position: 20, is_active: true },
    ]
    const mockSelect = vi.fn().mockReturnThis()
    const mockEq1 = vi.fn().mockReturnThis()
    const mockEq2 = vi.fn().mockReturnThis()
    const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null })

    const mockDb = {
      from: vi.fn(() => ({
        select: mockSelect,
        eq: (col: string, val: any) => {
          if (col === 'account_id') return { eq: mockEq2 }
          return { order: mockOrder }
        },
      })),
    } as any

    // Test with simpler mock structure
    const simpleDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
            }),
          }),
        }),
      }),
    } as any

    const res = await listTenantObjectionTaxonomy(simpleDb, 'acc-123')
    expect(res).toHaveLength(2)
    expect(res[0].code).toBe('price_budget')
  })

  it('calls override_objection_taxonomy RPC with reason', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: { success: true, effective_taxonomy_id: 'tax-override' },
      error: null,
    })
    const mockDb = { rpc: mockRpc } as any

    const res = await overrideObjectionTaxonomy(
      mockDb,
      'acc-123',
      'occ-456',
      'tax-override',
      'Cliente falou de juros'
    )

    expect(mockRpc).toHaveBeenCalledWith('override_objection_taxonomy', {
      p_account_id: 'acc-123',
      p_occurrence_id: 'occ-456',
      p_new_taxonomy_id: 'tax-override',
      p_reason: 'Cliente falou de juros',
    })
    expect(res.success).toBe(true)
  })

  it('calls get_objection_summary RPC with scoping filters', async () => {
    const mockSummary = {
      total: 10,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
      items: [
        { taxonomy_id: 'tax-1', taxonomy_code: 'price_budget', taxonomy_name: 'Preço / Orçamento', count: 6, percentage: 60 },
        { taxonomy_id: 'tax-2', taxonomy_code: 'other', taxonomy_name: 'Outra Objeção', count: 4, percentage: 40 },
      ],
    }

    const mockRpc = vi.fn().mockResolvedValue({ data: mockSummary, error: null })
    const mockDb = { rpc: mockRpc } as any

    const res = await getObjectionSummary(mockDb, 'acc-123', {
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
      catalogItemId: 'item-999',
      sellerUserId: 'seller-777',
    })

    expect(mockRpc).toHaveBeenCalledWith('get_objection_summary', {
      p_account_id: 'acc-123',
      p_from: '2026-08-01T00:00:00Z',
      p_to: '2026-08-31T23:59:59Z',
      p_catalog_item_id: 'item-999',
      p_seller_user_id: 'seller-777',
    })
    expect(res.total).toBe(10)
    expect(res.items).toHaveLength(2)
  })
})
