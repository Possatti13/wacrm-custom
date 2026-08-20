import { describe, it, expect } from 'vitest'
import {
  validateRuleKey,
  validateSignalType,
  validateOperator,
  validateScoreRange,
  validateLeadScoringRule,
  ScoringValidationError,
} from './validation'

describe('Lead Scoring Validation', () => {
  it('validates rule_key regex strictly', () => {
    expect(validateRuleKey('purchase_intent')).toBe('purchase_intent')
    expect(validateRuleKey('urgency_1')).toBe('urgency_1')

    expect(() => validateRuleKey('a')).toThrow(ScoringValidationError)
    expect(() => validateRuleKey('Invalid-Key!')).toThrow(ScoringValidationError)
    expect(() => validateRuleKey('')).toThrow(ScoringValidationError)
  })

  it('validates signal types and operators', () => {
    expect(validateSignalType('profile_field')).toBe('profile_field')
    expect(validateSignalType('attribute')).toBe('attribute')
    expect(() => validateSignalType('unknown_signal')).toThrow(ScoringValidationError)

    expect(validateOperator('equals')).toBe('equals')
    expect(validateOperator('gte')).toBe('gte')
    expect(() => validateOperator('invalid_op')).toThrow(ScoringValidationError)
  })

  it('validates score range bounds 0 <= min <= base <= max <= 100', () => {
    expect(() => validateScoreRange(0, 10, 100)).not.toThrow()
    expect(() => validateScoreRange(20, 20, 80)).not.toThrow()

    expect(() => validateScoreRange(-5, 10, 100)).toThrow(ScoringValidationError)
    expect(() => validateScoreRange(50, 10, 100)).toThrow(ScoringValidationError) // min > base
    expect(() => validateScoreRange(0, 120, 100)).toThrow(ScoringValidationError) // base > max
    expect(() => validateScoreRange(0, 10, 150)).toThrow(ScoringValidationError) // max > 100
  })

  it('validates full LeadScoringRule object', () => {
    const valid = validateLeadScoringRule({
      rule_key: 'high_urgency',
      label: 'High Urgency',
      signal_type: 'profile_field',
      field_key: 'urgency',
      operator: 'equals',
      expected_value: 'high',
      points: 20,
    })

    expect(valid.rule_key).toBe('high_urgency')
    expect(valid.points).toBe(20)
    expect(valid.status).toBe('active')
  })
})
