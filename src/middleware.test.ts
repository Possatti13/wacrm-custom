import { describe, expect, it } from 'vitest'
import { isPublicApiPath } from './middleware'

describe('Middleware Route Protection & Cron Allowlist (RUNTIME-001)', () => {
  it('allows exact canonical cron worker routes without session', () => {
    expect(isPublicApiPath('/api/jobs/intelligence/process')).toBe(true)
    expect(isPublicApiPath('/api/jobs/whatsapp-inbound/process')).toBe(true)
    expect(isPublicApiPath('/api/automations/cron')).toBe(true)
    expect(isPublicApiPath('/api/flows/cron')).toBe(true)
  })

  it('allows public webhooks, invitations and v1 API routes', () => {
    expect(isPublicApiPath('/api/v1/messages')).toBe(true)
    expect(isPublicApiPath('/api/whatsapp/webhook')).toBe(true)
    expect(isPublicApiPath('/api/whatsapp/waha/webhook')).toBe(true)
    expect(isPublicApiPath('/api/invitations/accept')).toBe(true)
  })

  it('blocks unauthorized routes and arbitrary /api/jobs/* wildcard subpaths', () => {
    // Proving exact allowlist rather than broad wildcard
    expect(isPublicApiPath('/api/jobs/arbitrary-unauthorized')).toBe(false)
    expect(isPublicApiPath('/api/jobs/admin/run-all')).toBe(false)
    expect(isPublicApiPath('/api/whatsapp/send')).toBe(false)
    expect(isPublicApiPath('/api/contacts')).toBe(false)
    expect(isPublicApiPath('/api/conversations')).toBe(false)
    expect(isPublicApiPath('/api/ai/config')).toBe(false)
    expect(isPublicApiPath('/api/manager/ask')).toBe(false)
  })
})
