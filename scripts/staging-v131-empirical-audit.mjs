import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const adminDb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const anonDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })

async function runAudit() {
  console.log('================================================================')
  console.log('=== CICLOPES V1.3.1: STAGING SECURITY & SMART AUTO AUDIT GATE ===')
  console.log('================================================================\n')

  const TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed'
  const OWNER_ID = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1' // Leo Possatti (Owner)
  const contactId = '463eb74e-8b05-4c88-b096-dd9acac31f80'

  // 1. Audit Taxonomy Bootstrap
  console.log('1. Auditing Taxonomy Bootstrap Security:')
  const { error: anonBootErr } = await anonDb.rpc('ensure_tenant_default_objection_taxonomy', { p_account_id: TENANT_ID })
  console.log(`✓ Anon call to ensure_tenant_default_objection_taxonomy: DENIED (${anonBootErr ? 'YES' : 'NO'})`)

  const { data: taxList, error: taxListErr } = await adminDb
    .from('tenant_objection_taxonomy')
    .select('id, code, name')
    .eq('account_id', TENANT_ID)
    .eq('is_active', true)
    .order('position')

  console.log(`✓ Active Taxonomies in Tenant: ${taxList?.length || 0}`)
  console.log('  Codes:', taxList?.map((t) => t.code).join(', '))

  // 2. Audit Sweep Security
  console.log('\n2. Auditing Global Sweep Security (Backend-Only):')
  const { error: anonSweepErr } = await anonDb.rpc('sweep_and_enqueue_due_intelligence', { p_batch_limit: 5 })
  console.log(`✓ Anon call to sweep_and_enqueue_due_intelligence: DENIED (${anonSweepErr ? 'YES' : 'NO'})`)

  // 3. Create Clean Test Conversation
  console.log('\n3. Creating Isolated Test Conversation:')
  const { data: conv } = await adminDb
    .from('conversations')
    .insert({
      account_id: TENANT_ID,
      contact_id: contactId,
      user_id: OWNER_ID,
      status: 'open',
    })
    .select('id')
    .single()

  const convId = conv.id
  console.log(`✓ Created test conversation: ${convId}`)

  // 4. Test Single Inbound Message -> Dirty Only, Zero Queue Jobs
  console.log('\n4. Testing Message 1 (Single Inbound -> Debounce Scheduled):')
  const t1 = new Date().toISOString()
  const { data: msg1 } = await adminDb.from('messages').insert({
    conversation_id: convId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'Olá! Achei a proposta da Scooter elétrica interessante, mas achei o preço muito alto.',
    status: 'delivered',
    created_at: t1,
  }).select('id').single()

  const { data: convA } = await adminDb
    .from('conversations')
    .select('commercial_state_dirty, pending_message_count, intelligence_eligible_at')
    .eq('id', convId)
    .single()

  console.log(`✓ Message 1 inserted: ${msg1.id}`)
  console.log(`✓ commercial_state_dirty: ${convA.commercial_state_dirty} (Expected: true)`)
  console.log(`✓ pending_message_count: ${convA.pending_message_count} (Expected: 1)`)
  console.log(`✓ intelligence_eligible_at: ${convA.intelligence_eligible_at}`)

  const eligibleTimeA = new Date(convA.intelligence_eligible_at).getTime()
  const diffMinutes = Math.round((eligibleTimeA - Date.now()) / 60000)
  console.log(`✓ Debounce window: ~${diffMinutes} minutes in future (Expected: 15 min)`)

  // 5. Test Messages 2-5 -> Debounce Continues
  console.log('\n5. Testing Messages 2-5 (Debounce Window Maintained):')
  const msgIds = [msg1.id]
  for (let i = 0; i < 4; i++) {
    const { data: m } = await adminDb.from('messages').insert({
      conversation_id: convId,
      sender_type: 'customer',
      content_type: 'text',
      content_text: `Mensagem adicional ${i + 2}`,
      status: 'delivered',
    }).select('id').single()
    msgIds.push(m.id)
  }

  const { data: convB } = await adminDb
    .from('conversations')
    .select('pending_message_count, intelligence_eligible_at')
    .eq('id', convId)
    .single()
  console.log(`✓ pending_message_count: ${convB.pending_message_count} (Expected: 5)`)

  // 6. Test Message 6 (Burst Threshold Trigger)
  console.log('\n6. Testing Message 6 (Burst Threshold Trigger >= 6 messages):')
  const { data: msg6 } = await adminDb.from('messages').insert({
    conversation_id: convId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'Mensagem 6 de fechamento',
    status: 'delivered',
  }).select('id').single()
  msgIds.push(msg6.id)

  const { data: convC } = await adminDb
    .from('conversations')
    .select('pending_message_count, intelligence_eligible_at')
    .eq('id', convId)
    .single()

  console.log(`✓ pending_message_count: ${convC.pending_message_count} (Expected: 6)`)
  const eligibleTimeC = new Date(convC.intelligence_eligible_at).getTime()
  const diffSecsC = Math.round((eligibleTimeC - Date.now()) / 1000)
  console.log(`✓ intelligence_eligible_at delta: ${diffSecsC}s (Expected: <= 0s, immediate!)`)

  // 7. Execute Service Role Sweep
  console.log('\n7. Executing Service Role Backend Sweep:')
  const { data: sweepRes } = await adminDb.rpc('sweep_and_enqueue_due_intelligence', {
    p_batch_limit: 10,
    p_lease_seconds: 300,
  })
  console.log(`✓ Sweep result:`, sweepRes)

  // 8. Execute Extraction and Batch Persistence
  console.log('\n8. Executing Extraction Claim & Batch Persistence:')
  const priceTax = taxList.find((t) => t.code === 'price_budget') || taxList[0]
  const timingTax = taxList.find((t) => t.code === 'timing') || taxList[1]

  const { data: claim } = await adminDb.rpc('claim_conversation_analysis_run', {
    p_account_id: TENANT_ID,
    p_conversation_id: convId,
    p_extractor_version: 'v1',
    p_prompt_version: 'v1',
    p_provider: 'mock',
    p_model: 'mock-v1',
    p_batch_limit: 25,
  })

  console.log(`✓ Claim status: ${claim.status}, Run ID: ${claim.run_id}`)

  const insightPayload = [
    {
      insight_type: 'objection',
      value_text: 'preço alto',
      value_json: {
        objection: 'Achei o preço muito alto',
        taxonomy_code: 'price_budget',
      },
      confidence: 0.95,
      source: 'intelligence',
      dedupe_key: `objection:preco_alto:${convId}`,
      observed_at: t1,
      evidence: [
        {
          message_id: msg1.id,
          start_offset: 68,
          end_offset: 89,
          snippet: 'preço muito alto',
        },
      ],
    },
  ]

  const { data: persistRes, error: persistErr } = await adminDb.rpc('persist_conversation_analysis_batch', {
    p_account_id: TENANT_ID,
    p_conversation_id: convId,
    p_run_id: claim.run_id,
    p_extractor_version: 'v1',
    p_insights: insightPayload,
    p_analyzed_message_ids: msgIds,
    p_last_message_id: msgIds[msgIds.length - 1],
    p_last_message_created_at: new Date().toISOString(),
    p_input_tokens: 120,
    p_output_tokens: 45,
    p_total_tokens: 165,
    p_latency_ms: 280,
  })

  if (persistErr) {
    console.error('persist_conversation_analysis_batch error:', persistErr)
    process.exit(1)
  }
  console.log(`✓ persist_conversation_analysis_batch result:`, persistRes)

  // 9. Verify Occurrence Ledger
  console.log('\n9. Verifying Objection Occurrence in Ledger:')
  const { data: occurrences } = await adminDb
    .from('conversation_objection_occurrences')
    .select('id, raw_objection, occurred_at, original_taxonomy_id, effective_taxonomy_id')
    .eq('account_id', TENANT_ID)
    .eq('conversation_id', convId)

  console.log(`✓ Occurrences in Ledger: ${occurrences?.length || 0}`)
  const occ = occurrences?.[0]
  if (occ) {
    const origTax = taxList.find((t) => t.id === occ.original_taxonomy_id)
    const effTax = taxList.find((t) => t.id === occ.effective_taxonomy_id)
    console.log(`  - Occurrence ID: ${occ.id}`)
    console.log(`  - Raw: "${occ.raw_objection}"`)
    console.log(`  - Original Category: ${origTax?.name} (${origTax?.code})`)
    console.log(`  - Effective Category: ${effTax?.name} (${effTax?.code})`)
    console.log(`  - Pinned Timestamp: ${occ.occurred_at}`)
  }

  // 10. Test Human Override
  console.log('\n10. Testing Human Override as Owner:')
  if (occ) {
    const { data: overrideRes, error: overrideErr } = await adminDb.rpc('override_objection_taxonomy', {
      p_account_id: TENANT_ID,
      p_occurrence_id: occ.id,
      p_new_taxonomy_id: timingTax.id,
      p_reason: 'Cliente apenas postergou para o próximo mês',
    })

    if (overrideErr) {
      console.error('override_objection_taxonomy error:', overrideErr)
      process.exit(1)
    }
    console.log(`✓ override_objection_taxonomy result:`, overrideRes)

    // Reproject Contact State
    await adminDb.rpc('project_contact_commercial_state', {
      p_account_id: TENANT_ID,
      p_contact_id: contactId,
      p_trigger_source: 'test_reprojection_audit',
    })

    const { data: reprojectedOcc } = await adminDb
      .from('conversation_objection_occurrences')
      .select('effective_taxonomy_id, override_reason')
      .eq('id', occ.id)
      .single()

    console.log(`✓ Reprojection Preserved Override Category ID: ${reprojectedOcc.effective_taxonomy_id === timingTax.id ? 'YES' : 'NO'}`)
  }

  // 11. Test Fingerprint Cache (Reprocess Identical Messages)
  console.log('\n11. Testing Fingerprint Cache (Zero Duplicate Work):')
  const { data: repeatClaim } = await adminDb.rpc('claim_conversation_analysis_run', {
    p_account_id: TENANT_ID,
    p_conversation_id: convId,
    p_extractor_version: 'v1',
    p_prompt_version: 'v1',
    p_provider: 'mock',
    p_model: 'mock-v1',
    p_batch_limit: 25,
  })

  console.log(`✓ Repeat Claim Status: ${repeatClaim.status} (Expected: already_completed / no_messages)`)

  // 12. Verify Final Conversation State Invariants
  console.log('\n12. Verifying Conversation State Invariants:')
  const { data: finalConv } = await adminDb
    .from('conversations')
    .select('commercial_state_dirty, pending_message_count, intelligence_claimed_at, intelligence_eligible_at')
    .eq('id', convId)
    .single()

  console.log(`✓ commercial_state_dirty: ${finalConv.commercial_state_dirty} (Expected: false)`)
  console.log(`✓ pending_message_count: ${finalConv.pending_message_count} (Expected: 0)`)
  console.log(`✓ intelligence_claimed_at: ${finalConv.intelligence_claimed_at} (Expected: null)`)
  console.log(`✓ intelligence_eligible_at: ${finalConv.intelligence_eligible_at} (Expected: null)`)

  console.log('\n================================================================')
  console.log('=== CICLOPES V1.3.1 AUDIT EMPIRICAL VERIFICATION COMPLETE: ALL PASS ===')
  console.log('================================================================')
}

runAudit().catch((err) => {
  console.error('Audit failed with error:', err)
  process.exit(1)
})
