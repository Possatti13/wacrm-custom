import type { SupabaseClient } from '@supabase/supabase-js'
import { LeadScoringService } from './service'
import type { RecalculateTenantSweepJobPayload } from './types'

export interface ScoringJobMessage {
  type: 'scoring.recalculate_contact' | 'scoring.recalculate_tenant'
  accountId: string
  payload: {
    accountId: string
    contactId?: string
    targetRevisionId?: string
    afterContactId?: string | null
    batchSize?: number
    triggerSource?: string
  }
}

export async function handleScoringJob(
  db: SupabaseClient,
  job: ScoringJobMessage
): Promise<{ success: boolean; details?: unknown }> {
  const service = new LeadScoringService(db)

  if (job.type === 'scoring.recalculate_contact') {
    if (!job.payload.contactId) {
      throw new Error('Missing contactId for scoring.recalculate_contact job')
    }
    const res = await service.scoreContact(
      job.accountId,
      job.payload.contactId,
      job.payload.triggerSource || 'pgmq_job'
    )
    return { success: true, details: res }
  }

  if (job.type === 'scoring.recalculate_tenant') {
    if (!job.payload.targetRevisionId) {
      throw new Error('Missing targetRevisionId for scoring.recalculate_tenant job')
    }
    const res = await service.processTenantSweep(
      job.payload as RecalculateTenantSweepJobPayload
    )
    return { success: true, details: res }
  }

  throw new Error(`Unknown scoring job type: ${(job as { type: string }).type}`)
}
