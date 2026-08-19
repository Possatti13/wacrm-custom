import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ConversationInsight,
  ConversationInsightEvidence,
  ConversationInsightWithEvidence,
  ConversationAnalysisRun,
  ConversationAnalysisState,
  CreateInsightInput,
  SupersedeInsightInput,
  InsightStatus,
  InsightType,
} from './types'
import { computeInsightDedupeKey } from './dedupe'
import {
  validateUuid,
  validateCreateInsight,
  validateSupersedeInsight,
  InsightValidationError,
} from './validation'

// ============================================================
// 1. Insights CRUD & Lifecycle Operations
// ============================================================

export async function createConversationInsight(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  rawInput: CreateInsightInput
): Promise<ConversationInsightWithEvidence> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')
  const input = validateCreateInsight(rawInput)

  const dedupeKey = computeInsightDedupeKey({
    insightType: input.insight_type,
    catalogItemId: input.catalog_item_id,
    valueText: input.value_text,
    evidence: input.evidence,
    extractorVersion: input.extractor_version,
  })

  // 1. Check if an active insight already exists with this exact dedupe key
  const { data: existing, error: findErr } = await db
    .from('conversation_insights')
    .select('*')
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .eq('dedupe_key', dedupeKey)
    .eq('status', 'active')
    .maybeSingle()

  if (findErr) {
    throw new Error(`createConversationInsight lookup failed: ${findErr.message}`)
  }

  if (existing) {
    // Return existing insight with evidence (idempotency)
    return getInsightWithEvidence(db, validAccId, validConvId, existing.id) as Promise<ConversationInsightWithEvidence>
  }

  // 2. Insert new insight
  const now = new Date().toISOString()
  const { data: inserted, error: insertErr } = await db
    .from('conversation_insights')
    .insert({
      account_id: validAccId,
      conversation_id: validConvId,
      insight_type: input.insight_type,
      value_text: input.value_text,
      value_json: input.value_json,
      catalog_item_id: input.catalog_item_id,
      confidence: input.confidence,
      source: input.source || 'manual',
      status: 'active',
      analysis_run_id: input.analysis_run_id,
      dedupe_key: dedupeKey,
      observed_at: input.observed_at || now,
    })
    .select('*')
    .single()

  if (insertErr) {
    if (insertErr.code === '23505' && insertErr.message?.includes('uq_conversation_insights_active_dedupe')) {
      // Raced with concurrent worker
      const raced = await db
        .from('conversation_insights')
        .select('*')
        .eq('account_id', validAccId)
        .eq('conversation_id', validConvId)
        .eq('dedupe_key', dedupeKey)
        .eq('status', 'active')
        .single()
      if (raced.data) {
        return getInsightWithEvidence(db, validAccId, validConvId, raced.data.id) as Promise<ConversationInsightWithEvidence>
      }
    }
    throw new Error(`createConversationInsight insert failed: ${insertErr.message}`)
  }

  const insight = inserted as ConversationInsight

  // 3. Insert associated evidence
  const createdEvidence: ConversationInsightEvidence[] = []
  if (input.evidence && input.evidence.length > 0) {
    const evidenceRows = input.evidence.map((e) => ({
      account_id: validAccId,
      conversation_id: validConvId,
      insight_id: insight.id,
      message_id: e.message_id,
      start_offset: e.start_offset,
      end_offset: e.end_offset,
      snippet: e.snippet,
    }))

    const { data: evData, error: evErr } = await db
      .from('conversation_insight_evidence')
      .insert(evidenceRows)
      .select('*')

    if (evErr) {
      throw new Error(`createConversationInsight evidence insert failed: ${evErr.message}`)
    }
    createdEvidence.push(...((evData as ConversationInsightEvidence[]) || []))
  }

  return {
    ...insight,
    evidence: createdEvidence,
  }
}

export async function supersedeConversationInsight(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  originalInsightId: string,
  rawInput: SupersedeInsightInput
): Promise<ConversationInsightWithEvidence> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')
  const validOrigId = validateUuid(originalInsightId, 'originalInsightId')
  const input = validateSupersedeInsight(rawInput)

  const newDedupeKey = computeInsightDedupeKey({
    insightType: input.new_insight_type,
    catalogItemId: input.new_catalog_item_id,
    valueText: input.new_value_text,
    evidence: input.evidence,
    extractorVersion: input.extractor_version,
  })

  // Call the atomic transactional RPC
  const { data: rpcResult, error: rpcErr } = await db.rpc('supersede_conversation_insight', {
    p_account_id: validAccId,
    p_conversation_id: validConvId,
    p_original_insight_id: validOrigId,
    p_new_insight_type: input.new_insight_type,
    p_new_value_text: input.new_value_text,
    p_new_value_json: input.new_value_json,
    p_new_catalog_item_id: input.new_catalog_item_id,
    p_new_confidence: input.new_confidence,
    p_new_source: input.new_source || 'manual',
    p_new_dedupe_key: newDedupeKey,
    p_evidence: input.evidence || [],
  })

  if (rpcErr) {
    throw new Error(`supersedeConversationInsight failed: ${rpcErr.message}`)
  }

  const newInsightId = (rpcResult as { new_insight_id: string })?.new_insight_id
  if (!newInsightId) {
    throw new Error('supersede_conversation_insight did not return new_insight_id')
  }

  const result = await getInsightWithEvidence(db, validAccId, validConvId, newInsightId)
  if (!result) {
    throw new Error(`Could not load superseded insight ${newInsightId}`)
  }
  return result
}

export async function retractConversationInsight(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  insightId: string,
  reason: string
): Promise<ConversationInsight> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')
  const validInsightId = validateUuid(insightId, 'insightId')

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new InsightValidationError('Retracted reason is required')
  }

  const { error: rpcErr } = await db.rpc('retract_conversation_insight', {
    p_account_id: validAccId,
    p_conversation_id: validConvId,
    p_insight_id: validInsightId,
    p_retracted_reason: reason.trim(),
  })

  if (rpcErr) {
    throw new Error(`retractConversationInsight failed: ${rpcErr.message}`)
  }

  const { data, error } = await db
    .from('conversation_insights')
    .select('*')
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .eq('id', validInsightId)
    .single()

  if (error || !data) {
    throw new Error(`Failed to load retracted insight: ${error?.message || 'Not found'}`)
  }

  return data as ConversationInsight
}

export async function getInsightWithEvidence(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  insightId: string
): Promise<ConversationInsightWithEvidence | null> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')
  const validInsightId = validateUuid(insightId, 'insightId')

  const { data: insight, error: insightErr } = await db
    .from('conversation_insights')
    .select(`
      *,
      catalog_items:catalog_item_id (
        id,
        name,
        type,
        sku,
        status
      )
    `)
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .eq('id', validInsightId)
    .maybeSingle()

  if (insightErr || !insight) {
    return null
  }

  const { data: evidence, error: evErr } = await db
    .from('conversation_insight_evidence')
    .select('*')
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .eq('insight_id', validInsightId)

  if (evErr) {
    throw new Error(`getInsightWithEvidence evidence lookup failed: ${evErr.message}`)
  }

  const row = insight as Record<string, unknown>
  const catalogItem = row.catalog_items as ConversationInsightWithEvidence['catalog_item']

  return {
    ...(row as unknown as ConversationInsight),
    evidence: (evidence as ConversationInsightEvidence[]) || [],
    catalog_item: catalogItem || null,
  }
}

export async function listConversationInsights(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  options?: {
    status?: InsightStatus
    insightType?: InsightType
  }
): Promise<ConversationInsightWithEvidence[]> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')

  let query = db
    .from('conversation_insights')
    .select(`
      *,
      catalog_items:catalog_item_id (
        id,
        name,
        type,
        sku,
        status
      )
    `)
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)

  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.insightType) {
    query = query.eq('insight_type', options.insightType)
  }

  query = query.order('observed_at', { ascending: false })

  const { data: insights, error } = await query

  if (error) {
    throw new Error(`listConversationInsights failed: ${error.message}`)
  }

  if (!insights || insights.length === 0) {
    return []
  }

  const insightIds = insights.map((i: { id: string }) => i.id)

  const { data: evidenceRows, error: evErr } = await db
    .from('conversation_insight_evidence')
    .select('*')
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .in('insight_id', insightIds)

  if (evErr) {
    throw new Error(`listConversationInsights evidence lookup failed: ${evErr.message}`)
  }

  const evidenceMap = new Map<string, ConversationInsightEvidence[]>()
  for (const ev of (evidenceRows as ConversationInsightEvidence[]) || []) {
    const list = evidenceMap.get(ev.insight_id) || []
    list.push(ev)
    evidenceMap.set(ev.insight_id, list)
  }

  return insights.map((row: Record<string, unknown>) => {
    const catalogItem = row.catalog_items as ConversationInsightWithEvidence['catalog_item']
    return {
      ...(row as unknown as ConversationInsight),
      evidence: evidenceMap.get(row.id as string) || [],
      catalog_item: catalogItem || null,
    }
  })
}

// ============================================================
// 2. Ledger & Processing State Helpers (Server-Only)
// ============================================================

export async function getUnanalyzedMessages(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  extractorVersion = 'v1'
): Promise<Array<{ id: string; conversation_id: string; content_text: string | null; created_at: string }>> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')

  // Query messages from conversation that are NOT present in conversation_analysis_messages for this extractor version
  const { data: analyzed, error: anErr } = await db
    .from('conversation_analysis_messages')
    .select('message_id')
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .eq('extractor_version', extractorVersion)

  if (anErr) {
    throw new Error(`getUnanalyzedMessages lookup failed: ${anErr.message}`)
  }

  const analyzedIds = (analyzed || []).map((a: { message_id: string }) => a.message_id)

  let query = db
    .from('messages')
    .select('id, conversation_id, content_text, created_at')
    .eq('conversation_id', validConvId)

  if (analyzedIds.length > 0) {
    // Exclude analyzed messages
    query = query.not('id', 'in', `(${analyzedIds.join(',')})`)
  }

  query = query.order('created_at', { ascending: true })

  const { data: messages, error: msgErr } = await query

  if (msgErr) {
    throw new Error(`getUnanalyzedMessages fetch failed: ${msgErr.message}`)
  }

  return messages || []
}

export async function recordAnalysisRun(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  runData: {
    status: 'completed' | 'failed' | 'processing'
    fromCursorTimestamp?: string | null
    fromCursorMessageId?: string | null
    toCursorTimestamp?: string | null
    toCursorMessageId?: string | null
    messagesCount: number
    insightsCount: number
    extractorVersion?: string
    provider?: string | null
    model?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    startedAt?: string | null
    completedAt?: string | null
  }
): Promise<ConversationAnalysisRun> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')

  const { data, error } = await db
    .from('conversation_analysis_runs')
    .insert({
      account_id: validAccId,
      conversation_id: validConvId,
      status: runData.status,
      from_cursor_timestamp: runData.fromCursorTimestamp || null,
      from_cursor_message_id: runData.fromCursorMessageId || null,
      to_cursor_timestamp: runData.toCursorTimestamp || null,
      to_cursor_message_id: runData.toCursorMessageId || null,
      messages_count: runData.messagesCount,
      insights_count: runData.insightsCount,
      extractor_version: runData.extractorVersion || 'v1',
      provider: runData.provider || null,
      model: runData.model || null,
      error_code: runData.errorCode || null,
      error_message: runData.errorMessage ? runData.errorMessage.substring(0, 500) : null,
      started_at: runData.startedAt || new Date().toISOString(),
      completed_at: runData.completedAt || new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`recordAnalysisRun failed: ${error.message}`)
  }

  return data as ConversationAnalysisRun
}

export async function recordAnalyzedMessages(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  messageIds: string[],
  analysisRunId: string,
  extractorVersion = 'v1'
): Promise<void> {
  if (!messageIds || messageIds.length === 0) return

  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')
  const validRunId = validateUuid(analysisRunId, 'analysisRunId')

  const rows = messageIds.map((msgId) => ({
    account_id: validAccId,
    conversation_id: validConvId,
    message_id: validateUuid(msgId, 'message_id'),
    extractor_version: extractorVersion,
    analysis_run_id: validRunId,
  }))

  const { error } = await db.from('conversation_analysis_messages').upsert(rows, {
    onConflict: 'conversation_id,message_id,extractor_version',
  })

  if (error) {
    throw new Error(`recordAnalyzedMessages failed: ${error.message}`)
  }
}

export async function getAnalysisState(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  extractorVersion = 'v1'
): Promise<ConversationAnalysisState | null> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')

  const { data, error } = await db
    .from('conversation_analysis_state')
    .select('*')
    .eq('account_id', validAccId)
    .eq('conversation_id', validConvId)
    .eq('extractor_version', extractorVersion)
    .maybeSingle()

  if (error) {
    throw new Error(`getAnalysisState failed: ${error.message}`)
  }

  return (data as ConversationAnalysisState) || null
}

export async function updateAnalysisState(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  extractorVersion: string,
  stateData: {
    lastAnalyzedMessageCreatedAt?: string | null
    lastAnalyzedMessageId?: string | null
    lastAnalysisRunId?: string | null
  }
): Promise<ConversationAnalysisState> {
  const validAccId = validateUuid(accountId, 'accountId')
  const validConvId = validateUuid(conversationId, 'conversationId')
  const version = extractorVersion?.trim() || 'v1'

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    account_id: validAccId,
    conversation_id: validConvId,
    extractor_version: version,
    last_analyzed_at: now,
    updated_at: now,
  }

  if (stateData.lastAnalyzedMessageCreatedAt !== undefined) {
    payload.last_analyzed_message_created_at = stateData.lastAnalyzedMessageCreatedAt
  }
  if (stateData.lastAnalyzedMessageId !== undefined) {
    payload.last_analyzed_message_id = stateData.lastAnalyzedMessageId
  }
  if (stateData.lastAnalysisRunId !== undefined) {
    payload.last_analysis_run_id = stateData.lastAnalysisRunId
  }

  const { data, error } = await db
    .from('conversation_analysis_state')
    .upsert(payload, { onConflict: 'conversation_id,extractor_version' })
    .select('*')
    .single()

  if (error) {
    throw new Error(`updateAnalysisState failed: ${error.message}`)
  }

  return data as ConversationAnalysisState
}
