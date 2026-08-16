import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'

const secret = 'waha-test-secret-999'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['select', 'eq', 'like', 'order', 'limit', 'not', 'insert', 'update']) {
        b[m] = vi.fn(chain)
      }
      b.maybeSingle = vi.fn(async () => {
        if (table === 'whatsapp_config') {
          return {
            data: {
              account_id: 'acct-1',
              user_id: 'user-1',
              provider: 'waha',
              waha_session_name: 'default',
              access_token: 'enc-secret',
            },
            error: null,
          }
        }
        return { data: null, error: null }
      })
      b.single = vi.fn(async () => {
        if (table === 'contacts') {
          return { data: { id: 'contact-1' }, error: null }
        }
        if (table === 'conversations') {
          return { data: { id: 'conv-1', unread_count: 0 }, error: null }
        }
        return { data: null, error: null }
      })
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null })
      return b
    },
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => secret),
  encrypt: vi.fn(() => 'enc-secret'),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))

import { POST } from './route'

describe('POST /api/whatsapp/waha/webhook', () => {
  beforeEach(() => {
    vi.stubEnv('WAHA_WEBHOOK_SECRET', secret)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('accepts a valid request with HMAC-SHA512 header', async () => {
    const body = JSON.stringify({
      event: 'message',
      session: 'default',
      payload: {
        from: '5511999999999@c.us',
        id: 'msg-waha-1',
        body: 'Olá teste',
        fromMe: false,
      },
    })
    const hmac = crypto.createHmac('sha512', secret).update(body).digest('hex')

    const req = new Request('http://localhost/api/whatsapp/waha/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-hmac': `sha512=${hmac}`,
      },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('received')
  })

  it('rejects an invalid HMAC signature with 401', async () => {
    const body = JSON.stringify({
      event: 'message',
      session: 'default',
      payload: {
        from: '5511999999999@c.us',
        id: 'msg-waha-1',
        body: 'Olá teste',
      },
    })

    const req = new Request('http://localhost/api/whatsapp/waha/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-hmac': 'sha512=badbadbadbadbadbad',
      },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Invalid signature')
  })

  it('rejects an unauthenticated request without HMAC/token with 401', async () => {
    const body = JSON.stringify({
      event: 'message',
      session: 'default',
      payload: {
        from: '5511999999999@c.us',
        id: 'msg-waha-1',
        body: 'Olá teste',
      },
    })

    const req = new Request('http://localhost/api/whatsapp/waha/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Invalid signature')
  })
})
