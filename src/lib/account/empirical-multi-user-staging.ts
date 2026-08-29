import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
  for (const k of Object.keys(envConfig)) {
    process.env[k] = envConfig[k];
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function runEmpiricalStagingGate() {
  console.log('--- STARTING EMPIRICAL STAGING GATE V1.1.1 ---');
  console.log('Target URL:', supabaseUrl);

  const db = createClient(supabaseUrl, serviceKey);
  const accountId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
  const sellerAId = 'a1111111-1111-4111-a111-111111111111';
  const sellerBId = 'b2222222-2222-4222-b222-222222222222';
  const convId = 'ff38fefd-667a-472f-b9c2-4470c896fb00';

  // 1. Direct UPDATE Bypass Check (MUST FAIL)
  console.log('\n[1/7] Testing direct assigned_agent_id bypass prevention...');
  const { error: directUpdateErr } = await db
    .from('conversations')
    .update({ assigned_agent_id: sellerAId })
    .eq('id', convId);

  if (directUpdateErr) {
    console.log('✅ Direct update blocked as expected:', directUpdateErr.message);
  } else {
    throw new Error('FAILED: Direct update to assigned_agent_id was NOT blocked!');
  }

  // 2. Direct History INSERT Prevention with Anon/Auth Client (MUST FAIL)
  console.log('\n[2/7] Testing direct history insertion prohibition via Anon Client...');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const anonClient = createClient(supabaseUrl, anonKey);
  const { error: directHistErr } = await anonClient
    .from('conversation_assignment_history')
    .insert({
      account_id: accountId,
      conversation_id: convId,
      assigned_by_user_id: sellerAId,
      to_user_id: sellerAId,
      event_type: 'claimed',
    });

  if (directHistErr) {
    console.log('✅ Direct history insert blocked as expected:', directHistErr.message);
  } else {
    throw new Error('FAILED: Direct history insert was NOT blocked for anon/unauthorized client!');
  }

  // 3. Step 1: SELLER A logs in and Claims the Conversation via RPC
  console.log('\n[3/7] Step 1: SELLER A logs in and claims conversation...');
  await db.auth.admin.updateUserById(sellerAId, { password: 'TestPassword123!', email_confirm: true });
  await db.auth.admin.updateUserById(sellerBId, { password: 'TestPassword123!', email_confirm: true });

  const clientA = createClient(supabaseUrl, anonKey);
  const { error: loginAErr } = await clientA.auth.signInWithPassword({
    email: 'seller.a.v11@ciclopes.test',
    password: 'TestPassword123!',
  });
  if (loginAErr) throw loginAErr;
  console.log('✅ SELLER A signed in successfully!');

  const { data: claimData, error: claimErr } = await clientA.rpc('assign_conversation_atomic', {
    p_account_id: accountId,
    p_conversation_id: convId,
    p_target_user_id: sellerAId,
    p_reason: 'SELLER A assumindo conversa piloto',
  });

  if (claimErr) throw claimErr;
  console.log('✅ Claim RPC Result (SELLER A):', claimData);

  // Verify in conversations table
  const { data: convAfterClaim } = await db
    .from('conversations')
    .select('id, assigned_agent_id, status')
    .eq('id', convId)
    .single();
  console.log('Conversations row after claim:', convAfterClaim);

  // 4. Step 2: SELLER A sends outbound message "V1.1 OPERADOR A"
  console.log('\n[4/7] Step 2: SELLER A sends outbound message "V1.1 OPERADOR A"...');
  const { data: msgA, error: msgAErr } = await clientA
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_type: 'agent',
      sender_id: sellerAId,
      content_type: 'text',
      content_text: 'V1.1 OPERADOR A',
      source_provider: 'waha',
      status: 'sent',
      message_id: `msg-alpha-${Date.now()}`,
    })
    .select()
    .single();

  if (msgAErr) throw msgAErr;
  console.log('✅ Message A recorded:', { id: msgA.id, sender_id: msgA.sender_id, content: msgA.content_text });

  // 5. Step 3: SELLER A transfers conversation to SELLER B
  console.log('\n[5/7] Step 3: SELLER A transfers conversation to SELLER B...');
  const { data: transferData, error: transferErr } = await clientA.rpc('assign_conversation_atomic', {
    p_account_id: accountId,
    p_conversation_id: convId,
    p_target_user_id: sellerBId,
    p_reason: 'Transferindo para o operador B',
    p_expected_current_agent_id: sellerAId,
  });

  if (transferErr) throw transferErr;
  console.log('✅ Transfer RPC Result (SELLER A -> SELLER B):', transferData);

  const { data: convAfterTransfer } = await db
    .from('conversations')
    .select('id, assigned_agent_id, status')
    .eq('id', convId)
    .single();
  console.log('Conversations row after transfer:', convAfterTransfer);

  // 6. Step 4: SELLER B logs in and sends outbound message "V1.1 OPERADOR B"
  console.log('\n[6/7] Step 4: SELLER B logs in and sends outbound message "V1.1 OPERADOR B"...');
  const clientB = createClient(supabaseUrl, anonKey);
  const { error: loginBErr } = await clientB.auth.signInWithPassword({
    email: 'seller.b.v11@ciclopes.test',
    password: 'TestPassword123!',
  });
  if (loginBErr) throw loginBErr;
  console.log('✅ SELLER B signed in successfully!');

  const { data: msgB, error: msgBErr } = await clientB
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_type: 'agent',
      sender_id: sellerBId,
      content_type: 'text',
      content_text: 'V1.1 OPERADOR B',
      source_provider: 'waha',
      status: 'sent',
      message_id: `msg-beta-${Date.now()}`,
    })
    .select()
    .single();

  if (msgBErr) throw msgBErr;
  console.log('✅ Message B recorded:', { id: msgB.id, sender_id: msgB.sender_id, content: msgB.content_text });

  // 7. Step 5: Physical WhatsApp Outbound Message (sender_id = NULL)
  console.log('\n[7/7] Step 5: Physical WhatsApp outbound message (fromMe=true, sender_id=NULL)...');
  const { data: msgPhys, error: msgPhysErr } = await db
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_type: 'agent',
      sender_id: null,
      content_type: 'text',
      content_text: 'Mensagem enviada do WhatsApp fisico (WAHA sync)',
      source_provider: 'waha',
      status: 'sent',
      message_id: `msg-phys-${Date.now()}`,
    })
    .select()
    .single();

  if (msgPhysErr) throw msgPhysErr;
  console.log('✅ Physical WhatsApp message recorded:', { id: msgPhys.id, sender_id: msgPhys.sender_id, content: msgPhys.content_text });

  // Fetch full assignment history audit ledger
  console.log('\n--- AUDIT LEDGER TRAIL IN STAGING ---');
  const { data: historyRows } = await db
    .from('conversation_assignment_history')
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  console.log('Assignment History Rows Count:', historyRows?.length);
  console.table(historyRows);

  console.log('\n--- EMPIRICAL STAGING GATE COMPLETED SUCCESSFULLY ---');
}

runEmpiricalStagingGate().catch((err) => {
  console.error('Gate failed:', err);
  process.exit(1);
});
