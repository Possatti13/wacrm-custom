import { describe, it, expect } from 'vitest'
import {
  resolveCatalogTermFromPinnedContext,
  resolveAndValidateObservation,
} from './validation'
import type {
  ClaimMessageItem,
  CatalogItemContextSnapshot,
} from './types'
import type { CanonicalConfigSnapshot } from '@/lib/commercial-config/types'

describe('Intelligence Observation Validation & Pinned Resolution', () => {
  const catalogSnapshot: CatalogItemContextSnapshot[] = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Scooter X-13',
      type: 'product',
      sku: 'SKU-X13',
      terms: [
        { term: 'Scooter X-13', normalized_term: 'scooter x 13', kind: 'canonical' },
        { term: 'X13', normalized_term: 'x13', kind: 'alias' },
        { term: 'moto x13', normalized_term: 'moto x13', kind: 'alias' },
      ],
    },
  ]

  const configSnapshot: CanonicalConfigSnapshot = {
    schemaVersion: 1,
    intents: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        key: 'purchase',
        label: 'Compra',
        description: null,
        status: 'active',
        sort_order: 0,
        metadata: {},
      },
    ],
    attributes: [
      {
        id: '33333333-3333-3333-3333-333333333333',
        key: 'payment_preference',
        label: 'Pagamento',
        description: null,
        value_type: 'single_select',
        options: [
          { key: 'cash', label: 'À Vista' },
          { key: 'financing', label: 'Financiamento' },
        ],
        status: 'active',
        sort_order: 0,
        metadata: {},
      },
    ],
    context: {
      company_description: null,
      commercial_objectives: null,
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
    content_text: 'Olá! Gostei muito da moto X13, mas achei o preço alto.',
    created_at: '2026-08-19T10:00:00Z',
  }

  const messageRefMap = new Map<string, ClaimMessageItem>()
  messageRefMap.set('M1', message1)

  describe('resolveCatalogTermFromPinnedContext', () => {
    it('resolves exact name or alias from pinned snapshot', () => {
      expect(resolveCatalogTermFromPinnedContext(catalogSnapshot, 'Scooter X-13').catalogItemId).toBe(catalogSnapshot[0].id)
      expect(resolveCatalogTermFromPinnedContext(catalogSnapshot, 'x13').catalogItemId).toBe(catalogSnapshot[0].id)
      expect(resolveCatalogTermFromPinnedContext(catalogSnapshot, 'moto x13').catalogItemId).toBe(catalogSnapshot[0].id)
    })

    it('returns null catalogItemId for unregistered terms', () => {
      expect(resolveCatalogTermFromPinnedContext(catalogSnapshot, 'Carro eletrico').catalogItemId).toBeNull()
    })
  })

  describe('resolveAndValidateObservation', () => {
    it('resolves valid interest with alias and evidence span', () => {
      const obs = resolveAndValidateObservation(
        {
          type: 'interest',
          value: 'moto x13',
          catalog_term: 'moto x13',
          confidence: 0.95,
          evidence: [{ message_ref: 'M1', quoted_text: 'moto X13' }],
        },
        { configSnapshot, catalogSnapshot, messageRefMap, extractorVersion: 'v1' }
      )

      expect(obs).not.toBeNull()
      expect(obs?.catalog_item_id).toBe(catalogSnapshot[0].id)
      expect(obs?.insight_type).toBe('interest')
      expect(obs?.evidence.length).toBe(1)
      expect(obs?.evidence[0].start_offset).toBe(21)
      expect(obs?.evidence[0].end_offset).toBe(29)
      expect(obs?.dedupe_key).toBeDefined()
    })

    it('rejects invented intent keys', () => {
      const obs = resolveAndValidateObservation(
        {
          type: 'intent',
          value: 'invented_intent_key',
          evidence: [{ message_ref: 'M1', quoted_text: 'Olá' }],
        },
        { configSnapshot, catalogSnapshot, messageRefMap, extractorVersion: 'v1' }
      )
      expect(obs).toBeNull()
    })

    it('accepts allowed intent key', () => {
      const obs = resolveAndValidateObservation(
        {
          type: 'intent',
          value: 'purchase',
          evidence: [{ message_ref: 'M1', quoted_text: 'Gostei muito' }],
        },
        { configSnapshot, catalogSnapshot, messageRefMap, extractorVersion: 'v1' }
      )
      expect(obs).not.toBeNull()
      expect(obs?.value_text).toBe('purchase')
    })

    it('validates single_select attribute value against pinned options', () => {
      const validObs = resolveAndValidateObservation(
        {
          type: 'attribute',
          attribute_key: 'payment_preference',
          value: 'financing',
          evidence: [{ message_ref: 'M1', quoted_text: 'preço alto' }],
        },
        { configSnapshot, catalogSnapshot, messageRefMap, extractorVersion: 'v1' }
      )
      expect(validObs).not.toBeNull()
      expect(validObs?.value_text).toBe('financing')

      const invalidObs = resolveAndValidateObservation(
        {
          type: 'attribute',
          attribute_key: 'payment_preference',
          value: 'invalid_option',
        },
        { configSnapshot, catalogSnapshot, messageRefMap, extractorVersion: 'v1' }
      )
      expect(invalidObs).toBeNull()
    })
  })
})
