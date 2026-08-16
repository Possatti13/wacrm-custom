import { describe, expect, it, vi, beforeEach } from 'vitest'
import { processNormalizedInboundEvent } from './processor'
import type { NormalizedInboundMessageEvent } from './types'

const messageInserts: Array<Record<string, unknown>> = []
const conversationUpdates: Array<Record<string, unknown>> = []

const mockDb = {
  from: (table: string) => {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'like', 'order', 'limit', 'not']) {
      b[m] = vi.fn(chain)
    }

    b.maybeSingle = vi.fn(async () => {
      if (table === 'messages') {
        return { data: null, error: null }
      }
      if (table === 'profiles') {
        return { data: { user_id: 'user-owner-1' }, error: null }
      }
      return { data: null, error: null }
    })

    b.single = vi.fn(async () => {
      if (table === 'contacts') {
        return { data: { id: 'contact-test-1', phone: '+5511999999999' }, error: null }
      }
      if (table === 'conversations') {
        return { data: { id: 'conv-test-1', unread_count: 0 }, error: null }
      }
      if (table === 'messages') {
        return { data: { id: 'msg-test-1' }, error: null }
      }
      return { data: null, error: null }
    })

    b.insert = vi.fn((payload: Record<string, unknown>) => {
      if (table === 'messages') messageInserts.push(payload)
      return b
    })

    b.update = vi.fn((payload: Record<string, unknown>) => {
      if (table === 'conversations') conversationUpdates.push(payload)
      return b
    })

    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return b
  },
}

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))

describe('processNormalizedInboundEvent', () => {
  beforeEach(() => {
    messageInserts.length = 0
    conversationUpdates.length = 0
    vi.clearAllMocks()
  })

  it('processes inbound message, creates conversation and persists message', async () => {
    const event: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-alpha',
      externalMessageId: 'wamid-unique-123',
      fromPhone: '5511999999999',
      senderName: 'Cliente Teste',
      timestamp: 1700000000,
      fromMe: false,
      content: {
        type: 'text',
        text: 'Olá CRM',
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await processNormalizedInboundEvent({ event, db: mockDb as any })
    expect(result.processed).toBe(true)
    expect(result.duplicate).toBeUndefined()
    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'conv-test-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Olá CRM',
      message_id: 'wamid-unique-123',
    })
    expect(conversationUpdates).toHaveLength(1)
  })

  it('enforces strict tenant isolation and prevents cross-tenant contamination', async () => {
    const eventA: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId: 'account-A',
      externalMessageId: 'waha-msg-A',
      fromPhone: '5511999999999',
      senderName: 'Cliente A',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Msg para A' },
    }

    const eventB: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId: 'account-B',
      externalMessageId: 'waha-msg-B',
      fromPhone: '5511888888888',
      senderName: 'Cliente B',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Msg para B' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resA = await processNormalizedInboundEvent({ event: eventA, db: mockDb as any })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resB = await processNormalizedInboundEvent({ event: eventB, db: mockDb as any })

    expect(resA.processed).toBe(true)
    expect(resB.processed).toBe(true)
  })

  it('ignores duplicate messages with the same externalMessageId (Idempotency pre-check)', async () => {
    const dedupeMockDb = {
      from: (table: string) => {
        const b: Record<string, unknown> = {}
        const chain = () => b
        for (const m of ['select', 'eq', 'like', 'order', 'limit', 'not']) {
          b[m] = vi.fn(chain)
        }
        b.maybeSingle = vi.fn(async () => {
          if (table === 'messages') {
            return { data: { id: 'existing-msg-id', conversation_id: 'conv-1' }, error: null }
          }
          return { data: null, error: null }
        })
        b.insert = vi.fn(() => b)
        b.update = vi.fn(() => b)
        b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
        return b
      },
    }

    const event: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-alpha',
      externalMessageId: 'wamid-already-processed',
      fromPhone: '5511999999999',
      senderName: 'Cliente Repetido',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Mensagem repetida' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await processNormalizedInboundEvent({ event, db: dedupeMockDb as any })
    expect(res.processed).toBe(true)
    expect(res.duplicate).toBe(true)
    expect(res.messageId).toBe('existing-msg-id')
  })

  it('handles concurrent race condition via DB unique constraint violation (Atomic Concurrency)', async () => {
    let insertAttempt = 0
    const racingMockDb = {
      from: (table: string) => {
        const b: Record<string, unknown> = {}
        const chain = () => b
        for (const m of ['select', 'eq', 'like', 'order', 'limit', 'not']) {
          b[m] = vi.fn(chain)
        }

        b.maybeSingle = vi.fn(async () => {
          if (table === 'messages') {
            // Initial pre-check returns null (simulating both workers passing pre-check simultaneously)
            if (insertAttempt === 0) return { data: null, error: null }
            // Post-violation lookup returns the row committed by the racing worker
            return { data: { id: 'raced-message-uuid', conversation_id: 'conv-race-1' }, error: null }
          }
          if (table === 'profiles') return { data: { user_id: 'user-1' }, error: null }
          return { data: null, error: null }
        })

        b.single = vi.fn(async () => {
          if (table === 'contacts') return { data: { id: 'contact-race-1', phone: '+5511999999999' }, error: null }
          if (table === 'conversations') return { data: { id: 'conv-race-1', unread_count: 0 }, error: null }
          if (table === 'messages') {
            insertAttempt++
            // Simulate Postgres unique violation (SQLSTATE 23505 / uq_messages_conversation_message_id)
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "uq_messages_conversation_message_id"',
              },
            }
          }
          return { data: null, error: null }
        })

        b.insert = vi.fn(() => b)
        b.update = vi.fn(() => b)
        b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
        return b
      },
    }

    const event: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-race',
      externalMessageId: 'wamid-racing-concurrent-123',
      fromPhone: '5511999999999',
      senderName: 'Cliente Concorrente',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Mensagem simultânea' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await processNormalizedInboundEvent({ event, db: racingMockDb as any })
    expect(res.processed).toBe(true)
    expect(res.duplicate).toBe(true)
    expect(res.messageId).toBe('raced-message-uuid')
  })
})
