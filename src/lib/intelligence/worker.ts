import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommercialIntelligenceProvider } from './types'
import { executeConversationExtraction } from './extractor'

export interface IntelligenceJobPayload {
  accountId: string
  conversationId: string
  extractorVersion?: string
  promptVersion?: string
  model?: string
  triggerMessageId?: string
}

export interface ProcessIntelligenceJobResult {
  success: boolean
  processed: boolean
  runId?: string
  error?: string
}

export async function handleIntelligenceExtractionJob(
  payload: IntelligenceJobPayload,
  db: SupabaseClient,
  provider: CommercialIntelligenceProvider
): Promise<ProcessIntelligenceJobResult> {
  if (!payload || !payload.accountId || !payload.conversationId) {
    return { success: true, processed: false, error: 'invalid_payload' }
  }

  const result = await executeConversationExtraction({
    db,
    provider,
    accountId: payload.accountId,
    conversationId: payload.conversationId,
    extractorVersion: payload.extractorVersion || 'v1',
    promptVersion: payload.promptVersion || 'v1',
    model: payload.model,
  })

  if (!result.processed && result.reason === 'failed') {
    throw new Error(result.error || 'Intelligence extraction failed')
  }

  return {
    success: true,
    processed: result.processed,
    runId: result.runId,
    error: result.error,
  }
}
