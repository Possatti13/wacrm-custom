import { describe, expect, it, vi } from 'vitest';
import { buildFactPacket, computeFactPacketFingerprint } from './fact-packet';
import { executePlannedTools } from './tool-registry';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAskWhatsAppHref, resolveAskDrilldown } from './actionability';
import type { Fact, FactDrilldownRef, OpaqueLeadEntity } from './types';

const conversationId = '11111111-1111-4111-8111-111111111111';
const attention = {
  contact_id: 'contact-a',
  contact_name: 'Contato A',
  contact_phone: '+351912345678',
  conversation_id: conversationId,
  score: 85,
  score_tier: 'hot',
  reason_code: 'hot_lead_no_action',
  reason_label: 'Sem próxima ação',
  responsible_user_name: 'Ana',
  signal_text: 'Perguntou sobre financiamento',
};
const build = (
  toolOutputs: Parameters<typeof buildFactPacket>[0]['toolOutputs']
) =>
  buildFactPacket({
    question: 'Quem precisa de atenção?',
    period: { range: '30d' },
    toolOutputs,
  });

describe('Ask private operational identity', () => {
  it('preserves the authorized conversation and available attributes without adding them to provider facts', () => {
    const result = build({ 'manager.attention': { items: [attention] } });
    expect(result.privateEntityMap.LEAD_1).toMatchObject({
      conversation_id: conversationId,
      score_tier: 'hot',
      responsible_user_name: 'Ana',
      signal_text: attention.signal_text,
    });
    const providerJson = JSON.stringify(result.providerFactPacket);
    expect(providerJson).not.toContain(conversationId);
    expect(providerJson).not.toContain(attention.contact_id);
    expect(providerJson).not.toContain(attention.contact_phone);
    expect(providerJson).not.toContain(attention.contact_name);
  });
  it('does not change the factual fingerprint when only navigation identity changes', () => {
    const first = build({ 'manager.attention': { items: [attention] } });
    const second = build({
      'manager.attention': {
        items: [
          {
            ...attention,
            conversation_id: '22222222-2222-4222-8222-222222222222',
          },
        ],
      },
    });
    expect(computeFactPacketFingerprint(first.providerFactPacket)).toBe(
      computeFactPacketFingerprint(second.providerFactPacket)
    );
    expect(second.privateEntityMap.LEAD_1).toHaveProperty(
      'conversation_id',
      '22222222-2222-4222-8222-222222222222'
    );
  });
  it('keeps separate tokens for attention and coaching instead of overwriting a lead', () => {
    const result = build({
      'manager.attention': { items: [attention] },
      'manager.coaching_opportunities': {
        items: [
          {
            contact_id: 'contact-b',
            contact_name: 'Contato B',
            conversation_id: '22222222-2222-4222-8222-222222222222',
            primary_reason: 'Aguardando retorno',
            lead_score: null,
            secondary_signals: [],
            category: 'unanswered_customer',
          },
        ],
      },
    });
    expect(Object.values(result.privateEntityMap)).toHaveLength(2);
    expect(result.privateEntityMap.LEAD_1.contact_id).toBe('contact-a');
    expect(result.privateEntityMap.LEAD_2).toMatchObject({
      contact_id: 'contact-b',
      conversation_id: '22222222-2222-4222-8222-222222222222',
      score: null,
    });
    expect(
      result.providerFactPacket.facts.map((f) => f.metadata?.lead_token)
    ).toEqual(['LEAD_1', 'LEAD_2']);
  });
  it('never derives missing conversation identity from free text', () => {
    const result = build({
      'manager.attention': {
        items: [
          {
            ...attention,
            conversation_id: undefined,
            reason_label: conversationId,
          },
        ],
      },
    });
    expect(result.privateEntityMap.LEAD_1.conversation_id).toBeUndefined();
  });
  it('ignores a tool argument accountId and injects only the authorized server tenant', async () => {
    const rpc = vi.fn(async () => ({
      data: { items: [attention] },
      error: null,
    }));
    const result = await executePlannedTools(
      { rpc } as unknown as SupabaseClient,
      'authorized-account',
      'owner',
      [
        {
          tool_name: 'manager.attention',
          args: { accountId: 'other-tenant', p_account_id: 'other-tenant' },
        },
      ],
      { range: '30d' }
    );
    expect(rpc).toHaveBeenCalledWith(
      'get_manager_attention_queue',
      expect.objectContaining({ p_account_id: 'authorized-account' })
    );
    expect(build(result).privateEntityMap.LEAD_1.contact_id).toBe('contact-a');
  });
  it('denies non-manager tool access before any query', async () => {
    const rpc = vi.fn();
    await expect(
      executePlannedTools(
        { rpc } as unknown as SupabaseClient,
        'account',
        'agent' as 'owner',
        [{ tool_name: 'manager.attention', args: {} }],
        { range: '30d' }
      )
    ).rejects.toThrow(/not authorized/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('Grounded Ask presentation destinations', () => {
  for (const type of [
    'attention',
    'objections',
    'products',
    'team',
    'coaching',
    'deals',
  ] as const) {
    it(`connects the existing ${type} destination from facts`, () => {
      const ref = { type };
      const fact: Fact = {
        fact_id: 'F1',
        metric: 'test',
        label: 'Test',
        value: 1,
        source: 'tool',
        drilldown_ref: ref,
      };
      const destination = resolveAskDrilldown(
        { label: 'Model title', drilldown_ref: ref },
        [fact],
        {}
      );
      expect(destination).toBeTruthy();
      expect(type === 'deals' ? destination?.href : destination?.section).toBe(
        type === 'deals' ? '/pipelines' : type
      );
    });
  }
  it('binds a model lead token only to the fact-backed private entity', () => {
    const ref = {
      type: 'attention',
      filter: { lead_token: 'LEAD_1' },
    } as const;
    const fact: Fact = {
      fact_id: 'F1',
      metric: 'attention_lead',
      label: 'Lead',
      value: 85,
      source: 'manager.attention',
      drilldown_ref: ref,
    };
    const entity = {
      lead_token: 'LEAD_1',
      contact_id: 'c',
      contact_name: 'Nome',
      conversation_id: conversationId,
    };
    expect(
      resolveAskDrilldown({ label: 'Lead', drilldown_ref: ref }, [fact], {
        LEAD_1: entity,
      })?.href
    ).toBe(`/inbox?c=${conversationId}`);
    expect(
      resolveAskDrilldown(
        {
          label: 'Unknown',
          drilldown_ref: {
            type: 'attention',
            filter: { lead_token: 'LEAD_9' },
          },
        },
        [fact],
        { LEAD_1: entity }
      )
    ).toBeNull();
    expect(
      resolveAskDrilldown({ label: 'Missing', drilldown_ref: ref }, [fact], {})
    ).toBeNull();
  });
  it('does not guess a destination from an unknown ref, filter or model answer', () => {
    const ref = {
      type: 'unknown',
      filter: { accountId: 'other' },
    } as unknown as FactDrilldownRef;
    expect(
      resolveAskDrilldown({ label: conversationId, drilldown_ref: ref }, [], {})
    ).toBeNull();
  });
  it('requires a usable taxonomy code for the existing objection drawer', () => {
    const ref: FactDrilldownRef = {
      type: 'objections',
      taxonomy_id: 'id-only',
    };
    expect(
      resolveAskDrilldown(
        { label: 'Objection', drilldown_ref: ref },
        [
          {
            fact_id: 'F1',
            metric: 'objection',
            label: 'Objection',
            value: 1,
            source: 'tool',
            drilldown_ref: ref,
          },
        ],
        {}
      )
    ).toBeNull();
  });
  it('keeps formatted canonical international BR digits but never inserts a country code', () => {
    const entity: OpaqueLeadEntity = {
      lead_token: 'LEAD_1',
      contact_id: 'c',
      contact_name: 'Contato',
      phone: '5513987654321',
    };
    expect(getAskWhatsAppHref(entity)).toBe('https://wa.me/5513987654321');
    expect(getAskWhatsAppHref({ ...entity, phone: '13987654321' })).toBeNull();
    expect(
      getAskWhatsAppHref({ ...entity, contact_name: 'Cliente Teste' })
    ).toBeNull();
    expect(getAskWhatsAppHref(entity, true)).toBeNull();
  });
});
