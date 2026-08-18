import crypto from 'node:crypto'
import type { JobEnvelope } from './types'

export interface EnvelopeValidationResult<TPayload = unknown> {
  ok: boolean
  envelope?: JobEnvelope<TPayload>
  error?: string
}

export function createJobEnvelope<TPayload>(params: {
  type: string
  accountId: string
  payload: TPayload
  correlationId?: string
}): JobEnvelope<TPayload> {
  if (!params.type || typeof params.type !== 'string') {
    throw new Error('createJobEnvelope: type is required and must be a string')
  }
  if (!params.accountId || typeof params.accountId !== 'string') {
    throw new Error('createJobEnvelope: accountId is required and must be a string')
  }

  return {
    version: 1,
    jobId: crypto.randomUUID(),
    type: params.type,
    accountId: params.accountId,
    createdAt: new Date().toISOString(),
    correlationId: params.correlationId || crypto.randomUUID(),
    payload: params.payload,
  }
}

export function validateJobEnvelope<TPayload = unknown>(
  input: unknown
): EnvelopeValidationResult<TPayload> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Job envelope must be a non-null object' }
  }

  const record = input as Record<string, unknown>

  if (record.version !== 1) {
    return { ok: false, error: `Unsupported envelope version: ${String(record.version)}. Expected version 1.` }
  }

  if (typeof record.jobId !== 'string' || record.jobId.trim().length === 0) {
    return { ok: false, error: 'Job envelope missing or invalid jobId' }
  }

  if (typeof record.type !== 'string' || record.type.trim().length === 0) {
    return { ok: false, error: 'Job envelope missing or invalid type' }
  }

  if (typeof record.accountId !== 'string' || record.accountId.trim().length === 0) {
    return { ok: false, error: 'Job envelope missing or invalid accountId' }
  }

  if (typeof record.createdAt !== 'string' || isNaN(Date.parse(record.createdAt))) {
    return { ok: false, error: 'Job envelope missing or invalid createdAt ISO timestamp' }
  }

  if (record.payload === undefined) {
    return { ok: false, error: 'Job envelope missing payload' }
  }

  return {
    ok: true,
    envelope: record as unknown as JobEnvelope<TPayload>,
  }
}
