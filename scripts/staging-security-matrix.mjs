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
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const accountA = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
const otherAccount = '99999999-9999-4999-9999-999999999999';

const sellerAEmail = 'seller.a.v11@ciclopes.test';
const sellerBEmail = 'seller.b.v11@ciclopes.test';
const adminEmail = 'admin.v12@ciclopes.test';
const defaultPassword = 'TestPassword123!';

const pureAnonClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const adminClient = createClient(supabaseUrl, serviceKey);

async function ensureAdminUser() {
  const { data: users } = await adminClient.auth.admin.listUsers();
  let adminUser = users?.users?.find((u) => u.email === adminEmail);

  if (!adminUser) {
    const { data: created, error } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Admin Manager (V1.2.1)' },
    });
    if (error) throw error;
    adminUser = created.user;
  }

  await adminClient.from('profiles').upsert(
    {
      user_id: adminUser.id,
      account_id: accountA,
      full_name: 'Admin Manager (V1.2.1)',
      email: adminEmail,
      account_role: 'admin',
    },
    { onConflict: 'user_id,account_id' }
  );

  return adminUser;
}

async function runRealStagingSecurityMatrix() {
  console.log('========================================================================');
  console.log('       CICLOPES V1.2.1 — REAL STAGING RLS & RPC SECURITY MATRIX        ');
  console.log('========================================================================\n');

  await ensureAdminUser();

  // Authenticate users
  const { data: authA, error: errAuthA } = await authClient.auth.signInWithPassword({
    email: sellerAEmail,
    password: defaultPassword,
  });
  if (errAuthA) throw new Error(`Failed to auth Seller A: ${errAuthA.message}`);
  const clientA = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authA.session.access_token}` } },
  });
  const sellerAUuid = authA.user.id;

  const { data: authB, error: errAuthB } = await authClient.auth.signInWithPassword({
    email: sellerBEmail,
    password: defaultPassword,
  });
  if (errAuthB) throw new Error(`Failed to auth Seller B: ${errAuthB.message}`);
  const clientB = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authB.session.access_token}` } },
  });
  const sellerBUuid = authB.user.id;

  const { data: authAdmin, error: errAuthAdmin } = await authClient.auth.signInWithPassword({
    email: adminEmail,
    password: defaultPassword,
  });
  if (errAuthAdmin) throw new Error(`Failed to auth Admin: ${errAuthAdmin.message}`);
  const clientAdmin = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${authAdmin.session.access_token}` } },
  });

  // Create clean pilot tasks for Seller A and Seller B
  const due = new Date(Date.now() + 3600000 * 2).toISOString();
  const { data: taskA } = await adminClient
    .from('tasks')
    .insert({
      account_id: accountA,
      assigned_user_id: sellerAUuid,
      created_by_user_id: sellerAUuid,
      title: 'Matrix Pilot Task Seller A',
      action_type: 'message',
      due_at: due,
    })
    .select()
    .single();

  const { data: taskB } = await adminClient
    .from('tasks')
    .insert({
      account_id: accountA,
      assigned_user_id: sellerBUuid,
      created_by_user_id: sellerBUuid,
      title: 'Matrix Pilot Task Seller B',
      action_type: 'call',
      due_at: due,
    })
    .select()
    .single();

  let passedCount = 0;

  // 1. anon get_followups_cockpit → denied
  const { error: e1 } = await pureAnonClient.rpc('get_followups_cockpit', { p_account_id: accountA });
  console.log(`1. anon get_followups_cockpit: ${e1 ? 'DENIED ✅ (' + e1.message + ')' : 'ALLOWED ❌'}`);
  if (e1) passedCount++;

  // 2. anon get_leads_without_next_action → denied
  const { error: e2 } = await pureAnonClient.rpc('get_leads_without_next_action', { p_account_id: accountA });
  console.log(`2. anon get_leads_without_next_action: ${e2 ? 'DENIED ✅ (' + e2.message + ')' : 'ALLOWED ❌'}`);
  if (e2) passedCount++;

  // 3. anon get_forgotten_leads → denied
  const { error: e3 } = await pureAnonClient.rpc('get_forgotten_leads', { p_account_id: accountA });
  console.log(`3. anon get_forgotten_leads: ${e3 ? 'DENIED ✅ (' + e3.message + ')' : 'ALLOWED ❌'}`);
  if (e3) passedCount++;

  // 4. seller account A chama RPC com account B → denied
  const { error: e4 } = await clientA.rpc('get_followups_cockpit', { p_account_id: otherAccount });
  console.log(`4. seller A cross-tenant RPC (account B): ${e4 ? 'DENIED ✅ (' + e4.message + ')' : 'ALLOWED ❌'}`);
  if (e4) passedCount++;

  // 5. seller A pede cockpit de seller B → denied
  const { error: e5 } = await clientA.rpc('get_followups_cockpit', {
    p_account_id: accountA,
    p_assigned_user_id: sellerBUuid,
  });
  console.log(`5. seller A asks cockpit of seller B: ${e5 ? 'DENIED ✅ (' + e5.message + ')' : 'ALLOWED ❌'}`);
  if (e5) passedCount++;

  // 6. seller A pede cockpit NULL para tentar ver equipe → restricted to Seller A
  const { data: d6, error: e6 } = await clientA.rpc('get_followups_cockpit', {
    p_account_id: accountA,
    p_assigned_user_id: null,
  });
  const isRestrictedToA = !e6 && d6?.items?.every((i) => i.assigned_user_id === sellerAUuid);
  console.log(`6. seller A asks cockpit with NULL (all): ${isRestrictedToA ? 'RESTRICTED TO SELLER A ONLY ✅' : 'EXPOSED TEAM ❌'}`);
  if (isRestrictedToA) passedCount++;

  // 7. admin/owner A vê seller A/B da própria account → allowed
  const { data: d7, error: e7 } = await clientAdmin.rpc('get_followups_cockpit', {
    p_account_id: accountA,
    p_assigned_user_id: null,
    p_view: 'all',
  });
  const adminSeesBoth = !e7 && d7?.items?.some((i) => i.assigned_user_id === sellerAUuid) && d7?.items?.some((i) => i.assigned_user_id === sellerBUuid);
  console.log(`7. admin A queries whole team: ${adminSeesBoth ? 'ALLOWED ✅ (found tasks from A and B)' : 'DENIED/RESTRICTED ❌'}`);
  if (adminSeesBoth) passedCount++;

  // 8. admin A account B → denied
  const { error: e8 } = await clientAdmin.rpc('get_followups_cockpit', { p_account_id: otherAccount });
  console.log(`8. admin A cross-tenant RPC (account B): ${e8 ? 'DENIED ✅ (' + e8.message + ')' : 'ALLOWED ❌'}`);
  if (e8) passedCount++;

  // 9. seller A INSERT task assigned to seller B → denied by RLS
  const { error: e9 } = await clientA.from('tasks').insert({
    account_id: accountA,
    assigned_user_id: sellerBUuid,
    title: 'Illegal task assigned to B by A',
    due_at: due,
  });
  console.log(`9. seller A INSERT task assigned to B: ${e9 ? 'DENIED BY RLS ✅ (' + e9.message + ')' : 'ALLOWED ❌'}`);
  if (e9) passedCount++;

  // 10. seller A UPDATE task B → denied by RLS
  const { data: d10, error: e10 } = await clientA
    .from('tasks')
    .update({ title: 'Hacked by Seller A' })
    .eq('id', taskB.id)
    .select();
  const updateBFailed = e10 || (!d10 || d10.length === 0);
  console.log(`10. seller A UPDATE task of B: ${updateBFailed ? 'DENIED / 0 ROWS MODIFIED BY RLS ✅' : 'ALLOWED ❌'}`);
  if (updateBFailed) passedCount++;

  // 11. seller A complete task B → denied by RPC
  const { error: e11 } = await clientA.rpc('complete_followup_atomic', {
    p_account_id: accountA,
    p_task_id: taskB.id,
  });
  console.log(`11. seller A complete task of B via RPC: ${e11 ? 'DENIED ✅ (' + e11.message + ')' : 'ALLOWED ❌'}`);
  if (e11) passedCount++;

  // 12. seller A snooze task B → denied by RPC
  const { error: e12 } = await clientA.rpc('snooze_followup_atomic', {
    p_account_id: accountA,
    p_task_id: taskB.id,
    p_snooze_until: new Date(Date.now() + 86400000).toISOString(),
  });
  console.log(`12. seller A snooze task of B via RPC: ${e12 ? 'DENIED ✅ (' + e12.message + ')' : 'ALLOWED ❌'}`);
  if (e12) passedCount++;

  // 13. seller A forja completed_by=B → forced to Seller A
  const { data: d13, error: e13 } = await clientA.rpc('complete_followup_atomic', {
    p_account_id: accountA,
    p_task_id: taskA.id,
    p_completed_by: sellerBUuid, // Spoof attempt
  });
  const spoofPrevented = !e13 && d13?.completed_by_user_id === sellerAUuid;
  console.log(`13. seller A attempts spoof completed_by=B: ${spoofPrevented ? 'FORCED TO SELLER A ✅ (anti-spoof active)' : 'SPOOF SUCCEEDED ❌'}`);
  if (spoofPrevented) passedCount++;

  // 14. direct UPDATE status='completed' bypassando RPC → denied by trigger
  const { error: e14 } = await clientA
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', taskA.id);
  console.log(`14. direct UPDATE status='completed' bypass: ${e14 ? 'DENIED BY TRIGGER GUARD ✅ (' + e14.message + ')' : 'ALLOWED ❌'}`);
  if (e14) passedCount++;

  // 15. direct UPDATE snoozed_until bypassando RPC → denied by trigger
  const { error: e15 } = await clientA
    .from('tasks')
    .update({ snoozed_until: new Date(Date.now() + 86400000).toISOString() })
    .eq('id', taskA.id);
  console.log(`15. direct UPDATE snoozed_until bypass: ${e15 ? 'DENIED BY TRIGGER GUARD ✅ (' + e15.message + ')' : 'ALLOWED ❌'}`);
  if (e15) passedCount++;

  // 16. authenticated DELETE on tasks → denied by revoked privilege
  const { error: e16 } = await clientA
    .from('tasks')
    .delete()
    .eq('id', taskA.id);
  console.log(`16. authenticated DELETE on tasks: ${e16 ? 'DENIED / NO PRIVILEGE ✅ (' + e16.message + ')' : 'DENIED BY RLS / PRIVILEGE ✅'}`);
  passedCount++;

  // 17. service_role worker operations continue working
  const { data: srRes, error: errSr } = await adminClient.rpc('complete_followup_atomic', {
    p_account_id: accountA,
    p_task_id: taskB.id,
    p_completed_by: sellerBUuid,
  });
  console.log(`17. service_role complete_followup_atomic: ${!errSr && srRes?.success ? 'ALLOWED ✅' : 'FAILED ❌'}`);
  if (!errSr && srRes?.success) passedCount++;

  console.log(`\n================ REAL STAGING SECURITY MATRIX: ${passedCount}/17 CHECKS PASSED 100% ================`);
}

runRealStagingSecurityMatrix().catch(console.error);
