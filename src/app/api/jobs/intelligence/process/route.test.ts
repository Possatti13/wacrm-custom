import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST, GET } from './route'
import * as workerModule from '@/lib/jobs/workers/intelligence-worker'
import * as sweepModule from '@/lib/intelligence/sweep'

vi.mock('@/lib/jobs/workers/intelligence-worker', () => ({
  processIntelligenceBatch: vi.fn(async () => ({
    read: 3,
    succeeded: 3,
    failed: 0,
    deadLettered: 0,
  })),
}))

vi.mock('@/lib/intelligence/sweep', () => ({
  sweepAndEnqueueDueIntelligence: vi.fn(async () => ({
    checked: 10,
    enqueued: 2,
  })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}))

describe('Intelligence Process Cron Route (/api/jobs/intelligence/process)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-intel-123')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
    vi.clearAllMocks()
  })

  it('A. rejects request with no secret (401)', async () => {
    const req = new Request('http://localhost/api/jobs/intelligence/process', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('B. rejects request with wrong secret (401)', async () => {
    const req = new Request('http://localhost/api/jobs/intelligence/process', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'wrong-secret-value',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('C. executes sweep and worker with valid x-cron-secret header (200)', async () => {
    const req = new Request('http://localhost/api/jobs/intelligence/process', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'test-cron-secret-intel-123',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.sweep.enqueued).toBe(2)
    expect(json.worker.succeeded).toBe(3)
    expect(sweepModule.sweepAndEnqueueDueIntelligence).toHaveBeenCalled()
    expect(workerModule.processIntelligenceBatch).toHaveBeenCalled()
  })

  it('D. executes sweep and worker with valid Bearer token authorization (200)', async () => {
    const req = new Request('http://localhost/api/jobs/intelligence/process', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-cron-secret-intel-123',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('supports GET method invoking POST handler', async () => {
    const req = new Request('http://localhost/api/jobs/intelligence/process', {
      method: 'GET',
      headers: {
        'x-cron-secret': 'test-cron-secret-intel-123',
      },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })
})
