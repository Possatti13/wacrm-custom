import { createHash } from 'crypto'
import type { InsightType, EvidenceDescriptor } from './types'

export interface DedupeKeyParams {
  insightType: InsightType
  catalogItemId?: string | null
  valueText?: string | null
  evidence?: EvidenceDescriptor[]
  extractorVersion?: string
}

/**
 * Deterministic fingerprint generator for conversation insights:
 * 1. Takes insight_type, canonical value or catalog_item_id, and extractor_version
 * 2. Normalizes and sorts evidence descriptors by message_id, start_offset, end_offset
 * 3. Hashes the canonical payload with SHA-256
 *
 * Guarantees:
 * - Same evidence in different order -> identical dedupe key
 * - Same meaning in different message -> different dedupe key
 */
export function computeInsightDedupeKey(params: DedupeKeyParams): string {
  const normValue = params.catalogItemId
    ? params.catalogItemId.trim().toLowerCase()
    : (params.valueText || '').trim().toLowerCase()

  const version = (params.extractorVersion || 'v1').trim().toLowerCase()

  const sortedEvidence = (params.evidence || [])
    .map((e) => ({
      msg: (e.message_id || '').trim().toLowerCase(),
      start: e.start_offset !== undefined && e.start_offset !== null ? e.start_offset : -1,
      end: e.end_offset !== undefined && e.end_offset !== null ? e.end_offset : -1,
    }))
    .sort((a, b) => {
      if (a.msg !== b.msg) return a.msg.localeCompare(b.msg)
      if (a.start !== b.start) return a.start - b.start
      return a.end - b.end
    })
    .map((e) => `${e.msg}:${e.start}:${e.end}`)
    .join('|')

  const canonicalString = `${params.insightType}#${normValue}#${version}#${sortedEvidence}`

  return createHash('sha256').update(canonicalString, 'utf8').digest('hex')
}
