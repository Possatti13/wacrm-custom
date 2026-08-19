import { describe, it, expect } from 'vitest'
import {
  validateUuid,
  validateInsightType,
  validateInsightStatus,
  validateConfidence,
  validateCreateInsight,
  validateSupersedeInsight,
  InsightValidationError,
} from './validation'

describe('Insight Validation', () => {
  describe('validateUuid', () => {
    it('accepts valid UUIDs', () => {
      expect(validateUuid('11111111-2222-3333-4444-555555555555')).toBe(
        '11111111-2222-3333-4444-555555555555'
      )
    })

    it('rejects invalid UUIDs', () => {
      expect(() => validateUuid('not-a-uuid')).toThrow(InsightValidationError)
      expect(() => validateUuid('')).toThrow(InsightValidationError)
    })
  })

  describe('validateConfidence', () => {
    it('accepts confidence between 0.0 and 1.0', () => {
      expect(validateConfidence(0.85)).toBe(0.85)
      expect(validateConfidence(0)).toBe(0)
      expect(validateConfidence(1)).toBe(1)
      expect(validateConfidence(null)).toBeNull()
      expect(validateConfidence(undefined)).toBeNull()
    })

    it('rejects confidence out of range', () => {
      expect(() => validateConfidence(-0.1)).toThrow(InsightValidationError)
      expect(() => validateConfidence(1.05)).toThrow(InsightValidationError)
      expect(() => validateConfidence('invalid')).toThrow(InsightValidationError)
    })
  })

  describe('validateInsightType & validateInsightStatus', () => {
    it('validates 8 canonical insight types', () => {
      expect(validateInsightType('interest')).toBe('interest')
      expect(validateInsightType('objection')).toBe('objection')
      expect(validateInsightType('intent')).toBe('intent')
      expect(validateInsightType('urgency')).toBe('urgency')
      expect(validateInsightType('sentiment')).toBe('sentiment')
      expect(validateInsightType('next_action')).toBe('next_action')
      expect(validateInsightType('summary')).toBe('summary')
      expect(validateInsightType('attribute')).toBe('attribute')
      expect(() => validateInsightType('custom_bad_type')).toThrow(InsightValidationError)
    })

    it('validates insight statuses', () => {
      expect(validateInsightStatus('active')).toBe('active')
      expect(validateInsightStatus('superseded')).toBe('superseded')
      expect(validateInsightStatus('retracted')).toBe('retracted')
      expect(() => validateInsightStatus('deleted')).toThrow(InsightValidationError)
    })
  })

  describe('validateCreateInsight', () => {
    it('validates a complete insight input', () => {
      const result = validateCreateInsight({
        insight_type: 'intent',
        value_text: 'compra',
        confidence: 0.92,
        source: 'intelligence',
        evidence: [
          {
            message_id: '11111111-2222-3333-4444-555555555555',
            start_offset: 0,
            end_offset: 15,
            snippet: 'Quero comprar!',
          },
        ],
      })

      expect(result.insight_type).toBe('intent')
      expect(result.value_text).toBe('compra')
      expect(result.confidence).toBe(0.92)
      expect(result.source).toBe('intelligence')
      expect(result.evidence?.length).toBe(1)
    })

    it('requires catalog_item_id or value_text for interest', () => {
      expect(() =>
        validateCreateInsight({
          insight_type: 'interest',
        })
      ).toThrow(InsightValidationError)
    })
  })

  describe('validateSupersedeInsight', () => {
    it('validates supersede payload', () => {
      const result = validateSupersedeInsight({
        new_insight_type: 'objection',
        new_value_text: 'prazo entrega longo',
        new_source: 'manual',
      })
      expect(result.new_insight_type).toBe('objection')
      expect(result.new_value_text).toBe('prazo entrega longo')
      expect(result.new_source).toBe('manual')
    })
  })
})
