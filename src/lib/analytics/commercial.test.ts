import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCommercialAnalytics } from './commercial';

describe('Commercial Analytics Aggregators', () => {
  const accountId = '00000000-0000-0000-0000-000000000001';

  it('aggregates lead scores, objections, interests, and tasks correctly', async () => {
    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'contact_lead_scores') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [{ score: 95 }, { score: 80 }, { score: 55 }, { score: 20 }],
              error: null,
            }),
          };
        }
        if (table === 'contact_objections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                { objection: 'Preço elevado', status: 'open' },
                { objection: 'Preço elevado', status: 'resolved' },
                { objection: 'Prazo longo', status: 'open' },
              ],
              error: null,
            }),
          };
        }
        if (table === 'contact_catalog_interests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  catalog_item_id: 'i1',
                  item: { id: 'i1', name: 'Falcon 2024', type: 'product' },
                },
                {
                  catalog_item_id: 'i1',
                  item: { id: 'i1', name: 'Falcon 2024', type: 'product' },
                },
                {
                  catalog_item_id: 'i2',
                  item: { id: 'i2', name: 'Consultoria', type: 'service' },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: 't1', status: 'pending', due_date: new Date(Date.now() + 86400000).toISOString() },
                { id: 't2', status: 'pending', due_date: new Date(Date.now() - 86400000).toISOString() },
                { id: 't3', status: 'completed', completed_at: new Date().toISOString() },
              ],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }),
    } as unknown as SupabaseClient;

    const res = await loadCommercialAnalytics(mockDb, accountId);

    // Lead Scores
    expect(res.leadScores.totalScored).toBe(4);
    expect(res.leadScores.avgScore).toBe(63); // (95 + 80 + 55 + 20) / 4 = 62.5 -> 63
    expect(res.leadScores.hotCount).toBe(2); // 95, 80
    expect(res.leadScores.warmCount).toBe(1); // 55
    expect(res.leadScores.coldCount).toBe(1); // 20

    // Objections
    expect(res.topObjections).toHaveLength(2);
    expect(res.topObjections[0].objection).toBe('Preço elevado');
    expect(res.topObjections[0].totalCount).toBe(2);
    expect(res.topObjections[0].resolutionRate).toBe(50);

    // Interests
    expect(res.topInterests).toHaveLength(2);
    expect(res.topInterests[0].itemName).toBe('Falcon 2024');
    expect(res.topInterests[0].interestCount).toBe(2);

    // Tasks
    expect(res.tasks.pending).toBe(2);
    expect(res.tasks.overdue).toBe(1);
    expect(res.tasks.completedToday).toBe(1);
  });
});
