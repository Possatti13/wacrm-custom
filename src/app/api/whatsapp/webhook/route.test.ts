import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET, POST } from './route'
import crypto from 'crypto'

const appSecret = 'test-meta-app-secret'
process.env.META_APP_SECRET = appSecret

function signPayload(body: string, secret = appSecret): string {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hmac}`
}

const mockMessages: Array<Record<string, unknown>> = []
const mockStatusUpdates: Array<Record<string, unknown>> = []
const mockReactions: Array<Record<string, unknown>> = []
let mockEnqueueFail = false

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      if (fn === 'enqueue_whatsapp_inbound_batch') {
        if (mockEnqueueFail) {
          return { data: null, error: { message: 'Queue unavailable / PGMQ connection timeout' } }
        }
        const msgs = (params.p_messages as unknown[]) || []
        return { data: msgs.map((_, i) => i + 1), error: null }
      }
      if (fn === 'read_whatsapp_inbound') {
        return { data: [], error: null }
      }
      if (fn === 'archive_whatsapp_inbound') {
        return { data: true, error: null }
      }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['select', 'eq', 'like', 'order', 'limit', 'not', 'in']) {
        b[m] = vi.fn(chain)
      }

      b.maybeSingle = vi.fn(async () => {
        if (table === 'whatsapp_config') {
          return {
            data: {
              id: 'cfg-meta-1',
              account_id: 'acct-meta-1',
              user_id: 'user-admin-1',
              phone_number_id: 'PN_123',
              verify_token: 'valid-verify-token',
            },
            error: null,
          }
        }
        if (table === 'messages') {
          return { data: null, error: null }
        }
        if (table === 'profiles') {
          return { data: { user_id: 'user-admin-1' }, error: null }
        }
        return { data: null, error: null }
      })

      b.single = vi.fn(async () => {
        if (table === 'contacts') {
          return { data: { id: 'contact-meta-1', phone: '+5511999999999' }, error: null }
        }
        if (table === 'conversations') {
          return { data: { id: 'conv-meta-1', unread_count: 0 }, error: null }
        }
        if (table === 'messages') {
          return { data: { id: 'msg-meta-1' }, error: null }
        }
        return { data: null, error: null }
      })

      b.insert = vi.fn((data: Record<string, unknown>) => {
        if (table === 'messages') mockMessages.push(data)
        return b
      })

      b.update = vi.fn((data: Record<string, unknown>) => {
        if (table === 'messages') mockStatusUpdates.push(data)
        return b
      })

      b.upsert = vi.fn((data: Record<string, unknown>) => {
        if (table === 'message_reactions') mockReactions.push(data)
        return b
      })

      b.delete = vi.fn(() => b)

      b.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'whatsapp_config') {
          return resolve({
            data: [
              {
                id: 'cfg-meta-1',
                account_id: 'acct-meta-1',
                user_id: 'user-admin-1',
                phone_number_id: 'PN_123',
                verify_token: 'valid-verify-token',
              },
            ],
            error: null,
          })
        }
        return resolve({ data: null, error: null })
      }

      return b
    },
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((token: string) => token),
  encrypt: vi.fn((token: string) => token),
  isLegacyFormat: vi.fn(() => false),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => {}),
}))

vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>()
  return {
    ...mod,
    after: (fn: () => void | Promise<void>) => {
      void fn()
    },
  }
})

describe('Meta Webhook Route (/api/whatsapp/webhook)', () => {
  beforeEach(() => {
    mockMessages.length = 0
    mockStatusUpdates.length = 0
    mockReactions.length = 0
    mockEnqueueFail = false
    vi.clearAllMocks()
  })

  describe('GET verification challenge', () => {
    it('returns challenge when verify_token matches', async () => {
      const req = new Request(
        'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=valid-verify-token&hub.challenge=test_challenge_123'
      )
      const res = await GET(req)
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toBe('test_challenge_123')
    })

    it('rejects with 403 when verify_token does not match', async () => {
      const req = new Request(
        'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test_challenge_123'
      )
      const res = await GET(req)
      expect(res.status).toBe(403)
    })
  })

  describe('POST signature & durable queue ingestion', () => {
    it('rejects invalid signature with 401', async () => {
      const payload = JSON.stringify({ entry: [] })
      const req = new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=invalid_hash',
        },
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('TESTE 25: returns 500 and rejects when queue enqueue fails (no false 200)', async () => {
      mockEnqueueFail = true

      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'PN_123' },
                  contacts: [{ profile: { name: 'Meta Cliente' }, wa_id: '5511999999999' }],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.FAIL_QUEUE_TEST',
                      timestamp: '1700000000',
                      text: { body: 'Mensagem com falha de queue' },
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      const sig = signPayload(payload)
      const req = new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json.error).toBe('Queue persistence failed')
    })

    it('enqueues inbound text message to durable queue and acknowledges HTTP 200', async () => {
      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15550254321',
                    phone_number_id: 'PN_123',
                  },
                  contacts: [{ profile: { name: 'Meta Cliente' }, wa_id: '5511999999999' }],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.TEST_INBOUND_1',
                      timestamp: '1700000000',
                      text: { body: 'Olá via Meta' },
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      const sig = signPayload(payload)
      const req = new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.status).toBe('received')
    })

    it('enqueues status updates to durable queue and acknowledges HTTP 200', async () => {
      const payload = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'PN_123' },
                  statuses: [
                    {
                      id: 'wamid.OUTBOUND_1',
                      status: 'delivered',
                      timestamp: '1700000010',
                      recipient_id: '5511999999999',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      const sig = signPayload(payload)
      const req = new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    })

    it('enqueues reaction events to durable queue and acknowledges HTTP 200', async () => {
      const payload = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'PN_123' },
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.REACT_1',
                      timestamp: '1700000020',
                      type: 'reaction',
                      reaction: { message_id: 'wamid.TARGET_1', emoji: '❤️' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      const sig = signPayload(payload)
      const req = new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    })

    it('safely handles empty/unknown changes without crashing', async () => {
      const payload = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'PN_123' },
                  unknown_field: { foo: 'bar' },
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      const sig = signPayload(payload)
      const req = new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: payload,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    })
  })
})
