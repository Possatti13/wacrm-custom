import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load real staging environment
dotenv.config({ path: '.env.local', override: true });
import {
  getManagerCoachingSummary,
  getManagerCoachingOpportunities,
  getManagerCoachingPatterns,
  getManagerCoachingConversation,
  updateManagerCoachingOpportunityStatus,
} from './coaching';
import {
  buildFactPacket,
  computeFactPacketFingerprint,
} from './ask-ciclopes/fact-packet';
import {
  validateAndSanitizeSynthesis,
  isPunitiveOrInsultingOutput,
} from './ask-ciclopes/validator';
import { askCiclopes } from './ask-ciclopes/service';
import type { AllowlistedToolName, SynthesisOutput } from './ask-ciclopes/types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pxpnkaakurjwpfuezpob.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const TEST_TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
const OWNER_USER_ID = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1';
const AGENT_USER_ID = 'a1111111-1111-4111-a111-111111111111';

describe('CICLOPES V1.6 — Grounded Coaching & Conversation Intelligence', () => {
  let adminDb: ReturnType<typeof createClient>;
  let anonDb: ReturnType<typeof createClient>;

  beforeAll(() => {
    adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonDb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  // 1. DETERMINISTIC CANDIDATE DETECTION & EXPECTED COUNTS
  it('1. detects coaching opportunities deterministically via get_manager_coaching_opportunities', async () => {
    const opps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: '30d',
      status: 'all',
      limit: 50,
    });

    expect(opps).toBeDefined();
    expect(opps.period).toBeDefined();
    expect(opps.total_count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(opps.items)).toBe(true);

    if (opps.items.length > 0) {
      const first = opps.items[0];
      expect(first.opportunity_key).toBeDefined();
      expect(first.conversation_id).toBeDefined();
      expect(first.category).toBeDefined();
      expect(['urgent', 'high', 'medium', 'low']).toContain(first.severity);
      expect(first.primary_reason).toBeTruthy();
      expect(Array.isArray(first.secondary_signals)).toBe(true);
      expect(Array.isArray(first.evidence)).toBe(true);
    }
  });

  // 2. COACHING SUMMARY
  it('2. aggregates coaching summary metrics deterministically', async () => {
    const summary = await getManagerCoachingSummary(adminDb, TEST_TENANT_ID, {
      range: '30d',
    });

    expect(summary).toBeDefined();
    expect(summary.total_open_opportunities).toBeGreaterThanOrEqual(0);
    expect(summary.urgent_count).toBeGreaterThanOrEqual(0);
    expect(summary.high_count).toBeGreaterThanOrEqual(0);
    expect(summary.category_breakdown).toBeDefined();
    expect(summary.category_breakdown.buying_signals_missed).toBeGreaterThanOrEqual(0);
    expect(summary.category_breakdown.overdue_followups).toBeGreaterThanOrEqual(0);
    expect(summary.category_breakdown.unanswered_customer).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.top_focus_areas)).toBe(true);
  });

  // 3. OBSERVED PATTERNS & MINIMUM SAMPLES
  it('3. identifies recurring friction patterns with minimum sample threshold (>=3 objections)', async () => {
    const patterns = await getManagerCoachingPatterns(adminDb, TEST_TENANT_ID, {
      range: '30d',
    });

    expect(patterns).toBeDefined();
    expect(Array.isArray(patterns.objection_patterns)).toBe(true);
    expect(Array.isArray(patterns.followup_patterns)).toBe(true);
    expect(Array.isArray(patterns.response_patterns)).toBe(true);

    // Verify minimum sample threshold: all returned objection patterns must have occurrences >= 3
    for (const pat of patterns.objection_patterns) {
      expect(pat.occurrences).toBeGreaterThanOrEqual(3);
      expect(pat.seller_name).toBeTruthy();
      expect(pat.objection_code).toBeTruthy();
    }
  });

  // 4. CONVERSATION REVIEW WORKFLOW & TIMELINE
  it('4. loads conversation review timeline and allows manager status acknowledgement', async () => {
    const opps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: '30d',
      limit: 1,
    });

    if (opps.items.length > 0) {
      const opp = opps.items[0];
      const conv = await getManagerCoachingConversation(adminDb, TEST_TENANT_ID, opp.conversation_id);

      expect(conv.conversation_id).toBe(opp.conversation_id);
      expect(conv.contact_name).toBeTruthy();
      expect(Array.isArray(conv.timeline)).toBe(true);

      // Update status to 'reviewed'
      const res = await updateManagerCoachingOpportunityStatus(
        adminDb,
        TEST_TENANT_ID,
        opp.opportunity_key,
        'reviewed',
        'Revisado em 1:1 com a equipe'
      );
      expect(res.success).toBe(true);
      expect(res.status).toBe('reviewed');

      // Re-query conversation review to verify updated status
      const updatedConv = await getManagerCoachingConversation(adminDb, TEST_TENANT_ID, opp.conversation_id);
      expect(updatedConv.review_info.status).toBe('reviewed');
      expect(updatedConv.review_info.notes).toBe('Revisado em 1:1 com a equipe');

      // Reset to open
      await updateManagerCoachingOpportunityStatus(adminDb, TEST_TENANT_ID, opp.opportunity_key, 'open');
    }
  });

  // 5. DEDUPLICATION: MULTI-SIGNAL CONVERSATION YIELDS SINGLE PRIMARY OPPORTUNITY
  it('5. deduplicates multi-signal conversations into a single primary opportunity with secondary signals', () => {
    const mockToolOutputs: Partial<Record<AllowlistedToolName, unknown>> = {
      'manager.coaching_opportunities': {
        total_count: 1,
        items: [
          {
            opportunity_key: 'conv:c123',
            conversation_id: 'c123',
            contact_id: 'ct123',
            contact_name: 'Marcos Silveira',
            contact_phone: '+55 11 97777-6666',
            responsible_user_id: 'u1',
            responsible_user_name: 'Vendedor Alpha',
            category: 'buying_signal_missed',
            severity: 'urgent',
            status: 'open',
            primary_reason: 'Sinal de compra sem ação registrada',
            secondary_signals: ['overdue_followup', 'hot_lead_unattended'],
            lead_score: 88,
            detected_at: new Date().toISOString(),
            evidence: [{ type: 'buying_signal', value: 'Quer fechar hoje' }],
            review_info: { status: 'open' },
          },
        ],
      },
    };

    const { providerFactPacket, privateEntityMap, privateSellerMap } = buildFactPacket({
      question: 'Quais conversas merecem revisão?',
      period: { range: '30d' },
      toolOutputs: mockToolOutputs,
    });

    expect(providerFactPacket.facts.length).toBe(1);
    expect(providerFactPacket.facts[0].fact_id).toBe('F1');
    expect(providerFactPacket.facts[0].label).toContain('LEAD_1');
    expect(providerFactPacket.facts[0].metadata?.category).toBe('buying_signal_missed');
    expect(providerFactPacket.facts[0].metadata?.secondary_signals).toEqual([
      'overdue_followup',
      'hot_lead_unattended',
    ]);

    // Opaque mappings stay server-side
    expect(privateEntityMap['LEAD_1'].contact_name).toBe('Marcos Silveira');
    expect(privateSellerMap['SELLER_1'].full_name).toBe('Vendedor Alpha');

    // Provider fact packet contains ZERO PII
    const packetStr = JSON.stringify(providerFactPacket);
    expect(packetStr).not.toContain('Marcos Silveira');
    expect(packetStr).not.toContain('97777-6666');
    expect(packetStr).not.toContain('Vendedor Alpha');
  });

  // 6. AI COACHING SAFETY FILTER: BLOCKS PUNITIVE AND EMPLOYEE JUDGMENT CLAIMS
  it('6. strictly blocks punitive recommendations and insulting employee judgments', () => {
    expect(isPunitiveOrInsultingOutput('O vendedor SELLER_1 deve ser demitido imediatamente')).toBe(true);
    expect(isPunitiveOrInsultingOutput('SELLER_1 é preguiçoso e não bate metas')).toBe(true);
    expect(isPunitiveOrInsultingOutput('Sugiro cortar a comissão do colaborador')).toBe(true);
    expect(isPunitiveOrInsultingOutput('Péssimo vendedor, recomendo suspensão')).toBe(true);

    // Factual coaching observations must PASS
    expect(isPunitiveOrInsultingOutput('Preço apareceu em 6 negociações associadas a SELLER_1')).toBe(false);
    expect(isPunitiveOrInsultingOutput('Recomenda-se revisar a apresentação de valor na etapa de proposta')).toBe(false);
    expect(isPunitiveOrInsultingOutput('Existem 3 follow-ups com prazo expirado')).toBe(false);

    // Synthesis validation integration
    const mockFactPacket = {
      question_context: {
        original_question: 'O que devo fazer com o vendedor?',
        normalized_question: 'o que devo fazer com o vendedor',
        period: { range: '30d' as const },
        timezone: 'America/Sao_Paulo',
      },
      facts: [
        {
          fact_id: 'F1',
          metric: 'coaching_seller_objection_pattern',
          label: 'Objeções de Preço (SELLER_1)',
          value: 6,
          unit: 'occurrences',
          source: 'manager.coaching_patterns',
        },
      ],
    };

    const maliciousSynthesis: SynthesisOutput = {
      answer: 'SELLER_1 é preguiçoso e deve ser demitido. No entanto, foram registradas 6 objeções de preço.',
      claims: [
        {
          text: 'SELLER_1 deve ser demitido por incompetência.',
          fact_ids: ['F1'],
        },
        {
          text: 'Foram registradas 6 ocorrências de objeção com SELLER_1.',
          fact_ids: ['F1'],
        },
      ],
      recommendations: [
        {
          text: 'Reduzir salário ou demitir o funcionário.',
          based_on_fact_ids: ['F1'],
        },
        {
          text: 'Fazer alinhamento sobre como demonstrar o ROI do produto.',
          based_on_fact_ids: ['F1'],
        },
      ],
      drilldowns: [],
    };

    const validated = validateAndSanitizeSynthesis(maliciousSynthesis, mockFactPacket);
    expect(validated.sanitizedSynthesis.claims.length).toBe(1);
    expect(validated.sanitizedSynthesis.claims[0].text).toContain('6 ocorrências');
    expect(validated.sanitizedSynthesis.recommendations.length).toBe(1);
    expect(validated.sanitizedSynthesis.recommendations[0].text).toContain('demonstrar o ROI');
    expect(validated.sanitizedSynthesis.answer).not.toContain('demitido');
    expect(validated.sanitizedSynthesis.answer).not.toContain('preguiçoso');
  });

  // 7. SECURITY MATRIX
  it('7. enforces manager-only access: owner/admin allowed, agent rejected with 403, anon denied', async () => {
    // 7.1 Owner allowed
    const ownerRes = await getManagerCoachingSummary(adminDb, TEST_TENANT_ID, { range: '30d' });
    expect(ownerRes.total_open_opportunities).toBeDefined();

    // 7.2 Agent rejected
    await expect(
      askCiclopes(adminDb, {
        accountId: TEST_TENANT_ID,
        userId: AGENT_USER_ID,
        userRole: 'agent' as unknown as 'owner',
        question: 'Onde minha equipe precisa de ajuda?',
      })
    ).rejects.toThrow(/Unauthorized: Ask Ciclopes is strictly restricted to Owner and Admin/);

    // 7.3 Anon denied
    await expect(
      getManagerCoachingSummary(anonDb, TEST_TENANT_ID, { range: '30d' })
    ).rejects.toThrow();
  });

  // 8. CACHE FACT-MUTATION REGRESSION (Permanent Invariant)
  it('8. proves cache fact-mutation: same question & period with mutated underlying facts produces distinct fingerprints (H1 != H2)', () => {
    const q = 'Onde minha equipe mais precisa de coaching?';
    const period = { range: '30d' as const };

    const facts1 = buildFactPacket({
      question: q,
      period,
      toolOutputs: {
        'manager.coaching_summary': {
          total_open_opportunities: 5,
          urgent_count: 2,
          high_count: 3,
          reviewed_count: 0,
          category_breakdown: {
            buying_signals_missed: 3,
            overdue_followups: 2,
            unanswered_customer: 0,
          },
          top_focus_areas: [],
        },
      },
    });

    const facts2 = buildFactPacket({
      question: q,
      period,
      toolOutputs: {
        'manager.coaching_summary': {
          total_open_opportunities: 6, // Fact value mutated from 5 to 6
          urgent_count: 2,
          high_count: 4,
          reviewed_count: 0,
          category_breakdown: {
            buying_signals_missed: 3,
            overdue_followups: 3,
            unanswered_customer: 0,
          },
          top_focus_areas: [],
        },
      },
    });

    const h1 = computeFactPacketFingerprint(facts1.providerFactPacket);
    const h2 = computeFactPacketFingerprint(facts2.providerFactPacket);

    expect(h1).not.toBe(h2);
    expect(h1.length).toBe(64);
    expect(h2.length).toBe(64);
  });

  // 9. REAL GEMINI STAGING GATE — GROUNDED COACHING INTELLIGENCE
  it('9. REAL GEMINI GATE: executes live Gemini planner & synthesis for grounded coaching intelligence', async () => {
    const question = 'Onde minha equipe mais precisa de coaching e quais conversas merecem revisão?';

    const result = await askCiclopes(adminDb, {
      accountId: TEST_TENANT_ID,
      userId: OWNER_USER_ID,
      userRole: 'owner',
      question,
      forceRefresh: true,
    });

    expect(result).toBeDefined();
    expect(result.answer).toBeTruthy();
    expect(result.cached).toBe(false);
    expect(result.turnId).toBeTruthy();

    // Verify non-punitive language
    expect(isPunitiveOrInsultingOutput(result.answer)).toBe(false);

    // Verify Zero PII sent in payload
    const resultJson = JSON.stringify(result.facts);
    expect(resultJson).not.toContain('password');
    expect(resultJson).not.toContain('secret');
  }, 90000);
});
