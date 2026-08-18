// ============================================================
// Lead Profiles & Commercial Context Types (Phase 3B)
// ============================================================

export type LeadUrgency = 'low' | 'medium' | 'high'

export type LeadSentiment = 'negative' | 'neutral' | 'positive' | 'mixed'

export type InformationSource = 'manual' | 'import' | 'intelligence' | 'system'

export type InterestStatus = 'active' | 'inactive' | 'dismissed'

export type ObjectionStatus = 'open' | 'resolved' | 'dismissed'

// ============================================================
// Entity Models
// ============================================================

export interface ContactLeadProfile {
  id: string
  account_id: string
  contact_id: string

  summary: string | null
  summary_source: InformationSource | null

  current_intent: string | null
  current_intent_source: InformationSource | null

  urgency: LeadUrgency | null
  urgency_source: InformationSource | null

  sentiment: LeadSentiment | null
  sentiment_source: InformationSource | null

  next_action: string | null
  next_action_due_at: string | null
  next_action_source: InformationSource | null

  attributes: Record<string, unknown>
  last_update_source: InformationSource

  created_at: string
  updated_at: string
}

export interface ContactCatalogInterest {
  id: string
  account_id: string
  contact_id: string
  catalog_item_id: string
  status: InterestStatus
  source: InformationSource
  first_seen_at: string
  last_seen_at: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ContactCatalogInterestWithItem extends ContactCatalogInterest {
  item?: {
    id: string
    name: string
    type: 'product' | 'service'
    sku: string | null
    status: 'active' | 'inactive' | 'archived'
    category_id: string | null
  } | null
}

export interface ContactObjection {
  id: string
  account_id: string
  contact_id: string
  objection: string
  normalized_objection: string
  status: ObjectionStatus
  source: InformationSource
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ContactCommercialContext {
  profile: ContactLeadProfile | null
  interests: ContactCatalogInterestWithItem[]
  objections: ContactObjection[]
}

// ============================================================
// Input DTOs
// ============================================================

export interface UpsertLeadProfileInput {
  summary?: string | null
  summary_source?: InformationSource | null

  current_intent?: string | null
  current_intent_source?: InformationSource | null

  urgency?: LeadUrgency | null
  urgency_source?: InformationSource | null

  sentiment?: LeadSentiment | null
  sentiment_source?: InformationSource | null

  next_action?: string | null
  next_action_due_at?: string | null
  next_action_source?: InformationSource | null

  attributes?: Record<string, unknown>
  source?: InformationSource
}

export interface RecordCatalogInterestInput {
  catalog_item_id: string
  source?: InformationSource
  metadata?: Record<string, unknown>
}

export interface RecordObjectionInput {
  objection: string
  source?: InformationSource
  metadata?: Record<string, unknown>
}
