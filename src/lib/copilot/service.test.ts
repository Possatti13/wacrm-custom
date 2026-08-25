import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runCopilotAction } from './service';

describe('Commercial Copilot Service', () => {
  const accountId = '00000000-0000-0000-0000-000000000001';
  const conversationId = '00000000-0000-0000-0000-000000000010';
  const contactId = '00000000-0000-0000-0000-000000000020';

  it('generates fallback summary when AI credential is not configured', async () => {
    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: 'm1', sender_type: 'customer', text_content: 'Quero saber o valor da moto' },
              ],
              error: null,
            }),
          };
        }
        if (table === 'catalog_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'c1', name: 'Falcon 2024', type: 'product' }],
              error: null,
            }),
          };
        }
        if (table === 'tenant_intelligence_settings' || table === 'ai_configs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    } as unknown as SupabaseClient;

    const res = await runCopilotAction(mockDb, accountId, {
      action: 'summarize',
      conversationId,
      contactId,
    });

    expect(res.action).toBe('summarize');
    expect(res.content).toContain('Perfil do Cliente');
  });

  it('generates fallback reply suggestion for agent', async () => {
    const mockDb = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    } as unknown as SupabaseClient;

    const res = await runCopilotAction(mockDb, accountId, {
      action: 'suggest_reply',
      conversationId,
      contactId,
    });

    expect(res.action).toBe('suggest_reply');
    expect(res.content).toContain('Olá! Tudo bem?');
  });
});
