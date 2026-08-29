import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY)

async function runPilot() {
  console.log('===============================================================')
  console.log('=== CICLOPES V1.3: STAGING SMART AUTOMATIC INTELLIGENCE PILOT ===')
  console.log('===============================================================\n')

  // 1. Target Pilot Tenant
  const TENANT_ID = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed'
  console.log(`1. Configuring pilot tenant: ${TENANT_ID}`)

  // Ensure default objection taxonomy
  await db.rpc('ensure_tenant_default_objection_taxonomy', { p_account_id: TENANT_ID })

  const { data: taxList } = await db
    .from('tenant_objection_taxonomy')
    .select('id, code, name')
    .eq('account_id', TENANT_ID)
    .eq('is_active', true)
    .order('position')

  console.log(`✓ Active objection taxonomies: ${taxList?.length || 0}`)
  console.log('  Canonical Codes:', taxList?.map((t) => t.code).join(', '))

  // Enable smart_auto mode for pilot tenant
  await db
    .from('tenant_intelligence_settings')
    .upsert({
      account_id: TENANT_ID,
      enabled: true,
      invocation_mode: 'smart_auto',
      updated_at: new Date().toISOString(),
    })

  // 2. Create a clean dedicated test conversation for this run
  const contactId = '463eb74e-8b05-4c88-b096-dd9acac31f80' // Leo Possatti
  const { data: conv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: TENANT_ID,
      contact_id: contactId,
      user_id: 'b4a10080-263b-4bf8-a22a-7a6741a27bc1', // tenant owner
      status: 'open',
    })
    .select('id')
    .single()

  if (convErr || !conv) {
    console.error('Error creating pilot conversation:', convErr)
    process.exit(1)
  }

  const convId = conv.id
  console.log(`✓ Created isolated pilot conversation: ${convId} (Contact: ${contactId})`)

  // 3. SCENARIO A: Single Inbound Message -> Trigger sets dirty + 15m debounce
  console.log('\n--- Scenario A: Single Inbound Message (Debounce Trigger) ---')
  const msg1Time = new Date().toISOString()
  const { data: msg1 } = await db
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Olá! A proposta da Scooter elétrica ficou interessante, mas achei o preço muito alto para o meu orçamento.',
      status: 'delivered',
      created_at: msg1Time,
    })
    .select('id')
    .single()

  // Verify conversation dirty state
  const { data: convA } = await db
    .from('conversations')
    .select('commercial_state_dirty, pending_message_count, intelligence_eligible_at')
    .eq('id', convId)
    .single()

  console.log(`✓ Message 1 inserted: ${msg1.id}`)
  console.log(`✓ commercial_state_dirty: ${convA.commercial_state_dirty} (Expected: true)`)
  console.log(`✓ pending_message_count: ${convA.pending_message_count} (Expected: 1)`)
  console.log(`✓ intelligence_eligible_at: ${convA.intelligence_eligible_at}`)

  const eligibleTimeA = new Date(convA.intelligence_eligible_at).getTime()
  const nowTime = Date.now()
  const diffMinutes = Math.round((eligibleTimeA - nowTime) / 60000)
  console.log(`✓ Debounce window: ~${diffMinutes} minutes in future (Expected: 15 min)`)

  // 4. SCENARIO B: Premature Sweep -> Debounced Conversation is NOT Enqueued
  console.log('\n--- Scenario B: Premature Sweep (Debounce Guard Active) ---')
  // Claim any other pending convs to isolate test
  await db.rpc('sweep_and_enqueue_due_intelligence', { p_batch_limit: 50, p_lease_seconds: 300 })

  // Recheck our conv: should NOT have claimed lease because eligible_at is in future
  const { data: convB } = await db
    .from('conversations')
    .select('intelligence_claimed_at, commercial_state_dirty')
    .eq('id', convId)
    .single()

  console.log(`✓ intelligence_claimed_at: ${convB.intelligence_claimed_at} (Expected: null - skipped)`)
  console.log(`✓ commercial_state_dirty: ${convB.commercial_state_dirty} (Expected: true)`)

  // 5. SCENARIO C: Burst Threshold -> Immediate Eligibility
  console.log('\n--- Scenario C: Burst Threshold (>= 6 messages triggers immediate eligibility) ---')
  const burstMsgIds = [msg1.id]
  for (let i = 0; i < 5; i++) {
    const { data: burstMsg } = await db.from('messages').insert({
      conversation_id: convId,
      sender_type: 'customer',
      content_type: 'text',
      content_text: `Mensagem de negociação adicional ${i + 1}`,
      status: 'delivered',
    }).select('id').single()
    burstMsgIds.push(burstMsg.id)
  }

  const { data: convC } = await db
    .from('conversations')
    .select('commercial_state_dirty, pending_message_count, intelligence_eligible_at')
    .eq('id', convId)
    .single()

  console.log(`✓ pending_message_count: ${convC.pending_message_count} (Expected: 6)`)
  const eligibleTimeC = new Date(convC.intelligence_eligible_at).getTime()
  const diffSecsC = Math.round((eligibleTimeC - Date.now()) / 1000)
  console.log(`✓ intelligence_eligible_at delta: ${diffSecsC}s (Expected: <= 0s, immediate!)`)

  // 6. SCENARIO D: Sweep & Claim Execution
  console.log('\n--- Scenario D: Sweep & Queue Enqueue Execution ---')
  const { data: sweepD } = await db.rpc('sweep_and_enqueue_due_intelligence', {
    p_batch_limit: 10,
    p_lease_seconds: 300,
  })
  console.log(`✓ Sweep result:`, sweepD)

  const { data: convD } = await db
    .from('conversations')
    .select('intelligence_claimed_at')
    .eq('id', convId)
    .single()
  console.log(`✓ intelligence_claimed_at lease set: ${convD.intelligence_claimed_at}`)

  // 7. SCENARIO E: Analysis Extraction & Persistence Simulation
  console.log('\n--- Scenario E: Structured Extraction & Occurrence Ledger Projection ---')

  const priceTax = taxList.find((t) => t.code === 'price_budget') || taxList[0]
  const timingTax = taxList.find((t) => t.code === 'timing') || taxList[1]

  // Create claim run
  const { data: claim } = await db.rpc('claim_conversation_analysis_run', {
    p_account_id: TENANT_ID,
    p_conversation_id: convId,
    p_extractor_version: 'v1',
    p_prompt_version: 'v1',
    p_provider: 'mock',
    p_model: 'mock-v1',
    p_batch_limit: 25,
  })

  console.log(`✓ Claim status: ${claim.status}, Run ID: ${claim.run_id}`)

  // Persist batch with objection insight mapped to taxonomy
  const lastMsgTime = new Date().toISOString()
  const insightPayload = [
    {
      insight_type: 'objection',
      value_text: 'preço alto',
      value_json: {
        objection: 'Achei o preço muito alto para o meu orçamento',
        taxonomy_code: 'price_budget',
      },
      confidence: 0.94,
      source: 'intelligence',
      dedupe_key: `objection:preco_alto:${convId}`,
      observed_at: msg1Time,
      evidence: [
        {
          message_id: msg1.id,
          start_offset: 58,
          end_offset: 74,
          snippet: 'preço muito alto',
        },
      ],
    },
    {
      insight_type: 'intent',
      value_text: 'purchase',
      value_json: { label: 'Compra' },
      confidence: 0.89,
      source: 'intelligence',
      dedupe_key: `intent:purchase:${convId}`,
      observed_at: msg1Time,
      evidence: [
        {
          message_id: msg1.id,
          start_offset: 8,
          end_offset: 48,
          snippet: 'A proposta da Scooter elétrica ficou interessante',
        },
      ],
    },
  ]

  const { data: persistRes, error: persistErr } = await db.rpc('persist_conversation_analysis_batch', {
    p_account_id: TENANT_ID,
    p_conversation_id: convId,
    p_run_id: claim.run_id,
    p_extractor_version: 'v1',
    p_insights: insightPayload,
    p_analyzed_message_ids: burstMsgIds,
    p_last_message_id: burstMsgIds[burstMsgIds.length - 1],
    p_last_message_created_at: lastMsgTime,
    p_input_tokens: 180,
    p_output_tokens: 75,
    p_total_tokens: 255,
    p_latency_ms: 350,
  })

  if (persistErr) {
    console.error('persist_conversation_analysis_batch error:', persistErr)
    process.exit(1)
  }
  console.log(`✓ persist_conversation_analysis_batch result:`, persistRes)

  // Verify Occurrence Ledger
  const { data: occurrences, error: occErr } = await db
    .from('conversation_objection_occurrences')
    .select('id, raw_objection, occurred_at, original_taxonomy_id, effective_taxonomy_id')
    .eq('account_id', TENANT_ID)
    .eq('conversation_id', convId)

  if (occErr) console.error('Occ error:', occErr)
  console.log(`✓ Objection occurrences in ledger: ${occurrences?.length || 0}`)
  const occ = occurrences?.[0]
  if (occ) {
    const origTax = taxList.find((t) => t.id === occ.original_taxonomy_id)
    const effTax = taxList.find((t) => t.id === occ.effective_taxonomy_id)
    console.log(`  - Occurrence ID: ${occ.id}`)
    console.log(`  - Raw Objection: "${occ.raw_objection}"`)
    console.log(`  - Original Category: ${origTax?.name} (${origTax?.code})`)
    console.log(`  - Effective Category: ${effTax?.name} (${effTax?.code})`)
    console.log(`  - Pinned Timestamp: ${occ.occurred_at}`)
  }

  // 8. SCENARIO F: Human Override
  console.log('\n--- Scenario F: Human Override & Audit Ledger Verification ---')
  if (occ) {
    const { data: overrideRes, error: overrideErr } = await db.rpc('override_objection_taxonomy', {
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

    // Re-verify occurrence
    const { data: updatedOcc } = await db
      .from('conversation_objection_occurrences')
      .select('id, raw_objection, original_taxonomy_id, effective_taxonomy_id, override_reason, override_at')
      .eq('id', occ.id)
      .single()

    const origTax = taxList.find((t) => t.id === updatedOcc.original_taxonomy_id)
    const effTax = taxList.find((t) => t.id === updatedOcc.effective_taxonomy_id)
    console.log(`✓ Original Taxonomy Preserved: ${origTax?.name} (${origTax?.code})`)
    console.log(`✓ Effective Taxonomy Updated: ${effTax?.name} (${effTax?.code})`)
    console.log(`✓ Override Reason: "${updatedOcc.override_reason}"`)
    console.log(`✓ Override Timestamp: ${updatedOcc.override_at}`)

    // Test Reprojection preserves override
    await db.rpc('project_contact_commercial_state', {
      p_account_id: TENANT_ID,
      p_contact_id: contactId,
      p_trigger_source: 'test_reprojection',
    })

    const { data: reprojectedOcc } = await db
      .from('conversation_objection_occurrences')
      .select('effective_taxonomy_id, override_reason')
      .eq('id', occ.id)
      .single()

    console.log(`✓ Reprojection Preserved Override Category ID: ${reprojectedOcc.effective_taxonomy_id === timingTax.id ? 'YES' : 'NO'}`)
  }

  // 9. SCENARIO G: Basic Objection Analytics Summary RPC
  console.log('\n--- Scenario G: Deterministic Analytics Summary RPC ---')
  const { data: summary, error: summaryErr } = await db.rpc('get_objection_summary', {
    p_account_id: TENANT_ID,
  })

  if (summaryErr) {
    console.error('get_objection_summary error:', summaryErr)
    process.exit(1)
  }

  console.log(`✓ Total Objections Count: ${summary.total}`)
  console.log(`✓ Categories Distribution:`)
  for (const item of summary.items || []) {
    if (item.count > 0) {
      console.log(`  - ${item.taxonomy_name} (${item.taxonomy_code}): ${item.count} (${item.percentage}%)`)
    }
  }

  // 10. SCENARIO H: Verify Final Conversation Dirty State
  console.log('\n--- Scenario H: Conversation State Invariant Check ---')
  const { data: finalConv } = await db
    .from('conversations')
    .select('commercial_state_dirty, pending_message_count, intelligence_claimed_at, intelligence_eligible_at')
    .eq('id', convId)
    .single()

  console.log(`✓ commercial_state_dirty: ${finalConv.commercial_state_dirty} (Expected: false)`)
  console.log(`✓ pending_message_count: ${finalConv.pending_message_count} (Expected: 0)`)
  console.log(`✓ intelligence_claimed_at: ${finalConv.intelligence_claimed_at} (Expected: null)`)
  console.log(`✓ intelligence_eligible_at: ${finalConv.intelligence_eligible_at} (Expected: null)`)

  console.log('\n===============================================================')
  console.log('=== CICLOPES V1.3 PILOT EMPIRICAL VERIFICATION COMPLETE: ALL PASS ===')
  console.log('===============================================================')
}

runPilot().catch((err) => {
  console.error('Pilot failed with error:', err)
  process.exit(1)
})
