// ============================================================
// Conversation Insights, Evidence & Analysis State Types (Phase 3C)
// ============================================================

export type InsightType =
  | 'interest'
  | 'objection'
  | 'intent'
  | 'urgency'
  | 'sentiment'
  | 'next_action'
  | 'summary'
  | 'attribute'

export type InsightStatus = 'active' | 'superseded' | 'retracted'

export type InformationSource = 'manual' | 'import' | 'intelligence' | 'system'

export type AnalysisRunStatus = 'pending' | 'processing' | 'completed' | 'failed'

// ============================================================
// Entity Models
// ============================================================

export interface ConversationInsight {
  id: string
  account_id: string
  conversation_id: string
  insight_type: InsightType
  value_text: string | null
  value_json: Record<string, unknown>
  catalog_item_id: string | null
  confidence: number | null
  source: InformationSource
  status: InsightStatus
  supersedes_insight_id: string | null
  retracted_reason: string | null
  analysis_run_id: string | null
  dedupe_key: string | null
  observed_at: string
  created_at: string
  updated_at: string
}

export interface ConversationInsightEvidence {
  id: string
  account_id: string
  conversation_id: string
  insight_id: string
  message_id: string
  start_offset: number | null
  end_offset: number | null
  snippet: string | null
  created_at: string
}

export interface ConversationInsightWithEvidence extends ConversationInsight {
  evidence: ConversationInsightEvidence[]
  catalog_item?: {
    id: string
    name: string
    type: 'product' | 'service'
    sku: string | null
    status: string
  } | null
}

export interface ConversationAnalysisRun {
  id: string
  account_id: string
  conversation_id: string
  status: AnalysisRunStatus
  from_cursor_timestamp: string | null
  from_cursor_message_id: string | null
  to_cursor_timestamp: string | null
  to_cursor_message_id: string | null
  messages_count: number
  insights_count: number
  extractor_version: string
  provider: string | null
  model: string | null
  error_code: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ConversationAnalysisMessage {
  account_id: string
  conversation_id: string
  message_id: string
  extractor_version: string
  analysis_run_id: string
  analyzed_at: string
}

export interface ConversationAnalysisState {
  account_id: string
  conversation_id: string
  extractor_version: string
  last_analyzed_message_created_at: string | null
  last_analyzed_message_id: string | null
  last_analysis_run_id: string | null
  last_analyzed_at: string | null
  updated_at: string
}

// ============================================================
// Input DTOs
// ============================================================

export interface EvidenceDescriptor {
  message_id: string
  start_offset?: number | null
  end_offset?: number | null
  snippet?: string | null
}

export interface CreateInsightInput {
  insight_type: InsightType
  value_text?: string | null
  value_json?: Record<string, unknown>
  catalog_item_id?: string | null
  confidence?: number | null
  source?: InformationSource
  analysis_run_id?: string | null
  observed_at?: string | null
  evidence?: EvidenceDescriptor[]
  extractor_version?: string
}

export interface SupersedeInsightInput {
  new_insight_type: InsightType
  new_value_text?: string | null
  new_value_json?: Record<string, unknown>
  new_catalog_item_id?: string | null
  new_confidence?: number | null
  new_source?: InformationSource
  evidence?: EvidenceDescriptor[]
  extractor_version?: string
}
