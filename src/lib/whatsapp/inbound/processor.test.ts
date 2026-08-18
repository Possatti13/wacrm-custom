import { describe, expect, it, vi, beforeEach } from 'vitest'
import { processNormalizedInboundEvent } from './processor'
import type { NormalizedInboundMessageEvent } from './types'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

const messageInserts: Array<Record<string, unknown>> = []
const conversationUpdates: Array<Record<string, unknown>> = []

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))

interface Filter {
  field: string
  value?: unknown
  matchFn?: (v: unknown) => boolean
}

function createMemoryDb() {
  const store = {
    contacts: [] as Array<Record<string, unknown>>,
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    profiles: [
      { user_id: 'default-user-1', account_id: 'account-1' },
      { user_id: 'default-user-alpha', account_id: 'tenant-alpha' },
      { user_id: 'default-user-beta', account_id: 'tenant-beta' },
    ] as Array<Record<string, unknown>>,
  }

  const db = {
    from: (table: keyof typeof store) => {
      const filters: Filter[] = []

      const checkMatch = (row: Record<string, unknown>) => {
        return filters.every((f) => {
          if (f.matchFn) return f.matchFn(row[f.field])
          return row[f.field] === f.value
        })
      }

      const b: Record<string, unknown> = {
        select: vi.fn(() => b),
        eq: vi.fn((field: string, value: unknown) => {
          filters.push({ field, value })
          return b
        }),
        like: vi.fn((field: string, pattern: string) => {
          const clean = pattern.replace(/%/g, '')
          filters.push({
            field,
            matchFn: (val: unknown) => String(val || '').includes(clean),
          })
          return b
        }),
        order: vi.fn(() => b),
        limit: vi.fn(() => b),
        not: vi.fn(() => b),

        maybeSingle: vi.fn(async () => {
          const rows = (store[table] || []).filter(checkMatch)
          return { data: rows[0] ?? null, error: null }
        }),

        single: vi.fn(async () => {
          const rows = (store[table] || []).filter(checkMatch)
          return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'Not found' } }
        }),

        insert: vi.fn((payload: Record<string, unknown>) => {
          const row = { id: `${table}-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...payload }
          if (table === 'messages') {
            // Composite unique index: (conversation_id, source_provider, message_id)
            const exists = store.messages.some(
              (m) =>
                m.conversation_id === payload.conversation_id &&
                m.source_provider === payload.source_provider &&
                m.message_id === payload.message_id &&
                payload.message_id != null &&
                payload.source_provider != null
            )
            if (exists) {
              return {
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint "uq_messages_conversation_provider_message_id"',
                    },
                  }),
                }),
              }
            }
            messageInserts.push(row)
          }
          store[table].push(row)
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          }
        }),

        update: vi.fn((payload: Record<string, unknown>) => {
          if (table === 'conversations') conversationUpdates.push(payload)
          for (const row of store[table] || []) {
            if (checkMatch(row)) {
              Object.assign(row, payload)
            }
          }
          return b
        }),

        then: (resolve: (v: unknown) => unknown) => {
          const rows = (store[table] || []).filter(checkMatch)
          return resolve({ data: rows, error: null })
        },
      }

      return b
    },
  }

  return { db, store }
}

describe('InboundProcessor Idempotency & Provenance Scoping', () => {
  beforeEach(() => {
    messageInserts.length = 0
    conversationUpdates.length = 0
    vi.clearAllMocks()
  })

  it('1. mesmo provider + mesma conversation + mesmo message ID → detectado como duplicado', async () => {
    const { db, store } = createMemoryDb()
    const event: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'wamid-shared-123',
      fromPhone: '5511999999999',
      senderName: 'Cliente Alpha',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Primeira entrega' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstRes = await processNormalizedInboundEvent({ event, db: db as any })
    expect(firstRes.processed).toBe(true)
    expect(firstRes.duplicate).toBeUndefined()
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].source_provider).toBe('meta')
    expect(store.messages[0].message_id).toBe('wamid-shared-123')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondRes = await processNormalizedInboundEvent({ event, db: db as any })
    expect(secondRes.processed).toBe(true)
    expect(secondRes.duplicate).toBe(true)
    expect(secondRes.messageId).toBe(firstRes.messageId)
    // No second row inserted
    expect(store.messages).toHaveLength(1)
  })

  it('2. providers diferentes + mesma conversation + mesmo message ID → permitido', async () => {
    const { db, store } = createMemoryDb()
    const contactId = 'contact-c1'
    const conversationId = 'conv-c1'

    // Pre-populate single conversation
    store.contacts.push({ id: contactId, account_id: 'account-1', phone: '+5511999999999' })
    store.conversations.push({ id: conversationId, account_id: 'account-1', contact_id: contactId, unread_count: 0 })

    const metaEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'msg-common-id',
      fromPhone: '5511999999999',
      senderName: 'Cliente Alpha',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Msg via Meta' },
    }

    const wahaEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId: 'account-1',
      externalMessageId: 'msg-common-id',
      fromPhone: '5511999999999',
      senderName: 'Cliente Alpha',
      timestamp: 1700000001,
      fromMe: false,
      content: { type: 'text', text: 'Msg via WAHA com mesmo id' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resMeta = await processNormalizedInboundEvent({ event: metaEvent, db: db as any })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resWaha = await processNormalizedInboundEvent({ event: wahaEvent, db: db as any })

    expect(resMeta.processed).toBe(true)
    expect(resMeta.duplicate).toBeUndefined()

    expect(resWaha.processed).toBe(true)
    expect(resWaha.duplicate).toBeUndefined()

    expect(store.messages).toHaveLength(2)
    expect(store.messages[0].source_provider).toBe('meta')
    expect(store.messages[1].source_provider).toBe('waha')
  })

  it('3. conversations diferentes + mesmo message ID → permitido', async () => {
    const { db, store } = createMemoryDb()

    const eventUserA: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'wamid-collide-1',
      fromPhone: '5511111111111',
      senderName: 'Cliente 1',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Msg de 1' },
    }

    const eventUserB: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'wamid-collide-1',
      fromPhone: '5511222222222',
      senderName: 'Cliente 2',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Msg de 2' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resA = await processNormalizedInboundEvent({ event: eventUserA, db: db as any })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resB = await processNormalizedInboundEvent({ event: eventUserB, db: db as any })

    expect(resA.processed).toBe(true)
    expect(resA.duplicate).toBeUndefined()
    expect(resB.processed).toBe(true)
    expect(resB.duplicate).toBeUndefined()
    expect(store.messages).toHaveLength(2)
  })

  it('4. tenants diferentes + mesmo message ID → permitido', async () => {
    const { db, store } = createMemoryDb()

    const eventTenant1: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId: 'tenant-alpha',
      externalMessageId: 'false_5511999999999@c.us_SAME',
      fromPhone: '5511999999999',
      senderName: 'Cliente T1',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Para Tenant 1' },
    }

    const eventTenant2: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId: 'tenant-beta',
      externalMessageId: 'false_5511999999999@c.us_SAME',
      fromPhone: '5511999999999',
      senderName: 'Cliente T2',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Para Tenant 2' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res1 = await processNormalizedInboundEvent({ event: eventTenant1, db: db as any })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res2 = await processNormalizedInboundEvent({ event: eventTenant2, db: db as any })

    expect(res1.processed).toBe(true)
    expect(res1.duplicate).toBeUndefined()
    expect(res2.processed).toBe(true)
    expect(res2.duplicate).toBeUndefined()
    expect(store.messages).toHaveLength(2)
  })

  it('5. corrida simultânea do mesmo evento → apenas uma persistência e sem efeitos colaterais duplicados', async () => {
    const { db, store } = createMemoryDb()

    const contactId = 'contact-race-1'
    const conversationId = 'conv-race-1'
    store.contacts.push({ id: contactId, account_id: 'account-1', phone: '+5511999999999' })
    store.conversations.push({ id: conversationId, account_id: 'account-1', contact_id: contactId, unread_count: 0 })

    const event: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'wamid-concurrent-race-999',
      fromPhone: '5511999999999',
      senderName: 'Cliente Race',
      timestamp: 1700000000,
      fromMe: false,
      content: { type: 'text', text: 'Mensagem Concorrente' },
    }

    // First arrival inserts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res1 = await processNormalizedInboundEvent({ event, db: db as any })
    // Simultaneous second arrival runs pre-check or insert collision
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res2 = await processNormalizedInboundEvent({ event, db: db as any })

    expect(res1.processed).toBe(true)
    expect(res2.processed).toBe(true)

    // Exactly one regular and one duplicate
    expect(res1.duplicate).toBeUndefined()
    expect(res2.duplicate).toBe(true)
    expect(res2.messageId).toBe(res1.messageId)

    // Exactly 1 message persisted in DB
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].source_provider).toBe('meta')

    // Exactly 1 automation trigger & AI reply dispatch
    expect(runAutomationsForTrigger).toHaveBeenCalledTimes(2) // 1 new_message_received, 1 first_inbound_message
    expect(dispatchInboundToAiReply).toHaveBeenCalledTimes(1)
  })

  it('6. mensagem antiga processada após mensagem nova não regride last_message_at nem last_message_text', async () => {
    const { db, store } = createMemoryDb()
    const contactId = 'contact-ooo-1'
    const conversationId = 'conv-ooo-1'

    store.contacts.push({ id: contactId, account_id: 'account-1', phone: '+5511999999999' })
    store.conversations.push({
      id: conversationId,
      account_id: 'account-1',
      contact_id: contactId,
      unread_count: 0,
      last_message_at: null,
      last_message_text: null,
    })

    // 1. Process recent message (timestamp = 2000)
    const recentEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'wamid.RECENT_2000',
      fromPhone: '5511999999999',
      senderName: 'Cliente OOO',
      timestamp: 2000,
      fromMe: false,
      content: { type: 'text', text: 'Mensagem Mais Recente' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processNormalizedInboundEvent({ event: recentEvent, db: db as any })

    const recentIso = new Date(2000 * 1000).toISOString()
    expect(store.conversations[0].last_message_at).toBe(recentIso)
    expect(store.conversations[0].last_message_text).toBe('Mensagem Mais Recente')
    expect(store.conversations[0].unread_count).toBe(1)

    // 2. Process delayed older message (timestamp = 1000)
    const olderEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'meta',
      accountId: 'account-1',
      externalMessageId: 'wamid.OLDER_1000',
      fromPhone: '5511999999999',
      senderName: 'Cliente OOO',
      timestamp: 1000,
      fromMe: false,
      content: { type: 'text', text: 'Mensagem Mais Antiga Atrasada' },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processNormalizedInboundEvent({ event: olderEvent, db: db as any })

    // unread_count is incremented to 2, but last_message_at and last_message_text remain monotonic!
    expect(store.conversations[0].unread_count).toBe(2)
    expect(store.conversations[0].last_message_at).toBe(recentIso)
    expect(store.conversations[0].last_message_text).toBe('Mensagem Mais Recente')
    expect(store.messages).toHaveLength(2)
  })
})
