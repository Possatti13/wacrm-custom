import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
const boundary = vi.hoisted(() => ({ requireRole: vi.fn(), ask: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: boundary.requireRole,
  toErrorResponse: (err: { status?: number }) =>
    new Response('{}', { status: err.status ?? 500 }),
}));
vi.mock('@/lib/analytics/ask-ciclopes/service', () => ({
  askCiclopes: boundary.ask,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
describe('Ask authorization and private navigation response', () => {
  it('uses only server account/user context and ignores arbitrary frontend identity', async () => {
    const db = {};
    boundary.requireRole.mockResolvedValue({
      accountId: 'tenant-authorized',
      userId: 'owner',
      role: 'owner',
      supabase: db,
    });
    boundary.ask.mockResolvedValue({
      opaqueEntities: {
        LEAD_1: {
          contact_id: 'contact-authorized',
          conversation_id: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    const response = await POST(
      new Request('https://fixture.invalid/api/manager/ask', {
        method: 'POST',
        body: JSON.stringify({
          question: 'Quem precisa de atenção?',
          accountId: 'cross-tenant',
          contactId: 'cross-contact',
          conversationId: 'cross-conversation',
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(boundary.requireRole).toHaveBeenCalledWith('admin');
    expect(boundary.ask).toHaveBeenCalledWith(db, {
      accountId: 'tenant-authorized',
      userId: 'owner',
      userRole: 'owner',
      question: 'Quem precisa de atenção?',
      threadId: undefined,
      forceRefresh: false,
    });
    expect(JSON.stringify(await response.json())).not.toContain('cross-');
  });
  for (const status of [401, 403]) {
    it(`never runs tools/provider after an authorization denial ${status}`, async () => {
      boundary.requireRole.mockRejectedValue({ status });
      const response = await POST(
        new Request('https://fixture.invalid/api/manager/ask', {
          method: 'POST',
          body: JSON.stringify({ question: 'Teste' }),
        })
      );
      expect(response.status).toBe(status);
      expect(boundary.ask).not.toHaveBeenCalled();
    });
  }
});
