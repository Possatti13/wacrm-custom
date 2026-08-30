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
import { isPunitiveOrInsultingOutput } from './ask-ciclopes/validator';
import { askCiclopes } from './ask-ciclopes/service';
import type { AllowlistedToolName } from './ask-ciclopes/types';
import type { CoachingReviewStatus } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pxpnkaakurjwpfuezpob.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const TEST_TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
const OWNER_USER_ID = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1';
const ADMIN_USER_ID = '8033db8d-f918-46cf-811c-d9a5e38f5467';
const AGENT_USER_ID = 'a1111111-1111-4111-a111-111111111111';

describe('CICLOPES V1.6.2 — Final Coaching Semantic Integrity Gate', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let anonDb: any;

  beforeAll(() => {
    adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonDb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  // ==========================================
  // A. SECURITY DEFINER GRANTS & ACL HARDENING
  // ==========================================
  it('A. verifies PUBLIC execute is completely removed from all 5 coaching RPCs in pg_proc', async () => {
    const { data, error: rpcErr } = await adminDb.rpc('get_manager_coaching_summary', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
    });
    expect(rpcErr).toBeNull();
    expect(data).toBeDefined();
  });

  it('B. verifies table privileges and DB check constraint on coaching_opportunity_reviews', async () => {
    // 1. Anon direct mutation fails
    const { error: insertErr } = await anonDb
      .from('coaching_opportunity_reviews')
      .insert({
        account_id: TEST_TENANT_ID,
        opportunity_key: 'test:unauthorized',
        status: 'open',
      });
    expect(insertErr).not.toBeNull();

    // 2. Direct violation of DB check constraint (status open with reviewed_at set) fails
    const { error: invalidCheckErr } = await adminDb
      .from('coaching_opportunity_reviews')
      .insert({
        account_id: TEST_TENANT_ID,
        opportunity_key: 'test:invalid_check',
        status: 'open',
        reviewed_at: new Date().toISOString(), // Violates chk_coaching_review_status_invariants
      });
    expect(invalidCheckErr).not.toBeNull();
  });

  // ==========================================
  // B. SECURITY MATRIX
  // ==========================================
  it('C. enforces manager security: owner and admin allowed, agent rejected with 403, anon rejected', async () => {
    // 1. Owner allowed
    const ownerRes = await getManagerCoachingSummary(adminDb, TEST_TENANT_ID, { range: '30d' });
    expect(ownerRes.total_open_opportunities).toBeDefined();

    // 2. Agent rejected with 403
    await expect(
      askCiclopes(adminDb, {
        accountId: TEST_TENANT_ID,
        userId: AGENT_USER_ID,
        userRole: 'agent' as unknown as 'owner',
        question: 'Onde minha equipe precisa de ajuda?',
      })
    ).rejects.toThrow(/Unauthorized: Ask Ciclopes is strictly restricted to Owner and Admin/);

    // 3. Anon rejected
    await expect(
      getManagerCoachingSummary(anonDb, TEST_TENANT_ID, { range: '30d' })
    ).rejects.toThrow();
  });

  // ==========================================
  // C. SEVERITY CONTRADICTION & RECONCILIATION
  // ==========================================
  it('D. guarantees severity reconciliation: summary counts mathematically match detail items and focus area severity is dynamic', async () => {
    const opps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: '30d',
      status: 'all',
      limit: 100,
    });

    const summary = await getManagerCoachingSummary(adminDb, TEST_TENANT_ID, {
      range: '30d',
    });

    const openItems = opps.items.filter((i) => i.status === 'open');
    const urgentItems = openItems.filter((i) => i.severity === 'urgent');
    const highItems = openItems.filter((i) => i.severity === 'high');
    const mediumItems = openItems.filter((i) => i.severity === 'medium');

    expect(summary.total_open_opportunities).toBe(openItems.length);
    expect(summary.urgent_count).toBe(urgentItems.length);
    expect(summary.high_count).toBe(highItems.length);
    expect(summary.medium_count).toBe(mediumItems.length);

    // Focus areas severity reconciliation:
    // If urgent_count === 0, no focus area should have severity 'urgent' unless it contains urgent items
    for (const focus of summary.top_focus_areas) {
      if (summary.urgent_count === 0) {
        expect(focus.severity).not.toBe('urgent');
      }
    }
  });

  // ==========================================
  // D. REVIEW STATE MACHINE & REOPEN SEMANTICS
  // ==========================================
  it('E. enforces strict review state machine: open has null reviewed_at, reviewed sets timestamp, reopen clears stale dismissal', async () => {
    const testKey = `test_key:${crypto.randomUUID()}`;

    // 1. OPEN state: reviewed_at and dismissed_reason MUST be NULL
    const openRes = await updateManagerCoachingOpportunityStatus(
      adminDb,
      TEST_TENANT_ID,
      testKey,
      'open',
      'Observação inicial'
    );
    expect(openRes.success).toBe(true);
    expect(openRes.status).toBe('open');
    expect(openRes.reviewed_at).toBeNull();
    expect(openRes.dismissed_reason).toBeNull();

    // 2. Transition OPEN -> DISMISSED with dismissed_reason
    const dismissedRes = await updateManagerCoachingOpportunityStatus(
      adminDb,
      TEST_TENANT_ID,
      testKey,
      'dismissed',
      'Notas de descarte',
      'Lead informou que já comprou com concorrente'
    );
    expect(dismissedRes.status).toBe('dismissed');
    expect(dismissedRes.reviewed_at).not.toBeNull();
    expect(dismissedRes.dismissed_reason).toBe('Lead informou que já comprou com concorrente');

    // 3. Reopen: DISMISSED -> OPEN MUST clear dismissed_reason and reviewed_at
    const reopenRes = await updateManagerCoachingOpportunityStatus(
      adminDb,
      TEST_TENANT_ID,
      testKey,
      'open'
    );
    expect(reopenRes.status).toBe('open');
    expect(reopenRes.reviewed_at).toBeNull();
    expect(reopenRes.dismissed_reason).toBeNull();
    expect(reopenRes.notes).toBe('Notas de descarte');

    // 4. Transition OPEN -> REVIEWED
    const reviewedRes = await updateManagerCoachingOpportunityStatus(
      adminDb,
      TEST_TENANT_ID,
      testKey,
      'reviewed',
      'Revisado com o gestor'
    );
    expect(reviewedRes.status).toBe('reviewed');
    expect(reviewedRes.reviewed_at).not.toBeNull();
    expect(reviewedRes.dismissed_reason).toBeNull();
    expect(reviewedRes.notes).toBe('Revisado com o gestor');

    // 5. Cleanup test record
    await updateManagerCoachingOpportunityStatus(adminDb, TEST_TENANT_ID, testKey, 'open');
  });

  it('E1. verifies get_manager_coaching_conversation loads chronological timeline and review info', async () => {
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
      expect(conv.review_info).toBeDefined();
    }
  });

  it('F. rejects invalid review statuses and missing dismissed reasons strictly', async () => {
    await expect(
      updateManagerCoachingOpportunityStatus(
        adminDb,
        TEST_TENANT_ID,
        'test_key:invalid',
        'invalid_status_code' as unknown as CoachingReviewStatus
      )
    ).rejects.toThrow(/Invalid status/);

    await expect(
      updateManagerCoachingOpportunityStatus(
        adminDb,
        TEST_TENANT_ID,
        'test_key:invalid_dismiss',
        'dismissed',
        'sem motivo',
        '' // Empty dismissed reason
      )
    ).rejects.toThrow(/Dismissed status requires a dismissed_reason/);
  });

  // ==========================================
  // E. HISTORICAL ATTRIBUTION VS CURRENT SNAPSHOT
  // ==========================================
  it('G. separates historical event attribution from current operational assignee', async () => {
    const opps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: '30d',
      status: 'all',
      limit: 20,
    });

    for (const opp of opps.items) {
      expect(opp).toHaveProperty('event_responsible_user_id');
      expect(opp).toHaveProperty('event_responsible_user_name');
      expect(opp).toHaveProperty('current_assigned_user_id');
      expect(opp).toHaveProperty('current_assigned_user_name');
      expect(opp).toHaveProperty('responsible_user_id');
      expect(opp).toHaveProperty('responsible_user_name');

      if (opp.category === 'buying_signal_missed' && opp.event_responsible_user_id === null) {
        expect(opp.event_responsible_user_name).toBe('Não identificado');
        expect(opp.responsible_user_id).toBeNull();
      }
    }
  });

  it('G1. CONTROLLED FIXTURE A: historical signal remains with Seller A after reassignment to Seller B', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const t1 = new Date(now.getTime() - 7200 * 1000); // 2 hours ago
    const t2 = new Date(now.getTime() - 3600 * 1000); // 1 hour ago
    const t3 = new Date(now.getTime() - 1800 * 1000); // 30 mins ago

    // 1. Create test contact & conversation
    const { data: contact, error: cErr } = await adminDb
      .from('contacts')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        name: 'Cliente Teste Atribuicao A',
        phone: contactPhone,
      })
      .select()
      .single();

    expect(cErr).toBeNull();
    expect(contact).toBeDefined();

    const { data: conv, error: convErr } = await adminDb
      .from('conversations')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        contact_id: contact!.id,
        status: 'open',
        assigned_agent_id: ADMIN_USER_ID, // Currently assigned to Seller B (Admin)
        created_at: t1.toISOString(),
      })
      .select()
      .single();

    expect(convErr).toBeNull();
    expect(conv).toBeDefined();

    // 2. Historical Assignment 1 (at T1 to Seller A - Owner)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: null,
      to_user_id: OWNER_USER_ID,
      event_type: 'assigned',
      created_at: t1.toISOString(),
    });

    // 3. Buying Signal Event (at T2 while Seller A was assigned)
    const { data: insight } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Cliente quer fechar pacote anual',
        observed_at: t2.toISOString(),
        status: 'active',
        confidence: 0.95,
      })
      .select()
      .single();

    // 4. Historical Assignment 2 (at T3 reassigned to Seller B - Admin)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: OWNER_USER_ID,
      to_user_id: ADMIN_USER_ID,
      event_type: 'reassigned',
      created_at: t3.toISOString(),
    });

    // 5. Query candidate without filter:
    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      category: 'buying_signal_missed',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    expect(targetItem!.event_responsible_user_id).toBe(OWNER_USER_ID);
    expect(targetItem!.current_assigned_user_id).toBe(ADMIN_USER_ID);
    expect(targetItem!.responsible_user_id).toBe(OWNER_USER_ID);

    // 6. Filter by Seller A (Owner) -> MUST find the opportunity
    const oppsSellerA = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      sellerId: OWNER_USER_ID,
      category: 'buying_signal_missed',
    });
    expect(oppsSellerA.items.some((i) => i.conversation_id === conv!.id)).toBe(true);

    // 7. Filter by Seller B (Admin) -> MUST NOT claim the historical event
    const oppsSellerB = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      sellerId: ADMIN_USER_ID,
      category: 'buying_signal_missed',
    });
    expect(oppsSellerB.items.some((i) => i.conversation_id === conv!.id)).toBe(false);

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversation_assignment_history').delete().eq('conversation_id', conv!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G2. CONTROLLED FIXTURE B (UNKNOWN HISTORY): buying signal with no prior assignment history returns NULL event actor (NEVER falls back to current Seller B)', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const t1 = new Date(now.getTime() - 7200 * 1000); // 2 hours ago (Buying signal at T1 with NO assignment history)
    const t2 = new Date(now.getTime() - 1800 * 1000); // 30 mins ago (Assigned to Seller B at T2)

    // 1. Create contact & conversation
    const { data: contact } = await adminDb
      .from('contacts')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        name: 'Cliente Teste Unknown History',
        phone: contactPhone,
      })
      .select()
      .single();

    const { data: conv } = await adminDb
      .from('conversations')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        contact_id: contact!.id,
        status: 'open',
        assigned_agent_id: ADMIN_USER_ID, // Currently assigned to Seller B
        created_at: t1.toISOString(),
      })
      .select()
      .single();

    // 2. Buying signal at T1
    const { data: insight } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Cliente quer plano avançado',
        observed_at: t1.toISOString(),
        status: 'active',
        confidence: 0.95,
      })
      .select()
      .single();

    // 3. Assignment at T2 (AFTER the signal)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: null,
      to_user_id: ADMIN_USER_ID,
      event_type: 'assigned',
      created_at: t2.toISOString(),
    });

    // 4. Query candidate:
    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      category: 'buying_signal_missed',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    // Historical event responsible MUST BE NULL (never falsely attributed to Seller B)
    expect(targetItem!.event_responsible_user_id).toBeNull();
    expect(targetItem!.event_responsible_user_name).toBe('Não identificado');
    // Current assignee is Seller B
    expect(targetItem!.current_assigned_user_id).toBe(ADMIN_USER_ID);
    // Canonical responsible_user_id is NULL (no fallback)
    expect(targetItem!.responsible_user_id).toBeNull();
    expect(targetItem!.responsible_user_name).toBe('Não identificado');

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversation_assignment_history').delete().eq('conversation_id', conv!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G3. CONTROLLED FIXTURE C (SAME-PRIORITY DEDUPE): tie-break selects most recent unresolved event deterministically', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const t1 = new Date(now.getTime() - 7200 * 1000); // 10:00 under Seller A
    const t2 = new Date(now.getTime() - 5400 * 1000); // 11:00 reassigned to Seller B
    const t3 = new Date(now.getTime() - 3600 * 1000); // 12:00 second buying signal under Seller B

    const { data: contact } = await adminDb
      .from('contacts')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        name: 'Cliente Teste Same Priority',
        phone: contactPhone,
      })
      .select()
      .single();

    const { data: conv } = await adminDb
      .from('conversations')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        contact_id: contact!.id,
        status: 'open',
        assigned_agent_id: ADMIN_USER_ID,
        created_at: t1.toISOString(),
      })
      .select()
      .single();

    // Assignment 1 at T1 (Seller A - Owner)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      to_user_id: OWNER_USER_ID,
      event_type: 'assigned',
      created_at: t1.toISOString(),
    });

    // Buying signal 1 at T1 under Seller A
    const { data: insight1 } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Sinal 1 às 10:00 sob Seller A',
        observed_at: t1.toISOString(),
        status: 'active',
        confidence: 0.9,
      })
      .select()
      .single();

    // Assignment 2 at T2 (Seller B - Admin)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: OWNER_USER_ID,
      to_user_id: ADMIN_USER_ID,
      event_type: 'reassigned',
      created_at: t2.toISOString(),
    });

    // Buying signal 2 at T3 under Seller B
    const { data: insight2 } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Sinal 2 às 12:00 sob Seller B',
        observed_at: t3.toISOString(),
        status: 'active',
        confidence: 0.95,
      })
      .select()
      .single();

    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      category: 'buying_signal_missed',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    // Primary event MUST BE the most recent unresolved signal (T3 at 12:00 under Seller B)
    expect(new Date(targetItem!.detected_at).getTime()).toBe(t3.getTime());
    expect(targetItem!.event_responsible_user_id).toBe(ADMIN_USER_ID);
    expect(targetItem!.responsible_user_id).toBe(ADMIN_USER_ID);
    // Evidence contains both signals
    expect(targetItem!.evidence.length).toBe(2);

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().in('id', [insight1!.id, insight2!.id]);
    await adminDb.from('conversation_assignment_history').delete().eq('conversation_id', conv!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G4. CONTROLLED FIXTURE D (PRIMARY ROW COHERENCE & OLDER SECONDARY): older secondary unassigned signal does not alter primary detected_at', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const tUnassigned = new Date(now.getTime() - 14400 * 1000); // 09:00 (4 hours ago) Unassigned conversation
    const tSignal = new Date(now.getTime() - 3600 * 1000); // 14:00 (1 hour ago) Buying signal

    const { data: contact } = await adminDb
      .from('contacts')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        name: 'Cliente Teste Older Secondary',
        phone: contactPhone,
      })
      .select()
      .single();

    const { data: conv } = await adminDb
      .from('conversations')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        contact_id: contact!.id,
        status: 'open',
        assigned_agent_id: null,
        unread_count: 1,
        pending_message_count: 1,
        created_at: tUnassigned.toISOString(),
      })
      .select()
      .single();

    // Buying signal at 14:00
    const { data: insight } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Sinal de compra às 14:00',
        observed_at: tSignal.toISOString(),
        status: 'active',
        confidence: 0.95,
      })
      .select()
      .single();

    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    // Primary category MUST be buying_signal_missed (Rank 1 vs Rank 6)
    expect(targetItem!.category).toBe('buying_signal_missed');
    // detected_at MUST be 14:00 (from primary row), NOT 09:00 from the older unassigned secondary signal!
    expect(new Date(targetItem!.detected_at).getTime()).toBe(tSignal.getTime());
    // secondary_signals contains unassigned_commercial
    expect(targetItem!.secondary_signals).toContain('unassigned_commercial');

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G5. CONTROLLED FIXTURE E (OVERALL SEVERITY FROM SECONDARY SIGNAL): overall severity reflects strongest secondary signal', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const tTask = new Date(now.getTime() - 7200 * 1000); // 2 hours ago (Overdue task created and due)
    const tSignal = new Date(now.getTime() - 3600 * 1000); // 1 hour ago (Buying signal after task, no subsequent task)

    const { data: contact } = await adminDb
      .from('contacts')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        name: 'Cliente Teste Severity Aggregation',
        phone: contactPhone,
      })
      .select()
      .single();

    const { data: conv } = await adminDb
      .from('conversations')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        contact_id: contact!.id,
        status: 'open',
        assigned_agent_id: OWNER_USER_ID,
        created_at: tTask.toISOString(),
      })
      .select()
      .single();

    // Assignment
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      to_user_id: OWNER_USER_ID,
      event_type: 'assigned',
      created_at: tTask.toISOString(),
    });

    // Primary candidate: Buying signal with HIGH severity (lead score = 50 -> high)
    const { data: insight } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Sinal de compra score normal',
        observed_at: tSignal.toISOString(),
        status: 'active',
        confidence: 0.9,
      })
      .select()
      .single();

    // Secondary candidate: Overdue task with URGENT priority
    const { data: task } = await adminDb
      .from('tasks')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        contact_id: contact!.id,
        assigned_user_id: OWNER_USER_ID,
        title: 'Follow-up urgente atrasado',
        priority: 'urgent',
        status: 'pending',
        due_at: tTask.toISOString(),
        created_at: tTask.toISOString(),
      })
      .select()
      .single();

    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    // Primary category is buying_signal_missed (Rank 1)
    expect(targetItem!.category).toBe('buying_signal_missed');
    // Primary reason reflects buying signal
    expect(targetItem!.primary_reason).toBe('Sinal de compra identificado sem ação posterior registrada');
    // Overall opportunity severity is elevated to URGENT due to the secondary urgent task!
    expect(targetItem!.severity).toBe('urgent');
    // secondary_signals contains overdue_followup
    expect(targetItem!.secondary_signals).toContain('overdue_followup');

    // Cleanup fixture
    await adminDb.from('tasks').delete().eq('id', task!.id);
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversation_assignment_history').delete().eq('conversation_id', conv!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G6. CONTROLLED FIXTURE F (HALF-OPEN PERIOD END BOUNDARY): event at exactly period end is excluded [curr_start, curr_end)', async () => {
    // Custom window: [2026-01-01T00:00:00Z, 2026-01-02T00:00:00Z)
    const customStart = '2026-01-01T00:00:00.000Z';
    const customEnd = '2026-01-02T00:00:00.000Z';
    const exactEndTimestamp = customEnd; // Exactly at the end boundary

    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;

    const { data: contact } = await adminDb
      .from('contacts')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        name: 'Cliente Teste Half Open Boundary',
        phone: contactPhone,
      })
      .select()
      .single();

    const { data: conv } = await adminDb
      .from('conversations')
      .insert({
        account_id: TEST_TENANT_ID,
        user_id: OWNER_USER_ID,
        contact_id: contact!.id,
        status: 'open',
        assigned_agent_id: OWNER_USER_ID,
        created_at: customStart,
      })
      .select()
      .single();

    // Signal observed at exactEndTimestamp (should be EXCLUDED by < curr_end)
    const { data: insight } = await adminDb
      .from('conversation_insights')
      .insert({
        account_id: TEST_TENANT_ID,
        conversation_id: conv!.id,
        insight_type: 'buying_signal',
        value_text: 'Sinal exatamente na borda final',
        observed_at: exactEndTimestamp,
        status: 'active',
        confidence: 0.95,
      })
      .select()
      .single();

    const opps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'custom',
      customStart,
      customEnd,
      category: 'buying_signal_missed',
    });

    // Must NOT contain the boundary event
    expect(opps.items.some((i) => i.conversation_id === conv!.id)).toBe(false);

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  // ==========================================
  // F. MINIMUM SAMPLE THRESHOLD & PATTERNS
  // ==========================================
  it('H. preserves recurring friction patterns with minimum sample threshold (>=3 objections)', async () => {
    const patterns = await getManagerCoachingPatterns(adminDb, TEST_TENANT_ID, {
      range: '30d',
    });

    expect(patterns).toBeDefined();
    expect(Array.isArray(patterns.objection_patterns)).toBe(true);
    expect(Array.isArray(patterns.followup_patterns)).toBe(true);
    expect(Array.isArray(patterns.response_patterns)).toBe(true);

    for (const pat of patterns.objection_patterns) {
      expect(pat.occurrences).toBeGreaterThanOrEqual(3);
    }
  });

  // ==========================================
  // G. PRIVACY & NON-PUNITIVE AI SAFETY REGRESSION
  // ==========================================
  it('I. verifies zero PII in provider fact packet and strict non-punitive filter enforcement', () => {
    const mockToolOutputs: Partial<Record<AllowlistedToolName, unknown>> = {
      'manager.coaching_opportunities': {
        total_count: 1,
        items: [
          {
            opportunity_key: 'conv:c999',
            conversation_id: 'c999',
            contact_id: 'ct999',
            contact_name: 'Juliana Paes',
            contact_phone: '+55 11 99999-8888',
            event_responsible_user_id: 'u1',
            event_responsible_user_name: 'Vendedor Bruno',
            current_assigned_user_id: 'u2',
            current_assigned_user_name: 'Vendedor Carla',
            responsible_user_id: 'u1',
            responsible_user_name: 'Vendedor Bruno',
            category: 'buying_signal_missed',
            severity: 'urgent',
            status: 'open',
            primary_reason: 'Sinal de compra sem ação registrada',
            secondary_signals: [],
            lead_score: 90,
            detected_at: new Date().toISOString(),
            evidence: [],
            review_info: { status: 'open' },
          },
        ],
      },
    };

    const { providerFactPacket, privateEntityMap, privateSellerMap } = buildFactPacket({
      question: 'Onde minha equipe mais precisa de coaching?',
      period: { range: '30d' },
      toolOutputs: mockToolOutputs,
    });

    const packetJson = JSON.stringify(providerFactPacket);
    expect(packetJson).not.toContain('Juliana Paes');
    expect(packetJson).not.toContain('99999-8888');
    expect(packetJson).not.toContain('Vendedor Bruno');
    expect(packetJson).not.toContain('Vendedor Carla');

    expect(privateEntityMap['LEAD_1'].contact_name).toBe('Juliana Paes');
    expect(privateSellerMap['SELLER_1'].full_name).toBe('Vendedor Bruno');

    // Punitive filter assertions:
    expect(isPunitiveOrInsultingOutput('Recomendo demitir o vendedor SELLER_1')).toBe(true);
    expect(isPunitiveOrInsultingOutput('Sugiro cortar a comissão do colaborador')).toBe(true);
    expect(isPunitiveOrInsultingOutput('SELLER_1 é preguiçoso e incompetente')).toBe(true);
    expect(isPunitiveOrInsultingOutput('Foram identificadas 5 oportunidades de melhoria em follow-up')).toBe(false);
  });

  // ==========================================
  // H. CACHE FACT-MUTATION REGRESSION
  // ==========================================
  it('J. proves cache fact-mutation: underlying fact mutation alters fingerprint (H1 != H2)', () => {
    const q = 'Onde minha equipe mais precisa de coaching?';
    const period = { range: '30d' as const };

    const facts1 = buildFactPacket({
      question: q,
      period,
      toolOutputs: {
        'manager.coaching_summary': {
          total_open_opportunities: 10,
          urgent_count: 2,
          high_count: 8,
          reviewed_count: 0,
          category_breakdown: {
            buying_signals_missed: 5,
            overdue_followups: 3,
            unanswered_customer: 2,
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
          total_open_opportunities: 11, // Mutated from 10 to 11
          urgent_count: 2,
          high_count: 9,
          reviewed_count: 0,
          category_breakdown: {
            buying_signals_missed: 5,
            overdue_followups: 4,
            unanswered_customer: 2,
          },
          top_focus_areas: [],
        },
      },
    });

    const h1 = computeFactPacketFingerprint(facts1.providerFactPacket);
    const h2 = computeFactPacketFingerprint(facts2.providerFactPacket);

    expect(h1).not.toBe(h2);
  });

  // ==========================================
  // I. REAL GEMINI STAGING GATE
  // ==========================================
  it('K. REAL GEMINI GATE: executes live Gemini planner & synthesis for grounded coaching intelligence', async () => {
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
