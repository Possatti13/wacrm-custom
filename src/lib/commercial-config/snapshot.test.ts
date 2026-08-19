import { describe, it, expect } from 'vitest'
import { buildCanonicalSnapshot, computeSnapshotHash } from './snapshot'
import type {
  CommercialIntent,
  CommercialAttributeDefinition,
} from './types'

describe('Canonical Config Snapshot & Deterministic Hashing', () => {
  const intent1: CommercialIntent = {
    id: '11111111-1111-1111-1111-111111111111',
    account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    key: 'purchase',
    label: 'Compra de Produto',
    description: 'Cliente quer comprar',
    status: 'active',
    sort_order: 1,
    metadata: {},
    created_at: '2026-08-19T10:00:00Z',
    updated_at: '2026-08-19T10:00:00Z',
  }

  const intent2: CommercialIntent = {
    id: '22222222-2222-2222-2222-222222222222',
    account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    key: 'appointment',
    label: 'Agendamento',
    description: 'Cliente quer agendar',
    status: 'active',
    sort_order: 0,
    metadata: {},
    created_at: '2026-08-19T10:00:00Z',
    updated_at: '2026-08-19T10:00:00Z',
  }

  const attr1: CommercialAttributeDefinition = {
    id: '33333333-3333-3333-3333-333333333333',
    account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    key: 'payment_preference',
    label: 'Forma de Pagamento',
    description: null,
    value_type: 'single_select',
    options: [
      { key: 'financing', label: 'Financiamento' },
      { key: 'cash', label: 'À Vista' },
    ],
    status: 'active',
    sort_order: 0,
    metadata: {},
    created_at: '2026-08-19T10:00:00Z',
    updated_at: '2026-08-19T10:00:00Z',
  }

  it('builds canonical snapshot sorted by sort_order and key', () => {
    const snapshot = buildCanonicalSnapshot({
      intents: [intent1, intent2], // passed in reverse sort order
      attributes: [attr1],
      context: {
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        company_description: 'Loja de mobilidade elétrica',
        commercial_objectives: 'Venda de veículos',
        qualification_guidelines: 'Verificar interesse e orçamento',
        prohibited_assumptions: 'Nunca assumir aprovação prévia de crédito',
        terminology_notes: null,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
      terminology: {
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        contact_label_singular: 'Lead',
        contact_label_plural: 'Leads',
        catalog_item_label_singular: 'Veículo',
        catalog_item_label_plural: 'Veículos',
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
    })

    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.intents[0].key).toBe('appointment') // sort_order 0
    expect(snapshot.intents[1].key).toBe('purchase') // sort_order 1
    // options are sorted by key
    expect(snapshot.attributes[0].options[0].key).toBe('cash')
    expect(snapshot.attributes[0].options[1].key).toBe('financing')
  })

  it('computes identical SHA-256 hash regardless of input array ordering', () => {
    const snap1 = buildCanonicalSnapshot({
      intents: [intent1, intent2],
      attributes: [attr1],
    })

    const snap2 = buildCanonicalSnapshot({
      intents: [intent2, intent1],
      attributes: [attr1],
    })

    const hash1 = computeSnapshotHash(snap1)
    const hash2 = computeSnapshotHash(snap2)

    expect(hash1).toBe(hash2)
  })

  it('includes active, inactive, and archived definitions in snapshot', () => {
    const archivedIntent: CommercialIntent = {
      ...intent1,
      id: '44444444-4444-4444-4444-444444444444',
      key: 'old_intent',
      status: 'archived',
    }

    const snapshot = buildCanonicalSnapshot({
      intents: [intent1, archivedIntent],
      attributes: [],
    })

    expect(snapshot.intents.length).toBe(2)
    expect(snapshot.intents.find((i) => i.status === 'archived')).toBeDefined()
  })
})
