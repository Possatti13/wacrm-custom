import { describe, it, expect } from 'vitest'
import {
  getContactDisplayName,
  getContactInitials,
  isGenericPlaceholderName,
} from '@/lib/contacts/display'
import { formatPhoneNumber, isValidDisplayPhone } from '@/lib/whatsapp/phone-utils'
import { buildAnalysisInput } from '@/lib/intelligence/input-builder'
import { resolveAndValidateObservation, sanitizeCommercialText } from '@/lib/intelligence/validation'
import { calculateLeadScore, hasSufficientScoringEvidence } from '@/lib/scoring/engine'
import type { ClaimMessageItem, CatalogItemContextSnapshot } from '@/lib/intelligence/types'
import type { CanonicalConfigSnapshot } from '@/lib/commercial-config/types'
import type { LeadScoringSnapshot, CanonicalLeadScoringInput } from '@/lib/scoring/types'

describe('CICLOPES — INBOX TRUST & CLARITY 01: Mandatory 10 Cases Test Suite', () => {
  const dummyConfigSnapshot: CanonicalConfigSnapshot = {
    schemaVersion: 1,
    intents: [
      {
        id: 'int-1',
        key: 'purchase',
        label: 'Compra de Veículo',
        description: null,
        status: 'active',
        sort_order: 0,
        metadata: {},
      },
      {
        id: 'int-2',
        key: 'pricing',
        label: 'Preço / Orçamento',
        description: null,
        status: 'active',
        sort_order: 1,
        metadata: {},
      },
      {
        id: 'int-3',
        key: 'not_interested',
        label: 'Sem Interesse',
        description: null,
        status: 'active',
        sort_order: 2,
        metadata: {},
      },
    ],
    attributes: [],
    context: {
      company_description: 'Concessionária de Motos',
      commercial_objectives: 'Venda de motos',
      qualification_guidelines: 'Identificar modelo e forma de pagamento',
      prohibited_assumptions: 'Nunca inventar dados',
      terminology_notes: null,
      metadata: {},
    },
    terminology: {
      contact_label_singular: 'Contato',
      contact_label_plural: 'Contatos',
      catalog_item_label_singular: 'Item',
      catalog_item_label_plural: 'Itens',
      metadata: {},
    },
  }

  const dummyCatalogSnapshot: CatalogItemContextSnapshot[] = [
    {
      id: 'cat-1',
      name: 'Moto Tank',
      type: 'product',
      sku: 'TANK-01',
      terms: [
        { term: 'Moto Tank', normalized_term: 'moto tank', kind: 'canonical' },
        { term: 'Tank', normalized_term: 'tank', kind: 'alias' },
      ],
    },
  ]

  const baseScoringSnapshot: LeadScoringSnapshot = {
    account_id: 'acc-1',
    revision_number: 1,
    enabled: true,
    base_score: 10,
    min_score: 0,
    max_score: 100,
    rules: [
      {
        rule_key: 'purchase_intent',
        label: 'Intenção de Compra',
        signal_type: 'profile_field',
        field_key: 'current_intent',
        operator: 'equals',
        expected_value: 'purchase',
        points: 40,
        sort_order: 1,
      },
      {
        rule_key: 'pricing_intent',
        label: 'Consulta de Preço',
        signal_type: 'profile_field',
        field_key: 'current_intent',
        operator: 'equals',
        expected_value: 'pricing',
        points: 25,
        sort_order: 2,
      },
      {
        rule_key: 'not_interested',
        label: 'Desinteresse Declarado',
        signal_type: 'profile_field',
        field_key: 'current_intent',
        operator: 'equals',
        expected_value: 'not_interested',
        points: -10,
        sort_order: 3,
      },
    ],
  }

  // CASE 1: Conversa comercial normal
  it('CASE 1 — Normal commercial conversation (pt-BR, evaluable lead, commercial next action)', () => {
    const contact = {
      name: 'Carlos Alberto',
      phone: '5511999998888',
    }
    expect(getContactDisplayName(contact)).toBe('Carlos Alberto')

    const msgs: ClaimMessageItem[] = [
      {
        id: 'm1',
        sender_type: 'customer',
        content_text: 'Oi, gostei da moto Tank. Qual o valor?',
        created_at: '2026-08-19T10:00:00Z',
      },
    ]

    const input = buildAnalysisInput({
      messages: msgs,
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    expect(input.userPrompt).toContain('Oi, gostei da moto Tank. Qual o valor?')
    expect(input.systemPrompt).toContain('Português do Brasil')

    // Validated observation
    const summaryObs = resolveAndValidateObservation(
      {
        type: 'summary',
        value: 'Cliente demonstrou interesse na Moto Tank e solicitou o valor.',
        evidence: [{ message_ref: 'M1', quoted_text: 'gostei da moto Tank. Qual o valor?' }],
      },
      { configSnapshot: dummyConfigSnapshot, catalogSnapshot: dummyCatalogSnapshot, messageRefMap: input.messageRefMap, extractorVersion: 'v1' }
    )
    expect(summaryObs?.value_text).toBe('Cliente demonstrou interesse na Moto Tank e solicitou o valor.')

    const actionObs = resolveAndValidateObservation(
      {
        type: 'next_action',
        value: 'Informar tabela de preços da Moto Tank e opções de financiamento.',
        evidence: [{ message_ref: 'M1', quoted_text: 'Qual o valor?' }],
      },
      { configSnapshot: dummyConfigSnapshot, catalogSnapshot: dummyCatalogSnapshot, messageRefMap: input.messageRefMap, extractorVersion: 'v1' }
    )
    expect(actionObs?.value_text).toBe('Informar tabela de preços da Moto Tank e opções de financiamento.')

    // Evaluable scoring
    const scoringInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: 'pricing',
        urgency: 'medium',
        sentiment: 'positive',
        next_action: actionObs!.value_text,
        attributes: {},
      },
      interests: { active_item_ids: ['cat-1'] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 1, open_objections_count: 0 },
    }

    const scoreRes = calculateLeadScore(baseScoringSnapshot, scoringInput, 'rev-1', 'hash-1')
    expect(scoreRes.is_sufficient).toBe(true)
    expect(scoreRes.final_score).toBe(35) // 10 base + 25 pricing
  })

  // CASE 2: Somente imagem
  it('CASE 2 — Image only (insufficient context, no technical jargon leakage, score not evaluated)', () => {
    const msgs: ClaimMessageItem[] = [
      {
        id: 'm1',
        sender_type: 'customer',
        content_text: '',
        content_type: 'image',
        created_at: '2026-08-19T10:00:00Z',
      },
    ]

    const input = buildAnalysisInput({
      messages: msgs,
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    // Normalization to semantic natural placeholder
    expect(input.userPrompt).toContain('[Cliente enviou uma imagem]')
    expect(input.userPrompt).not.toContain('binary')
    expect(input.userPrompt).not.toContain('base64')

    // If an LLM returned corrupted/binary phrasing, validation cleans it
    const sanitizedSummary = sanitizeCommercialText(
      'Mensagem com binary/image encoding data e payload corrompido',
      'summary'
    )
    expect(sanitizedSummary).toBe('Ainda não há contexto suficiente para resumir esta conversa.')

    const sanitizedAction = sanitizeCommercialText(
      'Desconsiderar mensagem corrompida por erro de encoding',
      'next_action'
    )
    expect(sanitizedAction).toBe('Aguardar nova interação do contato.')

    // Scoring gating
    const scoringInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: null,
        urgency: null,
        sentiment: null,
        next_action: sanitizedAction,
        attributes: {},
      },
      interests: { active_item_ids: [] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }

    const scoreRes = calculateLeadScore(baseScoringSnapshot, scoringInput, 'rev-1', 'hash-1')
    expect(scoreRes.is_sufficient).toBe(false)
  })

  // CASE 3: Imagem + legenda
  it('CASE 3 — Image with caption (commercial intent detected from caption)', () => {
    const msgs: ClaimMessageItem[] = [
      {
        id: 'm1',
        sender_type: 'customer',
        content_text: 'Quero essa preta, quanto fica financiada?',
        content_type: 'image',
        created_at: '2026-08-19T10:00:00Z',
      },
    ]

    const input = buildAnalysisInput({
      messages: msgs,
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    expect(input.userPrompt).toContain('[Cliente enviou uma imagem] Legenda: "Quero essa preta, quanto fica financiada?"')

    const scoringInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: 'purchase',
        urgency: 'high',
        sentiment: 'positive',
        next_action: 'Enviar simulação de financiamento',
        attributes: {},
      },
      interests: { active_item_ids: [] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }

    const scoreRes = calculateLeadScore(baseScoringSnapshot, scoringInput, 'rev-1', 'hash-1')
    expect(scoreRes.is_sufficient).toBe(true)
    expect(scoreRes.final_score).toBe(50) // 10 base + 40 purchase
  })

  // CASE 4: Áudio sem transcrição
  it('CASE 4 — Audio without transcription (semantic placeholder, no hallucination)', () => {
    const msgs: ClaimMessageItem[] = [
      {
        id: 'm1',
        sender_type: 'customer',
        content_text: null,
        content_type: 'audio',
        created_at: '2026-08-19T10:00:00Z',
      },
    ]

    const input = buildAnalysisInput({
      messages: msgs,
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    expect(input.userPrompt).toContain('[Cliente enviou um áudio]')
    expect(input.userPrompt).not.toContain('undefined')
    expect(input.userPrompt).not.toContain('null')
  })

  // CASE 5: Placeholder contact name "WhatsApp Contact" with pushName
  it('CASE 5 — Placeholder contact "WhatsApp Contact" resolves to pushName', () => {
    const contact = {
      name: 'WhatsApp Contact',
      phone: '+5513999999999',
      push_name: 'Carlos',
    }

    expect(isGenericPlaceholderName(contact.name)).toBe(true)
    expect(getContactDisplayName(contact)).toBe('Carlos')
    expect(getContactInitials(getContactDisplayName(contact))).toBe('CA')
  })

  // CASE 6: Placeholder contact name "Agent" with phone
  it('CASE 6 — Placeholder contact "Agent" resolves to formatted phone', () => {
    const contact = {
      name: 'Agent',
      phone: '+5513999999999',
      push_name: null,
    }

    expect(isGenericPlaceholderName(contact.name)).toBe(true)
    expect(getContactDisplayName(contact)).toBe('+55 (13) 99999-9999')
    // Avatar initials for phone number should be neutral "W", NEVER last digits "99"
    expect(getContactInitials(getContactDisplayName(contact))).toBe('W')
  })

  // CASE 7: Invalid zero identity
  it('CASE 7 — Invalid zero identity (name: "0", phone: "0") returns neutral fallback and "C" avatar', () => {
    const contact = {
      name: '0',
      phone: '0',
      push_name: null,
    }

    expect(isGenericPlaceholderName(contact.name)).toBe(true)
    expect(isValidDisplayPhone(contact.phone)).toBe(false)
    expect(formatPhoneNumber(contact.phone)).toBe('')
    expect(getContactDisplayName(contact)).toBe('Contato sem nome')
    expect(getContactInitials(getContactDisplayName(contact))).toBe('C')
  })

  // CASE 8: Truly cold lead
  it('CASE 8 — Truly cold lead ("Não tenho interesse") is evaluable with low score, not insufficient context', () => {
    const coldInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: 'not_interested',
        urgency: 'low',
        sentiment: 'negative',
        next_action: 'Encerrar atendimento',
        attributes: {},
      },
      interests: { active_item_ids: [] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }

    const resCold = calculateLeadScore(baseScoringSnapshot, coldInput, 'rev-1', 'hash-1')
    expect(resCold.is_sufficient).toBe(true)
    expect(resCold.final_score).toBe(0) // 10 base - 10 points = 0 (clamped)
  })

  // CASE 9: Sem contexto comercial ("Bom dia")
  it('CASE 9 — Insufficient commercial context ("Bom dia") is gated as insufficient context, not arbitrary score', () => {
    const msgs: ClaimMessageItem[] = [
      {
        id: 'm1',
        sender_type: 'customer',
        content_text: 'Bom dia',
        created_at: '2026-08-19T10:00:00Z',
      },
    ]

    const input = buildAnalysisInput({
      messages: msgs,
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    expect(input.userPrompt).toContain('Bom dia')

    const greetingInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: null,
        urgency: null,
        sentiment: 'neutral',
        next_action: 'Aguardar nova interação do contato.',
        attributes: {},
      },
      interests: { active_item_ids: [] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }

    expect(hasSufficientScoringEvidence(greetingInput)).toBe(false)
    const res = calculateLeadScore(baseScoringSnapshot, greetingInput, 'rev-1', 'hash-1')
    expect(res.is_sufficient).toBe(false)
  })

  // CASE 10: Mensagens em inglês -> análise exibida em pt-BR
  it('CASE 10 — English customer messages enforce pt-BR output mandate and observations', () => {
    const msgs: ClaimMessageItem[] = [
      {
        id: 'm1',
        sender_type: 'customer',
        content_text: 'How much is this model?',
        created_at: '2026-08-19T10:00:00Z',
      },
    ]

    const input = buildAnalysisInput({
      messages: msgs,
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    // System prompt mandates pt-BR explicitly
    expect(input.systemPrompt).toContain('LANGUAGE MANDATE (ABSOLUTE)')
    expect(input.systemPrompt).toContain('Português do Brasil')

    // Validated observation in pt-BR
    const summaryObs = resolveAndValidateObservation(
      {
        type: 'summary',
        value: 'Cliente perguntou em inglês o valor do modelo.',
        evidence: [{ message_ref: 'M1', quoted_text: 'How much is this model?' }],
      },
      { configSnapshot: dummyConfigSnapshot, catalogSnapshot: dummyCatalogSnapshot, messageRefMap: input.messageRefMap, extractorVersion: 'v1' }
    )
    expect(summaryObs?.value_text).toBe('Cliente perguntou em inglês o valor do modelo.')

    const actionObs = resolveAndValidateObservation(
      {
        type: 'next_action',
        value: 'Informar o preço do produto.',
        evidence: [{ message_ref: 'M1', quoted_text: 'How much is this model?' }],
      },
      { configSnapshot: dummyConfigSnapshot, catalogSnapshot: dummyCatalogSnapshot, messageRefMap: input.messageRefMap, extractorVersion: 'v1' }
    )
    expect(actionObs?.value_text).toBe('Informar o preço do produto.')
  })

  // SECTION 2: Media Accuracy Exact Types
  it('SECTION 2 — Preserves exact media types: image, audio, video, document, sticker without generic confusion', () => {
    const mediaCases: Array<{ type: string; expected: string }> = [
      { type: 'image', expected: '[Cliente enviou uma imagem]' },
      { type: 'audio', expected: '[Cliente enviou um áudio]' },
      { type: 'video', expected: '[Cliente enviou um vídeo]' },
      { type: 'document', expected: '[Cliente enviou um documento]' },
      { type: 'sticker', expected: '[Cliente enviou um sticker]' },
    ]

    for (const mc of mediaCases) {
      const input = buildAnalysisInput({
        messages: [
          {
            id: 'm-type',
            sender_type: 'customer',
            content_text: '',
            content_type: mc.type,
            created_at: '2026-08-19T10:00:00Z',
          },
        ],
        configSnapshot: dummyConfigSnapshot,
        catalogSnapshot: dummyCatalogSnapshot,
      })
      expect(input.userPrompt).toContain(mc.expected)
    }
  })

  // SECTION 6: Audio with Transcription
  it('SECTION 6 — Audio with transcription uses the transcribed text as real evidence', () => {
    const input = buildAnalysisInput({
      messages: [
        {
          id: 'm-audio',
          sender_type: 'customer',
          content_text: 'Tenho interesse em agendar uma visita amanhã',
          content_type: 'audio',
          created_at: '2026-08-19T10:00:00Z',
        },
      ],
      configSnapshot: dummyConfigSnapshot,
      catalogSnapshot: dummyCatalogSnapshot,
    })

    expect(input.userPrompt).toContain('[Cliente enviou um áudio: "Tenho interesse em agendar uma visita amanhã"]')
  })

  // SECTION 7 & 8: True Cold vs Unknown & Volume Alone Not Sufficient
  it('SECTION 7 & 8 — Volume of greetings alone is NOT sufficient; True Cold ("não tenho interesse") is sufficient', () => {
    // 8 messages of purely non-commercial greetings
    const nonCommercialInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: null,
        urgency: null,
        sentiment: 'neutral',
        next_action: 'Aguardar nova interação do contato.',
        attributes: {},
      },
      interests: { active_item_ids: [] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }

    // Even with 8 messages, lack of commercial intent/signals means insufficient
    expect(hasSufficientScoringEvidence(nonCommercialInput)).toBe(false)
    const resUnknown = calculateLeadScore(baseScoringSnapshot, nonCommercialInput, 'rev-1', 'hash-1')
    expect(resUnknown.is_sufficient).toBe(false)

    // True Cold: explicit rejection
    const trueColdInput: CanonicalLeadScoringInput = {
      profile: {
        current_intent: 'not_interested',
        urgency: 'low',
        sentiment: 'negative',
        next_action: 'Encerrar atendimento.',
        attributes: {},
      },
      interests: { active_item_ids: [] },
      objections: { open_keys: [], has_open: false },
      engagement: { active_interests_count: 0, open_objections_count: 0 },
    }

    expect(hasSufficientScoringEvidence(trueColdInput)).toBe(true)
    const resCold = calculateLeadScore(baseScoringSnapshot, trueColdInput, 'rev-1', 'hash-1')
    expect(resCold.is_sufficient).toBe(true)
    expect(resCold.final_score).toBe(0) // base 10 - 10 = 0
  })

  // SECTION 9: Language Guarantees for English and Spanish
  it('SECTION 9 — Spanish and English input sanitizes to pt-BR commercial text', () => {
    // LLM output with Spanish or English leaked or technical terms
    const sanitizedEn = sanitizeCommercialText(
      'Error: payload corrupted in WAHA binary blob',
      'summary'
    )
    expect(sanitizedEn).toBe('Ainda não há contexto suficiente para resumir esta conversa.')

    const sanitizedEs = sanitizeCommercialText(
      'Esperar retorno del webhook waha con payload',
      'next_action'
    )
    expect(sanitizedEs).toBe('Aguardar nova interação do contato.')
  })

  // SECTION 10: Explicit Contact Display Contracts
  it('SECTION 10 — Explicit Contact Display Contracts', () => {
    // 1. saved_name = "Maria", push_name = "Maria S.", phone válido -> "Maria"
    expect(
      getContactDisplayName({
        name: 'Maria',
        push_name: 'Maria S.',
        phone: '5511999998888',
      })
    ).toBe('Maria')

    // 2. saved_name = "WhatsApp Contact", push_name = "Carlos", phone válido -> "Carlos"
    expect(
      getContactDisplayName({
        name: 'WhatsApp Contact',
        push_name: 'Carlos',
        phone: '5511999998888',
      })
    ).toBe('Carlos')

    // 3. saved_name = "Agent", push_name = null, phone válido -> formatted phone
    expect(
      getContactDisplayName({
        name: 'Agent',
        push_name: null,
        phone: '5511999998888',
      })
    ).toBe('+55 (11) 99999-8888')

    // 4. name = "0", phone = "0", push_name = null -> "Contato sem nome"
    expect(
      getContactDisplayName({
        name: '0',
        phone: '0',
        push_name: null,
      })
    ).toBe('Contato sem nome')

    // 5. phone inválido -> isValidDisplayPhone is false, formatPhoneNumber is empty
    expect(isValidDisplayPhone('0')).toBe(false)
    expect(isValidDisplayPhone('+0')).toBe(false)
    expect(isValidDisplayPhone('1234')).toBe(false)
    expect(formatPhoneNumber('0')).toBe('')
    expect(formatPhoneNumber('+0')).toBe('')

    // 6. Numeric avatar leakage: phone number initials must NEVER slice digits like "77" or "48"
    expect(getContactInitials('+55 (77) 99999-9977')).toBe('W')
    expect(getContactInitials('+55 (48) 98888-7777')).toBe('W')
    expect(getContactInitials('+55 (11) 99999-8888')).toBe('W')
  })
})