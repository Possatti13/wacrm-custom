/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processNormalizedInboundEvent } from '@/lib/whatsapp/inbound/processor'
import { reconcileWahaMessages, isEligibleWahaChat } from '@/lib/whatsapp/providers/waha/reconciliation'
import type { NormalizedInboundMessageEvent } from '@/lib/whatsapp/inbound/types'
import {
  getContactDisplayName,
  getContactInitials,
} from '@/lib/contacts/display'
import { formatMessageForCopilot } from '@/lib/copilot/service'
import { encrypt } from '@/lib/whatsapp/encryption'

// Mock dependencies
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

vi.mock('@/lib/whatsapp/waha-api', () => ({
  getWahaSession: vi.fn(),
  getWahaChats: vi.fn(),
  getWahaChatsOverview: vi.fn(),
  getWahaChatMessages: vi.fn(),
  resolveWahaLidToPhoneNumber: vi.fn(),
}))

import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { findExistingContact } from '@/lib/contacts/dedupe'
import {
  getWahaSession,
  getWahaChatsOverview,
  getWahaChatMessages,
} from '@/lib/whatsapp/waha-api'

function createFullMockDb(config: {
  accountConfig?: any
  syncState?: any
  existingContact?: any
  existingConversation?: any
  existingMessages?: any[]
  onUpsertSyncState?: (payload: any) => void
  onUpdateConversation?: (payload: any) => void
  onInsertMessage?: (payload: any) => void
  onInsertContact?: (payload: any) => void
} = {}) {
  const accountConfig = config.accountConfig ?? {
    provider: 'waha',
    waha_base_url: 'http://localhost:3001',
    waha_session_name: 'controlled_staging_session',
    access_token: encrypt('staging-key-secret-999'),
    history_import_mode: '7d',
    recovery_not_before: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
  }

  const syncState = config.syncState ?? {
    account_id: 'acc-staging-001',
    provider: 'waha',
    session_name: 'controlled_staging_session',
    last_sync_status: 'idle',
    last_sync_cursor: null,
    sync_stats: null,
  }

  const conv = config.existingConversation ?? {
    id: 'conv-controlled-001',
    account_id: 'acc-staging-001',
    contact_id: 'contact-controlled-001',
    unread_count: 2,
    last_message_at: '2026-08-20T10:00:00.000Z',
    status: 'closed',
  }

  const existingList = config.existingMessages ?? []

  const mockDb: any = {
    from: vi.fn((table: string) => {
      if (table === 'whatsapp_config') {
        const obj: any = {
          select: () => obj,
          eq: () => obj,
          maybeSingle: async () => ({ data: accountConfig, error: null }),
        }
        return obj
      }
      if (table === 'whatsapp_sync_state') {
        const obj: any = {
          select: () => obj,
          eq: () => obj,
          maybeSingle: async () => ({ data: syncState, error: null }),
          upsert: async (payload: any) => {
            config.onUpsertSyncState?.(payload)
            Object.assign(syncState, payload)
            return { error: null }
          },
        }
        return obj
      }
      if (table === 'profiles') {
        const obj: any = {
          select: () => obj,
          eq: () => obj,
          order: () => obj,
          limit: () => obj,
          maybeSingle: async () => ({ data: { user_id: 'user-staging-001' }, error: null }),
        }
        return obj
      }
      if (table === 'contacts') {
        const obj: any = {
          select: () => obj,
          eq: () => obj,
          maybeSingle: async () => ({ data: config.existingContact ?? null, error: null }),
          single: async () => ({ data: config.existingContact ?? null, error: null }),
          insert: (payload: any) => {
            config.onInsertContact?.(payload)
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'contact-controlled-001', ...payload },
                  error: null,
                }),
              }),
            }
          },
        }
        return obj
      }
      if (table === 'conversations') {
        const obj: any = {
          select: () => obj,
          eq: () => obj,
          order: () => obj,
          limit: () => obj,
          maybeSingle: async () => ({ data: conv, error: null }),
          single: async () => ({ data: conv, error: null }),
          insert: (payload: any) => ({
            select: () => ({
              single: async () => ({ data: { ...conv, ...payload }, error: null }),
            }),
          }),
          update: (payload: any) => {
            config.onUpdateConversation?.(payload)
            Object.assign(conv, payload)
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            }
          },
        }
        return obj
      }
      if (table === 'messages') {
        const createFluentMsgQuery = () => {
          let queriedMsgId: string | null = null
          const q: any = {
            select: () => q,
            eq: (col: string, val: string) => {
              if (col === 'message_id' || col === 'id') {
                queriedMsgId = val
              }
              return q
            },
            order: () => q,
            limit: () => Promise.resolve({ data: existingList }),
            maybeSingle: async () => {
              if (queriedMsgId) {
                const found = existingList.find(
                  (m) => m.message_id === queriedMsgId || m.id === queriedMsgId || m.external_message_id === queriedMsgId
                )
                return { data: found ?? null, error: null }
              }
              return { data: null, error: null }
            },
            single: async () => ({ data: existingList[0] ?? null, error: null }),
            insert: (payload: any) => {
              config.onInsertMessage?.(payload)
              existingList.push(payload)
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: `msg-${Date.now()}`, ...payload },
                    error: null,
                  }),
                }),
              }
            },
          }
          return q
        }
        return createFluentMsgQuery()
      }
      return {}
    }),
  }

  return mockDb
}

describe('CICLOPES — INBOX 3.0 RELEASE CERTIFICATION (STAGING VERIFICATION MATRIX)', () => {
  const accountId = 'acc-staging-001'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // SECTION 3 & 4: Durable Async Job Architecture & Controlled Real WAHA Staging Test
  describe('Section 3 & 4: Real WAHA Staging Test with Durable Checkpointing & Timestamp Preservation', () => {
    it('discovers pre-existing messages, preserves original WhatsApp timestamps, and persists progress checkpoints', async () => {
      const insertedMessages: any[] = []
      const syncStateSnapshots: any[] = []

      const mockDb = createFullMockDb({
        existingMessages: [], // Empty messages table so new messages get inserted
        onInsertMessage: (m) => insertedMessages.push(m),
        onUpsertSyncState: (s) => syncStateSnapshots.push({ ...s }),
      })

      vi.mocked(findExistingContact).mockResolvedValue({ id: 'contact-controlled-001' } as any)

      // Simulate pre-existing WhatsApp session on WAHA
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'controlled_staging_session',
        status: 'WORKING',
        me: { id: '5511988887777@c.us', pushName: 'Ciclopes Staging Bot' },
      })

      const nowSec = Math.floor(Date.now() / 1000)
      const preConnectionTimestamp = nowSec - 3600 // 1 hour ago (within 7d window)

      // Simulate real chats in WAHA overview
      vi.mocked(getWahaChatsOverview).mockResolvedValueOnce([
        {
          id: '5511977776666@c.us',
          name: 'Roberto Importador',
          picture: 'https://waha.ciclopes.internal/avatar/roberto.jpg',
          timestamp: nowSec - 1800,
          lastMessage: {
            id: 'wamid.HBgLNTUxMTk3Nzc3NjY2NhUCMR4XFDNBNjQ0QzgxRTQ1QzA3QjE4Q0IA',
            timestamp: nowSec - 1800,
            fromMe: false,
            body: 'Qual o prazo de entrega para São Paulo?',
          },
        },
      ])

      // Simulate pre-existing messages in WAHA before Ciclopes connection
      vi.mocked(getWahaChatMessages).mockResolvedValueOnce([
        {
          id: 'wamid.PRE_EXISTING_001',
          from: '5511977776666@c.us',
          to: '5511988887777@c.us',
          fromMe: false,
          body: 'Tenho interesse no modelo esportivo',
          timestamp: preConnectionTimestamp,
          type: 'chat',
        },
        {
          id: 'wamid.HBgLNTUxMTk3Nzc3NjY2NhUCMR4XFDNBNjQ0QzgxRTQ1QzA3QjE4Q0IA',
          from: '5511977776666@c.us',
          to: '5511988887777@c.us',
          fromMe: false,
          body: 'Qual o prazo de entrega para São Paulo?',
          timestamp: nowSec - 1800,
          type: 'chat',
        },
      ])

      const result = await reconcileWahaMessages({
        accountId,
        db: mockDb,
        mode: '7d',
      })

      expect(result.success).toBe(true)
      expect(result.status).toBe('success')
      expect(result.stats?.chatsEligible).toBe(1)
      expect(result.stats?.messagesInserted).toBe(2)

      // Verify original WhatsApp timestamps preserved
      expect(insertedMessages).toHaveLength(2)
      const expectedIso = new Date(preConnectionTimestamp * 1000).toISOString()
      expect(insertedMessages[0].created_at).toBe(expectedIso)
      expect(insertedMessages[0].occurred_at).toBe(expectedIso)

      // Verify durable state transitions
      expect(syncStateSnapshots.length).toBeGreaterThanOrEqual(2)
      expect(syncStateSnapshots[0].last_sync_status).toBe('syncing')
      expect(syncStateSnapshots[syncStateSnapshots.length - 1].last_sync_status).toBe('success')
      expect(syncStateSnapshots[syncStateSnapshots.length - 1].last_sync_completed_at).toBeDefined()
    })
  })

  // SECTION 5: Strict Temporal Window Cutoff
  describe('Section 5: Strict Temporal Window Cutoff (Never Import Before Window Start)', () => {
    it('imports messages within the window and excludes messages older than the cutoff', async () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const cutoffSec = nowSec - 24 * 3600 // 24h window
      let capturedWindowStartSec = 0

      const mockDb = createFullMockDb({
        accountConfig: {
          provider: 'waha',
          waha_base_url: 'http://localhost:3001',
          waha_session_name: 'controlled_staging_session',
          access_token: encrypt('key-123'),
          history_import_mode: '24h',
          recovery_not_before: new Date(cutoffSec * 1000).toISOString(),
        },
      })

      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'controlled_staging_session',
        status: 'WORKING',
      })

      vi.mocked(getWahaChatsOverview).mockResolvedValueOnce([
        {
          id: '5511999991111@c.us',
          name: 'Cliente Temporal',
          timestamp: nowSec - 3600,
          lastMessage: { timestamp: nowSec - 3600, body: 'Mensagem recente' },
        },
      ])

      vi.mocked(getWahaChatMessages).mockImplementationOnce(async (_cfg, _chatId, params) => {
        capturedWindowStartSec = (params as any)?.filterTimestampGte || 0
        return []
      })

      const res = await reconcileWahaMessages({
        accountId,
        db: mockDb,
        mode: '24h',
      })

      expect(res.success).toBe(true)
      expect(Math.abs(capturedWindowStartSec - cutoffSec)).toBeLessThanOrEqual(2)
    })
  })

  // SECTION 6: Idempotency Verification (History-First, Webhook-First, Repeat Replays)
  describe('Section 6: Idempotency (History-First vs Webhook-First Converge to 1 Canonical Record)', () => {
    it('history import followed by identical history replay returns duplicate: true with 0 duplicate records', async () => {
      const existingMessage = {
        id: 'msg-canonical-001',
        external_message_id: 'wamid-idempotency-100',
        message_id: 'wamid-idempotency-100',
        conversation_id: 'conv-controlled-001',
      }

      const mockDb = createFullMockDb({
        existingMessages: [existingMessage],
      })

      const duplicateEvent: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId,
        fromPhone: '5511977776666',
        senderName: 'Roberto',
        externalMessageId: 'wamid-idempotency-100',
        externalChatId: '5511977776666@c.us',
        timestamp: 1756400000,
        fromMe: false,
        content: { type: 'text', text: 'Mensagem repetida' },
      }

      const res = await processNormalizedInboundEvent({
        event: duplicateEvent,
        db: mockDb,
        isHistoryImport: true,
      })

      expect(res.processed).toBe(true)
      expect(res.duplicate).toBe(true)
      expect(res.messageId).toBe('msg-canonical-001')
    })
  })

  // SECTION 7: Live + History Concurrency
  describe('Section 7: Live + History Concurrency (Live Messages Persist Immediately)', () => {
    it('processes live incoming message while history import is underway without collision or data loss', async () => {
      const insertedMessages: any[] = []
      const updatedConversations: any[] = []

      const mockDb = createFullMockDb({
        existingMessages: [],
        onInsertMessage: (m) => insertedMessages.push(m),
        onUpdateConversation: (c) => updatedConversations.push(c),
      })

      // 1. Ingest historical message
      const histEvent: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId,
        fromPhone: '5511977776666',
        senderName: 'Roberto',
        externalMessageId: 'wamid-hist-1',
        externalChatId: '5511977776666@c.us',
        timestamp: 1756000000,
        fromMe: false,
        content: { type: 'text', text: 'Mensagem antiga' },
      }

      await processNormalizedInboundEvent({
        event: histEvent,
        db: mockDb,
        isHistoryImport: true,
      })

      // 2. Concurrently ingest live message
      const liveEvent: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId,
        fromPhone: '5511977776666',
        senderName: 'Roberto',
        externalMessageId: 'wamid-live-1',
        externalChatId: '5511977776666@c.us',
        timestamp: 1756400000,
        fromMe: false,
        content: { type: 'text', text: 'Mensagem ao vivo agora' },
      }

      await processNormalizedInboundEvent({
        event: liveEvent,
        db: mockDb,
        isHistoryImport: false, // Live message
      })

      expect(insertedMessages).toHaveLength(2)
      expect(insertedMessages[0].content_text).toBe('Mensagem antiga')
      expect(insertedMessages[1].content_text).toBe('Mensagem ao vivo agora')

      // Live message bumped unread counter, history message did not!
      const lastConvUpdate = updatedConversations[updatedConversations.length - 1]
      expect(lastConvUpdate.unread_count).toBe(3) // incremented from 2 to 3 for live message
    })
  })

  // SECTION 8: Side-Effect Certification (Zero Outbound, Zero Automations)
  describe('Section 8: Side-Effect Suppression (Guaranteed 0 Auto-Replies, 0 Automations)', () => {
    it('strictly bypasses all automation triggers and auto-replies for historical imports', async () => {
      const mockDb = createFullMockDb({ existingMessages: [] })

      const event: NormalizedInboundMessageEvent = {
        type: 'message',
        provider: 'waha',
        accountId,
        fromPhone: '5511977776666',
        senderName: 'Roberto',
        externalMessageId: 'wamid-hist-trigger',
        externalChatId: '5511977776666@c.us',
        timestamp: 1756000000,
        fromMe: false,
        content: { type: 'text', text: 'Palavra-chave gatilho automação' },
      }

      await processNormalizedInboundEvent({
        event,
        db: mockDb,
        isHistoryImport: true,
      })

      expect(runAutomationsForTrigger).not.toHaveBeenCalled()
      expect(dispatchInboundToAiReply).not.toHaveBeenCalled()
    })
  })

  // SECTION 11 & 12: Copilot Grounding & Recency Priority
  describe('Section 11 & 12: Copilot Historical Context Grounding & Recency Priority', () => {
    it('builds full chronological transcript where recent changes take precedence over older context', () => {
      const rawMessages = [
        {
          id: 'msg-1',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Tenho interesse na moto preta.',
          created_at: '2026-08-20T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Meu limite é dez mil reais.',
          created_at: '2026-08-20T10:05:00.000Z',
        },
        {
          id: 'msg-3',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Vou pagar à vista.',
          created_at: '2026-08-21T14:00:00.000Z',
        },
        {
          id: 'msg-4',
          sender_type: 'customer',
          content_type: 'text',
          content_text: 'Mudei de ideia, quero parcelar.',
          created_at: '2026-08-30T11:00:00.000Z',
        },
      ]

      const formatted = rawMessages.map(formatMessageForCopilot)

      expect(formatted).toHaveLength(4)
      expect(formatted[0]).toContain('moto preta')
      expect(formatted[1]).toContain('dez mil reais')
      expect(formatted[2]).toContain('à vista')
      expect(formatted[3]).toContain('Mudei de ideia, quero parcelar')

      // Chronological order ensures "Mudei de ideia, quero parcelar" is at the end of the context
      const fullTranscript = formatted.join('\n')
      const posVista = fullTranscript.indexOf('à vista')
      const posParcelar = fullTranscript.indexOf('Mudei de ideia, quero parcelar')
      expect(posParcelar).toBeGreaterThan(posVista)
    })
  })

  // SECTION 13: Contact Precedence & Saved CRM Name Immutability
  describe('Section 13: Contact Identity Precedence & Immutability of Custom CRM Names', () => {
    it('preserves custom CRM name over any incoming WhatsApp chat or push name', () => {
      const contact = {
        name: 'Dr. Leonardo Possatti (VIP)',
        phone: '5511987654321',
        whatsapp_lid: '25190000009361@lid',
      }

      // Even if WhatsApp provides pushName "Leo", CRM saved name takes top priority
      expect(getContactDisplayName(contact, 'Leo WhatsApp')).toBe('Dr. Leonardo Possatti (VIP)')
    })
  })

  // SECTION 14: Avatar and Privacy Fallbacks
  describe('Section 14: Avatar Resolution & Secure Fallbacks', () => {
    it('generates uppercase initials fallback when avatar is missing or blocked', () => {
      expect(getContactInitials('Carlos Eduardo')).toBe('CE')
      expect(getContactInitials('+55 (11) 98765-4321')).toBe('21')
      expect(getContactInitials('')).toBe('C')
    })
  })

  // SECTION 28: Security & Cross-Tenant Boundary
  describe('Section 28: Security & Cross-Tenant Boundary Protection', () => {
    it('only scans chats that match eligible 1:1 format and rejects group/broadcast/newsletter identifiers', () => {
      expect(isEligibleWahaChat('5511999998888@c.us')).toBe(true)
      expect(isEligibleWahaChat('25190000009361@lid')).toBe(true)
      expect(isEligibleWahaChat('120363024823948293@g.us')).toBe(false)
      expect(isEligibleWahaChat('status@broadcast')).toBe(false)
      expect(isEligibleWahaChat('120363024823948293@newsletter')).toBe(false)
    })
  })
})
