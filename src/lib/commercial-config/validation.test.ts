import { describe, it, expect } from 'vitest'
import {
  validateKey,
  validateSelectOptions,
  validateSaveIntent,
  validateSaveAttributeDefinition,
  validateLeadProfileAttributes,
  validateCurrentIntentAssignment,
  CommercialConfigValidationError,
} from './validation'
import type {
  CommercialAttributeDefinition,
  CommercialIntent,
} from './types'

describe('Tenant Commercial Config Validation', () => {
  describe('validateKey', () => {
    it('accepts valid programmatic keys', () => {
      expect(validateKey('purchase')).toBe('purchase')
      expect(validateKey('quote_request')).toBe('quote_request')
      expect(validateKey('appointment_v2')).toBe('appointment_v2')
    })

    it('normalizes uppercase to lowercase', () => {
      expect(validateKey('PURCHASE_INTENT')).toBe('purchase_intent')
    })

    it('rejects invalid characters, spaces, or wrong length', () => {
      expect(() => validateKey('p')).toThrow(CommercialConfigValidationError)
      expect(() => validateKey('purchase intent with spaces')).toThrow(CommercialConfigValidationError)
      expect(() => validateKey('purchase-intent-hyphen')).toThrow(CommercialConfigValidationError)
      expect(() => validateKey('a'.repeat(65))).toThrow(CommercialConfigValidationError)
    })
  })

  describe('validateSelectOptions', () => {
    it('accepts valid options array', () => {
      const options = [
        { key: 'financing', label: 'Financiamento' },
        { key: 'cash', label: 'À Vista' },
      ]
      const result = validateSelectOptions(options)
      expect(result.length).toBe(2)
      expect(result[0].key).toBe('financing')
    })

    it('rejects duplicate option keys', () => {
      const options = [
        { key: 'financing', label: 'Financiamento' },
        { key: 'financing', label: 'Financiamento 2' },
      ]
      expect(() => validateSelectOptions(options)).toThrow(CommercialConfigValidationError)
    })

    it('rejects empty options or missing label', () => {
      expect(() => validateSelectOptions([])).toThrow(CommercialConfigValidationError)
      expect(() => validateSelectOptions([{ key: 'opt', label: '' }])).toThrow(CommercialConfigValidationError)
    })
  })

  describe('validateSaveIntent & validateSaveAttributeDefinition', () => {
    it('validates intent payload', () => {
      const result = validateSaveIntent({
        key: 'purchase',
        label: 'Compra de Produto',
        description: 'Interesse explícito em comprar',
      })
      expect(result.key).toBe('purchase')
      expect(result.status).toBe('active')
    })

    it('validates attribute definition payload with select options', () => {
      const result = validateSaveAttributeDefinition({
        key: 'payment_preference',
        label: 'Preferência de Pagamento',
        value_type: 'single_select',
        options: [
          { key: 'cash', label: 'À vista' },
          { key: 'financing', label: 'Financiamento' },
        ],
      })
      expect(result.key).toBe('payment_preference')
      expect(result.options?.length).toBe(2)
    })
  })

  describe('validateLeadProfileAttributes', () => {
    const definitions: CommercialAttributeDefinition[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key: 'budget',
        label: 'Orçamento',
        description: null,
        value_type: 'number',
        options: [],
        status: 'active',
        sort_order: 0,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key: 'payment_preference',
        label: 'Pagamento',
        description: null,
        value_type: 'single_select',
        options: [
          { key: 'cash', label: 'À vista' },
          { key: 'financing', label: 'Financiamento' },
        ],
        status: 'active',
        sort_order: 1,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key: 'interests_list',
        label: 'Lista de Interesses',
        description: null,
        value_type: 'multi_select',
        options: [
          { key: 'scooter', label: 'Scooter' },
          { key: 'moto', label: 'Moto' },
          { key: 'bike', label: 'Bicicleta' },
        ],
        status: 'active',
        sort_order: 2,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
      {
        id: '44444444-4444-4444-4444-444444444444',
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key: 'archived_field',
        label: 'Campo Antigo',
        description: null,
        value_type: 'text',
        options: [],
        status: 'archived',
        sort_order: 3,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
    ]

    it('validates attributes adhering strictly to the contract', () => {
      const input = {
        budget: 15000,
        payment_preference: 'financing',
        interests_list: ['scooter', 'moto'],
      }

      const validated = validateLeadProfileAttributes(definitions, input)
      expect(validated).toEqual({
        budget: 15000,
        payment_preference: 'financing',
        interests_list: ['scooter', 'moto'],
      })
    })

    it('rejects unknown attribute key', () => {
      expect(() =>
        validateLeadProfileAttributes(definitions, {
          unregistered_key: 'some_value',
        })
      ).toThrow(CommercialConfigValidationError)
    })

    it('rejects archived attribute definition for new assignment', () => {
      expect(() =>
        validateLeadProfileAttributes(definitions, {
          archived_field: 'teste',
        })
      ).toThrow(CommercialConfigValidationError)
    })

    it('rejects invalid single_select option key', () => {
      expect(() =>
        validateLeadProfileAttributes(definitions, {
          payment_preference: 'bitcoin', // not in cash | financing
        })
      ).toThrow(CommercialConfigValidationError)
    })

    it('rejects invalid multi_select option key', () => {
      expect(() =>
        validateLeadProfileAttributes(definitions, {
          interests_list: ['scooter', 'carro_voador'],
        })
      ).toThrow(CommercialConfigValidationError)
    })
  })

  describe('validateCurrentIntentAssignment', () => {
    const intents: CommercialIntent[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key: 'purchase',
        label: 'Compra',
        description: null,
        status: 'active',
        sort_order: 0,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        account_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key: 'quote',
        label: 'Orçamento',
        description: null,
        status: 'archived',
        sort_order: 1,
        metadata: {},
        created_at: '2026-08-19T10:00:00Z',
        updated_at: '2026-08-19T10:00:00Z',
      },
    ]

    it('accepts null or empty current_intent', () => {
      expect(validateCurrentIntentAssignment(intents, null)).toBeNull()
      expect(validateCurrentIntentAssignment(intents, '')).toBeNull()
    })

    it('accepts active intent key', () => {
      expect(validateCurrentIntentAssignment(intents, 'purchase')).toBe('purchase')
      expect(validateCurrentIntentAssignment(intents, 'PURCHASE')).toBe('purchase')
    })

    it('rejects unrecognized intent key', () => {
      expect(() => validateCurrentIntentAssignment(intents, 'unknown_intent')).toThrow(
        CommercialConfigValidationError
      )
    })

    it('rejects archived intent key for new assignments', () => {
      expect(() => validateCurrentIntentAssignment(intents, 'quote')).toThrow(
        CommercialConfigValidationError
      )
    })
  })
})
