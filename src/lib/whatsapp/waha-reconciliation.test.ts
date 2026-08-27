/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconcileWahaMessages } from './providers/waha/reconciliation'
import { normalizeWahaInbound } from './providers/waha/normalize-inbound'
import { encrypt } from './encryption'

// Mock waha-api
vi.mock('./waha-api', () => ({
  getWahaSession: vi.fn(),
  getWahaChats: vi.fn(),
  getWahaChatMessages: vi.fn(),
}))

import { getWahaSession, getWahaChats, getWahaChatMessages } from './waha-api'

describe('WAHA Resilient Reconciliation & Recovery Engine', () => {
  const accountId = 'a1111111-1111-4111-8111-111111111111'
  const validApiKey = 'test-waha-key-12345'
  const encryptedApiKey = encrypt(validApiKey)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('correctly normalizes phone-side outbound message (fromMe: true)', () => {
    const rawPayload = {
      event: 'message',
      session: 'wacrm_session',
      payload: {
        id: 'false_5511999998888@c.us_3EB0123456789',
        fromMe: true,
        from: '5511888887777@c.us', // business phone
        to: '5511999998888@c.us', // customer phone
        chatId: '5511999998888@c.us',
        body: 'Resposta enviada direto do celular físico',
        timestamp: 1740698000,
        _data: {
          id: {
            remote: '5511999998888@c.us',
            fromMe: true,
            _serialized: 'false_5511999998888@c.us_3EB0123456789',
          },
        },
      },
    }

    const event = normalizeWahaInbound(rawPayload, accountId)
    expect(event).not.toBeNull()
    expect(event?.type).toBe('message')
    if (event?.type === 'message') {
      expect(event.fromMe).toBe(true)
      expect(event.fromPhone).toBe('5511999998888') // correctly maps to customer phone, not business phone
      expect(event.content.text).toBe('Resposta enviada direto do celular físico')
      expect(event.externalMessageId).toBe('false_5511999998888@c.us_3EB0123456789')
    }
  })

  it('skips reconciliation when WAHA session is not in WORKING status', async () => {
    vi.mocked(getWahaSession).mockResolvedValueOnce({
      name: 'wacrm_session',
      status: 'SCAN_QR_CODE',
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

    const result = await reconcileWahaMessages({
      accountId,
      db: fakeDb,
    })

    expect(result.success).toBe(false)
    expect(result.reason).toBe('session_not_working')
    expect(result.sessionStatus).toBe('SCAN_QR_CODE')
  })

  it('applies safety overlap window and dedupes existing messages during recovery', async () => {
    vi.mocked(getWahaSession).mockResolvedValueOnce({
      name: 'wacrm_session',
      status: 'WORKING',
      me: { id: '5511888887777@c.us', pushName: 'Empresa Teste' },
    })

    vi.mocked(getWahaChats).mockResolvedValueOnce([
      { id: '5511999991111@c.us', name: 'Cliente 1' },
    ])

    const nowSec = Math.floor(Date.now() / 1000)

    vi.mocked(getWahaChatMessages).mockResolvedValueOnce([
      {
        id: 'msg_existing_001',
        from: '5511999991111@c.us',
        fromMe: false,
        body: 'Mensagem já gravada anteriormente',
        timestamp: nowSec - 300,
      },
      {
        id: 'msg_new_002',
        from: '5511999991111@c.us',
        fromMe: false,
        body: 'Nova mensagem recuperada na reconciliação',
        timestamp: nowSec - 60,
      },
    ])

    let upsertCalled = false
    let syncStateStatus = 'idle'

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
            upsert: vi.fn().mockImplementation((payload: any) => {
              upsertCalled = true
              syncStateStatus = payload.last_sync_status
              return Promise.resolve({ data: payload, error: null })
            }),
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
            like: vi.fn().mockResolvedValue({
              data: [{ id: 'c1', account_id: accountId, phone: '5511999991111' }],
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'c1', account_id: accountId, phone: '5511999991111' },
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
              data: [{ id: 'conv1', account_id: accountId, contact_id: 'c1' }],
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'conv1', unread_count: 0, last_message_at: null },
              error: null,
            }),
          }
        }
        if (table === 'messages') {
          let queryMessageId: string | null = null
          const builder: any = {
            select: vi.fn().mockImplementation(() => builder),
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              if (col === 'message_id') queryMessageId = val
              return builder
            }),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockImplementation(() => {
              if (queryMessageId === 'msg_existing_001') {
                return Promise.resolve({
                  data: { id: 'm1', conversation_id: 'conv1' },
                  error: null,
                })
              }
              return Promise.resolve({ data: null, error: null })
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'm2', conversation_id: 'conv1' },
                  error: null,
                }),
              }),
            }),
          }
          return builder
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
    expect(result.stats).toBeDefined()
    expect(result.stats?.chatsScanned).toBe(1)
    expect(result.stats?.messagesDiscovered).toBe(2)
    expect(result.stats?.duplicatesIgnored).toBe(1)
    expect(result.stats?.messagesInserted).toBe(1)
    expect(upsertCalled).toBe(true)
    expect(syncStateStatus).toBe('success')
  })
})
