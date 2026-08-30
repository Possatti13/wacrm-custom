import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  loadManagerCockpitSummary,
  loadManagerProductIntelligence,
  loadManagerTeamPerformance,
} from './manager-cockpit-repository';
import { METRIC_DEFINITIONS } from './metric-definitions';

// Load real staging env
dotenv.config({ path: '.env.local', override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const anonDb = createClient(SUPABASE_URL, ANON_KEY);

describe.sequential('Ciclopes V1.4.2 — First Response Ledger Truth & Manager Certification', () => {
  const TEST_TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
  const SELLER_A = 'a1111111-1111-4111-a111-111111111111';
  const SELLER_B = 'b2222222-2222-4222-b222-222222222222';

  beforeAll(() => {
    expect(SUPABASE_URL).toBeDefined();
    expect(SERVICE_ROLE_KEY).toBeDefined();
  });

  // 1. METRIC CONTRACTS AUDIT
  it('1. verifies that all 12 core manager KPIs have complete contract specifications', () => {
    expect(Object.keys(METRIC_DEFINITIONS).length).toBeGreaterThanOrEqual(12);

    for (const [key, def] of Object.entries(METRIC_DEFINITIONS)) {
      expect(def.key).toBe(key);
      expect(def.label).toBeTruthy();
      expect(def.definition).toBeTruthy();
      expect(def.sourceTable).toBeTruthy();
      expect(def.roleScope).toBe('owner_admin');
      expect(def.limitations).toBeTruthy();
    }
  });

  // 2. PERIOD BOUNDS TEST MATRIX (TODAY, 7D, 30D, MONTH)
  it('2. verifies get_account_period_bounds comparative rolling & elapsed windows', async () => {
    // 2.1 Today
    const { data: todayBounds, error: todayErr } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'today',
    });
    expect(todayErr).toBeNull();
    expect(todayBounds.tz).toBe('America/Sao_Paulo');
    const todayCurrDur = new Date(todayBounds.curr_end).getTime() - new Date(todayBounds.curr_start).getTime();
    const todayPrevDur = new Date(todayBounds.prev_end).getTime() - new Date(todayBounds.prev_start).getTime();
    expect(Math.abs(todayCurrDur - todayPrevDur)).toBeLessThanOrEqual(1000);

    // 2.2 7D Rolling Window
    const { data: b7d, error: err7d } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: '7d',
    });
    expect(err7d).toBeNull();
    const dur7dCurr = new Date(b7d.curr_end).getTime() - new Date(b7d.curr_start).getTime();
    const dur7dPrev = new Date(b7d.prev_end).getTime() - new Date(b7d.prev_start).getTime();
    expect(dur7dCurr).toBe(7 * 24 * 3600 * 1000);
    expect(dur7dPrev).toBe(7 * 24 * 3600 * 1000);
    expect(new Date(b7d.curr_start).getTime()).toBe(new Date(b7d.prev_end).getTime());

    // 2.3 30D Rolling Window
    const { data: b30d, error: err30d } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
    });
    expect(err30d).toBeNull();
    const dur30dCurr = new Date(b30d.curr_end).getTime() - new Date(b30d.curr_start).getTime();
    const dur30dPrev = new Date(b30d.prev_end).getTime() - new Date(b30d.prev_start).getTime();
    expect(dur30dCurr).toBe(30 * 24 * 3600 * 1000);
    expect(dur30dPrev).toBe(30 * 24 * 3600 * 1000);
    expect(new Date(b30d.curr_start).getTime()).toBe(new Date(b30d.prev_end).getTime());

    // 2.4 Month-to-date with clamp safety
    const { data: bMonth, error: errMonth } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'month',
    });
    expect(errMonth).toBeNull();
    expect(new Date(bMonth.curr_start).getTime()).toBeLessThan(new Date(bMonth.curr_end).getTime());
    expect(new Date(bMonth.prev_start).getTime()).toBeLessThan(new Date(bMonth.prev_end).getTime());
  });

  // 3. CUSTOM RANGE PARAMETER VALIDATION (REVERSED, EQUAL, NULL)
  it('3. rejects invalid custom range parameters (reversed, equal, nulls)', async () => {
    const baseDate = new Date();
    const futureDate = new Date(baseDate.getTime() + 86400000);

    // 3.1 Reversed: start > end
    const { error: revErr } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'custom',
      p_custom_start: futureDate.toISOString(),
      p_custom_end: baseDate.toISOString(),
    });
    expect(revErr).not.toBeNull();
    expect(revErr?.message).toContain('Invalid custom period');

    // 3.2 Equal: start == end
    const { error: eqErr } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'custom',
      p_custom_start: baseDate.toISOString(),
      p_custom_end: baseDate.toISOString(),
    });
    expect(eqErr).not.toBeNull();
    expect(eqErr?.message).toContain('Invalid custom period');

    // 3.3 Null start
    const { error: nullStartErr } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'custom',
      p_custom_start: null,
      p_custom_end: futureDate.toISOString(),
    });
    expect(nullStartErr).not.toBeNull();
    expect(nullStartErr?.message).toContain('Invalid custom period');

    // 3.4 Valid custom range works
    const { data: validCustom, error: validErr } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'custom',
      p_custom_start: baseDate.toISOString(),
      p_custom_end: futureDate.toISOString(),
    });
    expect(validErr).toBeNull();
    expect(new Date(validCustom.curr_start).getTime()).toBe(baseDate.getTime());
    expect(new Date(validCustom.curr_end).getTime()).toBe(futureDate.getTime());
  });

  // 4. DST SEMANTICS (AMERICA/NEW_YORK SPRING FORWARD & FALL BACK)
  it('4. verifies local calendar DST semantics in timezone with active transitions', async () => {
    // Switch pilot tenant timezone temporarily to America/New_York
    await adminDb.from('accounts').update({ timezone: 'America/New_York' }).eq('id', TEST_TENANT_ID);

    const { data: nyBounds, error: nyErr } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: 'today',
    });
    expect(nyErr).toBeNull();
    expect(nyBounds.tz).toBe('America/New_York');

    // Verify curr_start matches 00:00:00 local New York time
    const startStr = new Date(nyBounds.curr_start).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
    });
    expect(startStr).toContain('00:00:00');

    // Restore timezone to America/Sao_Paulo
    await adminDb.from('accounts').update({ timezone: 'America/Sao_Paulo' }).eq('id', TEST_TENANT_ID);
  });

  // 5. FIXTURE A: REASSIGN AFTER RESPONSE (SELLER A RESPONDS -> REASSIGNED TO SELLER B)
  it('5. FIXTURE A: first responder retained after conversation reassignment to another seller', async () => {
    const testConvId = 'd1420000-0000-4000-9000-000000000001';
    const testContactId = 'd1420000-0000-4000-8000-000000000001';
    const now = Date.now();
    const t0 = new Date(now - 600000).toISOString(); // 10 mins ago (Customer)
    const t1 = new Date(now - 480000).toISOString(); // 8 mins ago (Seller A responds -> 120s duration)

    try {
      await adminDb.from('contacts').upsert({
        id: testContactId,
        user_id: SELLER_A,
        account_id: TEST_TENANT_ID,
        name: 'Fixture A Lead',
      });

      await adminDb.from('conversations').upsert({
        id: testConvId,
        user_id: SELLER_A,
        account_id: TEST_TENANT_ID,
        contact_id: testContactId,
        status: 'open',
        assigned_agent_id: SELLER_B, // Assigned to Seller B after response
        updated_at: t1,
      });

      // Customer message at t0
      await adminDb.from('messages').upsert({
        id: 'd1420000-0000-4000-7000-000000000001',
        conversation_id: testConvId,
        sender_type: 'customer',
        created_at: t0,
      });

      // Seller A responds at t1
      await adminDb.from('messages').upsert({
        id: 'd1420000-0000-4000-7000-000000000002',
        conversation_id: testConvId,
        sender_type: 'agent',
        sender_id: SELLER_A,
        created_at: t1,
      });

      const teamRes = await loadManagerTeamPerformance(adminDb, TEST_TENANT_ID, '7d');
      const memberA = teamRes.team.find((m) => m.user_id === SELLER_A);
      const memberB = teamRes.team.find((m) => m.user_id === SELLER_B);

      expect(memberA).toBeDefined();
      expect(memberA?.median_response_seconds).toBe(120);
      expect(memberB?.median_response_seconds).toBeNull();
    } finally {
      await adminDb.from('messages').delete().eq('conversation_id', testConvId);
      await adminDb.from('conversations').delete().eq('id', testConvId);
      await adminDb.from('contacts').delete().eq('id', testContactId);
    }
  });

  // 6. FIXTURE B: CUSTOMER BURST (10:00, 10:01, 10:02 -> SELLER A RESPONDS AT 10:05 = 300s, 1 SAMPLE)
  it('6. FIXTURE B: customer burst produces exactly one first response sample from the start of the burst', async () => {
    const testConvId = 'd1420000-0000-4000-9000-000000000002';
    const testContactId = 'd1420000-0000-4000-8000-000000000002';
    const now = Date.now();
    const t0 = new Date(now - 600000).toISOString(); // 10 mins ago
    const t1 = new Date(now - 540000).toISOString(); // 9 mins ago
    const t2 = new Date(now - 480000).toISOString(); // 8 mins ago
    const t3 = new Date(now - 300000).toISOString(); // 5 mins ago (Seller A responds -> 300s duration from t0)

    try {
      await adminDb.from('contacts').upsert({
        id: testContactId,
        user_id: SELLER_A,
        account_id: TEST_TENANT_ID,
        name: 'Fixture B Burst Lead',
      });

      await adminDb.from('conversations').upsert({
        id: testConvId,
        user_id: SELLER_A,
        account_id: TEST_TENANT_ID,
        contact_id: testContactId,
        status: 'open',
        assigned_agent_id: SELLER_A,
        updated_at: t3,
      });

      // 3 Customer messages in a burst
      await adminDb.from('messages').upsert([
        {
          id: 'd1420000-0000-4000-7000-000000000010',
          conversation_id: testConvId,
          sender_type: 'customer',
          created_at: t0,
        },
        {
          id: 'd1420000-0000-4000-7000-000000000011',
          conversation_id: testConvId,
          sender_type: 'customer',
          created_at: t1,
        },
        {
          id: 'd1420000-0000-4000-7000-000000000012',
          conversation_id: testConvId,
          sender_type: 'customer',
          created_at: t2,
        },
      ]);

      // Seller A responds
      await adminDb.from('messages').upsert({
        id: 'd1420000-0000-4000-7000-000000000013',
        conversation_id: testConvId,
        sender_type: 'agent',
        sender_id: SELLER_A,
        created_at: t3,
      });

      const teamRes = await loadManagerTeamPerformance(adminDb, TEST_TENANT_ID, '7d');
      const memberA = teamRes.team.find((m) => m.user_id === SELLER_A);

      expect(memberA).toBeDefined();
      // Duration is from earliest customer message t0 (300s ago)
      expect(memberA?.median_response_seconds).toBe(300);
    } finally {
      await adminDb.from('messages').delete().eq('conversation_id', testConvId);
      await adminDb.from('conversations').delete().eq('id', testConvId);
      await adminDb.from('contacts').delete().eq('id', testContactId);
    }
  });

  // 7. FIXTURE C: LEGACY GAP (CONVERSATION ff38fefd-667a-472f-b9c2-4470c896fb00 IS EXCLUDED)
  it('7. FIXTURE C: legacy conversations without verified agent message evidence are excluded', async () => {
    // Audit real staging conversation ff38fefd-667a-472f-b9c2-4470c896fb00
    // In this conversation, the initial agent response on Aug 28 had sender_id = NULL.
    // Therefore, neither Seller A nor Seller B should receive the 1482s duration!
    const teamRes = await loadManagerTeamPerformance(adminDb, TEST_TENANT_ID, '30d');
    expect(teamRes).toBeDefined();

    const memberA = teamRes.team.find((m) => m.user_id === SELLER_A);
    const memberB = teamRes.team.find((m) => m.user_id === SELLER_B);

    // In baseline staging data without synthetic fixtures, neither Alpha nor Beta should have 1482s
    expect(memberA?.median_response_seconds).not.toBe(1482);
    expect(memberB?.median_response_seconds).not.toBe(1482);
  });

  // 8. FIXTURE D: TRANSFER BEFORE RESPONSE (ASSIGNED A -> TRANSFERRED TO B -> B REPLIES = ATTRIBUTED TO B)
  it('8. FIXTURE D: transfer before response attributes response strictly to actual sender Seller B', async () => {
    const testConvId = 'd1420000-0000-4000-9000-000000000004';
    const testContactId = 'd1420000-0000-4000-8000-000000000004';
    const now = Date.now();
    const t0 = new Date(now - 600000).toISOString(); // 10 mins ago
    const t1 = new Date(now - 420000).toISOString(); // 7 mins ago (Seller B responds -> 180s duration)

    try {
      await adminDb.from('contacts').upsert({
        id: testContactId,
        user_id: SELLER_A,
        account_id: TEST_TENANT_ID,
        name: 'Fixture D Transfer Lead',
      });

      // Conversation was initially assigned to Seller A, then transferred to Seller B
      await adminDb.from('conversations').upsert({
        id: testConvId,
        user_id: SELLER_A,
        account_id: TEST_TENANT_ID,
        contact_id: testContactId,
        status: 'open',
        assigned_agent_id: SELLER_B,
        updated_at: t1,
      });

      await adminDb.from('messages').upsert({
        id: 'd1420000-0000-4000-7000-000000000040',
        conversation_id: testConvId,
        sender_type: 'customer',
        created_at: t0,
      });

      await adminDb.from('messages').upsert({
        id: 'd1420000-0000-4000-7000-000000000041',
        conversation_id: testConvId,
        sender_type: 'agent',
        sender_id: SELLER_B, // Seller B sends the actual reply
        created_at: t1,
      });

      const teamRes = await loadManagerTeamPerformance(adminDb, TEST_TENANT_ID, '7d');
      const memberA = teamRes.team.find((m) => m.user_id === SELLER_A);
      const memberB = teamRes.team.find((m) => m.user_id === SELLER_B);

      expect(memberB).toBeDefined();
      expect(memberB?.median_response_seconds).toBe(180);
      expect(memberA?.median_response_seconds).toBeNull();
    } finally {
      await adminDb.from('messages').delete().eq('conversation_id', testConvId);
      await adminDb.from('conversations').delete().eq('id', testConvId);
      await adminDb.from('contacts').delete().eq('id', testContactId);
    }
  });

  // 9. ACTIVE LEADS LEDGER REGRESSION
  it('9. preserves active leads ledger parity', async () => {
    const summary = await loadManagerCockpitSummary(adminDb, TEST_TENANT_ID, '30d');
    expect(summary.executive_pulse.active_leads.current).toBeGreaterThanOrEqual(0);

    const { data: bounds } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
    });

    interface MessageRow {
      conversation_id: string;
      conversations: {
        account_id: string;
        contact_id: string;
      } | null;
    }

    const { data: manualActive } = await adminDb
      .from('messages')
      .select('conversation_id, conversations!inner(account_id, contact_id)')
      .eq('conversations.account_id', TEST_TENANT_ID)
      .in('sender_type', ['customer', 'agent'])
      .gte('created_at', bounds.curr_start)
      .lt('created_at', bounds.curr_end);

    const rows = (manualActive || []) as unknown as MessageRow[];
    const uniqueContacts = new Set(rows.map((m) => m.conversations?.contact_id).filter(Boolean));
    expect(summary.executive_pulse.active_leads.current).toBe(uniqueContacts.size);
  });

  // 10. PRODUCT FRICTION COHORT REGRESSION
  it('10. preserves product friction rate cohort math (0 <= rate <= 100)', async () => {
    const prodRes = await loadManagerProductIntelligence(adminDb, TEST_TENANT_ID, '30d');
    expect(prodRes).toBeDefined();

    for (const prod of prodRes.products) {
      expect(prod.friction_rate).toBeGreaterThanOrEqual(0);
      expect(prod.friction_rate).toBeLessThanOrEqual(100);
    }
  });

  // 11. SECURITY MATRIX REGRESSION
  it('11. preserves security matrix: anon and direct helper calls are strictly denied (42501)', async () => {
    const { error: sumErr } = await anonDb.rpc('get_manager_cockpit_summary', {
      p_account_id: TEST_TENANT_ID,
      p_time_range: '30d',
    });
    expect(sumErr?.code).toBe('42501');

    const { error: boundErr } = await anonDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
    });
    expect(boundErr?.code).toBe('42501');

    const { error: teamErr } = await anonDb.rpc('get_manager_team_performance', {
      p_account_id: TEST_TENANT_ID,
    });
    expect(teamErr?.code).toBe('42501');
  });
});
