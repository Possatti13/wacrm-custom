// ============================================================
// Lead Scoring Engine Domain Types (Phase 6)
// ============================================================

export type ScoringSignalType =
  | 'profile_field'
  | 'attribute'
  | 'catalog_interest'
  | 'objection_presence'
  | 'objection_key'
  | 'engagement_metric'

export type ScoringOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'exists'
  | 'not_exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export type ScoringRuleStatus = 'active' | 'inactive' | 'archived'

export interface LeadScoringConfig {
  id: string
  account_id: string
  enabled: boolean
  base_score: number
  min_score: number
  max_score: number
  current_revision_id: string | null
  current_revision_number: number | null
  created_at: string
  updated_at: string
}

export interface LeadScoringRule {
  id?: string
  account_id?: string
  config_id?: string
  rule_key: string
  label: string
  signal_type: ScoringSignalType
  field_key?: string | null
  operator: ScoringOperator
  expected_value?: unknown
  points: number
  status?: ScoringRuleStatus
  sort_order?: number
  created_at?: string
  updated_at?: string
}

export interface LeadScoringSnapshotRule {
  rule_key: string
  label: string
  signal_type: ScoringSignalType
  field_key: string | null
  operator: ScoringOperator
  expected_value: unknown
  points: number
  sort_order: number
}

export interface LeadScoringSnapshot {
  account_id: string
  revision_number: number
  enabled: boolean
  base_score: number
  min_score: number
  max_score: number
  rules: LeadScoringSnapshotRule[]
}

export interface LeadScoringRevision {
  id: string
  account_id: string
  revision_number: number
  snapshot_schema_version: number
  snapshot: LeadScoringSnapshot
  snapshot_hash: string
  created_by: string | null
  created_at: string
}

// Canonical Lead Scoring Input (v1)
export interface CanonicalLeadScoringInput {
  profile: {
    current_intent: string | null
    urgency: string | null
    sentiment: string | null
    next_action: string | null
    attributes: Record<string, unknown>
  }
  interests: {
    active_item_ids: string[]
  }
  objections: {
    open_keys: string[]
    has_open: boolean
  }
  engagement: {
    active_interests_count: number
    open_objections_count: number
  }
}

export interface LeadScoreContribution {
  rule_key: string
  label: string
  signal_type: ScoringSignalType
  field_key: string | null
  matched_value: string | null
  points: number
}

export interface LeadScoreBreakdown {
  base_score: number
  raw_score: number
  final_score: number
  min_score: number
  max_score: number
  contributions: LeadScoreContribution[]
}

export interface ScoringCalculationResult {
  raw_score: number
  final_score: number
  breakdown: LeadScoreBreakdown
  matched_rule_keys: string[]
  input_fingerprint: string
}

export interface ContactLeadScore {
  id: string
  account_id: string
  contact_id: string
  score: number
  scoring_revision_id: string
  scoring_revision_number: number
  input_fingerprint: string
  breakdown: LeadScoreBreakdown
  calculated_at: string
  updated_at: string
}

export interface ContactLeadScoreHistoryRecord {
  id: string
  account_id: string
  contact_id: string
  score: number
  raw_score: number
  scoring_revision_id: string
  scoring_revision_number: number
  input_schema_version: number
  input_snapshot: CanonicalLeadScoringInput
  input_fingerprint: string
  breakdown: LeadScoreBreakdown
  trigger_source: string
  calculated_at: string
}

export interface RecalculateTenantSweepJobPayload {
  accountId: string
  targetRevisionId: string
  afterContactId?: string | null
  batchSize?: number
}
