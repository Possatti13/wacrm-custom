import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClaimRunResult,
  FinalizeBatchResult,
  ValidatedObservation,
} from './types'
import { validateUuid } from '@/lib/commercial-config/validation'

export interface ClaimRunParams {
  accountId: string
  conversationId: string
  extractorVersion?: string
  promptVersion?: string
  provider?: string
  model?: string
  batchLimit?: number
  leaseSeconds?: number
}

export async function claimAnalysisRun(
  db: SupabaseClient,
  params: ClaimRunParams
): Promise<ClaimRunResult> {
  const validAccId = validateUuid(params.accountId, 'accountId')
  const validConvId = validateUuid(params.conversationId, 'conversationId')

  const { data, error } = await db.rpc('claim_conversation_analysis_run', {
    p_account_id: validAccId,
    p_conversation_id: validConvId,
    p_extractor_version: params.extractorVersion || 'v1',
    p_prompt_version: params.promptVersion || 'v1',
    p_provider: params.provider || null,
    p_model: params.model || null,
    p_batch_limit: params.batchLimit || 25,
    p_lease_seconds: params.leaseSeconds || 300,
  })

  if (error) {
    throw new Error(`claimAnalysisRun failed: ${error.message}`)
  }

  return data as ClaimRunResult
}

export interface PersistBatchParams {
  accountId: string
  conversationId: string
  runId: string
  extractorVersion?: string
  insights: ValidatedObservation[]
  analyzedMessageIds: string[]
  lastMessageId?: string | null
  lastMessageCreatedAt?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  latencyMs?: number | null
}

export async function persistAnalysisBatch(
  db: SupabaseClient,
  params: PersistBatchParams
): Promise<FinalizeBatchResult> {
  const validAccId = validateUuid(params.accountId, 'accountId')
  const validConvId = validateUuid(params.conversationId, 'conversationId')
  const validRunId = validateUuid(params.runId, 'runId')

  const { data, error } = await db.rpc('persist_conversation_analysis_batch', {
    p_account_id: validAccId,
    p_conversation_id: validConvId,
    p_run_id: validRunId,
    p_extractor_version: params.extractorVersion || 'v1',
    p_insights: params.insights,
    p_analyzed_message_ids: params.analyzedMessageIds,
    p_last_message_id: params.lastMessageId || null,
    p_last_message_created_at: params.lastMessageCreatedAt || null,
    p_input_tokens: params.inputTokens ?? null,
    p_output_tokens: params.outputTokens ?? null,
    p_total_tokens: params.totalTokens ?? null,
    p_latency_ms: params.latencyMs ?? null,
  })

  if (error) {
    throw new Error(`persistAnalysisBatch failed: ${error.message}`)
  }

  return data as FinalizeBatchResult
}

export interface FailRunParams {
  accountId: string
  conversationId: string
  runId: string
  errorCode: string
  errorMessage: string
}

export async function failAnalysisRun(
  db: SupabaseClient,
  params: FailRunParams
): Promise<{ status: 'failed'; run_id: string }> {
  const validAccId = validateUuid(params.accountId, 'accountId')
  const validConvId = validateUuid(params.conversationId, 'conversationId')
  const validRunId = validateUuid(params.runId, 'runId')

  const { data, error } = await db.rpc('fail_conversation_analysis_run', {
    p_account_id: validAccId,
    p_conversation_id: validConvId,
    p_run_id: validRunId,
    p_error_code: params.errorCode,
    p_error_message: params.errorMessage,
  })

  if (error) {
    throw new Error(`failAnalysisRun failed: ${error.message}`)
  }

  return data as { status: 'failed'; run_id: string }
}
