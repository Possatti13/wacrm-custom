import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  LeadScoringConfig,
  LeadScoringRule,
  LeadScoringRevision,
  ContactLeadScore,
  ContactLeadScoreHistoryRecord,
} from './types'
import { validateUuid } from '../leads/validation'
import { validateScoreRange, validateLeadScoringRule } from './validation'

// ============================================================
// Lead Scoring Repository
// ============================================================

export async function saveLeadScoringConfiguration(
  db: SupabaseClient,
  accountId: string,
  config: {
    enabled?: boolean
    base_score?: number
    min_score?: number
    max_score?: number
  },
  rules: Partial<LeadScoringRule>[]
): Promise<{
  config_id: string
  revision_id: string
  revision_number: number
  snapshot_hash: string
  enabled: boolean
}> {
  const validAccId = validateUuid(accountId, 'accountId')

  const min = config.min_score ?? 0
  const base = config.base_score ?? 0
  const max = config.max_score ?? 100
  validateScoreRange(min, base, max)

  const validatedRules = rules.map(validateLeadScoringRule)

  const { data, error } = await db.rpc('save_lead_scoring_configuration', {
    p_account_id: validAccId,
    p_config: {
      enabled: config.enabled ?? true,
      base_score: base,
      min_score: min,
      max_score: max,
    },
    p_rules: validatedRules,
  })

  if (error) {
    throw new Error(`saveLeadScoringConfiguration failed: ${error.message}`)
  }

  return data as {
    config_id: string
    revision_id: string
    revision_number: number
    snapshot_hash: string
    enabled: boolean
  }
}

export async function calculateAndPersistContactScore(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  triggerSource = 'commercial_state_projected'
): Promise<{
  outcome: 'applied' | 'no_op' | 'disabled'
  contact_id: string
  score?: number
  raw_score?: number
  scoring_revision_number?: number
  input_fingerprint?: string
  breakdown?: unknown
}> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const { data, error } = await db.rpc('calculate_and_persist_contact_score', {
    p_account_id: validAccId,
    p_contact_id: validContactId,
    p_trigger_source: triggerSource,
  })

  if (error) {
    throw new Error(`calculateAndPersistContactScore failed: ${error.message}`)
  }

  return data as {
    outcome: 'applied' | 'no_op' | 'disabled'
    contact_id: string
    score?: number
    raw_score?: number
    scoring_revision_number?: number
    input_fingerprint?: string
    breakdown?: unknown
  }
}

export async function getLeadScoringConfig(
  db: SupabaseClient,
  accountId: string
): Promise<LeadScoringConfig | null> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('lead_scoring_configs')
    .select('*')
    .eq('account_id', validAccId)
    .maybeSingle()

  if (error) {
    throw new Error(`getLeadScoringConfig failed: ${error.message}`)
  }

  return (data as LeadScoringConfig) || null
}

export async function getLeadScoringRules(
  db: SupabaseClient,
  accountId: string
): Promise<LeadScoringRule[]> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('lead_scoring_rules')
    .select('*')
    .eq('account_id', validAccId)
    .order('sort_order', { ascending: true })
    .order('rule_key', { ascending: true })

  if (error) {
    throw new Error(`getLeadScoringRules failed: ${error.message}`)
  }

  return (data as LeadScoringRule[]) || []
}

export async function getLeadScoringRevision(
  db: SupabaseClient,
  accountId: string,
  revisionId: string
): Promise<LeadScoringRevision | null> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validRevId = validateUuid(revisionId, 'revisionId')

  const { data, error } = await db
    .from('lead_scoring_revisions')
    .select('*')
    .eq('account_id', validAccId)
    .eq('id', validRevId)
    .maybeSingle()

  if (error) {
    throw new Error(`getLeadScoringRevision failed: ${error.message}`)
  }

  return (data as LeadScoringRevision) || null
}

export async function getCurrentContactLeadScore(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ContactLeadScore | null> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const { data, error } = await db
    .from('contact_lead_scores')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .maybeSingle()

  if (error) {
    throw new Error(`getCurrentContactLeadScore failed: ${error.message}`)
  }

  return (data as ContactLeadScore) || null
}

export async function listContactLeadScoreHistory(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  limit = 20
): Promise<ContactLeadScoreHistoryRecord[]> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const { data, error } = await db
    .from('contact_lead_score_history')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .order('calculated_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`listContactLeadScoreHistory failed: ${error.message}`)
  }

  return (data as ContactLeadScoreHistoryRecord[]) || []
}
