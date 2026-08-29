// ============================================================
// Intelligence Extraction Engine Types (Phase 5A & Phase 16)
// ============================================================

import type { InsightType, InformationSource } from '@/lib/insights/types'
import type { CanonicalConfigSnapshot } from '@/lib/commercial-config/types'

export type InvocationMode = 'off' | 'on_demand' | 'manual' | 'automatic' | 'smart_auto'

export type ActionType =
  | 'summarize_conversation'
  | 'analyze_conversation'
  | 'identify_objections'
  | 'analyze_purchase_intent'
  | 'suggest_next_action'
  | 'explain_lead_score'
  | 'copilot_query'

export type InternalAiRequestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cached'

export interface InternalAiRequest {
  id: string
  account_id: string
  requested_by_user_id: string | null
  target_type: 'conversation' | 'contact' | 'account' | 'query'
  target_id: string | null
  action_type: ActionType | string
  status: InternalAiRequestStatus
  input_fingerprint: string
  message_boundary_id: string | null
  message_count: number
  cached_from_request_id: string | null
  provider: string
  model: string
  result_json: Record<string, unknown> | null
  result_text: string | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  latency_ms: number | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface TenantCostStats {
  account_id: string
  month_start: string
  total_requests: number
  cached_requests: number
  provider_calls: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  total_estimated_cost: number
}

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
  taxonomy_code?: string | null
  catalog_term?: string | null
  attribute_key?: string | null
  confidence?: number | null
  evidence?: RawObservationEvidence[]
}

export interface RawStructuredExtractionOutput {
  summary?: string
  observations: RawModelObservation[]
  next_recommended_action?: string
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

// ============================================================
// Objection Taxonomy & Occurrence Ledger Models (V1.3)
// ============================================================

export interface TenantObjectionTaxonomy {
  id: string
  account_id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  is_default: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface ConversationObjectionOccurrence {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string
  insight_id: string
  original_taxonomy_id: string
  effective_taxonomy_id: string
  catalog_item_id: string | null
  responsible_user_id: string | null
  raw_objection: string
  confidence: number | null
  source: InformationSource
  occurred_at: string
  override_by_user_id: string | null
  override_at: string | null
  override_reason: string | null
  created_at: string
  updated_at: string
  original_taxonomy?: TenantObjectionTaxonomy | null
  effective_taxonomy?: TenantObjectionTaxonomy | null
}

export interface ObjectionSummaryItem {
  taxonomy_id: string
  taxonomy_code: string
  taxonomy_name: string
  taxonomy_description: string | null
  count: number
  percentage: number
}

export interface ObjectionSummaryResult {
  total: number
  from: string
  to: string
  items: ObjectionSummaryItem[]
}

