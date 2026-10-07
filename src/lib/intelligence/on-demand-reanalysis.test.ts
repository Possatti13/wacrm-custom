import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeOnDemandAiAction } from './on-demand';
import { executeConversationExtraction } from './extractor';
import { projectContactCommercialState } from '@/lib/projector/repository';
import { loadIntelligenceCredential } from './credentials';

const { scoreContact } = vi.hoisted(() => ({ scoreContact: vi.fn() }));
vi.mock('./extractor', () => ({ executeConversationExtraction: vi.fn() }));
vi.mock('@/lib/projector/repository', () => ({ projectContactCommercialState: vi.fn() }));
vi.mock('./credentials', () => ({ loadIntelligenceCredential: vi.fn() }));
vi.mock('@/lib/scoring/service', () => ({ LeadScoringService: class {
  constructor(public db: SupabaseClient) {}
  scoreContact = (...args: unknown[]) => scoreContact(this.db, ...args);
} }));

const accountId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const conversationId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const contactId = 'cccccccc-cccc-4ccc-accc-cccccccccccc';
const requestId = 'dddddddd-dddd-4ddd-addd-dddddddddddd';
const params = { accountId, userId: accountId, targetType: 'conversation' as const,
  targetId: conversationId, actionType: 'analyze_conversation' as const, forceRefresh: true };

function client() {
  const rpc = vi.fn().mockResolvedValue({ data: { status: 'claimed', request: { id: requestId },
    provider: 'gemini', model: 'gemini-3.5-flash-lite' }, error: null });
  const from = vi.fn((table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: table === 'conversations' ? { contact_id: contactId }
      : table === 'tenant_intelligence_settings' ? { provider: 'gemini', model: 'gemini-3.5-flash-lite' } : null, error: null }),
    order: async () => ({ data: [], error: null }),
  }) }) }));
  return { db: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadIntelligenceCredential).mockResolvedValue({ apiKey: 'test-only', provider: 'gemini' });
  vi.mocked(executeConversationExtraction).mockResolvedValue({ processed: true, reason: 'succeeded', insightsCount: 4 });
  vi.mocked(projectContactCommercialState).mockResolvedValue({} as Awaited<ReturnType<typeof projectContactCommercialState>>);
  scoreContact.mockResolvedValue({});
});

describe('manual commercial reanalysis authorization and truthful completion', () => {
  it('keeps the authenticated claim gate and reports disabled intelligence explicitly', async () => {
    const user = client(), worker = client();
    user.rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'Intelligence features are disabled' } });
    await expect(executeOnDemandAiAction(user.db, { ...params, adminDb: worker.db }))
      .rejects.toMatchObject({ status: 403, code: 'INTELLIGENCE_DISABLED' });
    expect(user.rpc).toHaveBeenCalledWith('claim_internal_ai_request', expect.objectContaining({ p_account_id: accountId }));
    expect(worker.rpc).not.toHaveBeenCalled();
    expect(executeConversationExtraction).not.toHaveBeenCalled();
  });

  it('does not execute privileged work after target or role authorization fails', async () => {
    const user = client(), worker = client();
    user.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Access denied' } });
    await expect(executeOnDemandAiAction(user.db, { ...params, adminDb: worker.db })).rejects.toThrow();
    expect(worker.rpc).not.toHaveBeenCalled();
    expect(executeConversationExtraction).not.toHaveBeenCalled();
  });

  it('runs extraction, projection and scoring through the worker after the user claim succeeds', async () => {
    const user = client(), worker = client();
    await executeOnDemandAiAction(user.db, { ...params, adminDb: worker.db });
    expect(executeConversationExtraction).toHaveBeenCalledWith(expect.objectContaining({ db: worker.db, accountId, conversationId, model: 'gemini-3.5-flash-lite' }));
    expect(projectContactCommercialState).toHaveBeenCalledWith(worker.db, { accountId, contactId, triggerSource: 'on_demand' });
    expect(scoreContact).toHaveBeenCalledWith(worker.db, accountId, contactId, 'on_demand');
    expect(worker.rpc).toHaveBeenCalledWith('complete_internal_ai_request', expect.objectContaining({ p_request_id: requestId }));
    expect(user.rpc.mock.calls.map(c => c[0])).toEqual(['claim_internal_ai_request']);
  });

  it('does not complete an extraction that failed or was budget-blocked', async () => {
    for (const reason of ['failed', 'budget_blocked'] as const) {
      const user = client(), worker = client();
      vi.mocked(executeConversationExtraction).mockResolvedValue({ processed: false, reason, error: 'Real extraction failed' });
      await expect(executeOnDemandAiAction(user.db, { ...params, adminDb: worker.db })).rejects.toThrow();
      expect(worker.rpc).toHaveBeenCalledWith('fail_internal_ai_request', expect.objectContaining({ p_request_id: requestId }));
      expect(worker.rpc.mock.calls.map(c => c[0])).not.toContain('complete_internal_ai_request');
    }
    expect(projectContactCommercialState).not.toHaveBeenCalled();
    expect(scoreContact).not.toHaveBeenCalled();
  });

  it.each(['projection', 'scoring'])('does not hide a %s persistence failure', async stage => {
    const user = client(), worker = client();
    if (stage === 'projection') vi.mocked(projectContactCommercialState).mockRejectedValue(new Error('Projection persistence failed'));
    else scoreContact.mockRejectedValue(new Error('Score persistence failed'));
    await expect(executeOnDemandAiAction(user.db, { ...params, adminDb: worker.db })).rejects.toThrow(/persistence failed/);
    expect(worker.rpc).toHaveBeenCalledWith('fail_internal_ai_request', expect.anything());
    expect(worker.rpc.mock.calls.map(c => c[0])).not.toContain('complete_internal_ai_request');
  });

  it('marks a claimed request failed if credential loading fails', async () => {
    const user = client(), worker = client();
    vi.mocked(loadIntelligenceCredential).mockRejectedValue(new Error('Credential is missing'));
    await expect(executeOnDemandAiAction(user.db, { ...params, adminDb: worker.db })).rejects.toThrow('Credential is missing');
    expect(worker.rpc).toHaveBeenCalledWith('fail_internal_ai_request', expect.anything());
    expect(executeConversationExtraction).not.toHaveBeenCalled();
  });
});
