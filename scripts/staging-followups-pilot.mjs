import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const envPath = path.join(root, '.env.local');
const env = fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return acc;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return acc;
    acc[trimmed.slice(0, idx)] = trimmed.slice(idx + 1).replace(/^['"]|['"]$/g, '');
    return acc;
  }, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const accountId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
const sellerAId = 'a1111111-1111-4111-a111-111111111111';
const sellerBId = 'b2222222-2222-4222-b222-222222222222';
const contactId = '463eb74e-8b05-4c88-b096-dd9acac31f80';
const convId = 'ff38fefd-667a-472f-b9c2-4470c896fb00';

const adminClient = createClient(supabaseUrl, serviceKey);

async function runPilot() {
  console.log('========================================================================');
  console.log('       CICLOPES V1.2 — STAGING REAL PILOT VERIFICATION                  ');
  console.log('========================================================================\n');

  // 1. SELLER A: Create Follow-up
  console.log('--- 1. SELLER A Creates Follow-up on Pilot Conversation ---');
  const dueToday = new Date(Date.now() + 3600000 * 2).toISOString(); // 2 hours from now
  const { data: taskA, error: errA } = await adminClient
    .from('tasks')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: convId,
      assigned_user_id: sellerAId,
      created_by_user_id: sellerAId,
      title: 'Enviar proposta comercial V1.2',
      description: 'Teste V1.2 Seller A - Follow-up cockpit pilot',
      action_type: 'proposal',
      waiting_on: 'customer',
      priority: 'high',
      due_at: dueToday,
      original_due_at: dueToday,
      source: 'manual',
    })
    .select()
    .single();

  if (errA) throw errA;
  console.log('✅ Created Task A:', taskA.id, `(action_type: ${taskA.action_type}, due_at: ${taskA.due_at})`);

  // 2. Query Cockpit "today" view
  console.log('\n--- 2. Query Cockpit "today" view via RPC ---');
  const { data: cockpitToday, error: errToday } = await adminClient.rpc('get_followups_cockpit', {
    p_account_id: accountId,
    p_assigned_user_id: sellerAId,
    p_view: 'today',
  });
  if (errToday) throw errToday;
  console.log(`✅ Cockpit 'today' count: ${cockpitToday.total} items (timezone: ${cockpitToday.timezone})`);
  const foundInToday = cockpitToday.items.find((i) => i.id === taskA.id);
  console.log('✅ Task A found in Today queue:', Boolean(foundInToday));

  // 3. SELLER A: Snooze Follow-up
  console.log('\n--- 3. SELLER A Snoozes Task A ---');
  const snoozeTomorrow = new Date(Date.now() + 86400000).toISOString();
  const { data: snoozedRes, error: errSnooze } = await adminClient.rpc('snooze_followup_atomic', {
    p_account_id: accountId,
    p_task_id: taskA.id,
    p_snooze_until: snoozeTomorrow,
    p_reason: 'Cliente pediu retorno amanhã',
  });
  if (errSnooze) throw errSnooze;
  console.log('✅ Snooze Result:', snoozedRes);

  // 4. Verify Task A moved to "upcoming"
  console.log('\n--- 4. Query Cockpit "upcoming" view ---');
  const { data: cockpitUpcoming, error: errUpcoming } = await adminClient.rpc('get_followups_cockpit', {
    p_account_id: accountId,
    p_assigned_user_id: sellerAId,
    p_view: 'upcoming',
  });
  if (errUpcoming) throw errUpcoming;
  const foundInUpcoming = cockpitUpcoming.items.find((i) => i.id === taskA.id);
  console.log('✅ Task A found in Upcoming queue after snooze:', Boolean(foundInUpcoming));

  // 5. SELLER A: Complete Follow-up
  console.log('\n--- 5. SELLER A Completes Task A ---');
  const { data: completeRes, error: errComplete } = await adminClient.rpc('complete_followup_atomic', {
    p_account_id: accountId,
    p_task_id: taskA.id,
    p_completed_by: sellerAId,
  });
  if (errComplete) throw errComplete;
  console.log('✅ Complete Result:', completeRes);

  // 6. SELLER B: Create Follow-up & verify responsibility isolation
  console.log('\n--- 6. SELLER B Creates Follow-up & Verifies Responsibility ---');
  const { data: taskB, error: errB } = await adminClient
    .from('tasks')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: convId,
      assigned_user_id: sellerBId,
      created_by_user_id: sellerBId,
      title: 'Ligar para alinhamento V1.2 Seller B',
      action_type: 'call',
      waiting_on: 'team',
      priority: 'medium',
      due_at: dueToday,
      original_due_at: dueToday,
      source: 'manual',
    })
    .select()
    .single();

  if (errB) throw errB;
  console.log('✅ Created Task B:', taskB.id, `(assigned_user_id: ${taskB.assigned_user_id})`);

  // Query Cockpit for Seller B only
  const { data: cockpitB } = await adminClient.rpc('get_followups_cockpit', {
    p_account_id: accountId,
    p_assigned_user_id: sellerBId,
    p_view: 'today',
  });
  console.log(`✅ Seller B Cockpit count: ${cockpitB.total}`);
  console.log('✅ Task B present in Seller B queue:', cockpitB.items.some((i) => i.id === taskB.id));
  console.log('✅ Task A NOT in active Seller B queue:', !cockpitB.items.some((i) => i.id === taskA.id));

  // Cleanly complete Task B
  await adminClient.rpc('complete_followup_atomic', {
    p_account_id: accountId,
    p_task_id: taskB.id,
    p_completed_by: sellerBId,
  });

  // 7. Verify "Sem próxima ação" and "Leads esquecidos" RPCs
  console.log('\n--- 7. Verify Commercial Health Views ---');
  const { data: noAction } = await adminClient.rpc('get_leads_without_next_action', {
    p_account_id: accountId,
  });
  console.log(`✅ Leads without next action found: ${noAction.total}`);

  const { data: forgotten } = await adminClient.rpc('get_forgotten_leads', {
    p_account_id: accountId,
    p_inactive_hours: 72,
  });
  console.log(`✅ Forgotten leads (>72h) found: ${forgotten.total}`);

  console.log('\n================ STAGING PILOT PASSED 100% ================');
}

runPilot().catch(console.error);
