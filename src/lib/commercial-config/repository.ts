import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommercialIntent,
  CommercialAttributeDefinition,
  TenantCommercialContext,
  TenantCommercialTerminology,
  TenantConfigRevision,
  SaveIntentInput,
  SaveAttributeDefinitionInput,
  SaveContextInput,
  SaveTerminologyInput,
  ConfigEntityStatus,
} from './types'
import {
  validateUuid,
  validateSaveIntent,
  validateSaveAttributeDefinition,
} from './validation'

// ============================================================
// 1. Commercial Intents
// ============================================================

export async function saveCommercialIntent(
  db: SupabaseClient,
  accountId: string,
  rawInput: SaveIntentInput
): Promise<{ intent: CommercialIntent; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
  const validAccId = validateUuid(accountId, 'accountId')
  const input = validateSaveIntent(rawInput)

  const { data, error } = await db.rpc('save_commercial_intent', {
    p_account_id: validAccId,
    p_id: input.id || null,
    p_key: input.key,
    p_label: input.label,
    p_description: input.description || null,
    p_status: input.status || 'active',
    p_sort_order: input.sort_order || 0,
    p_metadata: input.metadata || {},
    p_change_summary: input.change_summary || null,
  })

  if (error) {
    throw new Error(`saveCommercialIntent failed: ${error.message}`)
  }

  const res = data as { intent_id: string; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }

  const { data: intentRow, error: fetchErr } = await db
    .from('commercial_intents')
    .select('*')
    .eq('account_id', validAccId)
    .eq('id', res.intent_id)
    .single()

  if (fetchErr || !intentRow) {
    throw new Error(`Failed to load saved intent: ${fetchErr?.message || 'Not found'}`)
  }

  return {
    intent: intentRow as CommercialIntent,
    revision: res.revision,
  }
}

export async function archiveCommercialIntent(
  db: SupabaseClient,
  accountId: string,
  intentId: string,
  changeSummary?: string
): Promise<{ intent: CommercialIntent; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validId = validateUuid(intentId, 'intentId')

  const { data: current, error: findErr } = await db
    .from('commercial_intents')
    .select('*')
    .eq('account_id', validAccId)
    .eq('id', validId)
    .single()

  if (findErr || !current) {
    throw new Error(`Intent not found for archiving: ${findErr?.message || 'Not found'}`)
  }

  return saveCommercialIntent(db, validAccId, {
    id: current.id,
    key: current.key,
    label: current.label,
    description: current.description,
    status: 'archived',
    sort_order: current.sort_order,
    metadata: current.metadata,
    change_summary: changeSummary || `Archived intent ${current.key}`,
  })
}

export async function listCommercialIntents(
  db: SupabaseClient,
  accountId: string,
  options?: { status?: ConfigEntityStatus }
): Promise<CommercialIntent[]> {
  const validAccId = validateUuid(accountId, 'accountId')

  let query = db
    .from('commercial_intents')
    .select('*')
    .eq('account_id', validAccId)

  if (options?.status) {
    query = query.eq('status', options.status)
  }

  query = query.order('sort_order', { ascending: true }).order('key', { ascending: true })

  const { data, error } = await query

  if (error) {
    throw new Error(`listCommercialIntents failed: ${error.message}`)
  }

  return (data as CommercialIntent[]) || []
}

// ============================================================
// 2. Commercial Attribute Definitions
// ============================================================

export async function saveCommercialAttributeDefinition(
  db: SupabaseClient,
  accountId: string,
  rawInput: SaveAttributeDefinitionInput
): Promise<{ attribute: CommercialAttributeDefinition; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
  const validAccId = validateUuid(accountId, 'accountId')
  const input = validateSaveAttributeDefinition(rawInput)

  const { data, error } = await db.rpc('save_commercial_attribute_definition', {
    p_account_id: validAccId,
    p_id: input.id || null,
    p_key: input.key,
    p_label: input.label,
    p_description: input.description || null,
    p_value_type: input.value_type,
    p_options: input.options || [],
    p_status: input.status || 'active',
    p_sort_order: input.sort_order || 0,
    p_metadata: input.metadata || {},
    p_change_summary: input.change_summary || null,
  })

  if (error) {
    throw new Error(`saveCommercialAttributeDefinition failed: ${error.message}`)
  }

  const res = data as { attribute_id: string; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }

  const { data: attrRow, error: fetchErr } = await db
    .from('commercial_attribute_definitions')
    .select('*')
    .eq('account_id', validAccId)
    .eq('id', res.attribute_id)
    .single()

  if (fetchErr || !attrRow) {
    throw new Error(`Failed to load saved attribute definition: ${fetchErr?.message || 'Not found'}`)
  }

  return {
    attribute: attrRow as CommercialAttributeDefinition,
    revision: res.revision,
  }
}

export async function archiveCommercialAttributeDefinition(
  db: SupabaseClient,
  accountId: string,
  attributeId: string,
  changeSummary?: string
): Promise<{ attribute: CommercialAttributeDefinition; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validId = validateUuid(attributeId, 'attributeId')

  const { data: current, error: findErr } = await db
    .from('commercial_attribute_definitions')
    .select('*')
    .eq('account_id', validAccId)
    .eq('id', validId)
    .single()

  if (findErr || !current) {
    throw new Error(`Attribute definition not found for archiving: ${findErr?.message || 'Not found'}`)
  }

  return saveCommercialAttributeDefinition(db, validAccId, {
    id: current.id,
    key: current.key,
    label: current.label,
    description: current.description,
    value_type: current.value_type,
    options: current.options,
    status: 'archived',
    sort_order: current.sort_order,
    metadata: current.metadata,
    change_summary: changeSummary || `Archived attribute ${current.key}`,
  })
}

export async function listCommercialAttributeDefinitions(
  db: SupabaseClient,
  accountId: string,
  options?: { status?: ConfigEntityStatus }
): Promise<CommercialAttributeDefinition[]> {
  const validAccId = validateUuid(accountId, 'accountId')

  let query = db
    .from('commercial_attribute_definitions')
    .select('*')
    .eq('account_id', validAccId)

  if (options?.status) {
    query = query.eq('status', options.status)
  }

  query = query.order('sort_order', { ascending: true }).order('key', { ascending: true })

  const { data, error } = await query

  if (error) {
    throw new Error(`listCommercialAttributeDefinitions failed: ${error.message}`)
  }

  return (data as CommercialAttributeDefinition[]) || []
}

// ============================================================
// 3. Business Context & Terminology
// ============================================================

export async function saveTenantCommercialContext(
  db: SupabaseClient,
  accountId: string,
  input: SaveContextInput
): Promise<{ context: TenantCommercialContext; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db.rpc('save_tenant_commercial_context', {
    p_account_id: validAccId,
    p_company_description: input.company_description || null,
    p_commercial_objectives: input.commercial_objectives || null,
    p_qualification_guidelines: input.qualification_guidelines || null,
    p_prohibited_assumptions: input.prohibited_assumptions || null,
    p_terminology_notes: input.terminology_notes || null,
    p_metadata: input.metadata || {},
    p_change_summary: input.change_summary || 'Updated business context',
  })

  if (error) {
    throw new Error(`saveTenantCommercialContext failed: ${error.message}`)
  }

  const res = data as { revision: { revision_id: string; revision_number: number; snapshot_hash: string } }

  const { data: ctxRow, error: fetchErr } = await db
    .from('tenant_commercial_context')
    .select('*')
    .eq('account_id', validAccId)
    .single()

  if (fetchErr || !ctxRow) {
    throw new Error(`Failed to load saved context: ${fetchErr?.message || 'Not found'}`)
  }

  return {
    context: ctxRow as TenantCommercialContext,
    revision: res.revision,
  }
}

export async function getTenantCommercialContext(
  db: SupabaseClient,
  accountId: string
): Promise<TenantCommercialContext | null> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('tenant_commercial_context')
    .select('*')
    .eq('account_id', validAccId)
    .maybeSingle()

  if (error) {
    throw new Error(`getTenantCommercialContext failed: ${error.message}`)
  }

  return (data as TenantCommercialContext) || null
}

export async function saveTenantCommercialTerminology(
  db: SupabaseClient,
  accountId: string,
  input: SaveTerminologyInput
): Promise<{ terminology: TenantCommercialTerminology; revision: { revision_id: string; revision_number: number; snapshot_hash: string } }> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db.rpc('save_tenant_commercial_terminology', {
    p_account_id: validAccId,
    p_contact_label_singular: input.contact_label_singular || 'Contato',
    p_contact_label_plural: input.contact_label_plural || 'Contatos',
    p_catalog_item_label_singular: input.catalog_item_label_singular || 'Produto / Serviço',
    p_catalog_item_label_plural: input.catalog_item_label_plural || 'Produtos e Serviços',
    p_metadata: input.metadata || {},
    p_change_summary: input.change_summary || 'Updated terminology labels',
  })

  if (error) {
    throw new Error(`saveTenantCommercialTerminology failed: ${error.message}`)
  }

  const res = data as { revision: { revision_id: string; revision_number: number; snapshot_hash: string } }

  const { data: termRow, error: fetchErr } = await db
    .from('tenant_commercial_terminology')
    .select('*')
    .eq('account_id', validAccId)
    .single()

  if (fetchErr || !termRow) {
    throw new Error(`Failed to load saved terminology: ${fetchErr?.message || 'Not found'}`)
  }

  return {
    terminology: termRow as TenantCommercialTerminology,
    revision: res.revision,
  }
}

export async function getTenantCommercialTerminology(
  db: SupabaseClient,
  accountId: string
): Promise<TenantCommercialTerminology | null> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('tenant_commercial_terminology')
    .select('*')
    .eq('account_id', validAccId)
    .maybeSingle()

  if (error) {
    throw new Error(`getTenantCommercialTerminology failed: ${error.message}`)
  }

  return (data as TenantCommercialTerminology) || null
}

// ============================================================
// 4. Config Revisions Ledger
// ============================================================

export async function getLatestConfigRevision(
  db: SupabaseClient,
  accountId: string
): Promise<TenantConfigRevision | null> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('tenant_config_revisions')
    .select('*')
    .eq('account_id', validAccId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`getLatestConfigRevision failed: ${error.message}`)
  }

  return (data as TenantConfigRevision) || null
}

export async function listConfigRevisions(
  db: SupabaseClient,
  accountId: string,
  limit = 20
): Promise<TenantConfigRevision[]> {
  const validAccId = validateUuid(accountId, 'accountId')

  const { data, error } = await db
    .from('tenant_config_revisions')
    .select('*')
    .eq('account_id', validAccId)
    .order('revision_number', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`listConfigRevisions failed: ${error.message}`)
  }

  return (data as TenantConfigRevision[]) || []
}
