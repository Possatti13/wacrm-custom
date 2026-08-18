import { describe, expect, it, vi, beforeEach } from 'vitest'
import { processWhatsAppInboundBatch } from './whatsapp-inbound-worker'
import type { JobQueue } from '../queue'
import type { QueueMessage, WhatsAppInboundJobEnvelope } from '../types'
import * as handlerModule from '../handlers/whatsapp-inbound'

const fakeDb = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  }),
}

describe('WhatsApp Inbound Worker & Resiliency', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://mock.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-service-role-key')
    vi.clearAllMocks()
  })

  it('processes valid job, executes handler, and archives on success', async () => {
    const handleSpy = vi.spyOn(handlerModule, 'handleWhatsAppInboundJob').mockResolvedValue({ success: true })

    const envelope: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-101',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: {
        type: 'message',
        provider: 'meta',
        accountId: 'acc-1',
        externalMessageId: 'wamid.101',
        fromPhone: '5511999999999',
        senderName: 'Client',
        timestamp: 1700000000,
        fromMe: false,
        content: { type: 'text', text: 'Hello' },
      },
    }

    const messages: Array<QueueMessage<unknown>> = [
      {
        msg_id: 1,
        read_ct: 1,
        enqueued_at: '2026-08-18T00:00:00.000Z',
        vt: '2026-08-18T00:02:00.000Z',
        message: envelope,
      },
    ]

    const archivedIds: number[] = []
    const mockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(),
      readWhatsAppInbound: vi.fn(async () => messages),
      archiveWhatsAppInbound: vi.fn(async (id) => {
        archivedIds.push(id)
        return true
      }),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await processWhatsAppInboundBatch({ queue: mockQueue, db: fakeDb as any })
    expect(stats.read).toBe(1)
    expect(stats.succeeded).toBe(1)
    expect(stats.failed).toBe(0)
    expect(stats.deadLettered).toBe(0)
    expect(handleSpy).toHaveBeenCalledTimes(1)
    expect(archivedIds).toEqual([1])
  })

  it('isolates jobs in batch: Job A failure does not affect Job B', async () => {
    let callCount = 0
    vi.spyOn(handlerModule, 'handleWhatsAppInboundJob').mockImplementation(async (env) => {
      callCount++
      if (env.jobId === 'job-fail') {
        throw new Error('Database locked')
      }
      return { success: true }
    })

    const envA: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-fail',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: { type: 'unknown', provider: 'meta', accountId: 'acc-1', rawPayload: {} },
    }

    const envB: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-ok',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: { type: 'unknown', provider: 'meta', accountId: 'acc-1', rawPayload: {} },
    }

    const messages: Array<QueueMessage<unknown>> = [
      { msg_id: 10, read_ct: 1, enqueued_at: '2026-08-18T00:00:00.000Z', vt: '2026-08-18T00:02:00.000Z', message: envA },
      { msg_id: 20, read_ct: 1, enqueued_at: '2026-08-18T00:00:00.000Z', vt: '2026-08-18T00:02:00.000Z', message: envB },
    ]

    const archivedIds: number[] = []
    const mockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(),
      readWhatsAppInbound: vi.fn(async () => messages),
      archiveWhatsAppInbound: vi.fn(async (id) => {
        archivedIds.push(id)
        return true
      }),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await processWhatsAppInboundBatch({ queue: mockQueue, db: fakeDb as any })
    expect(stats.read).toBe(2)
    expect(stats.succeeded).toBe(1)
    expect(stats.failed).toBe(1)
    expect(archivedIds).toEqual([20]) // Only Job B was archived
    expect(callCount).toBe(2)
  })

  it('retries attempts 1 and 2 without archiving, executes attempt 3 and routes to DLQ upon 3rd failure', async () => {
    const handleSpy = vi.spyOn(handlerModule, 'handleWhatsAppInboundJob').mockRejectedValue(
      new Error('Third-party API downtime')
    )

    const envelope: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-retry-max',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: { type: 'unknown', provider: 'meta', accountId: 'acc-1', rawPayload: {} },
    }

    const dlqCalls: unknown[] = []
    const archivedIds: number[] = []
    const mockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(),
      readWhatsAppInbound: vi.fn(),
      archiveWhatsAppInbound: vi.fn(async (id) => {
        archivedIds.push(id)
        return true
      }),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(async (msgId, env, err) => {
        dlqCalls.push({ msgId, env, err })
        return true
      }),
    }

    // 1. Attempt 1 failure: not archived, not DLQ'd
    mockQueue.readWhatsAppInbound = vi.fn(async () => [
      { msg_id: 1, read_ct: 1, enqueued_at: '2026-08-18T00:00:00.000Z', vt: '2026-08-18T00:02:00.000Z', message: envelope },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats1 = await processWhatsAppInboundBatch({ queue: mockQueue, db: fakeDb as any })
    expect(stats1.failed).toBe(1)
    expect(archivedIds).toHaveLength(0)
    expect(dlqCalls).toHaveLength(0)

    // 2. Attempt 2 failure: not archived, not DLQ'd
    mockQueue.readWhatsAppInbound = vi.fn(async () => [
      { msg_id: 1, read_ct: 2, enqueued_at: '2026-08-18T00:00:00.000Z', vt: '2026-08-18T00:02:00.000Z', message: envelope },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats2 = await processWhatsAppInboundBatch({ queue: mockQueue, db: fakeDb as any })
    expect(stats2.failed).toBe(1)
    expect(archivedIds).toHaveLength(0)
    expect(dlqCalls).toHaveLength(0)

    // 3. Attempt 3 failure: handler is STILL executed, then moved to DLQ
    mockQueue.readWhatsAppInbound = vi.fn(async () => [
      { msg_id: 1, read_ct: 3, enqueued_at: '2026-08-18T00:00:00.000Z', vt: '2026-08-18T00:02:00.000Z', message: envelope },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats3 = await processWhatsAppInboundBatch({ queue: mockQueue, db: fakeDb as any })
    expect(stats3.deadLettered).toBe(1)
    expect(dlqCalls).toHaveLength(1)
    expect(handleSpy).toHaveBeenCalledTimes(3) // 3 real handler executions
  })

  it('TESTE 24 (CRUCIAL): Webhook enqueues → Crash during run 1 → Job remains in queue → Next run succeeds → Zero duplication', async () => {
    let attempts = 0
    vi.spyOn(handlerModule, 'handleWhatsAppInboundJob').mockImplementation(async () => {
      attempts++
      if (attempts === 1) {
        throw new Error('Fatal worker crash / process killed')
      }
      return { success: true }
    })

    const durableQueueStorage: Array<QueueMessage<unknown>> = [
      {
        msg_id: 999,
        read_ct: 1,
        enqueued_at: '2026-08-18T00:00:00.000Z',
        vt: '2026-08-18T00:02:00.000Z',
        message: {
          version: 1,
          jobId: 'job-crash-recovery',
          type: 'whatsapp.inbound',
          accountId: 'acc-1',
          createdAt: '2026-08-18T00:00:00.000Z',
          payload: {
            type: 'message',
            provider: 'meta',
            accountId: 'acc-1',
            externalMessageId: 'wamid.CRASH_TEST',
            fromPhone: '5511999999999',
            senderName: 'Client',
            timestamp: 1700000000,
            fromMe: false,
            content: { type: 'text', text: 'Crash recovery test' },
          },
        },
      },
    ]

    const archivedMsgIds: number[] = []
    const durableMockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(),
      readWhatsAppInbound: vi.fn(async () => {
        // Return whatever is not yet archived
        return durableQueueStorage.filter((m) => !archivedMsgIds.includes(m.msg_id))
      }),
      archiveWhatsAppInbound: vi.fn(async (id) => {
        archivedMsgIds.push(id)
        return true
      }),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    // Run 1: Crashes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run1 = await processWhatsAppInboundBatch({ queue: durableMockQueue, db: fakeDb as any })
    expect(run1.failed).toBe(1)
    expect(archivedMsgIds).toHaveLength(0) // Still in queue

    // Simulate visibility timeout expiration & Run 2: Next worker reads it (read_ct becomes 2)
    durableQueueStorage[0].read_ct = 2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run2 = await processWhatsAppInboundBatch({ queue: durableMockQueue, db: fakeDb as any })
    expect(run2.succeeded).toBe(1)
    expect(archivedMsgIds).toEqual([999]) // Archived now

    // Total executions: exactly 2 attempts, zero lost jobs
    expect(attempts).toBe(2)
  })
})
