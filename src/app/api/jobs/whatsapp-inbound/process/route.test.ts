import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST, GET } from './route'
import * as workerModule from '@/lib/jobs/workers/whatsapp-inbound-worker'

vi.mock('@/lib/jobs/workers/whatsapp-inbound-worker', () => ({
  processWhatsAppInboundBatch: vi.fn(async () => ({
    read: 5,
    succeeded: 5,
    failed: 0,
    deadLettered: 0,
  })),
}))

describe('Recovery Worker Route (/api/jobs/whatsapp-inbound/process)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-123')
    vi.clearAllMocks()
  })

  it('rejects unauthorized request with 401', async () => {
    const req = new Request('http://localhost/api/jobs/whatsapp-inbound/process', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('executes batch drainage with valid x-cron-secret header', async () => {
    const req = new Request('http://localhost/api/jobs/whatsapp-inbound/process', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'test-cron-secret-123',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stats.read).toBe(5)
    expect(workerModule.processWhatsAppInboundBatch).toHaveBeenCalled()
  })

  it('supports GET method with bearer token authorization', async () => {
    const req = new Request('http://localhost/api/jobs/whatsapp-inbound/process', {
      method: 'GET',
      headers: {
        authorization: 'Bearer test-cron-secret-123',
      },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })
})
