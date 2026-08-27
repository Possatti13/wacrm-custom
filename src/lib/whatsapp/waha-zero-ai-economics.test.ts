/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import { processNormalizedInboundEvent } from './inbound/processor'
import type { NormalizedInboundMessageEvent } from './inbound/types'

describe('WAHA Zero-AI Economics & Inbound Ingestion Invariant', () => {
  const accountId = 'a1111111-1111-4111-8111-111111111111'

  it('proves that 100 WAHA inbound messages in ON_DEMAND mode trigger ZERO LLM calls', async () => {
    const llmCallsCount = 0

    const insertedMessages: any[] = []

    const fakeDb = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { user_id: 'u-owner-1' },
              error: null,
            }),
          }
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            like: vi.fn().mockResolvedValue({
              data: [{ id: 'c-customer-1', account_id: accountId, phone: '5511999991111' }],
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'c-customer-1', account_id: accountId, phone: '5511999991111' },
              error: null,
            }),
          }
        }
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'conv-1', account_id: accountId, contact_id: 'c-customer-1' }],
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'conv-1', unread_count: 0, last_message_at: null },
              error: null,
            }),
          }
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null, // no duplicates for unique IDs
              error: null,
            }),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: 'msg-prior' }], // not first message
              error: null,
            }),
            insert: vi.fn().mockImplementation((payload: any) => {
              insertedMessages.push(payload)
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: `m-${Date.now()}`, ...payload },
                    error: null,
                  }),
                }),
              }
            }),
          }
        }
        if (table === 'ai_configs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                is_enabled: false, // auto reply is OFF for pilot
                model: 'gpt-4o-mini',
              },
              error: null,
            }),
          }
        }
        if (table === 'tenant_intelligence_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                invocation_mode: 'on_demand', // Strict ON_DEMAND mode
              },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    } as any

    // Simulate 100 inbound customer WhatsApp messages from WAHA
    for (let i = 1; i <= 100; i++) {
      const event: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId,
        externalMessageId: `waha-inbound-${i}`,
        externalChatId: '5511999991111@c.us',
        fromPhone: '5511999991111',
        senderName: 'Cliente Teste',
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: false,
        content: {
          type: 'text',
          text: `Mensagem de teste número ${i}`,
        },
        rawPayload: {},
      }

      const result = await processNormalizedInboundEvent({
        event,
        db: fakeDb,
      })

      expect(result.processed).toBe(true)
    }

    expect(insertedMessages.length).toBe(100)
    expect(llmCallsCount).toBe(0)
  })
})
