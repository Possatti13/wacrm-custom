import type {
  ScoringSignalType,
  ScoringOperator,
  LeadScoringRule,
} from './types'

export class ScoringValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoringValidationError'
  }
}

const RULE_KEY_REGEX = /^[a-z0-9_]{2,64}$/

export const VALID_SIGNALS: Set<ScoringSignalType> = new Set([
  'profile_field',
  'attribute',
  'catalog_interest',
  'objection_presence',
  'objection_key',
  'engagement_metric',
])

export const VALID_OPERATORS: Set<ScoringOperator> = new Set([
  'equals',
  'not_equals',
  'in',
  'exists',
  'not_exists',
  'gt',
  'gte',
  'lt',
  'lte',
])

export function validateRuleKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new ScoringValidationError('rule_key must be a non-empty string')
  }
  const trimmed = key.trim().toLowerCase()
  if (!RULE_KEY_REGEX.test(trimmed)) {
    throw new ScoringValidationError(
      `Invalid rule_key '${key}': must be 2-64 lowercase alphanumeric and underscore characters (^[a-z0-9_]{2,64}$)`
    )
  }
  return trimmed
}

export function validateSignalType(type: string): ScoringSignalType {
  if (!VALID_SIGNALS.has(type as ScoringSignalType)) {
    throw new ScoringValidationError(
      `Invalid signal_type '${type}': must be one of ${Array.from(VALID_SIGNALS).join(', ')}`
    )
  }
  return type as ScoringSignalType
}

export function validateOperator(op: string): ScoringOperator {
  if (!VALID_OPERATORS.has(op as ScoringOperator)) {
    throw new ScoringValidationError(
      `Invalid operator '${op}': must be one of ${Array.from(VALID_OPERATORS).join(', ')}`
    )
  }
  return op as ScoringOperator
}

export function validateScoreRange(min: number, base: number, max: number): void {
  if (
    typeof min !== 'number' ||
    typeof base !== 'number' ||
    typeof max !== 'number' ||
    !Number.isInteger(min) ||
    !Number.isInteger(base) ||
    !Number.isInteger(max)
  ) {
    throw new ScoringValidationError('min_score, base_score, and max_score must be integers')
  }

  if (min < 0 || min > base || base > max || max > 100) {
    throw new ScoringValidationError(
      `Invalid score range: must satisfy 0 <= min_score (${min}) <= base_score (${base}) <= max_score (${max}) <= 100`
    )
  }
}

export function validateLeadScoringRule(rule: Partial<LeadScoringRule>): LeadScoringRule {
  if (!rule || typeof rule !== 'object') {
    throw new ScoringValidationError('Rule must be an object')
  }

  const rule_key = validateRuleKey(rule.rule_key || '')
  const label = typeof rule.label === 'string' && rule.label.trim().length > 0
    ? rule.label.trim()
    : rule_key

  const signal_type = validateSignalType(rule.signal_type || '')
  const operator = validateOperator(rule.operator || '')

  if (typeof rule.points !== 'number' || !Number.isInteger(rule.points)) {
    throw new ScoringValidationError(`points for rule '${rule_key}' must be an integer`)
  }

  if (signal_type === 'engagement_metric') {
    const validMetrics = ['active_interests_count', 'open_objections_count']
    if (!rule.field_key || !validMetrics.includes(rule.field_key)) {
      throw new ScoringValidationError(
        `engagement_metric field_key must be one of: ${validMetrics.join(', ')}`
      )
    }
  }

  return {
    rule_key,
    label,
    signal_type,
    field_key: rule.field_key ? rule.field_key.trim() : null,
    operator,
    expected_value: rule.expected_value ?? null,
    points: rule.points,
    status: rule.status || 'active',
    sort_order: typeof rule.sort_order === 'number' ? Math.round(rule.sort_order) : 0,
  }
}
