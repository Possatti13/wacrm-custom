import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedInboundEvent } from '@/lib/whatsapp/inbound/types'
import { createJobEnvelope, validateJobEnvelope } from './envelope'
import { defaultJobQueue, type JobQueue } from './queue'
import type { WhatsAppInboundJobEnvelope } from './types'

export interface EnqueueInboundResult {
  jobIds: string[]
  messageIds: number[]
}

/**
 * Durably enqueue a batch of normalized WhatsApp inbound events in a single
 * atomic transaction.
 *
 * Requirements:
 * - All events MUST have a verified, authenticated `accountId`.
 * - All events are enqueued together via `enqueue_whatsapp_inbound_batch` (pgmq.send_batch).
 * - If enqueue fails, throws an Error so the webhook rejects and does NOT send a false 200.
 */
export async function enqueueWhatsAppInboundEvents(
  events: NormalizedInboundEvent[],
  options?: {
    db?: SupabaseClient
    queue?: JobQueue
    correlationId?: string
  }
): Promise<EnqueueInboundResult> {
  if (!events || events.length === 0) {
    return { jobIds: [], messageIds: [] }
  }

  const envelopes: WhatsAppInboundJobEnvelope[] = []

  for (const event of events) {
    if (!event.accountId || typeof event.accountId !== 'string' || event.accountId.trim().length === 0) {
      throw new Error('enqueueWhatsAppInboundEvents: Every event must contain a valid, authenticated accountId')
    }

    const envelope = createJobEnvelope<NormalizedInboundEvent>({
      type: 'whatsapp.inbound',
      accountId: event.accountId,
      payload: event,
      correlationId: options?.correlationId,
    })

    const validation = validateJobEnvelope(envelope)
    if (!validation.ok) {
      throw new Error(`enqueueWhatsAppInboundEvents validation failed: ${validation.error}`)
    }

    envelopes.push(envelope)
  }

  const queue = options?.queue || defaultJobQueue
  const messageIds = await queue.enqueueWhatsAppInboundBatch(envelopes, options?.db)

  return {
    jobIds: envelopes.map((e) => e.jobId),
    messageIds,
  }
}

/**
 * Convenience wrapper for a single inbound event.
 */
export async function enqueueWhatsAppInboundEvent(
  event: NormalizedInboundEvent,
  options?: {
    db?: SupabaseClient
    queue?: JobQueue
    correlationId?: string
  }
): Promise<{ jobId: string; messageId?: number }> {
  const result = await enqueueWhatsAppInboundEvents([event], options)
  return {
    jobId: result.jobIds[0] || '',
    messageId: result.messageIds[0],
  }
}
