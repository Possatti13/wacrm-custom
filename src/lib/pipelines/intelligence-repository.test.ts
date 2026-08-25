import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listPendingStageSuggestions,
  createStageSuggestion,
  applyStageSuggestion,
  dismissStageSuggestion,
} from './intelligence-repository';

describe('Pipeline Intelligence Repository', () => {
  const accountId = '00000000-0000-0000-0000-000000000001';
  const dealId = '00000000-0000-0000-0000-000000000010';
  const suggestionId = '00000000-0000-0000-0000-000000000020';
  const stageFromId = '00000000-0000-0000-0000-000000000001';
  const stageToId = '00000000-0000-0000-0000-000000000002';

  it('lists pending stage suggestions for an account', async () => {
    const mockSuggestions = [
      {
        id: suggestionId,
        account_id: accountId,
        deal_id: dealId,
        suggested_stage_id: stageToId,
        current_stage_id: stageFromId,
        status: 'pending',
        reason: 'Cliente aceitou a proposta formal na conversa',
      },
    ];

    const mockSelect = vi.fn().mockReturnThis();
    const mockEq1 = vi.fn().mockReturnThis();
    const mockEq2 = vi.fn().mockReturnThis();
    const mockOrder = vi.fn().mockResolvedValue({ data: mockSuggestions, error: null });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: mockSelect.mockReturnValue({
          eq: mockEq1.mockImplementation(() => ({
            eq: mockEq2.mockReturnValue({
              order: mockOrder,
            }),
          })),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await listPendingStageSuggestions(mockDb, accountId);
    expect(res).toHaveLength(1);
    expect(res[0].reason).toContain('Cliente aceitou');
  });

  it('creates stage suggestion', async () => {
    const mockCreated = {
      id: suggestionId,
      account_id: accountId,
      deal_id: dealId,
      suggested_stage_id: stageToId,
      current_stage_id: stageFromId,
      reason: 'Sinal de intenção de compra confirmado',
      status: 'pending',
    };

    const mockInsert = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({ data: mockCreated, error: null });

    const mockDb = {
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
        select: mockSelect,
        single: mockSingle,
      }),
    } as unknown as SupabaseClient;

    const res = await createStageSuggestion(mockDb, accountId, {
      deal_id: dealId,
      suggested_stage_id: stageToId,
      current_stage_id: stageFromId,
      reason: 'Sinal de intenção de compra confirmado',
    });

    expect(res.id).toBe(suggestionId);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: accountId,
        deal_id: dealId,
        status: 'pending',
      })
    );
  });

  it('applies stage suggestion via atomic RPC', async () => {
    const mockUpdatedDeal = {
      id: dealId,
      stage_id: stageToId,
      title: 'Venda Falcon 2024',
    };

    const mockRpc = vi.fn().mockResolvedValue({ data: mockUpdatedDeal, error: null });

    const mockDb = {
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const deal = await applyStageSuggestion(mockDb, accountId, suggestionId);
    expect(deal.id).toBe(dealId);
    expect(mockRpc).toHaveBeenCalledWith('apply_deal_stage_suggestion', {
      p_account_id: accountId,
      p_suggestion_id: suggestionId,
    });
  });

  it('dismisses stage suggestion via RPC', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

    const mockDb = {
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    await dismissStageSuggestion(mockDb, accountId, suggestionId);
    expect(mockRpc).toHaveBeenCalledWith('dismiss_deal_stage_suggestion', {
      p_account_id: accountId,
      p_suggestion_id: suggestionId,
    });
  });
});
