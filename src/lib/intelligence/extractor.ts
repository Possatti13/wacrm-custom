import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommercialIntelligenceProvider,
  RawStructuredExtractionOutput,
  RawModelObservation,
  ValidatedObservation,
} from './types'
import { claimAnalysisRun, persistAnalysisBatch, failAnalysisRun } from './repository'
import { buildAnalysisInput } from './input-builder'
import { resolveAndValidateObservation } from './validation'
import { listTenantObjectionTaxonomy, ensureTenantObjectionTaxonomy } from './taxonomy'
import { logAiUsage } from '@/lib/ai/usage'

export interface ExtractConversationOptions {
  db: SupabaseClient
  provider: CommercialIntelligenceProvider
  accountId: string
  conversationId: string
  extractorVersion?: string
  promptVersion?: string
  model?: string
  batchLimit?: number
}

export interface ExtractionExecutionResult {
  processed: boolean
  runId?: string
  insightsCount?: number
  reason?: 'no_messages' | 'already_processing' | 'already_completed' | 'budget_blocked' | 'succeeded' | 'failed'
  error?: string
}

export async function executeConversationExtraction(
  options: ExtractConversationOptions
): Promise<ExtractionExecutionResult> {
  const {
    db,
    provider,
    accountId,
    conversationId,
    extractorVersion = 'v1',
    promptVersion = 'v1',
    model,
    batchLimit = 25,
  } = options

  // 1. Budget Circuit Breaker Check
  const { data: settings } = await db
    .from('tenant_intelligence_settings')
    .select('monthly_budget_limit_usd')
    .eq('account_id', accountId)
    .maybeSingle()

  if (settings?.monthly_budget_limit_usd !== null && settings?.monthly_budget_limit_usd !== undefined) {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const { data: usageRows } = await db
      .from('ai_usage_log')
      .select('estimated_cost')
      .eq('account_id', accountId)
      .gte('created_at', monthStart.toISOString())

    const totalSpent = (usageRows || []).reduce((acc, row) => acc + Number(row.estimated_cost || 0), 0)
    if (totalSpent >= Number(settings.monthly_budget_limit_usd)) {
      return {
        processed: false,
        reason: 'budget_blocked',
        error: 'Monthly AI budget limit exceeded for tenant',
      }
    }
  }

  // 2. Claim Analysis Run (short transaction)
  const claim = await claimAnalysisRun(db, {
    accountId,
    conversationId,
    extractorVersion,
    promptVersion,
    provider: provider.providerName,
    model,
    batchLimit,
  })

  if (claim.status === 'no_messages') {
    return { processed: false, reason: 'no_messages', insightsCount: 0 }
  }

  if (claim.status === 'already_processing') {
    return { processed: false, reason: 'already_processing' }
  }

  if (claim.status === 'already_completed') {
    return { processed: true, runId: claim.run_id, reason: 'already_completed' }
  }

  const runId = claim.run_id!

  try {
    // 3. Load Tenant Objection Taxonomy
    let taxonomies = await listTenantObjectionTaxonomy(db, accountId)
    if (taxonomies.length === 0) {
      await ensureTenantObjectionTaxonomy(db, accountId)
      taxonomies = await listTenantObjectionTaxonomy(db, accountId)
    }

    // 4. Build Analysis Input from Pinned Snapshots & Taxonomies
    const builtInput = buildAnalysisInput({
      messages: claim.messages || [],
      configSnapshot: claim.config_revision!.snapshot,
      catalogSnapshot: claim.catalog_context!.snapshot,
      taxonomies,
      promptVersion,
    })

    // 5. Call External LLM Provider (outside DB transaction)
    const extractionResult = await provider.extract({
      systemPrompt: builtInput.systemPrompt,
      userPrompt: builtInput.userPrompt,
      model,
    })

    // 6. Parse & Validate Raw Output
    const rawData = extractionResult.rawOutput as RawStructuredExtractionOutput
    const rawObservations: RawModelObservation[] = Array.isArray(rawData?.observations)
      ? rawData.observations
      : []

    // 7. Resolve Observations against Pinned Snapshots & Quoted Evidence
    const validatedObservations: ValidatedObservation[] = []
    for (const obs of rawObservations) {
      const resolved = resolveAndValidateObservation(obs, {
        configSnapshot: claim.config_revision!.snapshot,
        catalogSnapshot: claim.catalog_context!.snapshot,
        messageRefMap: builtInput.messageRefMap,
        extractorVersion,
      })
      if (resolved) {
        validatedObservations.push(resolved)
      }
    }

    // 8. Persist Batch via Atomic RPC (short transaction)
    const lastMsg = claim.last_message
    const finalizeRes = await persistAnalysisBatch(db, {
      accountId,
      conversationId,
      runId,
      extractorVersion,
      insights: validatedObservations,
      analyzedMessageIds: claim.analyzed_message_ids || [],
      lastMessageId: lastMsg?.id || null,
      lastMessageCreatedAt: lastMsg?.created_at || null,
      inputTokens: extractionResult.usage?.promptTokens,
      outputTokens: extractionResult.usage?.completionTokens,
      totalTokens: extractionResult.usage?.totalTokens,
      latencyMs: extractionResult.latencyMs,
    })

    // 9. Log Usage Best-Effort
    if (extractionResult.usage) {
      await logAiUsage(db, {
        accountId,
        conversationId,
        mode: 'auto_reply', // using compatible mode for log table
        provider: provider.providerName as any,
        model: extractionResult.model || model || 'default',
        usage: {
          promptTokens: extractionResult.usage.promptTokens,
          completionTokens: extractionResult.usage.completionTokens,
          totalTokens: extractionResult.usage.totalTokens,
        },
      })
    }

    return {
      processed: true,
      runId,
      insightsCount: finalizeRes.insights_count,
      reason: 'succeeded',
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const errorCode = (err as { code?: string })?.code || 'extraction_error'

    // Fail the run safely in DB
    try {
      await failAnalysisRun(db, {
        accountId,
        conversationId,
        runId,
        errorCode,
        errorMessage: errorMsg,
      })
    } catch {
      // ignore secondary failure
    }

    return {
      processed: false,
      runId,
      reason: 'failed',
      error: errorMsg,
    }
  }
}
