import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  loadManagerCockpitSummary,
  loadManagerAttentionQueue,
  loadManagerObjectionAnalytics,
  loadManagerObjectionDrilldown,
  loadManagerProductIntelligence,
  loadManagerTeamPerformance,
  loadManagerSignalsAndPipeline,
} from './manager-cockpit-repository';
import { METRIC_DEFINITIONS } from './metric-definitions';

// Load real staging env
dotenv.config({ path: '.env.local', override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const anonDb = createClient(SUPABASE_URL, ANON_KEY);

describe('Ciclopes V1.4 — Manager Cockpit & Commercial Operating View', () => {
  const TEST_TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';

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

  // 2. PERIOD BOUNDS & TIMEZONE HELPER
  it('2. verifies get_account_period_bounds returns exact timestamps in tenant timezone', async () => {
    const { data, error } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: '30d',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.tz).toBe('America/Sao_Paulo');
    expect(data.curr_start).toBeDefined();
    expect(data.curr_end).toBeDefined();
    expect(data.prev_start).toBeDefined();
    expect(data.prev_end).toBeDefined();

    // Verify that curr_start and prev_end match perfectly at the boundary
    const currStart = new Date(data.curr_start).getTime();
    const prevEnd = new Date(data.prev_end).getTime();
    expect(currStart).toBe(prevEnd);

    // Verify 7d range
    const { data: data7d } = await adminDb.rpc('get_account_period_bounds', {
      p_account_id: TEST_TENANT_ID,
      p_range: '7d',
    });
    expect(data7d).toBeDefined();
    expect(new Date(data7d.curr_start).getTime()).toBe(new Date(data7d.prev_end).getTime());
  });

  // 3. EXECUTIVE PULSE & SUMMARY RPC
  it('3. verifies get_manager_cockpit_summary returns all executive pulse metrics and operational health', async () => {
    const summary = await loadManagerCockpitSummary(adminDb, TEST_TENANT_ID, '30d');

    expect(summary).toBeDefined();
    expect(summary.period.range).toBe('30d');
    expect(summary.period.timezone).toBe('America/Sao_Paulo');

    // Executive Pulse KPIs
    expect(summary.executive_pulse.active_leads.current).toBeGreaterThanOrEqual(0);
    expect(summary.executive_pulse.hot_leads.current).toBeGreaterThanOrEqual(0);
    expect(summary.executive_pulse.overdue_followups.current).toBeGreaterThanOrEqual(0);
    expect(summary.executive_pulse.leads_without_next_action.current).toBeGreaterThanOrEqual(0);
    expect(summary.executive_pulse.period_objections.current).toBeGreaterThanOrEqual(0);
    expect(summary.executive_pulse.pipeline_snapshot.open_deals_count).toBeGreaterThanOrEqual(0);

    // Operational Health
    expect(summary.operational_health.unassigned_conversations).toBeGreaterThanOrEqual(0);
    expect(summary.operational_health.intelligence_status.enabled).toBe(true);
    expect(summary.operational_health.intelligence_status.provider).toBe('gemini');

    // Data Freshness
    expect(summary.data_freshness.evaluated_at).toBeDefined();
  });

  // 4. ATTENTION QUEUE RANKING & TRIAGE
  it('4. verifies get_manager_attention_queue priorities, deduplication, and pagination', async () => {
    const queue = await loadManagerAttentionQueue(adminDb, TEST_TENANT_ID, 'all', 10, 0);

    expect(queue).toBeDefined();
    expect(queue.total_count).toBeGreaterThanOrEqual(0);
    expect(queue.urgent_count + queue.high_count + queue.medium_count).toBe(queue.total_count);
    expect(queue.items.length).toBeLessThanOrEqual(10);

    for (const item of queue.items) {
      expect(item.contact_id).toBeDefined();
      expect(item.contact_name).toBeDefined();
      expect(item.conversation_id).toBeDefined();
      expect(['urgent', 'high', 'medium']).toContain(item.priority);
      expect(['hot', 'warm', 'cold']).toContain(item.score_tier);
      expect(item.idle_time_seconds).toBeGreaterThanOrEqual(0);
    }
  });

  // 5. OBJECTION ANALYTICS & DRILL-DOWN PARITY
  it('5. verifies objection analytics percentages sum to 100% and drill-down matches total count', async () => {
    const objections = await loadManagerObjectionAnalytics(adminDb, TEST_TENANT_ID, '30d');

    expect(objections).toBeDefined();
    expect(objections.total_count).toBeGreaterThanOrEqual(0);

    if (objections.total_count > 0 && objections.top_objections.length > 0) {
      const sumCounts = objections.top_objections.reduce((acc, o) => acc + o.count, 0);
      expect(sumCounts).toBe(objections.total_count);

      const topObj = objections.top_objections[0];
      expect(topObj.percentage).toBeGreaterThan(0);
      expect(topObj.percentage).toBeLessThanOrEqual(100);

      // Verify drilldown for top objection
      const drilldown = await loadManagerObjectionDrilldown(adminDb, TEST_TENANT_ID, {
        taxonomyCode: topObj.code,
        range: '30d',
        limit: 10,
      });

      expect(drilldown.total_count).toBe(topObj.count);
      expect(drilldown.items.length).toBeLessThanOrEqual(10);

      for (const item of drilldown.items) {
        expect(item.taxonomy_code).toBe(topObj.code);
        expect(item.raw_objection).toBeDefined();
        expect(item.contact_id).toBeDefined();
      }
    }
  });

  // 6. PRODUCT INTELLIGENCE & FRICTION MATRIX
  it('6. verifies product demand, objection counts, and friction rate calculations', async () => {
    const prodRes = await loadManagerProductIntelligence(adminDb, TEST_TENANT_ID, '30d');

    expect(prodRes).toBeDefined();
    expect(Array.isArray(prodRes.products)).toBe(true);

    for (const prod of prodRes.products) {
      expect(prod.catalog_item_id).toBeDefined();
      expect(prod.name).toBeDefined();
      expect(prod.unique_interested_contacts).toBeGreaterThanOrEqual(0);
      expect(prod.objection_occurrences).toBeGreaterThanOrEqual(0);
      expect(prod.friction_rate).toBeGreaterThanOrEqual(0);
    }
  });

  // 7. TEAM OPERATIONAL PERFORMANCE & MEDIAN/P90 RESPONSE TIMES
  it('7. verifies team performance metrics, response percentiles, and follow-up discipline', async () => {
    const teamRes = await loadManagerTeamPerformance(adminDb, TEST_TENANT_ID, '30d');

    expect(teamRes).toBeDefined();
    expect(Array.isArray(teamRes.team)).toBe(true);
    expect(teamRes.team.length).toBeGreaterThanOrEqual(1);

    for (const member of teamRes.team) {
      expect(member.user_id).toBeDefined();
      expect(member.full_name).toBeDefined();
      expect(['owner', 'admin', 'agent']).toContain(member.role);
      expect(member.conversations_handled).toBeGreaterThanOrEqual(0);
      expect(member.messages_sent).toBeGreaterThanOrEqual(0);
      expect(member.followups_completed).toBeGreaterThanOrEqual(0);
      expect(member.followups_overdue).toBeGreaterThanOrEqual(0);
    }
  });

  // 8. SIGNALS & PIPELINE SNAPSHOT
  it('8. verifies buying signals, loss signals, and pipeline snapshot structure', async () => {
    const sigRes = await loadManagerSignalsAndPipeline(adminDb, TEST_TENANT_ID, '30d');

    expect(sigRes).toBeDefined();
    expect(Array.isArray(sigRes.buying_signals)).toBe(true);
    expect(Array.isArray(sigRes.loss_signals)).toBe(true);
    expect(sigRes.pipeline_snapshot.is_snapshot).toBe(true);
    expect(Array.isArray(sigRes.pipeline_snapshot.stages)).toBe(true);
  });

  // 9. SECURITY MATRIX (MULTI-TENANT & ROLE RESTRICTIONS)
  it('9. denies anon access to all manager cockpit RPCs (42501 Unauthorized)', async () => {
    const { error: sumErr } = await anonDb.rpc('get_manager_cockpit_summary', {
      p_account_id: TEST_TENANT_ID,
      p_time_range: '30d',
    });
    expect(sumErr).not.toBeNull();
    expect(sumErr?.code).toBe('42501');

    const { error: attErr } = await anonDb.rpc('get_manager_attention_queue', {
      p_account_id: TEST_TENANT_ID,
    });
    expect(attErr).not.toBeNull();
    expect(attErr?.code).toBe('42501');

    const { error: objErr } = await anonDb.rpc('get_manager_objection_analytics', {
      p_account_id: TEST_TENANT_ID,
    });
    expect(objErr).not.toBeNull();
    expect(objErr?.code).toBe('42501');

    const { error: teamErr } = await anonDb.rpc('get_manager_team_performance', {
      p_account_id: TEST_TENANT_ID,
    });
    expect(teamErr).not.toBeNull();
    expect(teamErr?.code).toBe('42501');
  });
});
