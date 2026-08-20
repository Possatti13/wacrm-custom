import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadScoringRule, RecalculateTenantSweepJobPayload } from './types'
import {
  saveLeadScoringConfiguration,
  calculateAndPersistContactScore,
  getLeadScoringConfig,
} from './repository'

export class LeadScoringService {
  constructor(private db: SupabaseClient) {}

  async saveConfiguration(
    accountId: string,
    config: {
      enabled?: boolean
      base_score?: number
      min_score?: number
      max_score?: number
    },
    rules: Partial<LeadScoringRule>[]
  ) {
    const res = await saveLeadScoringConfiguration(this.db, accountId, config, rules)

    // Enqueue tenant sweep job in PGMQ if enabled
    if (res.enabled && res.revision_id) {
      await this.enqueueTenantSweep({
        accountId,
        targetRevisionId: res.revision_id,
        batchSize: 50,
      })
    }

    return res
  }

  async scoreContact(accountId: string, contactId: string, triggerSource = 'commercial_state_projected') {
    return calculateAndPersistContactScore(this.db, accountId, contactId, triggerSource)
  }

  async enqueueTenantSweep(payload: RecalculateTenantSweepJobPayload) {
    try {
      await this.db.rpc('pgmq_send', {
        queue_name: 'lead_scoring_jobs',
        msg: {
          version: 1,
          jobId: `sweep-${payload.accountId}-${payload.targetRevisionId}-${Date.now()}`,
          type: 'scoring.recalculate_tenant',
          accountId: payload.accountId,
          createdAt: new Date().toISOString(),
          payload,
        },
      })
    } catch {
      // PGMQ might be handled via adapter
    }
  }

  async processTenantSweep(payload: RecalculateTenantSweepJobPayload): Promise<{
    processedCount: number
    nextCursor: string | null
    isObsolete: boolean
  }> {
    const { data, error } = await this.db.rpc('recalculate_tenant_lead_scores_batch', {
      p_account_id: payload.accountId,
      p_target_revision_id: payload.targetRevisionId,
      p_after_contact_id: payload.afterContactId || null,
      p_batch_size: payload.batchSize || 50,
    })

    if (error) {
      throw new Error(`processTenantSweep failed: ${error.message}`)
    }

    const res = data as {
      outcome: string
      processed_count: number
      next_cursor: string | null
      is_obsolete: boolean
    }

    if (res.next_cursor) {
      await this.enqueueTenantSweep({
        accountId: payload.accountId,
        targetRevisionId: payload.targetRevisionId,
        afterContactId: res.next_cursor,
        batchSize: payload.batchSize || 50,
      })
    }

    return {
      processedCount: res.processed_count,
      nextCursor: res.next_cursor,
      isObsolete: res.is_obsolete,
    }
  }
}
