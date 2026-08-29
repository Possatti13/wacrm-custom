import type { SupabaseClient } from '@supabase/supabase-js'

export interface SweepResult {
  success: boolean
  enqueued_count: number
  timestamp: string
}

/**
 * Sweeps conversations that are dirty and due for commercial intelligence,
 * and enqueues them atomically to the PGMQ extraction queue using FOR UPDATE SKIP LOCKED.
 */
export async function sweepAndEnqueueDueIntelligence(
  db: SupabaseClient,
  options?: {
    batchLimit?: number
    leaseSeconds?: number
  }
): Promise<SweepResult> {
  const batchLimit = options?.batchLimit ?? 20
  const leaseSeconds = options?.leaseSeconds ?? 300

  const { data, error } = await db.rpc('sweep_and_enqueue_due_intelligence', {
    p_batch_limit: batchLimit,
    p_lease_seconds: leaseSeconds,
  })

  if (error) {
    throw new Error(`sweepAndEnqueueDueIntelligence failed: ${error.message}`)
  }

  return data as SweepResult
}
