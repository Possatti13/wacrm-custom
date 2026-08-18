import type { NormalizedInboundEvent } from '@/lib/whatsapp/inbound/types'

export interface JobEnvelope<TPayload = unknown> {
  version: 1
  jobId: string
  type: string
  accountId: string
  createdAt: string
  correlationId?: string
  payload: TPayload
}

export type WhatsAppInboundJobEnvelope = JobEnvelope<NormalizedInboundEvent>

export interface QueueMessage<TPayload = unknown> {
  msg_id: number
  read_ct: number
  enqueued_at: string
  vt: string
  message: JobEnvelope<TPayload>
}

export interface DeadLetterMetadata {
  sanitizedError: string
  attempts: number
  failedAt: string
  originalMsgId: number
}

export interface JobBatchResult {
  read: number
  succeeded: number
  failed: number
  deadLettered: number
}
