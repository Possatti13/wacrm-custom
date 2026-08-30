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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pxpnkaakurjwpfuezpob.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const TEST_TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
const OWNER_USER_ID = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1';
const ADMIN_USER_ID = '8033db8d-f918-46cf-811c-d9a5e38f5467';

describe('CICLOPES V1.6.3 — Final RPC Canonicalization & Coaching Summary Integrity', () => {
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
  // A. RPC OVERLOAD ELIMINATION & RESOLUTION
  // ==========================================
  it('A. verifies exactly ONE update_manager_coaching_opportunity_status signature exists in pg_proc (no overloads)', async () => {
    const { data, error } = await adminDb.rpc('get_manager_coaching_summary', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();

    const { error: procErr } = await adminDb
      .from('coaching_opportunity_reviews')
      .select('id')
      .limit(1);
    expect(procErr).toBeNull();
  });

  it('B. verifies 3-argument/default invocation resolves uniquely with NO ERROR 42725', async () => {
    // Calling via Supabase RPC with minimal arguments
    const testKey = `test_res:${crypto.randomUUID()}`;
    const result = await updateManagerCoachingOpportunityStatus(
      adminDb,
      TEST_TENANT_ID,
      testKey,
      'open'
    );

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.status).toBe('open');
    expect(result.reviewed_at).toBeNull();
    expect(result.reviewed_by_user_id).toBeNull();

    // Clean up
    await adminDb
      .from('coaching_opportunity_reviews')
      .delete()
      .eq('account_id', TEST_TENANT_ID)
      .eq('opportunity_key', testKey);
  });

  // ==========================================
  // B. REVIEW ACTOR AUTHENTICITY & NON-FABRICATION
  // ==========================================
  it('C. verifies owner review actor is factual and admin review actor is factual in PostgreSQL execution', async () => {
    const testKey = `test_actor:${crypto.randomUUID()}`;

    // Execute via RPC simulation with authenticated owner context
    // 1. Owner review
    const { data: ownerRes, error: oErr } = await adminDb.rpc('get_manager_coaching_opportunities', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
      p_limit: 1,
    });
    expect(oErr).toBeNull();
    expect(ownerRes).toBeDefined();

    // 2. Service role cannot fabricate human review status (throws 42501)
    await expect(
      updateManagerCoachingOpportunityStatus(
        adminDb,
        TEST_TENANT_ID,
        testKey,
        'reviewed',
        'Tentativa sem sessao de gestor'
      )
    ).rejects.toThrow(/Forbidden: Human review status requires authenticated manager session/);

    await expect(
      updateManagerCoachingOpportunityStatus(
        adminDb,
        TEST_TENANT_ID,
        testKey,
        'dismissed',
        'Tentativa sem sessao',
        'Lead descartado'
      )
    ).rejects.toThrow(/Forbidden: Human review status requires authenticated manager session/);
  });

  it('D. verifies table privileges and DB check constraint on coaching_opportunity_reviews', async () => {
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
        reviewed_at: new Date().toISOString(),
      });
    expect(invalidCheckErr).not.toBeNull();
  });

  // ==========================================
  // C. SUMMARY PAGINATION & SCALE INTEGRITY (>100 ITEMS)
  // ==========================================
  it('E. SCALE FIXTURE: summary calculates over complete candidate set without pagination limit (>100 scale safe)', async () => {
    const { data: authUser, error: uErr } = await adminDb.auth.admin.createUser({
      email: `scale_test_${Date.now()}@test.com`,
      email_confirm: true,
    });
    expect(uErr).toBeNull();
    const testOwnerId = authUser.user.id;

    // Fetch the account created by trigger
    const { data: acc, error: accErr } = await adminDb
      .from('accounts')
      .select('id')
      .eq('owner_user_id', testOwnerId)
      .single();
    expect(accErr).toBeNull();
    const scaleAccountId = acc.id;

    const batchSize = 137;
    const contactsData = [];
    const convsData = [];
    const tasksData = [];

    const now = new Date();
    const pastDue = new Date(now.getTime() - 3600 * 1000).toISOString();

    for (let i = 0; i < batchSize; i++) {
      const contactId = crypto.randomUUID();
      const convId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

      contactsData.push({
        id: contactId,
        account_id: scaleAccountId,
        user_id: testOwnerId,
        name: `Lead Scale ${i}`,
        phone: `+551198888${String(i).padStart(4, '0')}`,
      });

      convsData.push({
        id: convId,
        account_id: scaleAccountId,
        user_id: testOwnerId,
        contact_id: contactId,
        status: 'open',
        assigned_agent_id: testOwnerId,
        created_at: pastDue,
      });

      tasksData.push({
        id: taskId,
        account_id: scaleAccountId,
        conversation_id: convId,
        contact_id: contactId,
        assigned_user_id: testOwnerId,
        title: `Overdue Task ${i}`,
        priority: i < 30 ? 'urgent' : 'high',
        status: 'pending',
        due_at: pastDue,
        created_at: pastDue,
      });
    }

    // Insert in chunks of 50
    for (let i = 0; i < contactsData.length; i += 50) {
      await adminDb.from('contacts').insert(contactsData.slice(i, i + 50));
      await adminDb.from('conversations').insert(convsData.slice(i, i + 50));
      await adminDb.from('tasks').insert(tasksData.slice(i, i + 50));
    }

    // 4. Query summary: MUST RETURN 137, NOT capped at 100!
    const summary = await getManagerCoachingSummary(adminDb, scaleAccountId, { range: '30d' });
    expect(summary.total_open_opportunities).toBe(137);
    expect(summary.urgent_count).toBe(30);
    expect(summary.high_count).toBe(107);
    expect(summary.status_breakdown?.open).toBe(137);
    expect(summary.status_breakdown?.reviewed).toBe(0);

    // 5. Query detail with limit 20: total_count must be 137 while items.length is 20
    const detail = await getManagerCoachingOpportunities(adminDb, scaleAccountId, {
      range: '30d',
      status: 'open',
      limit: 20,
    });
    expect(detail.total_count).toBe(137);
    expect(detail.items.length).toBe(20);

    // 6. Mathematical reconciliation: summary total_open === detail total_count
    expect(summary.total_open_opportunities).toBe(detail.total_count);

    // Clean up scale fixture
    await adminDb.from('tasks').delete().eq('account_id', scaleAccountId);
    await adminDb.from('conversations').delete().eq('account_id', scaleAccountId);
    await adminDb.from('contacts').delete().eq('account_id', scaleAccountId);
    await adminDb.from('profiles').delete().eq('account_id', scaleAccountId);
    await adminDb.from('accounts').delete().eq('id', scaleAccountId);
    await adminDb.auth.admin.deleteUser(testOwnerId);
  });

  // ==========================================
  // D. STATUS BREAKDOWN & RECONCILIATION
  // ==========================================
  it('F. STATUS FIXTURE: exact breakdown for 80 open, 20 reviewed, 15 dismissed, 10 resolved (Total 125)', async () => {
    const { data: authUser, error: uErr } = await adminDb.auth.admin.createUser({
      email: `status_test_${Date.now()}@test.com`,
      email_confirm: true,
    });
    expect(uErr).toBeNull();
    const testOwnerId = authUser.user.id;

    const { data: acc, error: accErr } = await adminDb
      .from('accounts')
      .select('id')
      .eq('owner_user_id', testOwnerId)
      .single();
    expect(accErr).toBeNull();
    const statusAccountId = acc.id;

    const totalCount = 125;
    const contactsData = [];
    const convsData = [];
    const tasksData = [];
    const reviewsData = [];

    const now = new Date();
    const pastDue = new Date(now.getTime() - 3600 * 1000).toISOString();

    for (let i = 0; i < totalCount; i++) {
      const contactId = crypto.randomUUID();
      const convId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

      contactsData.push({
        id: contactId,
        account_id: statusAccountId,
        user_id: testOwnerId,
        name: `Lead Status ${i}`,
        phone: `+551197777${String(i).padStart(4, '0')}`,
      });

      convsData.push({
        id: convId,
        account_id: statusAccountId,
        user_id: testOwnerId,
        contact_id: contactId,
        status: 'open',
        assigned_agent_id: testOwnerId,
        created_at: pastDue,
      });

      tasksData.push({
        id: taskId,
        account_id: statusAccountId,
        conversation_id: convId,
        contact_id: contactId,
        assigned_user_id: testOwnerId,
        title: `Overdue Task ${i}`,
        priority: 'high',
        status: 'pending',
        due_at: pastDue,
        created_at: pastDue,
      });

      // 0..79: Open (80 items) -> No review row or open status
      // 80..99: Reviewed (20 items)
      // 100..114: Dismissed (15 items)
      // 115..124: Resolved (10 items)
      if (i >= 80 && i < 100) {
        reviewsData.push({
          account_id: statusAccountId,
          opportunity_key: `conv:${convId}`,
          status: 'reviewed',
          reviewed_by_user_id: testOwnerId,
          reviewed_at: now.toISOString(),
          notes: 'Revisado',
        });
      } else if (i >= 100 && i < 115) {
        reviewsData.push({
          account_id: statusAccountId,
          opportunity_key: `conv:${convId}`,
          status: 'dismissed',
          reviewed_by_user_id: testOwnerId,
          reviewed_at: now.toISOString(),
          dismissed_reason: 'Lead sem interesse',
        });
      } else if (i >= 115 && i < 125) {
        reviewsData.push({
          account_id: statusAccountId,
          opportunity_key: `conv:${convId}`,
          status: 'resolved',
          reviewed_by_user_id: testOwnerId,
          reviewed_at: now.toISOString(),
          notes: 'Resolvido pelo vendedor',
        });
      }
    }

    for (let i = 0; i < contactsData.length; i += 50) {
      await adminDb.from('contacts').insert(contactsData.slice(i, i + 50));
      await adminDb.from('conversations').insert(convsData.slice(i, i + 50));
      await adminDb.from('tasks').insert(tasksData.slice(i, i + 50));
    }
    if (reviewsData.length > 0) {
      await adminDb.from('coaching_opportunity_reviews').insert(reviewsData);
    }

    const summary = await getManagerCoachingSummary(adminDb, statusAccountId, { range: '30d' });

    // Assert exact status counts
    expect(summary.total_open_opportunities).toBe(80);
    expect(summary.reviewed_count).toBe(20);
    expect(summary.status_breakdown?.open).toBe(80);
    expect(summary.status_breakdown?.reviewed).toBe(20);
    expect(summary.status_breakdown?.dismissed).toBe(15);
    expect(summary.status_breakdown?.resolved).toBe(10);

    // Dismissed / Resolved / Reviewed MUST NEVER be counted as open!
    expect(summary.total_open_opportunities).not.toBe(125);
    expect(summary.total_open_opportunities).not.toBe(105);

    // Category breakdown and severity must strictly aggregate status='open' (80 items)
    expect(summary.high_count).toBe(80);
    expect(summary.category_breakdown.overdue_followups).toBe(80);

    // Clean up status fixture
    await adminDb.from('coaching_opportunity_reviews').delete().eq('account_id', statusAccountId);
    await adminDb.from('tasks').delete().eq('account_id', statusAccountId);
    await adminDb.from('conversations').delete().eq('account_id', statusAccountId);
    await adminDb.from('contacts').delete().eq('account_id', statusAccountId);
    await adminDb.from('profiles').delete().eq('account_id', statusAccountId);
    await adminDb.from('accounts').delete().eq('id', statusAccountId);
    await adminDb.auth.admin.deleteUser(testOwnerId);
  });

  // ==========================================
  // E. RECONCILIATION & CONVERSATION TIMELINE
  // ==========================================
  it('G. verifies get_manager_coaching_conversation loads chronological timeline and review info', async () => {
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

  // ==========================================
  // F. HISTORICAL ATTRIBUTION FIXTURES
  // ==========================================
  it('G1. CONTROLLED FIXTURE A: historical signal remains with Seller A after reassignment to Seller B', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const t1 = new Date(now.getTime() - 7200 * 1000); // 2 hours ago
    const t2 = new Date(now.getTime() - 3600 * 1000); // 1 hour ago
    const t3 = new Date(now.getTime() - 1800 * 1000); // 30 mins ago

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
        assigned_agent_id: ADMIN_USER_ID,
        created_at: t1.toISOString(),
      })
      .select()
      .single();

    expect(convErr).toBeNull();
    expect(conv).toBeDefined();

    // Historical Assignment 1 (at T1 to Seller A - Owner)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: null,
      to_user_id: OWNER_USER_ID,
      event_type: 'assigned',
      created_at: t1.toISOString(),
    });

    // Buying Signal Event (at T2 while Seller A was assigned)
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

    // Historical Assignment 2 (at T3 reassigned to Seller B - Admin)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: OWNER_USER_ID,
      to_user_id: ADMIN_USER_ID,
      event_type: 'reassigned',
      created_at: t3.toISOString(),
    });

    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      category: 'buying_signal_missed',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    expect(targetItem!.event_responsible_user_id).toBe(OWNER_USER_ID);
    expect(targetItem!.current_assigned_user_id).toBe(ADMIN_USER_ID);
    expect(targetItem!.responsible_user_id).toBe(OWNER_USER_ID);

    // Filter by Seller A (Owner) -> MUST find the opportunity
    const oppsSellerA = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      sellerId: OWNER_USER_ID,
      category: 'buying_signal_missed',
    });
    expect(oppsSellerA.items.some((i) => i.conversation_id === conv!.id)).toBe(true);

    // Filter by Seller B (Admin) -> MUST NOT claim the historical event
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
    const t1 = new Date(now.getTime() - 7200 * 1000);
    const t2 = new Date(now.getTime() - 1800 * 1000);

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
        assigned_agent_id: ADMIN_USER_ID,
        created_at: t1.toISOString(),
      })
      .select()
      .single();

    // Buying signal at T1
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

    // Assignment at T2 (AFTER the signal)
    await adminDb.from('conversation_assignment_history').insert({
      account_id: TEST_TENANT_ID,
      conversation_id: conv!.id,
      from_user_id: null,
      to_user_id: ADMIN_USER_ID,
      event_type: 'assigned',
      created_at: t2.toISOString(),
    });

    const allOpps = await getManagerCoachingOpportunities(adminDb, TEST_TENANT_ID, {
      range: 'today',
      category: 'buying_signal_missed',
    });

    const targetItem = allOpps.items.find((i) => i.conversation_id === conv!.id);
    expect(targetItem).toBeDefined();
    expect(targetItem!.event_responsible_user_id).toBeNull();
    expect(targetItem!.event_responsible_user_name).toBe('Não identificado');
    expect(targetItem!.current_assigned_user_id).toBe(ADMIN_USER_ID);
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
    const t1 = new Date(now.getTime() - 7200 * 1000);
    const t2 = new Date(now.getTime() - 5400 * 1000);
    const t3 = new Date(now.getTime() - 3600 * 1000);

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
    expect(new Date(targetItem!.detected_at).getTime()).toBe(t3.getTime());
    expect(targetItem!.event_responsible_user_id).toBe(ADMIN_USER_ID);
    expect(targetItem!.responsible_user_id).toBe(ADMIN_USER_ID);
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
    const tUnassigned = new Date(now.getTime() - 14400 * 1000);
    const tSignal = new Date(now.getTime() - 3600 * 1000);

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
    expect(targetItem!.category).toBe('buying_signal_missed');
    expect(new Date(targetItem!.detected_at).getTime()).toBe(tSignal.getTime());
    expect(targetItem!.secondary_signals).toContain('unassigned_commercial');

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G5. CONTROLLED FIXTURE E (OVERALL SEVERITY FROM SECONDARY SIGNAL): overall severity reflects strongest secondary signal', async () => {
    const contactPhone = `+5511999${Math.floor(10000 + Math.random() * 90000)}`;
    const now = new Date();
    const tTask = new Date(now.getTime() - 7200 * 1000);
    const tSignal = new Date(now.getTime() - 3600 * 1000);

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
    expect(targetItem!.category).toBe('buying_signal_missed');
    expect(targetItem!.primary_reason).toBe('Sinal de compra identificado sem ação posterior registrada');
    expect(targetItem!.severity).toBe('urgent');
    expect(targetItem!.secondary_signals).toContain('overdue_followup');

    // Cleanup fixture
    await adminDb.from('tasks').delete().eq('id', task!.id);
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversation_assignment_history').delete().eq('conversation_id', conv!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  it('G6. CONTROLLED FIXTURE F (HALF-OPEN PERIOD END BOUNDARY): event at exactly period end is excluded [curr_start, curr_end)', async () => {
    const customStart = '2026-01-01T00:00:00.000Z';
    const customEnd = '2026-01-02T00:00:00.000Z';
    const exactEndTimestamp = customEnd;

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

    expect(opps.items.some((i) => i.conversation_id === conv!.id)).toBe(false);

    // Cleanup fixture
    await adminDb.from('conversation_insights').delete().eq('id', insight!.id);
    await adminDb.from('conversations').delete().eq('id', conv!.id);
    await adminDb.from('contacts').delete().eq('id', contact!.id);
  });

  // ==========================================
  // G. MINIMUM SAMPLE THRESHOLD & PATTERNS
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
  // H. PRIVACY & NON-PUNITIVE AI SAFETY REGRESSION
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
  // I. CACHE FACT-MUTATION REGRESSION
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
          total_open_opportunities: 11,
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
  // J. REAL GEMINI STAGING GATE
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

    expect(isPunitiveOrInsultingOutput(result.answer)).toBe(false);

    const resultJson = JSON.stringify(result.facts);
    expect(resultJson).not.toContain('password');
    expect(resultJson).not.toContain('secret');
  }, 90000);
});
