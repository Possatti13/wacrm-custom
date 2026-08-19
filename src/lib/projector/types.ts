// ============================================================
// Commercial State Projector Types (Phase 5B)
// ============================================================

export type ProjectionOutcome = 'applied' | 'no_op'

export interface ProjectionRunResult {
  outcome: ProjectionOutcome
  projection_run_id?: string
  input_fingerprint?: string
  source_insights_count?: number
  mutations_count?: number
  reason?: 'already_projected'
}

export interface ProjectContactCommercialStateParams {
  accountId: string
  contactId: string
  triggerSource?: string
}

export interface CommercialProvenanceRecord {
  id: string
  account_id: string
  contact_id: string
  source_conversation_id: string
  source_insight_id: string
  projection_run_id?: string | null
  target_type: 'profile_field' | 'catalog_interest' | 'objection' | 'attribute'
  target_key: string
  created_at: string
}

export interface AttributeMetadataItem {
  value: unknown
  source: 'manual' | 'import' | 'intelligence' | 'system'
  updated_at: string
}
