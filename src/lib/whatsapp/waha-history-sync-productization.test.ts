/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processNormalizedInboundEvent } from '@/lib/whatsapp/inbound/processor'
import type { NormalizedInboundMessageEvent } from '@/lib/whatsapp/inbound/types'
import {
  getContactDisplayName,
  getContactInitials,
} from '@/lib/contacts/display'
import { formatPhoneNumber } from '@/lib/whatsapp/phone-utils'
import { formatMessageForCopilot } from '@/lib/copilot/service'

// Mock dependencies for inbound processor
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(),
  findExistingContactByLid: vi.fn(),
  isUniqueViolation: vi.fn(() => false),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(),
}))

import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { findExistingContact } from '@/lib/contacts/dedupe'

function createMockSupabase(overrides: {
  existingConversation?: any
  existingMessage?: any
  onUpdateConversation?: (payload: any) => void
  onInsertMessage?: (payload: any) => void
} = {}) {
  const convData = overrides.existingConversation ?? {
    id: 'conv-xyz',
    unread_count: 3,
    last_message_at: '2026-08-20T10:00:00.000Z',
    status: 'closed',
  }

  const pObj: any = {
    select: () => pObj,
    eq: () => pObj,
    order: () => pObj,
    limit: () => pObj,
    maybeSingle: async () => ({ data: { user_id: 'user-123' }, error: null }),
  }

  const cObj: any = {
    select: () => cObj,
    eq: () => cObj,
    order: () => cObj,
    limit: () => cObj,
    maybeSingle: async () => ({ data: convData, error: null }),
    single: async () => ({ data: convData, error: null }),
    insert: (payload: any) => ({
      select: () => ({
        single: async () => ({ data: { ...convData, ...payload }, error: null }),
        maybeSingle: async () => ({ data: { ...convData, ...payload }, error: null }),
      }),
    }),
    update: (payload: any) => {
      overrides.onUpdateConversation?.(payload)
      return {
        eq: () => Promise.resolve({ data: null, error: null }),
      }
    },
  }

  const mObj: any = {
    select: () => mObj,
    eq: () => mObj,
    order: () => mObj,
    limit: () => Promise.resolve({ data: [{ id: 'prior-msg-1' }] }),
    maybeSingle: async () => ({ data: overrides.existingMessage ?? null, error: null }),
    insert: (payload: any) => {
      overrides.onInsertMessage?.(payload)
      return {
        select: () => ({
          single: async () => ({
            data: { id: 'msg-historical-1', ...payload },
            error: null,
          }),
        }),
      }
    },
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'profiles') return pObj
      if (table === 'contacts') {
        return {
          insert: (payload: any) => ({
            select: () => ({
              single: async () => ({
                data: { id: 'contact-abc', ...payload },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'conversations') return cObj
      if (table === 'messages') return mObj
      return {}
    }),
  }
}

describe('CICLOPES INBOX 3.0 — WhatsApp History Sync & Productization Sprint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Side-Effect Immunity Policy (Zero Auto-Send, Zero Automations, Zero Unread Increment)', () => {
    it('suppresses automations, AI auto-replies, and unread increments when isHistoryImport is true', async () => {
      const insertedMessages: any[] = []
      const updatedConversations: any[] = []

      const mockDb = createMockSupabase({
        onInsertMessage: (p) => insertedMessages.push(p),
        onUpdateConversation: (p) => updatedConversations.push(p),
      })

      vi.mocked(findExistingContact).mockResolvedValue(null)

      const historicalTimestamp = 1755780000 // historical date
      const historicalIso = new Date(historicalTimestamp * 1000).toISOString()

      const event: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId: 'acc-test-1',
        fromPhone: '5511999998888',
        senderName: 'Carlos Cliente',
        externalMessageId: 'wamid-historical-999',
        externalChatId: '5511999998888@c.us',
        timestamp: historicalTimestamp,
        fromMe: false,
        content: {
          type: 'text',
          text: 'Mensagem histórica recebida há 10 dias',
        },
      }

      const result = await processNormalizedInboundEvent({
        event,
        db: mockDb as any,
        isHistoryImport: true,
        avatarUrl: 'https://cdn.whatsapp.net/profile-123.jpg',
      })

      expect(result.processed).toBe(true)
      expect(result.duplicate).toBeUndefined()

      // 1. Zero automations triggered
      expect(runAutomationsForTrigger).not.toHaveBeenCalled()

      // 2. Zero AI auto-replies dispatched
      expect(dispatchInboundToAiReply).not.toHaveBeenCalled()

      // 3. Unread count preserved (NOT incremented)
      expect(updatedConversations.length).toBeGreaterThan(0)
      const lastConvUpdate = updatedConversations[updatedConversations.length - 1]
      expect(lastConvUpdate.unread_count).toBe(3) // Stayed 3, not 4!

      // 4. Closed conversation status NOT forcefully reopened by old history
      expect(lastConvUpdate.status).toBe('closed')

      // 5. Message timestamps set to historical timestamp
      expect(insertedMessages.length).toBe(1)
      expect(insertedMessages[0].created_at).toBe(historicalIso)
      expect(insertedMessages[0].occurred_at).toBe(historicalIso)
    })
  })

  describe('2. Contact Display Name & Identity Precedence (5-Tier Resolution)', () => {
    it('strictly follows 1) Custom CRM Name > 2) Formatted Phone > 3) WhatsApp LID > 4) Fallback', () => {
      // 1. Explicit CRM Name
      expect(
        getContactDisplayName({
          name: 'Renato Silva',
          phone: '5511987654321',
        })
      ).toBe('Renato Silva')

      // 2. Generic placeholder names are bypassed in favor of formatted phone
      expect(
        getContactDisplayName({
          name: 'Agent',
          phone: '5511987654321',
        })
      ).toBe('+55 (11) 98765-4321')

      expect(
        getContactDisplayName({
          name: 'WhatsApp Contact',
          phone: '5511987654321',
        })
      ).toBe('+55 (11) 98765-4321')

      expect(
        getContactDisplayName({
          name: 'Contato sem nome',
          phone: '5521999887766',
        })
      ).toBe('+55 (21) 99988-7766')

      // 3. WhatsApp LID Identity fallback
      expect(
        getContactDisplayName({
          whatsapp_lid: '25190000009361@lid',
        })
      ).toBe('Contato WhatsApp')

      // 4. Fallback
      expect(getContactDisplayName(null)).toBe('Contato sem nome')
      expect(getContactDisplayName({})).toBe('Contato sem nome')
    })

    it('formats phone numbers cleanly for Brazilian standard and E.164', () => {
      expect(formatPhoneNumber('5511987654321')).toBe('+55 (11) 98765-4321')
      expect(formatPhoneNumber('551133334444')).toBe('+55 (11) 3333-4444')
      expect(formatPhoneNumber('11987654321')).toBe('(11) 98765-4321')
      expect(formatPhoneNumber('+14155552671')).toBe('+14155552671')
    })

    it('generates 1-2 letter uppercase initials for avatar fallbacks', () => {
      expect(getContactInitials('Carlos Eduardo')).toBe('CE')
      expect(getContactInitials('Carlos')).toBe('CA')
      expect(getContactInitials('+55 (11) 98765-4321')).toBe('21')
      expect(getContactInitials('')).toBe('C')
      expect(getContactInitials(null)).toBe('C')
    })
  })

  describe('3. Idempotency & Deduplication Engine', () => {
    it('returns duplicate: true and prevents duplicate insert on duplicate externalMessageId', async () => {
      const mockDb = createMockSupabase({
        existingMessage: { id: 'existing-msg-id', conversation_id: 'conv-xyz' },
      })

      vi.mocked(findExistingContact).mockResolvedValue({ id: 'contact-abc' } as any)

      const event: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId: 'acc-1',
        fromPhone: '5511999998888',
        senderName: 'João',
        externalMessageId: 'duplicate-wamid-123',
        externalChatId: '5511999998888@c.us',
        timestamp: 1755780000,
        fromMe: false,
        content: { type: 'text', text: 'Hello again' },
      }

      const result = await processNormalizedInboundEvent({
        event,
        db: mockDb as any,
        isHistoryImport: true,
      })

      expect(result.processed).toBe(true)
      expect(result.duplicate).toBe(true)
      expect(result.messageId).toBe('existing-msg-id')
    })
  })

  describe('4. Synthetic Acceptance Fixture: Chronological History Grounding for Copilot', () => {
    it('formats a multi-day conversation with strict chronological ordering for Copilot grounding', () => {
      // Historical messages across multiple days
      const rawMessages = [
        {
          id: 'msg-1',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Tenho limite de R$ 10.000 no cartão de crédito.',
          created_at: '2026-08-20T14:30:00.000Z', // Day -10
        },
        {
          id: 'msg-2',
          sender_type: 'agent',
          content_type: 'text',
          content_text: 'Perfeito! Temos excelentes opções nessa faixa.',
          created_at: '2026-08-20T14:35:00.000Z',
        },
        {
          id: 'msg-3',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Prefiro moto preta, estilo esportivo.',
          created_at: '2026-08-22T09:15:00.000Z', // Day -8
        },
        {
          id: 'msg-4',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Posso parcelar a entrada em 12x?',
          created_at: '2026-08-27T16:00:00.000Z', // Day -3
        },
        {
          id: 'msg-5',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Bom dia! Gostaria de saber se a preta ainda está disponível.',
          created_at: '2026-08-30T08:00:00.000Z', // Today
        },
      ]

      const formattedTranscript = rawMessages.map(formatMessageForCopilot)

      expect(formattedTranscript).toHaveLength(5)
      expect(formattedTranscript[0]).toContain('CLIENTE: "Tenho limite de R$ 10.000 no cartão de crédito."')
      expect(formattedTranscript[1]).toContain('VENDEDOR: "Perfeito! Temos excelentes opções nessa faixa."')
      expect(formattedTranscript[2]).toContain('CLIENTE: "Prefiro moto preta, estilo esportivo."')
      expect(formattedTranscript[3]).toContain('CLIENTE: "Posso parcelar a entrada em 12x?"')
      expect(formattedTranscript[4]).toContain('CLIENTE: "Bom dia! Gostaria de saber se a preta ainda está disponível."')

      // Combined transcript contains complete historical customer context for AI reasoning
      const fullContext = formattedTranscript.join('\n')
      expect(fullContext).toContain('R$ 10.000')
      expect(fullContext).toContain('moto preta')
      expect(fullContext).toContain('12x')
    })
  })
})
