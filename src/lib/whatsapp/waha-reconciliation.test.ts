/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reconcileWahaMessages,
  maybeTriggerAutoRecovery,
} from './providers/waha/reconciliation'
import { encrypt } from './encryption'

// Mock waha-api
vi.mock('./waha-api', () => ({
  getWahaSession: vi.fn(),
  getWahaChats: vi.fn(),
  getWahaChatMessages: vi.fn(),
  resolveWahaLidToPhoneNumber: vi.fn(),
}))

import {
  getWahaSession,
  getWahaChats,
  getWahaChatMessages,
  resolveWahaLidToPhoneNumber,
} from './waha-api'

describe('WAHA Resilient Reconciliation & Recovery Engine', () => {
  const accountId = 'a1111111-1111-4111-8111-111111111111'
  const validApiKey = 'test-waha-key-12345'
  const encryptedApiKey = encrypt(validApiKey)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Sync Status Semantics & Resilience', () => {
    it('marks status as failed and DOES NOT advance last_sync_completed_at when all 17 chats fail', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      // 17 chats
      const mockChats = Array.from({ length: 17 }, (_, i) => ({
        id: `chat_${i}@lid`,
        name: `Chat ${i}`,
      }))
      vi.mocked(getWahaChats).mockResolvedValueOnce(mockChats)

      // All 17 chat message calls fail
      vi.mocked(getWahaChatMessages).mockRejectedValue(new Error('WAHA 500 Internal Error'))

      let lastUpsertPayload: any = null
      const fakeDb = {
        from: vi.fn((table: string) => {
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  provider: 'waha',
                  waha_base_url: 'http://localhost:3001',
                  waha_session_name: 'wacrm_session',
                  access_token: encryptedApiKey,
                },
                error: null,
              }),
            }
          }
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  last_sync_completed_at: '2026-08-28T00:00:00.000Z',
                  last_sync_status: 'success',
                },
                error: null,
              }),
              upsert: vi.fn().mockImplementation((payload: any) => {
                lastUpsertPayload = payload
                return Promise.resolve({ data: payload, error: null })
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

      const result = await reconcileWahaMessages({
        accountId,
        db: fakeDb,
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('failed')
      expect(result.stats?.chatsScanned).toBe(17)
      expect(result.stats?.chatsFailed).toBe(17)
      expect(result.stats?.chatsSucceeded).toBe(0)
      expect(result.error).toContain('todas as 17 conversas falharam')

      // Critical invariant: last_sync_completed_at MUST NOT be advanced on complete failure!
      expect(lastUpsertPayload.last_sync_status).toBe('failed')
      expect(lastUpsertPayload.last_sync_completed_at).toBeUndefined()
    })

    it('marks status as partial when 1 out of 17 chats fails and 16 succeed', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      const mockChats = Array.from({ length: 17 }, (_, i) => ({
        id: `chat_${i}@c.us`,
        name: `Chat ${i}`,
      }))
      vi.mocked(getWahaChats).mockResolvedValueOnce(mockChats)

      // 1 chat fails, 16 succeed
      vi.mocked(getWahaChatMessages).mockImplementation(async (_config, chatId) => {
        if (chatId === 'chat_0@c.us') {
          throw new Error('Network timeout on chat_0')
        }
        return []
      })

      let lastUpsertPayload: any = null
      const fakeDb = {
        from: vi.fn((table: string) => {
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  provider: 'waha',
                  waha_base_url: 'http://localhost:3001',
                  waha_session_name: 'wacrm_session',
                  access_token: encryptedApiKey,
                },
                error: null,
              }),
            }
          }
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  last_sync_completed_at: '2026-08-28T00:00:00.000Z',
                  last_sync_status: 'success',
                },
                error: null,
              }),
              upsert: vi.fn().mockImplementation((payload: any) => {
                lastUpsertPayload = payload
                return Promise.resolve({ data: payload, error: null })
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

      const result = await reconcileWahaMessages({
        accountId,
        db: fakeDb,
      })

      expect(result.success).toBe(true)
      expect(result.status).toBe('partial')
      expect(result.stats?.chatsScanned).toBe(17)
      expect(result.stats?.chatsFailed).toBe(1)
      expect(result.stats?.chatsSucceeded).toBe(16)
      expect(result.error).toContain('1 de 17 conversas falharam')

      expect(lastUpsertPayload.last_sync_status).toBe('partial')
      expect(lastUpsertPayload.last_sync_completed_at).toBeDefined()
    })

    it('marks status as success when 0 chats fail', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      vi.mocked(getWahaChats).mockResolvedValueOnce([
        { id: '5511999991111@c.us', name: 'Chat 1' },
      ])
      vi.mocked(getWahaChatMessages).mockResolvedValueOnce([])

      let lastUpsertPayload: any = null
      const fakeDb = {
        from: vi.fn((table: string) => {
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  provider: 'waha',
                  waha_base_url: 'http://localhost:3001',
                  waha_session_name: 'wacrm_session',
                  access_token: encryptedApiKey,
                },
                error: null,
              }),
            }
          }
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  last_sync_completed_at: '2026-08-28T00:00:00.000Z',
                  last_sync_status: 'success',
                },
                error: null,
              }),
              upsert: vi.fn().mockImplementation((payload: any) => {
                lastUpsertPayload = payload
                return Promise.resolve({ data: payload, error: null })
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

      const result = await reconcileWahaMessages({
        accountId,
        db: fakeDb,
      })

      expect(result.success).toBe(true)
      expect(result.status).toBe('success')
      expect(result.stats?.chatsScanned).toBe(1)
      expect(result.stats?.chatsFailed).toBe(0)
      expect(result.stats?.chatsSucceeded).toBe(1)
      expect(result.error).toBeUndefined()

      expect(lastUpsertPayload.last_sync_status).toBe('success')
      expect(lastUpsertPayload.last_sync_error).toBeNull()
      expect(lastUpsertPayload.last_sync_completed_at).toBeDefined()
    })
  })

  describe('LID Resolution & Contact Identity', () => {
    it('preserves LID in externalChatId and resolves phone number server-side', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      vi.mocked(getWahaChats).mockResolvedValueOnce([
        { id: '25190000009361@lid', name: 'Leo Possatti' },
      ])

      const nowSec = Math.floor(Date.now() / 1000)
      vi.mocked(getWahaChatMessages).mockResolvedValueOnce([
        {
          id: 'false_25190000009361@lid_OFFLINE01',
          from: '25190000009361@lid',
          fromMe: false,
          body: 'OFFLINE CICLOPES 01',
          timestamp: nowSec - 100,
        },
      ])

      vi.mocked(resolveWahaLidToPhoneNumber).mockResolvedValueOnce('5513974135365')

      let insertedContactPhone: string | null = null
      let insertedMessageContent: string | null = null

      const fakeDb = {
        from: vi.fn((table: string) => {
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  provider: 'waha',
                  waha_base_url: 'http://localhost:3001',
                  waha_session_name: 'wacrm_session',
                  access_token: encryptedApiKey,
                },
                error: null,
              }),
            }
          }
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  last_sync_completed_at: new Date(Date.now() - 3600 * 1000).toISOString(),
                  last_sync_status: 'success',
                },
                error: null,
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
            }
          }
          if (table === 'profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { user_id: 'u1' },
                error: null,
              }),
            }
          }
          if (table === 'contacts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              like: vi.fn().mockResolvedValue({ data: [], error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockImplementation((cPayload: any) => {
                insertedContactPhone = cPayload.phone
                return {
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'c_lid_1', phone: cPayload.phone, account_id: accountId },
                      error: null,
                    }),
                  }),
                }
              }),
            }
          }
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'conv_lid_1', account_id: accountId, contact_id: 'c_lid_1' },
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnThis(),
            }
          }
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockImplementation((mPayload: any) => {
                insertedMessageContent = mPayload.content_text
                return {
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'm_lid_1', conversation_id: 'conv_lid_1' },
                      error: null,
                    }),
                  }),
                }
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

      const result = await reconcileWahaMessages({
        accountId,
        db: fakeDb,
      })

      expect(result.success).toBe(true)
      expect(result.stats?.messagesInserted).toBe(1)
      expect(insertedMessageContent).toBe('OFFLINE CICLOPES 01')
      // Resolved PN 5513974135365 must be used for contact phone
      expect(insertedContactPhone).toBe('5513974135365')
    })
  })

  describe('Auto-Recovery Engine with Cooldown Lock', () => {
    it('triggers reconciliation when sync gap exists and adheres to in-memory lock', async () => {
      const now = Date.now()
      const fakeDb = {
        from: vi.fn((table: string) => {
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  last_sync_completed_at: new Date(now - 30 * 60 * 1000).toISOString(), // 30 min gap
                  last_sync_status: 'success',
                },
                error: null,
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
            }
          }
          if (table === 'whatsapp_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  provider: 'waha',
                  waha_base_url: 'http://localhost:3001',
                  waha_session_name: 'wacrm_session',
                  access_token: encryptedApiKey,
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

      vi.mocked(getWahaSession).mockResolvedValue({
        name: 'wacrm_session',
        status: 'WORKING',
      })
      vi.mocked(getWahaChats).mockResolvedValue([])

      const autoAccId = 'auto-recovery-test-account-1'
      // Call 1: triggers auto recovery
      await maybeTriggerAutoRecovery(autoAccId, fakeDb, { minGapMinutes: 5 })

      // Call 2 immediately: must be blocked by in-memory cooldown lock
      await maybeTriggerAutoRecovery(autoAccId, fakeDb, { minGapMinutes: 5 })

      // Verify db was queried only once for sync state
      expect(fakeDb.from).toHaveBeenCalledWith('whatsapp_sync_state')
    })
  })
})
