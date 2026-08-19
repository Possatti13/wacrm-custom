import type {
  InsightType,
  InsightStatus,
  InformationSource,
  CreateInsightInput,
  SupersedeInsightInput,
  EvidenceDescriptor,
} from './types'
import { validateSpanOffsets } from './spans'

export class InsightValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsightValidationError'
  }
}

const VALID_TYPES = new Set<InsightType>([
  'interest',
  'objection',
  'intent',
  'urgency',
  'sentiment',
  'next_action',
  'summary',
  'attribute',
])

const VALID_STATUSES = new Set<InsightStatus>(['active', 'superseded', 'retracted'])
const VALID_SOURCES = new Set<InformationSource>(['manual', 'import', 'intelligence', 'system'])

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateUuid(value: unknown, fieldName = 'ID'): string {
  if (!value || typeof value !== 'string' || !UUID_REGEX.test(value.trim())) {
    throw new InsightValidationError(`Invalid ${fieldName}: must be a valid UUID`)
  }
  return value.trim()
}

export function validateInsightType(value: unknown): InsightType {
  if (typeof value !== 'string' || !VALID_TYPES.has(value as InsightType)) {
    throw new InsightValidationError(
      `Invalid insight_type: must be one of 'interest', 'objection', 'intent', 'urgency', 'sentiment', 'next_action', 'summary', 'attribute'`
    )
  }
  return value as InsightType
}

export function validateInsightStatus(value: unknown): InsightStatus {
  if (typeof value !== 'string' || !VALID_STATUSES.has(value as InsightStatus)) {
    throw new InsightValidationError(
      `Invalid insight status: must be 'active', 'superseded' or 'retracted'`
    )
  }
  return value as InsightStatus
}

export function validateSource(value: unknown, fieldName = 'source'): InformationSource {
  if (value === undefined || value === null) return 'manual'
  if (typeof value !== 'string' || !VALID_SOURCES.has(value as InformationSource)) {
    throw new InsightValidationError(
      `Invalid ${fieldName}: must be one of 'manual', 'import', 'intelligence', 'system'`
    )
  }
  return value as InformationSource
}

export function validateConfidence(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  if (isNaN(num) || num < 0.0 || num > 1.0) {
    throw new InsightValidationError(`Invalid confidence: must be a number between 0.0 and 1.0 or null`)
  }
  return Math.round(num * 1000) / 1000
}

export function validateEvidenceDescriptors(
  evidence: unknown,
  messageTextMap?: Map<string, string>
): EvidenceDescriptor[] {
  if (evidence === undefined || evidence === null) return []
  if (!Array.isArray(evidence)) {
    throw new InsightValidationError('Evidence must be an array of evidence descriptors')
  }

  return evidence.map((e, idx) => {
    if (!e || typeof e !== 'object') {
      throw new InsightValidationError(`Evidence at index ${idx} must be a non-null object`)
    }
    const messageId = validateUuid(e.message_id, `evidence[${idx}].message_id`)

    const msgText = messageTextMap ? messageTextMap.get(messageId) : undefined
    const spanCheck = validateSpanOffsets(msgText, e.start_offset, e.end_offset)
    if (!spanCheck.valid) {
      throw new InsightValidationError(`Evidence[${idx}]: ${spanCheck.error}`)
    }

    return {
      message_id: messageId,
      start_offset: e.start_offset !== undefined && e.start_offset !== null ? Number(e.start_offset) : null,
      end_offset: e.end_offset !== undefined && e.end_offset !== null ? Number(e.end_offset) : null,
      snippet: typeof e.snippet === 'string' ? e.snippet.trim() : null,
    }
  })
}

export function validateCreateInsight(input: CreateInsightInput): CreateInsightInput {
  if (!input || typeof input !== 'object') {
    throw new InsightValidationError('Input must be a non-null object')
  }

  const type = validateInsightType(input.insight_type)
  const confidence = validateConfidence(input.confidence)
  const source = validateSource(input.source, 'source')
  const catalogItemId = input.catalog_item_id ? validateUuid(input.catalog_item_id, 'catalog_item_id') : null
  const analysisRunId = input.analysis_run_id ? validateUuid(input.analysis_run_id, 'analysis_run_id') : null

  // Invariant: interest must have catalog_item_id or non-empty value_text
  if (type === 'interest' && !catalogItemId && (!input.value_text || input.value_text.trim().length === 0)) {
    throw new InsightValidationError('Interest insight must provide either catalog_item_id or value_text')
  }

  return {
    insight_type: type,
    value_text: input.value_text !== undefined ? (input.value_text?.trim() || null) : null,
    value_json: input.value_json && typeof input.value_json === 'object' ? input.value_json : {},
    catalog_item_id: catalogItemId,
    confidence,
    source,
    analysis_run_id: analysisRunId,
    observed_at: input.observed_at ? new Date(input.observed_at).toISOString() : new Date().toISOString(),
    evidence: validateEvidenceDescriptors(input.evidence),
    extractor_version: input.extractor_version?.trim() || 'v1',
  }
}

export function validateSupersedeInsight(input: SupersedeInsightInput): SupersedeInsightInput {
  if (!input || typeof input !== 'object') {
    throw new InsightValidationError('Input must be a non-null object')
  }

  const type = validateInsightType(input.new_insight_type)
  const confidence = validateConfidence(input.new_confidence)
  const source = validateSource(input.new_source, 'new_source')
  const catalogItemId = input.new_catalog_item_id ? validateUuid(input.new_catalog_item_id, 'new_catalog_item_id') : null

  if (type === 'interest' && !catalogItemId && (!input.new_value_text || input.new_value_text.trim().length === 0)) {
    throw new InsightValidationError('Interest insight must provide either catalog_item_id or value_text')
  }

  return {
    new_insight_type: type,
    new_value_text: input.new_value_text !== undefined ? (input.new_value_text?.trim() || null) : null,
    new_value_json: input.new_value_json && typeof input.new_value_json === 'object' ? input.new_value_json : {},
    new_catalog_item_id: catalogItemId,
    new_confidence: confidence,
    new_source: source,
    evidence: validateEvidenceDescriptors(input.evidence),
    extractor_version: input.extractor_version?.trim() || 'v1',
  }
}
