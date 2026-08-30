import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { processIntelligenceBatch } from '@/lib/jobs/workers/intelligence-worker'

dotenv.config({ path: '.env.local', override: true })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pxpnkaakurjwpfuezpob.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

describe('V1.3.3 Real Gemini E2E Pipeline Gate', () => {
  it.runIf(Boolean(SUPABASE_SERVICE_ROLE_KEY))(
    'executes full real pipeline: synthetic messages -> sweep -> PGMQ -> worker -> Gemini -> persistence -> projection',
    async () => {
      console.log('=== STARTING V1.3.3 REAL GEMINI E2E GATE ===')
      const tenantId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed'
      const ownerId = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1'

      // 1. BASELINE
      const { count: baselineRuns } = await adminDb
        .from('conversation_analysis_runs')
        .select('*', { count: 'exact', head: true })

      const { count: baselineInternalReqs } = await adminDb
        .from('internal_ai_requests')
        .select('*', { count: 'exact', head: true })

      const { count: baselineUsageLogs } = await adminDb
        .from('ai_usage_log')
        .select('*', { count: 'exact', head: true })

      console.log('Baseline:', {
        analysis_runs: baselineRuns,
        internal_ai_requests: baselineInternalReqs,
        ai_usage_log: baselineUsageLogs,
      })

      // 2. CREATE NEW SYNTHETIC CONTACT & CONVERSATION (0 PII)
      const randomSuffix = Math.floor(100000 + Math.random() * 900000)
      const hexSuffix = randomSuffix.toString(16).padStart(12, '0')
      const contactId = `c1330000-0000-4000-8000-${hexSuffix}`
      const convId = `c1330000-0000-4000-9000-${hexSuffix}`
      const emptyConvId = `c1330000-0000-4000-9000-e${hexSuffix.slice(1)}`

      // Upsert catalog product item if not present to ensure pinned context resolves
      const catalogItemId = 'c1330000-0000-4000-7000-000000000133'
      await adminDb.from('catalog_items').upsert({
        id: catalogItemId,
        account_id: tenantId,
        name: 'Plano Profissional',
        type: 'service',
        sku: 'PL-PRO-133',
        status: 'active',
      })

      // Add search term
      await adminDb.from('catalog_search_terms').upsert({
        account_id: tenantId,
        catalog_item_id: catalogItemId,
        term: 'plano profissional',
        normalized_term: 'plano profissional',
        kind: 'canonical',
      })

      // Upsert Contact
      const { error: cErr } = await adminDb.from('contacts').upsert({
        id: contactId,
        account_id: tenantId,
        user_id: ownerId,
        name: `Synthetic Client ${randomSuffix}`,
        phone: `+5511977${randomSuffix}`,
      })
      expect(cErr).toBeNull()

      // Upsert Target Conversation
      const { error: convErr } = await adminDb.from('conversations').upsert({
        id: convId,
        account_id: tenantId,
        user_id: ownerId,
        contact_id: contactId,
        status: 'open',
        commercial_state_dirty: false,
        pending_message_count: 0,
      })
      expect(convErr).toBeNull()

      // Upsert Empty Dirty Conversation (To prove Sweep skips it)
      await adminDb.from('conversations').upsert({
        id: emptyConvId,
        account_id: tenantId,
        user_id: ownerId,
        contact_id: contactId,
        status: 'open',
        commercial_state_dirty: true,
        pending_message_count: 0,
        intelligence_eligible_at: new Date(Date.now() - 10000).toISOString(),
        intelligence_claimed_at: null,
      })

      // 3. INSERT 6 SYNTHETIC MESSAGES SEQUENTIALLY
      const messagesData = [
        {
          id: `b1330000-0000-4000-8001-${hexSuffix}`,
          text: 'Olá! Estou avaliando uma plataforma para organizar o atendimento comercial da nossa equipe.',
          time: new Date(Date.now() - 60000 * 5).toISOString(),
        },
        {
          id: `b1330000-0000-4000-8002-${hexSuffix}`,
          text: 'O plano profissional parece atender exatamente o que precisamos no momento.',
          time: new Date(Date.now() - 60000 * 4).toISOString(),
        },
        {
          id: `b1330000-0000-4000-8003-${hexSuffix}`,
          text: 'O valor ficou um pouco acima do orçamento que tínhamos previsto inicialmente.',
          time: new Date(Date.now() - 60000 * 3).toISOString(),
        },
        {
          id: `b1330000-0000-4000-8004-${hexSuffix}`,
          text: 'Se conseguirmos uma condição melhor de pagamento e parcelamento, fica super viável para nós.',
          time: new Date(Date.now() - 60000 * 2).toISOString(),
        },
        {
          id: `b1330000-0000-4000-8005-${hexSuffix}`,
          text: 'Quero fechar a contratação ainda esta semana com certeza.',
          time: new Date(Date.now() - 60000 * 1).toISOString(),
        },
        {
          id: `b1330000-0000-4000-8006-${hexSuffix}`,
          text: 'Pode me retornar amanhã às 15h para alinharmos o contrato e concluirmos o fechamento?',
          time: new Date().toISOString(),
        },
      ]

      for (const m of messagesData) {
        const { error: mErr } = await adminDb.from('messages').insert({
          id: m.id,
          conversation_id: convId,
          sender_type: 'customer',
          content_text: m.text,
          content_type: 'text',
          status: 'delivered',
          created_at: m.time,
        })
        expect(mErr).toBeNull()
      }

      // Explicitly set intelligence_eligible_at to the past after inserting all messages
      const { error: updErr } = await adminDb
        .from('conversations')
        .update({
          commercial_state_dirty: true,
          pending_message_count: 6,
          intelligence_eligible_at: new Date(Date.now() - 10000).toISOString(),
          intelligence_claimed_at: null,
        })
        .eq('id', convId)
      expect(updErr).toBeNull()

      // Verify 0 per-message LLM calls
      const { count: preSweepUsageLogs } = await adminDb
        .from('ai_usage_log')
        .select('*', { count: 'exact', head: true })

      console.log('Provider call delta before sweep:', (preSweepUsageLogs || 0) - (baselineUsageLogs || 0))
      expect((preSweepUsageLogs || 0) - (baselineUsageLogs || 0)).toBe(0)

      // 4. RUN SERVICE-ROLE SWEEP
      console.log('Executing sweep_and_enqueue_due_intelligence()...')
      const { data: sweepResult, error: sweepErr } = await adminDb.rpc('sweep_and_enqueue_due_intelligence', {
        p_batch_limit: 10,
        p_lease_seconds: 300,
      })

      expect(sweepErr).toBeNull()
      console.log('Sweep result:', sweepResult)
      expect(sweepResult.success).toBe(true)
      expect(sweepResult.enqueued_count).toBeGreaterThanOrEqual(1)

      // Verify empty conversation was NOT claimed
      const { data: emptyConvStatus } = await adminDb
        .from('conversations')
        .select('intelligence_claimed_at')
        .eq('id', emptyConvId)
        .single()

      console.log('Empty conversation claimed at (expected null):', emptyConvStatus?.intelligence_claimed_at)
      expect(emptyConvStatus?.intelligence_claimed_at).toBeNull()

      // 5. RUN CANONICAL WORKER (REAL GEMINI)
      console.log('Executing processIntelligenceBatch() via canonical worker...')
      const workerResult = await processIntelligenceBatch({ limit: 10 })
      console.log('Worker result:', workerResult)
      expect(workerResult.succeeded).toBeGreaterThanOrEqual(1)

      // 6. QUERY & ASSERT RESULTS
      const { data: run } = await adminDb
        .from('conversation_analysis_runs')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      console.log('=== REAL GEMINI ANALYSIS RUN ===', {
        id: run?.id,
        provider: run?.provider,
        model: run?.model,
        status: run?.status,
        input_tokens: run?.input_tokens,
        output_tokens: run?.output_tokens,
        total_tokens: run?.total_tokens,
        latency_ms: run?.latency_ms,
        input_fingerprint: run?.input_fingerprint,
        messages_count: run?.messages_count,
      })

      expect(run).toBeDefined()
      expect(run!.provider).toBe('gemini')
      expect(run!.model).toBe('gemini-3.5-flash-lite')
      expect(run!.status).toBe('completed')
      expect(run!.messages_count).toBe(6)
      expect(run!.input_tokens).toBeGreaterThan(0)
      expect(run!.output_tokens).toBeGreaterThan(0)
      expect(run!.latency_ms).toBeGreaterThan(0)

      const { data: insights } = await adminDb
        .from('conversation_insights')
        .select('id, insight_type, value_text, value_json, confidence, observed_at')
        .eq('conversation_id', convId)

      console.log('=== CONVERSATION INSIGHTS ===', JSON.stringify(insights, null, 2))

      const insightTypes = (insights || []).map((i) => i.insight_type)
      console.log('Extracted insight types:', insightTypes)

      // Expect Summary and Intent to be extracted
      expect(insightTypes).toContain('summary')
      expect(insightTypes).toContain('intent')

      const { data: leadProfile } = await adminDb
        .from('contact_lead_profiles')
        .select('*')
        .eq('contact_id', contactId)
        .single()

      console.log('=== CONTACT LEAD PROFILE ===', JSON.stringify(leadProfile, null, 2))

      expect(leadProfile).toBeDefined()
      expect(leadProfile!.summary).not.toBeNull()
      expect(leadProfile!.summary_source).toBe('intelligence')
      expect(leadProfile!.current_intent).not.toBeNull()
      expect(leadProfile!.current_intent_source).toBe('intelligence')
      expect(leadProfile!.urgency).not.toBeNull()
      expect(leadProfile!.urgency_source).toBe('intelligence')
      expect(leadProfile!.next_action).not.toBeNull()
      expect(leadProfile!.next_action_source).toBe('intelligence')

      const { data: objections } = await adminDb
        .from('conversation_objection_occurrences')
        .select('id, raw_objection, confidence, occurred_at, original_taxonomy_id, effective_taxonomy_id, override_at')
        .eq('conversation_id', convId)

      console.log('=== OBJECTION OCCURRENCES ===', JSON.stringify(objections, null, 2))

      expect(objections?.length).toBeGreaterThanOrEqual(1)
      for (const obj of objections || []) {
        expect(obj.original_taxonomy_id).toBe(obj.effective_taxonomy_id)
        expect(obj.override_at).toBeNull()
      }

      const { data: evidence } = await adminDb
        .from('conversation_insight_evidence')
        .select('id, insight_id, message_id, snippet, start_offset, end_offset')
        .in('insight_id', (insights || []).map((i) => i.id))

      console.log('=== EVIDENCE ITEMS ===', JSON.stringify(evidence, null, 2))
      expect(evidence?.length).toBeGreaterThan(0)

      const { data: leadScore } = await adminDb
        .from('contact_lead_scores')
        .select('*')
        .eq('contact_id', contactId)
        .single()

      console.log('=== LEAD SCORE ===', JSON.stringify(leadScore, null, 2))
      expect(leadScore).toBeDefined()
      expect(leadScore.score).toBeGreaterThan(0)

      const { count: tasksCount } = await adminDb
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', convId)

      console.log('Automatic follow-up tasks created (expected 0):', tasksCount)
      expect(tasksCount).toBe(0)
    },
    120000 // 2 minutes timeout for real Gemini API call
  )
})
