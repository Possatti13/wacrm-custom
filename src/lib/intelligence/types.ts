// ============================================================
// Intelligence Extraction Engine Types (Phase 5A)
// ============================================================

import type { InsightType, InformationSource } from '@/lib/insights/types'
import type { CanonicalConfigSnapshot } from '@/lib/commercial-config/types'

// ============================================================
// Catalog Context & Pinned Context Models
// ============================================================

export interface CatalogItemContextSnapshot {
  id: string
  name: string
  type: 'product' | 'service'
  sku: string | null
  terms: Array<{
    term: string
    normalized_term: string
    kind: 'canonical' | 'alias'
  }>
}

export interface AnalysisCatalogContext {
  id: string
  account_id: string
  schema_version: number
  context_hash: string
  snapshot: CatalogItemContextSnapshot[]
  created_at: string
}

// ============================================================
// Structured Model Output Contract
// ============================================================

export interface RawObservationEvidence {
  message_ref: string // e.g. 'M1', 'M2'
  quoted_text: string // exact quote from the message
}

export interface RawModelObservation {
  type: InsightType
  value: string | number | boolean | Record<string, unknown>
  catalog_term?: string | null
  attribute_key?: string | null
  confidence?: number | null
  evidence?: RawObservationEvidence[]
}

export interface RawStructuredExtractionOutput {
  observations: RawModelObservation[]
}

// ============================================================
// Resolved & Validated Observation
// ============================================================

export interface ValidatedEvidenceItem {
  message_id: string
  start_offset: number
  end_offset: number
  snippet: string
}

export interface ValidatedObservation {
  insight_type: InsightType
  value_text: string | null
  value_json: Record<string, unknown>
  catalog_item_id: string | null
  confidence: number | null
  source: InformationSource
  dedupe_key: string
  evidence: ValidatedEvidenceItem[]
  observed_at?: string
}

// ============================================================
// Claim & Analysis Models
// ============================================================

export interface ClaimMessageItem {
  id: string
  sender_type: 'customer' | 'agent' | 'system'
  content_text: string | null
  created_at: string
}

export type ClaimResultStatus =
  | 'claimed'
  | 'no_messages'
  | 'already_processing'
  | 'already_completed'

export interface ClaimRunResult {
  status: ClaimResultStatus
  run_id?: string
  account_id?: string
  conversation_id?: string
  extractor_version?: string
  prompt_version?: string
  input_fingerprint?: string
  lease_expires_at?: string
  config_revision?: {
    id: string
    revision_number: number
    snapshot_hash: string
    snapshot: CanonicalConfigSnapshot
  }
  catalog_context?: {
    id: string
    context_hash: string
    snapshot: CatalogItemContextSnapshot[]
  }
  messages?: ClaimMessageItem[]
  analyzed_message_ids?: string[]
  first_message?: { id: string; created_at: string }
  last_message?: { id: string; created_at: string }
}

export interface FinalizeBatchResult {
  status: 'completed' | 'already_completed'
  run_id: string
  insights_count: number
}

// ============================================================
// Extraction Provider Interface
// ============================================================

export interface ExtractionProviderUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ExtractionProviderRequest {
  systemPrompt: string
  userPrompt: string
  responseSchema?: Record<string, unknown>
  model?: string
  temperature?: number
  timeoutMs?: number
}

export interface ExtractionProviderResult {
  rawOutput: unknown
  usage?: ExtractionProviderUsage
  model: string
  provider: string
  latencyMs: number
}

export interface CommercialIntelligenceProvider {
  readonly providerName: string
  extract(request: ExtractionProviderRequest): Promise<ExtractionProviderResult>
}
