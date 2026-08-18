import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_JOB_ATTEMPTS,
  WHATSAPP_INBOUND_BATCH_SIZE,
  WHATSAPP_INBOUND_VISIBILITY_TIMEOUT,
} from '../config'
import { validateJobEnvelope } from '../envelope'
import { defaultJobQueue, type JobQueue } from '../queue'
import { handleWhatsAppInboundJob } from '../handlers/whatsapp-inbound'
import type { JobBatchResult, WhatsAppInboundJobEnvelope } from '../types'

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

export interface ProcessBatchOptions {
  limit?: number
  visibilityTimeout?: number
  db?: SupabaseClient
  queue?: JobQueue
}

/**
 * HTTP-independent worker that processes a batch of inbound WhatsApp jobs.
 *
 * Execution guarantee:
 * - Each job is processed in complete isolation.
 * - Attempts 1, 2, and 3 execute the handler.
 * - On success, the job is archived.
 * - On failure (attempts 1 or 2), the job is left unarchived to retry after visibility timeout.
 * - On failure of attempt 3 (`read_ct >= MAX_JOB_ATTEMPTS`), the job is atomically
 *   moved to DLQ and archived.
 */
export async function processWhatsAppInboundBatch(
  options?: ProcessBatchOptions
): Promise<JobBatchResult> {
  const db = options?.db || getDefaultAdminClient()
  const queue = options?.queue || defaultJobQueue
  const limit = options?.limit || WHATSAPP_INBOUND_BATCH_SIZE
  const vt = options?.visibilityTimeout || WHATSAPP_INBOUND_VISIBILITY_TIMEOUT

  const stats: JobBatchResult = {
    read: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
  }

  let messages: Awaited<ReturnType<typeof queue.readWhatsAppInbound>>
  try {
    messages = await queue.readWhatsAppInbound(vt, limit, db)
  } catch (readErr) {
    console.error('[whatsapp-inbound-worker] Failed to read batch from queue:', readErr)
    return stats
  }

  stats.read = messages.length
  if (messages.length === 0) {
    return stats
  }

  for (const rawMsg of messages) {
    const startTime = Date.now()
    const msgId = rawMsg.msg_id
    const readCount = rawMsg.read_ct

    // 1. Validate envelope integrity
    const validation = validateJobEnvelope<WhatsAppInboundJobEnvelope['payload']>(rawMsg.message)
    if (!validation.ok || !validation.envelope) {
      console.warn(`[whatsapp-inbound-worker] Invalid envelope in message ${msgId}, moving to DLQ:`, validation.error)
      try {
        await queue.deadLetterWhatsAppInbound(
          msgId,
          rawMsg.message,
          { error: validation.error || 'Invalid envelope format', readCount },
          db
        )
        stats.deadLettered++
      } catch (dlqErr) {
        console.error(`[whatsapp-inbound-worker] Failed to DLQ invalid message ${msgId}:`, dlqErr)
        stats.failed++
      }
      continue
    }

    const envelope = validation.envelope as WhatsAppInboundJobEnvelope
    const jobId = envelope.jobId
    const accountId = envelope.accountId
    const provider = envelope.payload?.provider || 'unknown'

    // 2. Execute handler in isolation
    try {
      await handleWhatsAppInboundJob(envelope, db)

      // Success: archive the job
      await queue.archiveWhatsAppInbound(msgId, db)
      stats.succeeded++

      const durationMs = Date.now() - startTime
      logJobOutcome({
        jobId,
        pgmqMessageId: msgId,
        type: envelope.type,
        accountId,
        provider,
        readCount,
        durationMs,
        outcome: 'succeeded',
      })
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : String(err)

      if (readCount >= MAX_JOB_ATTEMPTS) {
        // Attempt limit reached: route to DLQ
        console.error(
          `[whatsapp-inbound-worker] Job ${jobId} failed attempt ${readCount}/${MAX_JOB_ATTEMPTS}. Routing to DLQ:`,
          errorMessage
        )

        try {
          await queue.deadLetterWhatsAppInbound(
            msgId,
            envelope,
            {
              sanitizedError: errorMessage,
              attempts: readCount,
              failedAt: new Date().toISOString(),
              originalMsgId: msgId,
            },
            db
          )
          stats.deadLettered++

          logJobOutcome({
            jobId,
            pgmqMessageId: msgId,
            type: envelope.type,
            accountId,
            provider,
            readCount,
            durationMs,
            outcome: 'dead_lettered',
          })
        } catch (dlqErr) {
          console.error(`[whatsapp-inbound-worker] Critical: DLQ routing failed for job ${jobId}:`, dlqErr)
          stats.failed++
        }
      } else {
        // Retryable transient failure: leave in queue for visibility expiration
        console.warn(
          `[whatsapp-inbound-worker] Job ${jobId} failed attempt ${readCount}/${MAX_JOB_ATTEMPTS} (will retry):`,
          errorMessage
        )
        stats.failed++

        logJobOutcome({
          jobId,
          pgmqMessageId: msgId,
          type: envelope.type,
          accountId,
          provider,
          readCount,
          durationMs,
          outcome: 'retry_pending',
        })
      }
    }
  }

  return stats
}

function logJobOutcome(meta: {
  jobId: string
  pgmqMessageId: number
  type: string
  accountId: string
  provider: string
  readCount: number
  durationMs: number
  outcome: 'succeeded' | 'retry_pending' | 'dead_lettered'
}) {
  console.log(
    JSON.stringify({
      component: 'whatsapp_inbound_worker',
      ...meta,
    })
  )
}
