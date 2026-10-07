import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import { executeOnDemandAiAction } from '@/lib/intelligence/on-demand';
import { IntelligenceActionError } from '@/lib/intelligence/errors';

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({ supabase: {}, accountId: 'account', userId: 'user' })),
  toErrorResponse: vi.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
}));
vi.mock('@/lib/intelligence/on-demand', () => ({ executeOnDemandAiAction: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it.each([
  ['INTELLIGENCE_DISABLED', 403],
  ['ANALYSIS_IN_PROGRESS', 409],
  ['AI_BUDGET_EXCEEDED', 429],
  ['ANALYSIS_FAILED', 502],
] as const)('returns the explicit safe status for %s', async (code, status) => {
  vi.mocked(executeOnDemandAiAction).mockRejectedValue(new IntelligenceActionError(code, status, 'Safe message', { cause: new Error('private details') }));
  const res = await POST(new Request('http://test/api/ai/on-demand', { method: 'POST', body: JSON.stringify({ targetType: 'conversation', actionType: 'analyze_conversation', targetId: 'target' }) }));
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: 'Safe message', code });
});
