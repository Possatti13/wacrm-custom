import { describe, it, expect } from 'vitest'
import {
  validateUuid,
  validateUpsertLeadProfile,
  validateRecordCatalogInterest,
  validateRecordObjection,
  validateInterestStatus,
  validateObjectionStatus,
  validateUrgency,
  validateSentiment,
  LeadValidationError,
} from './validation'

describe('Lead Validation', () => {
  describe('validateUuid', () => {
    it('accepts valid UUIDs', () => {
      expect(validateUuid('11111111-2222-3333-4444-555555555555')).toBe(
        '11111111-2222-3333-4444-555555555555'
      )
    })

    it('rejects invalid UUID strings', () => {
      expect(() => validateUuid('not-a-uuid')).toThrow(LeadValidationError)
      expect(() => validateUuid('')).toThrow(LeadValidationError)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => validateUuid(null as any)).toThrow(LeadValidationError)
    })
  })

  describe('validateUrgency & validateSentiment', () => {
    it('validates urgency options', () => {
      expect(validateUrgency('low')).toBe('low')
      expect(validateUrgency('medium')).toBe('medium')
      expect(validateUrgency('high')).toBe('high')
      expect(validateUrgency(null)).toBeNull()
      expect(validateUrgency(undefined)).toBeNull()
      expect(() => validateUrgency('urgent')).toThrow(LeadValidationError)
    })

    it('validates sentiment options', () => {
      expect(validateSentiment('positive')).toBe('positive')
      expect(validateSentiment('neutral')).toBe('neutral')
      expect(validateSentiment('negative')).toBe('negative')
      expect(validateSentiment('mixed')).toBe('mixed')
      expect(validateSentiment(null)).toBeNull()
      expect(validateSentiment(undefined)).toBeNull()
      expect(() => validateSentiment('angry')).toThrow(LeadValidationError)
    })
  })

  describe('validateUpsertLeadProfile', () => {
    it('validates a complete lead profile', () => {
      const result = validateUpsertLeadProfile({
        summary: 'Cliente interessado em scooter',
        summary_source: 'intelligence',
        current_intent: 'compra',
        current_intent_source: 'intelligence',
        urgency: 'high',
        urgency_source: 'intelligence',
        sentiment: 'positive',
        sentiment_source: 'intelligence',
        next_action: 'Enviar proposta comercial',
        next_action_due_at: '2026-08-20T10:00:00.000Z',
        next_action_source: 'manual',
        source: 'manual',
        attributes: { score_pref: 1 },
      })

      expect(result.summary).toBe('Cliente interessado em scooter')
      expect(result.summary_source).toBe('intelligence')
      expect(result.current_intent).toBe('compra')
      expect(result.urgency).toBe('high')
      expect(result.sentiment).toBe('positive')
      expect(result.next_action).toBe('Enviar proposta comercial')
      expect(result.next_action_due_at).toBe('2026-08-20T10:00:00.000Z')
      expect(result.next_action_source).toBe('manual')
      expect(result.source).toBe('manual')
    })

    it('rejects next_action_due_at without next_action', () => {
      expect(() =>
        validateUpsertLeadProfile({
          next_action_due_at: '2026-08-20T10:00:00.000Z',
        })
      ).toThrow(LeadValidationError)
    })

    it('rejects invalid date string', () => {
      expect(() =>
        validateUpsertLeadProfile({
          next_action: 'Ligar',
          next_action_due_at: 'invalid-date',
        })
      ).toThrow(LeadValidationError)
    })
  })

  describe('validateRecordCatalogInterest', () => {
    it('validates interest input', () => {
      const result = validateRecordCatalogInterest({
        catalog_item_id: '11111111-2222-3333-4444-555555555555',
        source: 'intelligence',
        metadata: { budget: 15000 },
      })
      expect(result.catalog_item_id).toBe('11111111-2222-3333-4444-555555555555')
      expect(result.source).toBe('intelligence')
      expect(result.metadata).toEqual({ budget: 15000 })
    })

    it('rejects invalid catalog item id', () => {
      expect(() =>
        validateRecordCatalogInterest({
          catalog_item_id: 'invalid',
        })
      ).toThrow(LeadValidationError)
    })
  })

  describe('validateRecordObjection', () => {
    it('validates objection input', () => {
      const result = validateRecordObjection({
        objection: 'Preço acima do orçamento',
        source: 'manual',
      })
      expect(result.objection).toBe('Preço acima do orçamento')
      expect(result.source).toBe('manual')
    })

    it('rejects empty objection', () => {
      expect(() =>
        validateRecordObjection({
          objection: '   ',
        })
      ).toThrow(LeadValidationError)
    })
  })

  describe('validate statuses', () => {
    it('validates interest statuses', () => {
      expect(validateInterestStatus('active')).toBe('active')
      expect(validateInterestStatus('inactive')).toBe('inactive')
      expect(validateInterestStatus('dismissed')).toBe('dismissed')
      expect(() => validateInterestStatus('won')).toThrow(LeadValidationError)
    })

    it('validates objection statuses', () => {
      expect(validateObjectionStatus('open')).toBe('open')
      expect(validateObjectionStatus('resolved')).toBe('resolved')
      expect(validateObjectionStatus('dismissed')).toBe('dismissed')
      expect(() => validateObjectionStatus('closed')).toThrow(LeadValidationError)
    })
  })
})
