import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CommercialIntelligenceProvider } from '@/lib/intelligence/types'
import { executeConversationExtraction } from '@/lib/intelligence/extractor'
import { OpenAiStructuredExtractor } from '@/lib/intelligence/providers/openai'
import { AnthropicStructuredExtractor } from '@/lib/intelligence/providers/anthropic'
import { XAiStructuredExtractor } from '@/lib/intelligence/providers/xai'
import { GeminiStructuredExtractor } from '@/lib/intelligence/providers/gemini'
import { MockStructuredExtractor } from '@/lib/intelligence/providers/mock'
import { loadIntelligenceCredential } from '@/lib/intelligence/credentials'
import { MAX_JOB_ATTEMPTS } from '../config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function getDefaultAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export const INTELLIGENCE_QUEUE = 'intelligence_extraction' as const
export const INTELLIGENCE_DLQ = 'intelligence_extraction_dead' as const
export const INTELLIGENCE_VISIBILITY_TIMEOUT = 120
export const INTELLIGENCE_BATCH_SIZE = 10

export interface IntelligenceBatchResult {
  read: number
  succeeded: number
  failed: number
  deadLettered: number
}

export function resolveProviderForTenant(
  providerName: string,
  apiKey?: string | null
): CommercialIntelligenceProvider {
  if (providerName === 'mock') {
    return new MockStructuredExtractor()
  }

  if (providerName === 'gemini') {
    if (!apiKey) throw new Error('Missing Google Gemini API key for intelligence extraction')
    return new GeminiStructuredExtractor(apiKey)
  }

  if (providerName === 'anthropic') {
    if (!apiKey) throw new Error('Missing Anthropic API key for intelligence extraction')
    return new AnthropicStructuredExtractor(apiKey)
  }

  if (providerName === 'xai') {
    if (!apiKey) throw new Error('Missing xAI API key for intelligence extraction')
    return new XAiStructuredExtractor(apiKey)
  }

  // Default to OpenAI
  if (!apiKey) throw new Error('Missing OpenAI API key for intelligence extraction')
  return new OpenAiStructuredExtractor(apiKey)
}

export async function processIntelligenceBatch(options?: {
  db?: SupabaseClient
  vt?: number
  limit?: number
  providerOverride?: CommercialIntelligenceProvider
}): Promise<IntelligenceBatchResult> {
  const db = options?.db || getDefaultAdminClient()
  const vt = options?.vt || INTELLIGENCE_VISIBILITY_TIMEOUT
  const limit = options?.limit || INTELLIGENCE_BATCH_SIZE

  const { data: rows, error: readError } = await db.rpc('read_intelligence_extraction', {
    p_vt: vt,
    p_limit: limit,
  })

  if (readError) {
    throw new Error(`read_intelligence_extraction failed: ${readError.message}`)
  }

  const messages = rows || []
  const result: IntelligenceBatchResult = {
    read: messages.length,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
  }

  for (const row of messages) {
    const msgId = Number(row.msg_id)
    const readCt = Number(row.read_ct)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = row.message as any
    const payload = envelope?.payload || envelope || {}

    try {
      const accountId = payload.accountId || envelope?.accountId
      const conversationId = payload.conversationId || envelope?.conversationId

      if (!accountId || !conversationId) {
        throw new Error('Invalid intelligence job envelope: missing accountId or conversationId')
      }

      // Fetch tenant intelligence settings for defaults
      const { data: tenantSettings } = await db
        .from('tenant_intelligence_settings')
        .select('provider, model, extractor_version, prompt_version')
        .eq('account_id', accountId)
        .maybeSingle()

      // Resolve provider
      let provider: CommercialIntelligenceProvider
      if (options?.providerOverride) {
        provider = options.providerOverride
      } else {
        const providerName = payload.provider || tenantSettings?.provider || 'openai'
        if (providerName === 'mock') {
          provider = new MockStructuredExtractor()
        } else {
          const cred = await loadIntelligenceCredential(db, accountId, providerName)
          provider = resolveProviderForTenant(providerName, cred.apiKey)
        }
      }

      const extractionRes = await executeConversationExtraction({
        db,
        provider,
        accountId,
        conversationId,
        extractorVersion: payload.extractorVersion || tenantSettings?.extractor_version || 'v1',
        promptVersion: payload.promptVersion || tenantSettings?.prompt_version || 'v1',
        model: payload.model || tenantSettings?.model,
      })

      if (!extractionRes.processed && extractionRes.reason === 'failed') {
        throw new Error(extractionRes.error || 'executeConversationExtraction failed')
      }

      // Archive job on success
      await db.rpc('archive_intelligence_extraction', { p_msg_id: msgId })
      result.succeeded++
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[intelligence worker error]:', err)
      result.failed++

      if (readCt >= MAX_JOB_ATTEMPTS) {
        // Route to DLQ
        await db.rpc('dead_letter_intelligence_extraction', {
          p_msg_id: msgId,
          p_message: envelope,
          p_error_info: {
            error: errorMsg,
            attempts: readCt,
            failed_at: new Date().toISOString(),
          },
        })
        result.deadLettered++
      } else {
        // Set visibility for backoff retry
        await db.rpc('set_intelligence_extraction_visibility', {
          p_msg_id: msgId,
          p_vt: Math.min(30 * readCt, 300),
        })
      }
    }
  }

  return result
}
