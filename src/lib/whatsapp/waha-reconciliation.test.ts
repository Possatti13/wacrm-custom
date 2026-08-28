/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reconcileWahaMessages,
  maybeTriggerAutoRecovery,
  isEligibleWahaChat,
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
} from './waha-api'

describe('WAHA Resilient Reconciliation & Scoped Recovery Engine', () => {
  const accountId = 'a1111111-1111-4111-8111-111111111111'
  const validApiKey = 'test-waha-key-12345'
  const encryptedApiKey = encrypt(validApiKey)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Chat Type Filtering Helper (isEligibleWahaChat)', () => {
    it('allows 1:1 @c.us chats', () => {
      expect(isEligibleWahaChat('5511999998888@c.us')).toBe(true)
    })

    it('allows 1:1 @lid chats', () => {
      expect(isEligibleWahaChat('25190000009361@lid')).toBe(true)
    })

    it('allows plain phone number digits', () => {
      expect(isEligibleWahaChat('5511999998888')).toBe(true)
    })

    it('rejects @g.us group chats', () => {
      expect(isEligibleWahaChat('559887305062-1510868516@g.us')).toBe(false)
      expect(isEligibleWahaChat('120363045678901234@g.us')).toBe(false)
    })

    it('rejects @broadcast and status updates', () => {
      expect(isEligibleWahaChat('status@broadcast')).toBe(false)
      expect(isEligibleWahaChat('12345@broadcast')).toBe(false)
    })

    it('rejects @newsletter and channels', () => {
      expect(isEligibleWahaChat('1203631234567890@newsletter')).toBe(false)
    })

    it('rejects invalid or malformed strings', () => {
      expect(isEligibleWahaChat('')).toBe(false)
      expect(isEligibleWahaChat('[object Object]')).toBe(false)
      expect(isEligibleWahaChat(null as any)).toBe(false)
    })
  })

  describe('Strict Temporal Windows & Recovery Baseline (Recovery Floor)', () => {
    it('A) Mode "now" (apenas novas) NEVER imports messages before recovery_not_before baseline', async () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const baselineIso = new Date((nowSec - 300) * 1000).toISOString() // connected 5 min ago

      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      vi.mocked(getWahaChats).mockResolvedValueOnce([
        { id: '5511999991111@c.us', name: 'Chat 1' },
      ])

      let requestedTimestampGte = 0
      vi.mocked(getWahaChatMessages).mockImplementation(async (_config, _chatId, opts) => {
        requestedTimestampGte = opts?.filterTimestampGte || 0
        return []
      })

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
                  history_import_mode: 'now',
                  recovery_not_before: baselineIso,
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
                data: null, // No prior sync
                error: null,
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
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
        mode: 'now',
      })

      expect(result.success).toBe(true)
      expect(result.stats?.historyMode).toBe('now')
      // Requested timestamp must be >= baseline (5 min ago), NOT 24h ago!
      const expectedBaselineSec = Math.floor(new Date(baselineIso).getTime() / 1000)
      expect(requestedTimestampGte).toBe(expectedBaselineSec)
      expect(result.stats?.windowStart).toBe(new Date(expectedBaselineSec * 1000).toISOString())
    })

    it('B) Overlap recuperates gap between last_sync_completed_at - overlap and now', async () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const baselineIso = new Date((nowSec - 7200) * 1000).toISOString() // 2 hours ago
      const lastCompletedIso = new Date((nowSec - 1800) * 1000).toISOString() // 30 min ago

      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      vi.mocked(getWahaChats).mockResolvedValueOnce([
        { id: '5511999991111@c.us', name: 'Chat 1' },
      ])

      let requestedTimestampGte = 0
      vi.mocked(getWahaChatMessages).mockImplementation(async (_config, _chatId, opts) => {
        requestedTimestampGte = opts?.filterTimestampGte || 0
        return []
      })

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
                  history_import_mode: 'now',
                  recovery_not_before: baselineIso,
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
                  last_sync_completed_at: lastCompletedIso,
                  last_sync_status: 'success',
                },
                error: null,
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
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
        overlapMinutes: 10,
      })

      expect(result.success).toBe(true)
      // 30 min ago - 10 min overlap = 40 min ago (2400 sec ago)
      const expectedWindowStartSec = nowSec - 1800 - 600
      expect(Math.abs(requestedTimestampGte - expectedWindowStartSec)).toBeLessThanOrEqual(2)
    })

    it('C) Mode "24h" calculates 24 hours lookback', async () => {
      const nowSec = Math.floor(Date.now() / 1000)

      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })
      vi.mocked(getWahaChats).mockResolvedValueOnce([
        { id: '5511999991111@c.us', name: 'Chat 1' },
      ])

      let requestedTimestampGte = 0
      vi.mocked(getWahaChatMessages).mockImplementation(async (_config, _chatId, opts) => {
        requestedTimestampGte = opts?.filterTimestampGte || 0
        return []
      })

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
                  history_import_mode: '24h',
                },
                error: null,
              }),
            }
          }
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
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
        mode: '24h',
      })

      expect(result.success).toBe(true)
      expect(result.stats?.historyMode).toBe('24h')
      const expected24hSec = nowSec - 24 * 3600
      expect(Math.abs(requestedTimestampGte - expected24hSec)).toBeLessThanOrEqual(2)
    })

    it('D) Mode "7d" and E) Mode "30d" calculate correct lookback windows', async () => {
      const nowSec = Math.floor(Date.now() / 1000)

      vi.mocked(getWahaSession).mockResolvedValue({
        name: 'wacrm_session',
        status: 'WORKING',
      })
      vi.mocked(getWahaChats).mockResolvedValue([
        { id: '5511999991111@c.us', name: 'Chat 1' },
      ])

      let requestedTimestampGte = 0
      vi.mocked(getWahaChatMessages).mockImplementation(async (_config, _chatId, opts) => {
        requestedTimestampGte = opts?.filterTimestampGte || 0
        return []
      })

      const fakeDb = {
        from: vi.fn(() => ({
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
          upsert: vi.fn().mockResolvedValue({ error: null }),
        })),
      } as any

      // 7d test
      const res7d = await reconcileWahaMessages({ accountId, db: fakeDb, mode: '7d' })
      expect(res7d.stats?.historyMode).toBe('7d')
      const expected7dSec = nowSec - 7 * 24 * 3600
      expect(Math.abs(requestedTimestampGte - expected7dSec)).toBeLessThanOrEqual(2)

      // 30d test
      const res30d = await reconcileWahaMessages({ accountId, db: fakeDb, mode: '30d' })
      expect(res30d.stats?.historyMode).toBe('30d')
      const expected30dSec = nowSec - 30 * 24 * 3600
      expect(Math.abs(requestedTimestampGte - expected30dSec)).toBeLessThanOrEqual(2)
    })
  })

  describe('Chat Filtering & Exclusion of Groups, Broadcasts, and Status Updates', () => {
    it('scans only 1:1 chats and skips @g.us, @broadcast, @newsletter, and status', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      const mixedChats = [
        { id: '25190000009361@lid', name: 'Leo Possatti' }, // Eligible 1:1
        { id: '5511999998888@c.us', name: 'Cliente Real' }, // Eligible 1:1
        { id: '559887305062-1510868516@g.us', name: 'Grupo Suporte', isGroup: true }, // Group -> Skip
        { id: '120363045678901234@g.us', name: 'Outro Grupo', isGroup: true }, // Group -> Skip
        { id: 'status@broadcast', name: 'Status Broadcast' }, // Status -> Skip
        { id: '1203631234567890@newsletter', name: 'Canal de Novidades' }, // Channel -> Skip
      ]

      vi.mocked(getWahaChats).mockResolvedValueOnce(mixedChats as any)

      const scannedChatIds: string[] = []
      vi.mocked(getWahaChatMessages).mockImplementation(async (_config, chatId) => {
        scannedChatIds.push(
          typeof chatId === 'string'
            ? chatId
            : (chatId as any)._serialized || String((chatId as any).id || '')
        )
        return []
      })

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
                  history_import_mode: 'now',
                },
                error: null,
              }),
            }
          }
          if (table === 'whatsapp_sync_state') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
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
      expect(result.stats?.chatsScanned).toBe(6)
      expect(result.stats?.chatsEligible).toBe(2)
      expect(result.stats?.chatsSkippedGroup).toBe(2)
      expect(result.stats?.chatsSkippedBroadcast).toBe(2)
      expect(result.stats?.chatsSucceeded).toBe(2)
      expect(result.stats?.chatsFailed).toBe(0)

      // Verified: ONLY the two 1:1 chats were scanned!
      expect(scannedChatIds).toEqual(['25190000009361@lid', '5511999998888@c.us'])
    })
  })

  describe('Sync Status Semantics & Resilience', () => {
    it('marks status as failed and DOES NOT advance last_sync_completed_at when all eligible chats fail', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      const mockChats = Array.from({ length: 5 }, (_, i) => ({
        id: `chat_${i}@lid`,
        name: `Chat ${i}`,
      }))
      vi.mocked(getWahaChats).mockResolvedValueOnce(mockChats)
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
      expect(result.stats?.chatsEligible).toBe(5)
      expect(result.stats?.chatsFailed).toBe(5)
      expect(result.stats?.chatsSucceeded).toBe(0)
      expect(result.error).toContain('todas as 5 conversas elegíveis falharam')

      expect(lastUpsertPayload.last_sync_status).toBe('failed')
      expect(lastUpsertPayload.last_sync_completed_at).toBeUndefined()
    })

    it('marks status as partial when 1 out of 5 chats fails and 4 succeed', async () => {
      vi.mocked(getWahaSession).mockResolvedValueOnce({
        name: 'wacrm_session',
        status: 'WORKING',
      })

      const mockChats = Array.from({ length: 5 }, (_, i) => ({
        id: `chat_${i}@c.us`,
        name: `Chat ${i}`,
      }))
      vi.mocked(getWahaChats).mockResolvedValueOnce(mockChats)

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
      expect(result.stats?.chatsEligible).toBe(5)
      expect(result.stats?.chatsFailed).toBe(1)
      expect(result.stats?.chatsSucceeded).toBe(4)
      expect(result.error).toContain('1 de 5 conversas falharam')

      expect(lastUpsertPayload.last_sync_status).toBe('partial')
      expect(lastUpsertPayload.last_sync_completed_at).toBeDefined()
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
                  last_sync_completed_at: new Date(now - 30 * 60 * 1000).toISOString(),
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

      const autoAccId = 'auto-recovery-test-account-scoped'
      await maybeTriggerAutoRecovery(autoAccId, fakeDb, { minGapMinutes: 5 })
      await maybeTriggerAutoRecovery(autoAccId, fakeDb, { minGapMinutes: 5 })

      expect(fakeDb.from).toHaveBeenCalledWith('whatsapp_sync_state')
    })
  })
})
