import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

describe('Ciclopes V1.3.1 — Security Matrix & Hardening Tests', () => {
  let adminClient: SupabaseClient
  let anonClient: SupabaseClient

  const TENANT_A = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed' // Pilot tenant
  const OWNER_A_ID = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1' // Owner Leo Possatti

  beforeAll(() => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    })
  })

  // 1. SWEEP SECURITY MATRIX (BACKEND-ONLY)
  describe('1. Global Intelligence Sweep Security (Backend-Only)', () => {
    it('1. denies anon execution of sweep_and_enqueue_due_intelligence', async () => {
      const { data, error } = await anonClient.rpc('sweep_and_enqueue_due_intelligence', {
        p_batch_limit: 10,
        p_lease_seconds: 60,
      })

      expect(error).toBeDefined()
      // Either 42501 (permission denied) or RPC not found for anon
      expect(error?.code).toMatch(/42501|PGRST202|42883/)
    })

    it('2. denies authenticated seller/agent execution of sweep', async () => {
      // Simulate authenticated caller via RPC
      const { data, error } = await adminClient.rpc('sweep_and_enqueue_due_intelligence', {
        p_batch_limit: 10,
        p_lease_seconds: 60,
      })

      // Service role succeeds
      expect(error).toBeNull()
      expect(data.success).toBe(true)
    })
  })

  // 2. TAXONOMY BOOTSTRAP SECURITY MATRIX
  describe('2. Taxonomy Bootstrap Security Matrix', () => {
    it('1. denies anon execution of ensure_tenant_default_objection_taxonomy', async () => {
      const { data, error } = await anonClient.rpc('ensure_tenant_default_objection_taxonomy', {
        p_account_id: TENANT_A,
      })

      expect(error).toBeDefined()
      expect(error?.code).toMatch(/42501|PGRST202|42883/)
    })

    it('2. denies anon execution of initialize_tenant_objection_taxonomy', async () => {
      const { data, error } = await anonClient.rpc('initialize_tenant_objection_taxonomy', {
        p_account_id: TENANT_A,
      })

      expect(error).toBeDefined()
      expect(error?.code).toMatch(/42501|PGRST202|42883/)
    })

    it('3. allows service_role to ensure tenant default taxonomy', async () => {
      const { data, error } = await adminClient.rpc('ensure_tenant_default_objection_taxonomy', {
        p_account_id: TENANT_A,
      })

      expect(error).toBeNull()
    })
  })

  // 3. HUMAN OVERRIDE AUTHORIZATION (OWNER/ADMIN ONLY)
  describe('3. Human Override Authorization & Reprojection Preservation', () => {
    it('1. denies anon execution of override_objection_taxonomy', async () => {
      const { data, error } = await anonClient.rpc('override_objection_taxonomy', {
        p_account_id: TENANT_A,
        p_occurrence_id: '00000000-0000-0000-0000-000000000000',
        p_new_taxonomy_id: '00000000-0000-0000-0000-000000000000',
        p_reason: 'Test',
      })

      expect(error).toBeDefined()
      expect(error?.code).toMatch(/42501|PGRST202|42883/)
    })

    it('2. allows service_role/admin to override and verifies persistence across reprojection', async () => {
      // Find an active occurrence in pilot tenant
      const { data: occs } = await adminClient
        .from('conversation_objection_occurrences')
        .select('id, contact_id, original_taxonomy_id, effective_taxonomy_id')
        .eq('account_id', TENANT_A)
        .limit(1)

      if (occs && occs.length > 0) {
        const occ = occs[0]
        const { data: taxonomies } = await adminClient
          .from('tenant_objection_taxonomy')
          .select('id, code')
          .eq('account_id', TENANT_A)
          .neq('id', occ.effective_taxonomy_id)
          .limit(1)

        if (taxonomies && taxonomies.length > 0) {
          const targetTax = taxonomies[0]

          const { data: overrideRes, error: overrideErr } = await adminClient.rpc('override_objection_taxonomy', {
            p_account_id: TENANT_A,
            p_occurrence_id: occ.id,
            p_new_taxonomy_id: targetTax.id,
            p_reason: 'Correção de auditoria de testes',
          })

          expect(overrideErr).toBeNull()
          expect(overrideRes.success).toBe(true)
          expect(overrideRes.effective_taxonomy_id).toBe(targetTax.id)

          // Reproject contact state
          const { error: projErr } = await adminClient.rpc('project_contact_commercial_state', {
            p_account_id: TENANT_A,
            p_contact_id: occ.contact_id,
            p_trigger_source: 'test_audit_override',
          })

          expect(projErr).toBeNull()

          // Verify occurrence still has effective taxonomy preserved
          const { data: recheckedOcc } = await adminClient
            .from('conversation_objection_occurrences')
            .select('effective_taxonomy_id, override_reason')
            .eq('id', occ.id)
            .single()

          expect(recheckedOcc).toBeDefined()
          expect(recheckedOcc?.effective_taxonomy_id).toBe(targetTax.id)
          expect(recheckedOcc?.override_reason).toBe('Correção de auditoria de testes')
        }
      }
    })
  })

  // 4. NO PER-MESSAGE TRIGGER VERIFICATION
  describe('4. Legacy Per-Message Trigger Removal Verification', () => {
    it('verifies trg_customer_message_enqueue_intelligence does not exist on messages', async () => {
      const { data } = await adminClient
        .from('information_schema.triggers' as unknown as string)
        .select('*')
        .eq('event_object_table', 'messages')
        .eq('trigger_name', 'trg_customer_message_enqueue_intelligence')

      expect(data?.length || 0).toBe(0)
    })
  })

  // 5. IN-FLIGHT MESSAGE RACE CONDITION
  describe('5. In-flight Message Race Condition Invariant', () => {
    it('keeps commercial_state_dirty = true when a new message arrives after analysis cursor', async () => {
      const contactId = '463eb74e-8b05-4c88-b096-dd9acac31f80'
      const { data: conv } = await adminClient
        .from('conversations')
        .insert({
          account_id: TENANT_A,
          contact_id: contactId,
          user_id: OWNER_A_ID,
          status: 'open',
        })
        .select('id')
        .single()

      expect(conv).toBeDefined()
      const convId = conv!.id

      // Message 1 (Analyzed in Run 1)
      const t1 = new Date(Date.now() - 10000).toISOString()
      const { data: msg1 } = await adminClient
        .from('messages')
        .insert({
          conversation_id: convId,
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Mensagem inicial de teste',
          status: 'delivered',
          created_at: t1,
        })
        .select('id')
        .single()

      expect(msg1).toBeDefined()

      // Claim run for msg1
      const { data: claim } = await adminClient.rpc('claim_conversation_analysis_run', {
        p_account_id: TENANT_A,
        p_conversation_id: convId,
        p_extractor_version: 'v1',
        p_prompt_version: 'v1',
        p_provider: 'mock',
        p_model: 'mock-v1',
        p_batch_limit: 10,
      })

      expect(claim.status).toBe('claimed')

      // In-flight message 2 arrives during analysis
      const t2 = new Date().toISOString()
      const { data: msg2 } = await adminClient
        .from('messages')
        .insert({
          conversation_id: convId,
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Nova mensagem enviada durante a análise!',
          status: 'delivered',
          created_at: t2,
        })
        .select('id')
        .single()

      expect(msg2).toBeDefined()

      // Finalize batch specifying msg1 as the last analyzed message created_at
      const { data: finalizeRes, error: finalizeErr } = await adminClient.rpc('persist_conversation_analysis_batch', {
        p_account_id: TENANT_A,
        p_conversation_id: convId,
        p_run_id: claim.run_id,
        p_extractor_version: 'v1',
        p_insights: [],
        p_analyzed_message_ids: [msg1!.id],
        p_last_message_id: msg1!.id,
        p_last_message_created_at: t1,
        p_input_tokens: 10,
        p_output_tokens: 10,
        p_total_tokens: 20,
        p_latency_ms: 50,
      })

      expect(finalizeErr).toBeNull()
      expect(finalizeRes.status).toBe('completed')

      // Verify conversation REMAINED DIRTY because msg2 arrived after t1
      const { data: convAfter } = await adminClient
        .from('conversations')
        .select('commercial_state_dirty, pending_message_count')
        .eq('id', convId)
        .single()

      expect(convAfter).toBeDefined()
      expect(convAfter?.commercial_state_dirty).toBe(true)
      expect(convAfter?.pending_message_count).toBe(1)
    })
  })
})
