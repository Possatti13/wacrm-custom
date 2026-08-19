// ============================================================
// Tenant Commercial Configuration Types (Phase 4)
// ============================================================

export type ConfigEntityStatus = 'active' | 'inactive' | 'archived'

export type AttributeValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'single_select'
  | 'multi_select'

// ============================================================
// Entities
// ============================================================

export interface CommercialIntent {
  id: string
  account_id: string
  key: string
  label: string
  description: string | null
  status: ConfigEntityStatus
  sort_order: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface SelectOption {
  key: string
  label: string
}

export interface CommercialAttributeDefinition {
  id: string
  account_id: string
  key: string
  label: string
  description: string | null
  value_type: AttributeValueType
  options: SelectOption[]
  status: ConfigEntityStatus
  sort_order: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface TenantCommercialContext {
  account_id: string
  company_description: string | null
  commercial_objectives: string | null
  qualification_guidelines: string | null
  prohibited_assumptions: string | null
  terminology_notes: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface TenantCommercialTerminology {
  account_id: string
  contact_label_singular: string
  contact_label_plural: string
  catalog_item_label_singular: string
  catalog_item_label_plural: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Canonical Snapshot & Revision
// ============================================================

export interface CanonicalConfigSnapshot {
  schemaVersion: number
  intents: Array<{
    id: string
    key: string
    label: string
    description: string | null
    status: ConfigEntityStatus
    sort_order: number
    metadata: Record<string, unknown>
  }>
  attributes: Array<{
    id: string
    key: string
    label: string
    description: string | null
    value_type: AttributeValueType
    options: SelectOption[]
    status: ConfigEntityStatus
    sort_order: number
    metadata: Record<string, unknown>
  }>
  context: {
    company_description: string | null
    commercial_objectives: string | null
    qualification_guidelines: string | null
    prohibited_assumptions: string | null
    terminology_notes: string | null
    metadata: Record<string, unknown>
  }
  terminology: {
    contact_label_singular: string
    contact_label_plural: string
    catalog_item_label_singular: string
    catalog_item_label_plural: string
    metadata: Record<string, unknown>
  }
}

export interface TenantConfigRevision {
  id: string
  account_id: string
  revision_number: number
  snapshot_schema_version: number
  snapshot: CanonicalConfigSnapshot
  snapshot_hash: string
  change_summary: string | null
  created_by: string | null
  created_at: string
}

// ============================================================
// Input DTOs
// ============================================================

export interface SaveIntentInput {
  id?: string
  key: string
  label: string
  description?: string | null
  status?: ConfigEntityStatus
  sort_order?: number
  metadata?: Record<string, unknown>
  change_summary?: string
}

export interface SaveAttributeDefinitionInput {
  id?: string
  key: string
  label: string
  description?: string | null
  value_type: AttributeValueType
  options?: SelectOption[]
  status?: ConfigEntityStatus
  sort_order?: number
  metadata?: Record<string, unknown>
  change_summary?: string
}

export interface SaveContextInput {
  company_description?: string | null
  commercial_objectives?: string | null
  qualification_guidelines?: string | null
  prohibited_assumptions?: string | null
  terminology_notes?: string | null
  metadata?: Record<string, unknown>
  change_summary?: string
}

export interface SaveTerminologyInput {
  contact_label_singular?: string
  contact_label_plural?: string
  catalog_item_label_singular?: string
  catalog_item_label_plural?: string
  metadata?: Record<string, unknown>
  change_summary?: string
}
