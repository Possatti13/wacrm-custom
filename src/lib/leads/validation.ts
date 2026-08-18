import type {
  LeadUrgency,
  LeadSentiment,
  InformationSource,
  InterestStatus,
  ObjectionStatus,
  UpsertLeadProfileInput,
  RecordCatalogInterestInput,
  RecordObjectionInput,
} from './types'

export class LeadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LeadValidationError'
  }
}

const VALID_URGENCIES = new Set<LeadUrgency>(['low', 'medium', 'high'])
const VALID_SENTIMENTS = new Set<LeadSentiment>(['negative', 'neutral', 'positive', 'mixed'])
const VALID_SOURCES = new Set<InformationSource>(['manual', 'import', 'intelligence', 'system'])
const VALID_INTEREST_STATUSES = new Set<InterestStatus>(['active', 'inactive', 'dismissed'])
const VALID_OBJECTION_STATUSES = new Set<ObjectionStatus>(['open', 'resolved', 'dismissed'])

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateUuid(value: unknown, fieldName = 'ID'): string {
  if (!value || typeof value !== 'string' || !UUID_REGEX.test(value.trim())) {
    throw new LeadValidationError(`Invalid ${fieldName}: must be a valid UUID`)
  }
  return value.trim()
}

export function validateSource(value: unknown, fieldName = 'source'): InformationSource {
  if (value === undefined || value === null) return 'manual'
  if (typeof value !== 'string' || !VALID_SOURCES.has(value as InformationSource)) {
    throw new LeadValidationError(
      `Invalid ${fieldName}: must be one of 'manual', 'import', 'intelligence', 'system'`
    )
  }
  return value as InformationSource
}

export function validateOptionalSource(value: unknown, fieldName: string): InformationSource | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !VALID_SOURCES.has(value as InformationSource)) {
    throw new LeadValidationError(
      `Invalid ${fieldName}: must be one of 'manual', 'import', 'intelligence', 'system' or null`
    )
  }
  return value as InformationSource
}

export function validateUrgency(value: unknown): LeadUrgency | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !VALID_URGENCIES.has(value as LeadUrgency)) {
    throw new LeadValidationError(`Invalid urgency: must be 'low', 'medium', 'high' or null`)
  }
  return value as LeadUrgency
}

export function validateSentiment(value: unknown): LeadSentiment | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !VALID_SENTIMENTS.has(value as LeadSentiment)) {
    throw new LeadValidationError(`Invalid sentiment: must be 'negative', 'neutral', 'positive', 'mixed' or null`)
  }
  return value as LeadSentiment
}

export function validateInterestStatus(value: unknown): InterestStatus {
  if (typeof value !== 'string' || !VALID_INTEREST_STATUSES.has(value as InterestStatus)) {
    throw new LeadValidationError(`Invalid interest status: must be 'active', 'inactive' or 'dismissed'`)
  }
  return value as InterestStatus
}

export function validateObjectionStatus(value: unknown): ObjectionStatus {
  if (typeof value !== 'string' || !VALID_OBJECTION_STATUSES.has(value as ObjectionStatus)) {
    throw new LeadValidationError(`Invalid objection status: must be 'open', 'resolved' or 'dismissed'`)
  }
  return value as ObjectionStatus
}

export function validateIsoDate(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new LeadValidationError(`Invalid ${fieldName}: must be a valid ISO date string`)
  }
  const parsed = Date.parse(value)
  if (isNaN(parsed)) {
    throw new LeadValidationError(`Invalid ${fieldName}: could not parse ISO date string "${value}"`)
  }
  return new Date(parsed).toISOString()
}

export function validateUpsertLeadProfile(input: UpsertLeadProfileInput): UpsertLeadProfileInput {
  if (!input || typeof input !== 'object') {
    throw new LeadValidationError('Input must be a non-null object')
  }

  const urgency = input.urgency !== undefined ? validateUrgency(input.urgency) : undefined
  const sentiment = input.sentiment !== undefined ? validateSentiment(input.sentiment) : undefined
  const nextAction = input.next_action !== undefined ? (input.next_action?.trim() || null) : undefined
  const nextActionDueAt = input.next_action_due_at !== undefined ? validateIsoDate(input.next_action_due_at, 'next_action_due_at') : undefined

  // Invariant: next_action_due_at requires next_action to be present
  if (nextActionDueAt !== null && nextActionDueAt !== undefined && (!nextAction || nextAction.length === 0)) {
    throw new LeadValidationError('next_action_due_at cannot be set without a valid next_action')
  }

  return {
    summary: input.summary !== undefined ? (input.summary?.trim() || null) : undefined,
    summary_source: input.summary_source !== undefined ? validateOptionalSource(input.summary_source, 'summary_source') : undefined,

    current_intent: input.current_intent !== undefined ? (input.current_intent?.trim() || null) : undefined,
    current_intent_source: input.current_intent_source !== undefined ? validateOptionalSource(input.current_intent_source, 'current_intent_source') : undefined,

    urgency,
    urgency_source: input.urgency_source !== undefined ? validateOptionalSource(input.urgency_source, 'urgency_source') : undefined,

    sentiment,
    sentiment_source: input.sentiment_source !== undefined ? validateOptionalSource(input.sentiment_source, 'sentiment_source') : undefined,

    next_action: nextAction,
    next_action_due_at: nextActionDueAt,
    next_action_source: input.next_action_source !== undefined ? validateOptionalSource(input.next_action_source, 'next_action_source') : undefined,

    attributes: input.attributes !== undefined ? (input.attributes && typeof input.attributes === 'object' ? input.attributes : {}) : undefined,
    source: validateSource(input.source, 'source'),
  }
}

export function validateRecordCatalogInterest(input: RecordCatalogInterestInput): {
  catalog_item_id: string
  source: InformationSource
  metadata: Record<string, unknown>
} {
  if (!input || typeof input !== 'object') {
    throw new LeadValidationError('Input must be a non-null object')
  }

  const catalogItemId = validateUuid(input.catalog_item_id, 'catalog_item_id')
  const source = validateSource(input.source, 'source')
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}

  return {
    catalog_item_id: catalogItemId,
    source,
    metadata,
  }
}

export function validateRecordObjection(input: RecordObjectionInput): {
  objection: string
  source: InformationSource
  metadata: Record<string, unknown>
} {
  if (!input || typeof input !== 'object') {
    throw new LeadValidationError('Input must be a non-null object')
  }

  if (typeof input.objection !== 'string' || input.objection.trim().length === 0) {
    throw new LeadValidationError('Objection text must not be empty')
  }

  const source = validateSource(input.source, 'source')
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}

  return {
    objection: input.objection.trim(),
    source,
    metadata,
  }
}
