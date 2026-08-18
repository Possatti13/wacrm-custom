import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContactLeadProfile,
  ContactCatalogInterest,
  ContactCatalogInterestWithItem,
  ContactObjection,
  ContactCommercialContext,
  UpsertLeadProfileInput,
  RecordCatalogInterestInput,
  RecordObjectionInput,
  InterestStatus,
  ObjectionStatus,
  InformationSource,
} from './types'
import { normalizeObjection } from './normalization'
import {
  validateUuid,
  validateUpsertLeadProfile,
  validateRecordCatalogInterest,
  validateRecordObjection,
  validateInterestStatus,
  validateObjectionStatus,
  validateSource,
  LeadValidationError,
} from './validation'

// ============================================================
// 1. Lead Profile CRUD & Context
// ============================================================

export async function getLeadProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ContactLeadProfile | null> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const { data, error } = await db
    .from('contact_lead_profiles')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .maybeSingle()

  if (error) {
    throw new Error(`getLeadProfile failed: ${error.message}`)
  }

  return (data as ContactLeadProfile) || null
}

export async function upsertLeadProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  rawInput: UpsertLeadProfileInput
): Promise<ContactLeadProfile> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')
  const input = validateUpsertLeadProfile(rawInput)

  const existing = await getLeadProfile(db, validAccId, validContactId)

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    account_id: validAccId,
    contact_id: validContactId,
    last_update_source: input.source || 'manual',
    updated_at: now,
  }

  if (input.summary !== undefined) {
    payload.summary = input.summary
    payload.summary_source = input.summary === null ? null : (input.summary_source ?? input.source ?? 'manual')
  } else if (!existing) {
    payload.summary = null
    payload.summary_source = null
  }

  if (input.current_intent !== undefined) {
    payload.current_intent = input.current_intent
    payload.current_intent_source =
      input.current_intent === null ? null : (input.current_intent_source ?? input.source ?? 'manual')
  } else if (!existing) {
    payload.current_intent = null
    payload.current_intent_source = null
  }

  if (input.urgency !== undefined) {
    payload.urgency = input.urgency
    payload.urgency_source = input.urgency === null ? null : (input.urgency_source ?? input.source ?? 'manual')
  } else if (!existing) {
    payload.urgency = null
    payload.urgency_source = null
  }

  if (input.sentiment !== undefined) {
    payload.sentiment = input.sentiment
    payload.sentiment_source = input.sentiment === null ? null : (input.sentiment_source ?? input.source ?? 'manual')
  } else if (!existing) {
    payload.sentiment = null
    payload.sentiment_source = null
  }

  if (input.next_action !== undefined) {
    payload.next_action = input.next_action
    payload.next_action_due_at = input.next_action_due_at !== undefined ? input.next_action_due_at : (existing?.next_action_due_at ?? null)
    payload.next_action_source =
      input.next_action === null ? null : (input.next_action_source ?? input.source ?? 'manual')
  } else if (input.next_action_due_at !== undefined) {
    payload.next_action_due_at = input.next_action_due_at
  } else if (!existing) {
    payload.next_action = null
    payload.next_action_due_at = null
    payload.next_action_source = null
  }

  if (input.attributes !== undefined) {
    payload.attributes = input.attributes
  } else if (!existing) {
    payload.attributes = {}
  }

  const { data, error } = await db
    .from('contact_lead_profiles')
    .upsert(payload, { onConflict: 'account_id,contact_id' })
    .select('*')
    .single()

  if (error) {
    throw new Error(`upsertLeadProfile failed: ${error.message}`)
  }

  return data as ContactLeadProfile
}

export async function deleteLeadProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const { error } = await db
    .from('contact_lead_profiles')
    .delete()
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)

  if (error) {
    throw new Error(`deleteLeadProfile failed: ${error.message}`)
  }

  return true
}

// ============================================================
// 2. Catalog Interests
// ============================================================

export async function recordCatalogInterest(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  rawInput: RecordCatalogInterestInput
): Promise<ContactCatalogInterest> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')
  const input = validateRecordCatalogInterest(rawInput)

  const { data: existing, error: findErr } = await db
    .from('contact_catalog_interests')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .eq('catalog_item_id', input.catalog_item_id)
    .maybeSingle()

  if (findErr) {
    throw new Error(`recordCatalogInterest lookup failed: ${findErr.message}`)
  }

  const now = new Date().toISOString()

  if (existing) {
    const existingInterest = existing as ContactCatalogInterest

    // Invariant: dismissed interests are not implicitly reactivated
    if (existingInterest.status === 'dismissed') {
      return existingInterest
    }

    // active or inactive -> active, refresh last_seen_at and source
    const { data: updated, error: updateErr } = await db
      .from('contact_catalog_interests')
      .update({
        status: 'active',
        source: input.source,
        last_seen_at: now,
        metadata: { ...existingInterest.metadata, ...input.metadata },
        updated_at: now,
      })
      .eq('id', existingInterest.id)
      .eq('account_id', validAccId)
      .select('*')
      .single()

    if (updateErr) {
      throw new Error(`recordCatalogInterest update failed: ${updateErr.message}`)
    }
    return updated as ContactCatalogInterest
  }

  // Insert new interest
  const { data: inserted, error: insertErr } = await db
    .from('contact_catalog_interests')
    .insert({
      account_id: validAccId,
      contact_id: validContactId,
      catalog_item_id: input.catalog_item_id,
      status: 'active',
      source: input.source,
      first_seen_at: now,
      last_seen_at: now,
      metadata: input.metadata,
    })
    .select('*')
    .single()

  if (insertErr) {
    if (insertErr.code === '23503') {
      throw new LeadValidationError(`Catalog item ${input.catalog_item_id} or contact ${validContactId} not found in this account`)
    }
    throw new Error(`recordCatalogInterest insert failed: ${insertErr.message}`)
  }

  return inserted as ContactCatalogInterest
}

export async function updateCatalogInterestStatus(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  catalogItemId: string,
  status: InterestStatus,
  source?: InformationSource
): Promise<ContactCatalogInterest> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')
  const validItemId = validateUuid(catalogItemId, 'catalogItemId')
  const validStatus = validateInterestStatus(status)
  const validSource = source ? validateSource(source) : undefined

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    status: validStatus,
    updated_at: now,
  }
  if (validSource) payload.source = validSource
  if (validStatus === 'active') payload.last_seen_at = now

  const { data, error } = await db
    .from('contact_catalog_interests')
    .update(payload)
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .eq('catalog_item_id', validItemId)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`updateCatalogInterestStatus failed: ${error?.message || 'Interest not found'}`)
  }

  return data as ContactCatalogInterest
}

export async function dismissCatalogInterest(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  catalogItemId: string,
  source?: InformationSource
): Promise<ContactCatalogInterest> {
  return updateCatalogInterestStatus(db, accountId, contactId, catalogItemId, 'dismissed', source)
}

export async function reactivateCatalogInterest(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  catalogItemId: string,
  source?: InformationSource
): Promise<ContactCatalogInterest> {
  return updateCatalogInterestStatus(db, accountId, contactId, catalogItemId, 'active', source)
}

export async function listCatalogInterests(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  status?: InterestStatus
): Promise<ContactCatalogInterestWithItem[]> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  let query = db
    .from('contact_catalog_interests')
    .select(`
      *,
      catalog_items:catalog_item_id (
        id,
        name,
        type,
        sku,
        status,
        category_id
      )
    `)
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)

  if (status) {
    query = query.eq('status', validateInterestStatus(status))
  }

  query = query.order('last_seen_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    throw new Error(`listCatalogInterests failed: ${error.message}`)
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const item = row.catalog_items as ContactCatalogInterestWithItem['item']
    return {
      id: row.id as string,
      account_id: row.account_id as string,
      contact_id: row.contact_id as string,
      catalog_item_id: row.catalog_item_id as string,
      status: row.status as InterestStatus,
      source: row.source as InformationSource,
      first_seen_at: row.first_seen_at as string,
      last_seen_at: row.last_seen_at as string,
      metadata: (row.metadata as Record<string, unknown>) || {},
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      item: item || null,
    }
  })
}

// ============================================================
// 3. Objections
// ============================================================

export async function recordObjection(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  rawInput: RecordObjectionInput
): Promise<ContactObjection> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')
  const input = validateRecordObjection(rawInput)
  const normObjection = normalizeObjection(input.objection)

  if (normObjection.length === 0) {
    throw new LeadValidationError('Objection text could not be normalized into valid words')
  }

  const { data: existing, error: findErr } = await db
    .from('contact_objections')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)
    .eq('normalized_objection', normObjection)
    .maybeSingle()

  if (findErr) {
    throw new Error(`recordObjection lookup failed: ${findErr.message}`)
  }

  const now = new Date().toISOString()

  if (existing) {
    const existingObj = existing as ContactObjection

    // Invariant: dismissed objection remains dismissed without explicit reactivation
    if (existingObj.status === 'dismissed') {
      return existingObj
    }

    // If resolved and detected again -> reopen and clear resolved_at
    // If open -> update last_seen_at
    const { data: updated, error: updateErr } = await db
      .from('contact_objections')
      .update({
        status: 'open',
        resolved_at: null,
        source: input.source,
        last_seen_at: now,
        objection: input.objection,
        metadata: { ...existingObj.metadata, ...input.metadata },
        updated_at: now,
      })
      .eq('id', existingObj.id)
      .eq('account_id', validAccId)
      .select('*')
      .single()

    if (updateErr) {
      throw new Error(`recordObjection update failed: ${updateErr.message}`)
    }
    return updated as ContactObjection
  }

  // Insert new objection
  const { data: inserted, error: insertErr } = await db
    .from('contact_objections')
    .insert({
      account_id: validAccId,
      contact_id: validContactId,
      objection: input.objection,
      normalized_objection: normObjection,
      status: 'open',
      source: input.source,
      first_seen_at: now,
      last_seen_at: now,
      resolved_at: null,
      metadata: input.metadata,
    })
    .select('*')
    .single()

  if (insertErr) {
    if (insertErr.code === '23503') {
      throw new LeadValidationError(`Contact ${validContactId} not found in this account`)
    }
    throw new Error(`recordObjection insert failed: ${insertErr.message}`)
  }

  return inserted as ContactObjection
}

export async function updateObjectionStatus(
  db: SupabaseClient,
  accountId: string,
  objectionId: string,
  status: ObjectionStatus,
  source?: InformationSource
): Promise<ContactObjection> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validObjId = validateUuid(objectionId, 'objectionId')
  const validStatus = validateObjectionStatus(status)
  const validSource = source ? validateSource(source) : undefined

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    status: validStatus,
    updated_at: now,
  }
  if (validSource) payload.source = validSource

  // Invariant coherence: resolved requires resolved_at; other statuses must clear resolved_at
  if (validStatus === 'resolved') {
    payload.resolved_at = now
  } else {
    payload.resolved_at = null
    if (validStatus === 'open') {
      payload.last_seen_at = now
    }
  }

  const { data, error } = await db
    .from('contact_objections')
    .update(payload)
    .eq('id', validObjId)
    .eq('account_id', validAccId)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`updateObjectionStatus failed: ${error?.message || 'Objection not found'}`)
  }

  return data as ContactObjection
}

export async function resolveObjection(
  db: SupabaseClient,
  accountId: string,
  objectionId: string,
  source?: InformationSource
): Promise<ContactObjection> {
  return updateObjectionStatus(db, accountId, objectionId, 'resolved', source)
}

export async function dismissObjection(
  db: SupabaseClient,
  accountId: string,
  objectionId: string,
  source?: InformationSource
): Promise<ContactObjection> {
  return updateObjectionStatus(db, accountId, objectionId, 'dismissed', source)
}

export async function reactivateObjection(
  db: SupabaseClient,
  accountId: string,
  objectionId: string,
  source?: InformationSource
): Promise<ContactObjection> {
  return updateObjectionStatus(db, accountId, objectionId, 'open', source)
}

export async function listObjections(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  status?: ObjectionStatus
): Promise<ContactObjection[]> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  let query = db
    .from('contact_objections')
    .select('*')
    .eq('account_id', validAccId)
    .eq('contact_id', validContactId)

  if (status) {
    query = query.eq('status', validateObjectionStatus(status))
  }

  query = query.order('last_seen_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    throw new Error(`listObjections failed: ${error.message}`)
  }

  return (data as ContactObjection[]) || []
}

// ============================================================
// 4. Commercial Context Aggregator
// ============================================================

export async function getCommercialContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ContactCommercialContext> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validContactId = validateUuid(contactId, 'contactId')

  const [profile, interests, objections] = await Promise.all([
    getLeadProfile(db, validAccId, validContactId),
    listCatalogInterests(db, validAccId, validContactId),
    listObjections(db, validAccId, validContactId),
  ])

  return {
    profile,
    interests,
    objections,
  }
}
