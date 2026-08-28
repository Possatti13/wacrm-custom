import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'

const secret = 'waha-test-secret-999'
let mockWahaEnqueueFail = false

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn(async (fn: string, params: Record<string, unknown>) => {
      if (fn === 'enqueue_whatsapp_inbound_batch') {
        if (mockWahaEnqueueFail) {
          return { data: null, error: { message: 'Queue unavailable' } }
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
      let queriedSession: string | null = null
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['select', 'like', 'order', 'limit', 'not', 'insert', 'update']) {
        b[m] = vi.fn(chain)
      }
      b.eq = vi.fn((col: string, val: string) => {
        if (col === 'waha_session_name') queriedSession = val
        return b
      })
      b.maybeSingle = vi.fn(async () => {
        if (table === 'whatsapp_config') {
          if (queriedSession && queriedSession !== 'default') {
            return { data: null, error: null }
          }
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
        if (table === 'messages') {
          return { data: { id: 'msg-1' }, error: null }
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

vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>()
  return {
    ...mod,
    after: (fn: () => void | Promise<void>) => {
      void fn()
    },
  }
})

import { POST } from './route'

describe('POST /api/whatsapp/waha/webhook', () => {
  beforeEach(() => {
    mockWahaEnqueueFail = false
    vi.stubEnv('WAHA_WEBHOOK_SECRET', secret)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('accepts a valid request with HMAC-SHA512 header and enqueues to durable queue', async () => {
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
    expect(json.job_id).toBeDefined()
  })

  it('TESTE 25: returns 500 when queue enqueue fails (no false 200)', async () => {
    mockWahaEnqueueFail = true

    const body = JSON.stringify({
      event: 'message',
      session: 'default',
      payload: {
        from: '5511999999999@c.us',
        id: 'msg-waha-fail',
        body: 'Olá teste falha',
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
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Queue persistence failed')
  })

  it('rejects an invalid HMAC signature with 401', async () => {
    const body = JSON.stringify({
      event: 'message',
      session: 'default',
      payload: {
        from: '5511999999999@c.us',
        id: 'msg-waha-2',
        body: 'Olá teste',
      },
    })

    const req = new Request('http://localhost/api/whatsapp/waha/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-hmac': 'sha512=badbadbadbad',
      },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects an unauthenticated request without HMAC/token with 401', async () => {
    const body = JSON.stringify({
      event: 'message',
      session: 'default',
      payload: {
        from: '5511999999999@c.us',
        id: 'msg-waha-3',
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
  })

  it('safely handles session.status event and returns 200 without queueing a message job', async () => {
    const payloadStr = JSON.stringify({
      event: 'session.status',
      session: 'default',
      payload: {
        status: 'WORKING',
        name: 'default',
      },
    })
    const signature = crypto.createHmac('sha512', secret).update(payloadStr).digest('hex')

    const req = new Request('http://localhost/api/whatsapp/waha/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-hmac': signature,
      },
      body: payloadStr,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('handled')
    expect(json.event).toBe('session.status')
    expect(json.session_status).toBe('WORKING')
  })

  it('safely ignores events from unconfigured sessions with 200 to prevent retry storms', async () => {
    const payloadStr = JSON.stringify({
      event: 'session.status',
      session: 'legacy_wacrm_unknown',
      payload: {
        status: 'STOPPED',
        name: 'legacy_wacrm_unknown',
      },
    })

    const req = new Request('http://localhost/api/whatsapp/waha/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payloadStr,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ignored')
    expect(json.reason).toBe('unconfigured_session')
  })
})
