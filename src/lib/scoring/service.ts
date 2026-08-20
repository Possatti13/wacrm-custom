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
    const cfg = await getLeadScoringConfig(this.db, payload.accountId)
    if (!cfg || !cfg.enabled || cfg.current_revision_id !== payload.targetRevisionId) {
      // Target revision is no longer current -> obsolete job
      return { processedCount: 0, nextCursor: null, isObsolete: true }
    }

    const batchSize = payload.batchSize || 50

    let query = this.db
      .from('contacts')
      .select('id')
      .eq('account_id', payload.accountId)
      .order('id', { ascending: true })
      .limit(batchSize)

    if (payload.afterContactId) {
      query = query.gt('id', payload.afterContactId)
    }

    const { data: contacts, error } = await query

    if (error) {
      throw new Error(`processTenantSweep fetch contacts failed: ${error.message}`)
    }

    const contactList = contacts || []
    for (const c of contactList) {
      await calculateAndPersistContactScore(
        this.db,
        payload.accountId,
        c.id as string,
        'tenant_revision_recompute'
      )
    }

    const nextCursor = contactList.length === batchSize ? (contactList[contactList.length - 1].id as string) : null

    if (nextCursor) {
      await this.enqueueTenantSweep({
        accountId: payload.accountId,
        targetRevisionId: payload.targetRevisionId,
        afterContactId: nextCursor,
        batchSize,
      })
    }

    return {
      processedCount: contactList.length,
      nextCursor,
      isObsolete: false,
    }
  }
}
