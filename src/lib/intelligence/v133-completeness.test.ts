import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
import { resolveAndValidateObservation } from './validation'
import { buildAnalysisInput } from './input-builder'
import type { ClaimMessageItem, CatalogItemContextSnapshot } from './types'
import type { CanonicalConfigSnapshot } from '@/lib/commercial-config/types'

describe('V1.3.3 Completeness & Projection Integrity Matrix', () => {
  const catalogSnapshot: CatalogItemContextSnapshot[] = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Plano Profissional',
      type: 'service',
      sku: 'PL-PRO',
      terms: [
        { term: 'Plano Profissional', normalized_term: 'plano profissional', kind: 'canonical' },
        { term: 'plano pro', normalized_term: 'plano pro', kind: 'alias' },
      ],
    },
  ]

  const configSnapshot: CanonicalConfigSnapshot = {
    schemaVersion: 1,
    intents: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        key: 'purchase',
        label: 'Compra / Fechamento',
        description: 'Cliente com intenção clara de compra ou contratação',
        status: 'active',
        sort_order: 10,
        metadata: {},
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        key: 'budget_quote',
        label: 'Cotação / Orçamento',
        description: 'Cliente solicitando orçamentos ou valores',
        status: 'active',
        sort_order: 20,
        metadata: {},
      },
    ],
    attributes: [],
    context: {
      company_description: 'Plataforma CRM',
      commercial_objectives: 'Venda de assinaturas',
      qualification_guidelines: null,
      prohibited_assumptions: null,
      terminology_notes: null,
      metadata: {},
    },
    terminology: {
      contact_label_singular: 'Lead',
      contact_label_plural: 'Leads',
      catalog_item_label_singular: 'Produto',
      catalog_item_label_plural: 'Produtos',
      metadata: {},
    },
  }

  const message1: ClaimMessageItem = {
    id: '44444444-4444-4444-4444-444444444444',
    sender_type: 'customer',
    content_text: 'Olá! Quero fechar a contratação do plano pro ainda esta semana.',
    created_at: '2026-08-30T10:00:00Z',
  }

  const message2: ClaimMessageItem = {
    id: '55555555-5555-5555-5555-555555555555',
    sender_type: 'customer',
    content_text: 'O valor ficou um pouco acima do orçamento, mas se parcelar eu fecho.',
    created_at: '2026-08-30T10:05:00Z',
  }

  const messageRefMap = new Map<string, ClaimMessageItem>()
  messageRefMap.set('M1', message1)
  messageRefMap.set('M2', message2)

  const ctx = {
    catalogSnapshot,
    configSnapshot,
    messageRefMap,
    extractorVersion: 'v1',
    taxonomies: [
      {
        id: '66666666-6666-6666-6666-666666666666',
        account_id: 'ec86e41e-6fec-41b8-a83f-64922c45d5ed',
        code: 'price_budget',
        name: 'Preço / Orçamento',
        description: 'Orçamento insuficiente ou preço alto',
        is_default: true,
        sort_order: 10,
        position: 10,
        is_active: true,
        created_at: '2026-08-30T00:00:00Z',
        updated_at: '2026-08-30T00:00:00Z',
      },
    ],
  }

  // A & B: Contract Prompt Generation
  it('A & B: buildAnalysisInput includes summary and allowed intents in prompt', () => {
    const input = buildAnalysisInput({
      messages: [message1, message2],
      configSnapshot,
      catalogSnapshot,
      taxonomies: ctx.taxonomies,
    })

    expect(input.systemPrompt).toContain("'summary'")
    expect(input.systemPrompt).toContain("'intent'")
    expect(input.systemPrompt).toContain('ALLOWED INTENTS:')
    expect(input.systemPrompt).toContain('key: "purchase"')
    expect(input.systemPrompt).toContain('key: "budget_quote"')
    expect(input.userPrompt).toContain('[M1] [customer]: Olá! Quero fechar a contratação')
  })

  // C: Summary validation
  it('C: valid summary observation resolves and validates correctly', () => {
    const obs = resolveAndValidateObservation(
      {
        type: 'summary',
        value: 'Lead quer contratar o plano pro ainda esta semana, negociando parcelamento de valor.',
        confidence: 0.95,
      },
      ctx
    )

    expect(obs).not.toBeNull()
    expect(obs?.insight_type).toBe('summary')
    expect(obs?.value_text).toBe('Lead quer contratar o plano pro ainda esta semana, negociando parcelamento de valor.')
    expect(obs?.value_json).toEqual({
      summary: 'Lead quer contratar o plano pro ainda esta semana, negociando parcelamento de valor.',
    })
  })

  // D: Intent validation
  it('D: valid intent observation resolves and matches canonical intent with evidence', () => {
    const obs = resolveAndValidateObservation(
      {
        type: 'intent',
        value: 'purchase',
        confidence: 0.98,
        evidence: [
          {
            message_ref: 'M1',
            quoted_text: 'Quero fechar a contratação',
          },
        ],
      },
      ctx
    )

    expect(obs).not.toBeNull()
    expect(obs?.insight_type).toBe('intent')
    expect(obs?.value_text).toBe('purchase')
    expect(obs?.value_json).toEqual({ label: 'Compra / Fechamento' })
    expect(obs?.evidence).toHaveLength(1)
    expect(obs?.evidence[0].snippet).toBe('Quero fechar a contratação')
  })

  // D2: Intent synonym resolution
  it('D2: intent synonym (e.g. "compra") maps to canonical "purchase"', () => {
    const obs = resolveAndValidateObservation(
      {
        type: 'intent',
        value: 'compra',
        confidence: 0.95,
        evidence: [
          {
            message_ref: 'M1',
            quoted_text: 'Quero fechar a contratação',
          },
        ],
      },
      ctx
    )

    expect(obs).not.toBeNull()
    expect(obs?.insight_type).toBe('intent')
    expect(obs?.value_text).toBe('purchase')
  })

  // G: Intent without valid evidence is rejected
  it('G: intent without valid quoted evidence is rejected', () => {
    const obs = resolveAndValidateObservation(
      {
        type: 'intent',
        value: 'purchase',
        confidence: 0.95,
        evidence: [
          {
            message_ref: 'M1',
            quoted_text: 'Texto inventado que nao existe na mensagem',
          },
        ],
      },
      ctx
    )

    expect(obs).toBeNull()
  })

  // K: Buying signal does not fabricate intent
  it('K: buying_signal is extracted as buying_signal and does not convert to intent', () => {
    const obs = resolveAndValidateObservation(
      {
        type: 'buying_signal',
        value: 'se parcelar eu fecho',
        confidence: 0.9,
        evidence: [
          {
            message_ref: 'M2',
            quoted_text: 'se parcelar eu fecho',
          },
        ],
      },
      ctx
    )

    expect(obs).not.toBeNull()
    expect(obs?.insight_type).toBe('buying_signal')
    expect(obs?.value_text).toBe('se parcelar eu fecho')
  })

  // Empty string summary rejected
  it('H: empty summary returns null', () => {
    const obs = resolveAndValidateObservation(
      {
        type: 'summary',
        value: '   ',
        confidence: 0.9,
      },
      ctx
    )

    expect(obs).toBeNull()
  })

  // Staging DB Integration Tests for Provenance, Summary Projection, and Sweep Integrity
  describe('Staging DB Projection, Provenance, and Sweep Tests', () => {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pxpnkaakurjwpfuezpob.supabase.co'
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const adminDb = SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null

    it.runIf(Boolean(SUPABASE_SERVICE_ROLE_KEY))(
      'E, F, G, H, I, J: reproject_commercial_state enforces strict provenance and projects summary & intent',
      async () => {
        if (!adminDb) return

        const tenantId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed'
        const ownerId = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1'
        const randomSuffix = Math.floor(100000 + Math.random() * 900000)
        // Create synthetic contact
        const contactId = `c1330000-0000-4000-8000-${randomSuffix.toString().padStart(12, '0')}`
        const { error: cErr } = await adminDb.from('contacts').upsert({
          id: contactId,
          account_id: tenantId,
          user_id: ownerId,
          name: 'Synthetic Lead V133',
          phone: `+5511988${randomSuffix}`,
        })
        expect(cErr).toBeNull()

        // Create synthetic conversation
        const convId = `c1330000-0000-4000-9000-${randomSuffix.toString().padStart(12, '0')}`
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

        // Step 1: Reproject with NO insights -> All fields NULL and sources NULL
        await adminDb.rpc('reproject_commercial_state', {
          p_account_id: tenantId,
          p_contact_id: contactId,
        })

        const { data: profile1 } = await adminDb
          .from('contact_lead_profiles')
          .select('*')
          .eq('contact_id', contactId)
          .single()

        expect(profile1).not.toBeNull()
        expect(profile1.current_intent).toBeNull()
        expect(profile1.current_intent_source).toBeNull()
        expect(profile1.summary).toBeNull()
        expect(profile1.summary_source).toBeNull()
        expect(profile1.urgency).toBeNull()
        expect(profile1.urgency_source).toBeNull()
        expect(profile1.sentiment).toBeNull()
        expect(profile1.sentiment_source).toBeNull()
        expect(profile1.next_action).toBeNull()
        expect(profile1.next_action_source).toBeNull()

        // Step 2: Insert summary and intent insights
        await adminDb.from('conversation_insights').insert([
          {
            account_id: tenantId,
            conversation_id: convId,
            insight_type: 'summary',
            value_text: 'Lead interessado no plano pro com urgência alta.',
            value_json: { summary: 'Lead interessado no plano pro com urgência alta.' },
            source: 'intelligence',
            confidence: 0.95,
            status: 'active',
            observed_at: new Date().toISOString(),
          },
          {
            account_id: tenantId,
            conversation_id: convId,
            insight_type: 'intent',
            value_text: 'purchase',
            value_json: { label: 'Compra / Fechamento' },
            source: 'intelligence',
            confidence: 0.98,
            status: 'active',
            observed_at: new Date().toISOString(),
          },
        ])

        // Step 3: Reproject -> Summary and Intent are projected with intelligence source
        await adminDb.rpc('reproject_commercial_state', {
          p_account_id: tenantId,
          p_contact_id: contactId,
        })

        const { data: profile2 } = await adminDb
          .from('contact_lead_profiles')
          .select('*')
          .eq('contact_id', contactId)
          .single()

        expect(profile2.summary).toBe('Lead interessado no plano pro com urgência alta.')
        expect(profile2.summary_source).toBe('intelligence')
        expect(profile2.current_intent).toBe('purchase')
        expect(profile2.current_intent_source).toBe('intelligence')

        // Clean up synthetic records
        await adminDb.from('conversation_insights').delete().eq('conversation_id', convId)
        await adminDb.from('contact_lead_profiles').delete().eq('contact_id', contactId)
        await adminDb.from('commercial_state_projection_runs').delete().eq('contact_id', contactId)
        await adminDb.from('conversations').delete().eq('id', convId)
        await adminDb.from('contacts').delete().eq('id', contactId)
      }
    )

    it.runIf(Boolean(SUPABASE_SERVICE_ROLE_KEY))(
      'L & M: sweep does not enqueue empty dirty conversation (pending_message_count = 0)',
      async () => {
        if (!adminDb) return

        const tenantId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed'
        const ownerId = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1'
        const contactId = 'c0000000-0000-0000-0000-000000000003'
        await adminDb.from('contacts').upsert({
          id: contactId,
          account_id: tenantId,
          user_id: ownerId,
          name: 'Empty Conversation Test',
          phone: '+5511999990003',
        })

        // Conversation A: dirty but 0 pending messages
        const convEmptyId = 'c0000000-0000-0000-0000-000000000004'
        await adminDb.from('conversations').upsert({
          id: convEmptyId,
          account_id: tenantId,
          user_id: ownerId,
          contact_id: contactId,
          status: 'open',
          commercial_state_dirty: true,
          pending_message_count: 0,
          intelligence_eligible_at: new Date(Date.now() - 10000).toISOString(),
          intelligence_claimed_at: null,
        })

        // Conversation B: dirty with 1 pending message
        const convValidId = 'c0000000-0000-0000-0000-000000000005'
        await adminDb.from('conversations').upsert({
          id: convValidId,
          account_id: tenantId,
          user_id: ownerId,
          contact_id: contactId,
          status: 'open',
          commercial_state_dirty: true,
          pending_message_count: 1,
          intelligence_eligible_at: new Date(Date.now() - 10000).toISOString(),
          intelligence_claimed_at: null,
        })

        // Run sweep
        await adminDb.rpc('sweep_and_enqueue_due_intelligence', {
          p_batch_limit: 10,
          p_lease_seconds: 60,
        })

        // Conversation Empty must NOT be claimed
        const { data: emptyCheck } = await adminDb
          .from('conversations')
          .select('intelligence_claimed_at')
          .eq('id', convEmptyId)
          .single()

        expect(emptyCheck!.intelligence_claimed_at).toBeNull()

        // Conversation Valid MUST be claimed
        const { data: validCheck } = await adminDb
          .from('conversations')
          .select('intelligence_claimed_at')
          .eq('id', convValidId)
          .single()

        expect(validCheck!.intelligence_claimed_at).not.toBeNull()

        // Clean up
        await adminDb.from('conversations').delete().in('id', [convEmptyId, convValidId])
        await adminDb.from('contacts').delete().eq('id', contactId)
      }
    )
  })
})
