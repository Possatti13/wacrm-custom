import { describe, expect, it, vi } from 'vitest'
import { enqueueWhatsAppInboundEvents, enqueueWhatsAppInboundEvent } from './producer'
import type { NormalizedInboundMessageEvent, NormalizedInboundStatusEvent } from '@/lib/whatsapp/inbound/types'
import type { JobQueue } from './queue'

describe('Job Producer (enqueueWhatsAppInboundEvents)', () => {
  it('creates valid JobEnvelope version 1 for Meta event', async () => {
    const metaEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'acc-tenant-1',
      externalMessageId: 'wamid.123',
      fromPhone: '5511999999999',
      senderName: 'User Meta',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Hello via Meta' },
    }

    let enqueuedBatch: unknown[] = []
    const mockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(async (envelopes) => {
        enqueuedBatch = envelopes
        return [101]
      }),
      readWhatsAppInbound: vi.fn(),
      archiveWhatsAppInbound: vi.fn(),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    const result = await enqueueWhatsAppInboundEvent(metaEvent, { queue: mockQueue })
    expect(result.jobId).toBeDefined()
    expect(result.messageId).toBe(101)
    expect(enqueuedBatch).toHaveLength(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = enqueuedBatch[0] as any
    expect(env.version).toBe(1)
    expect(env.type).toBe('whatsapp.inbound')
    expect(env.accountId).toBe('acc-tenant-1')
    expect(env.createdAt).toBeDefined()
    expect(env.payload).toEqual(metaEvent)
  })

  it('creates valid JobEnvelope for WAHA event', async () => {
    const wahaEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId: 'acc-tenant-2',
      externalMessageId: 'false_5511999999999@c.us_ABC',
      fromPhone: '5511999999999',
      senderName: 'User WAHA',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Hello via WAHA' },
    }

    const mockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(async () => [202]),
      readWhatsAppInbound: vi.fn(),
      archiveWhatsAppInbound: vi.fn(),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    const result = await enqueueWhatsAppInboundEvent(wahaEvent, { queue: mockQueue })
    expect(result.messageId).toBe(202)
  })

  it('strictly enforces accountId and rejects empty accountId', async () => {
    const invalidEvent = {
      type: 'message',
      provider: 'meta',
      accountId: '',
      fromPhone: '5511999999999',
      senderName: 'Test',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Bad' },
    } as unknown as NormalizedInboundMessageEvent

    const mockQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(),
      readWhatsAppInbound: vi.fn(),
      archiveWhatsAppInbound: vi.fn(),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    await expect(
      enqueueWhatsAppInboundEvent(invalidEvent, { queue: mockQueue })
    ).rejects.toThrow(/accountId/)
  })

  it('enqueues batch of 3 events atomically and propagates error if queue fails (no partial ack)', async () => {
    const events: NormalizedInboundStatusEvent[] = [
      { type: 'status', provider: 'meta', accountId: 'acc-1', externalMessageId: 'm1', status: 'sent', timestamp: 1700000001 },
      { type: 'status', provider: 'meta', accountId: 'acc-1', externalMessageId: 'm2', status: 'delivered', timestamp: 1700000002 },
      { type: 'status', provider: 'meta', accountId: 'acc-1', externalMessageId: 'm3', status: 'read', timestamp: 1700000003 },
    ]

    // 1. Success batch
    const mockSuccessQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(async (envelopes: unknown[]) => envelopes.map((_: unknown, i: number) => i + 1)),
      readWhatsAppInbound: vi.fn(),
      archiveWhatsAppInbound: vi.fn(),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    const res = await enqueueWhatsAppInboundEvents(events, { queue: mockSuccessQueue })
    expect(res.jobIds).toHaveLength(3)
    expect(res.messageIds).toEqual([1, 2, 3])

    // 2. Failure batch (atomic failure)
    const mockFailingQueue: JobQueue = {
      enqueueWhatsAppInboundBatch: vi.fn(async () => {
        throw new Error('Database connection timeout')
      }),
      readWhatsAppInbound: vi.fn(),
      archiveWhatsAppInbound: vi.fn(),
      setWhatsAppInboundVisibility: vi.fn(),
      deadLetterWhatsAppInbound: vi.fn(),
    }

    await expect(
      enqueueWhatsAppInboundEvents(events, { queue: mockFailingQueue })
    ).rejects.toThrow('Database connection timeout')
  })
})
