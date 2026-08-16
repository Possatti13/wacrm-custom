import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { verifyWahaWebhookSignature } from './waha-signature'

describe('verifyWahaWebhookSignature', () => {
  const secret = 'test-waha-secret-key-12345'
  const payload = JSON.stringify({
    event: 'message',
    session: 'default',
    payload: { id: 'msg-123', body: 'Olá mundo' },
  })

  beforeEach(() => {
    vi.stubEnv('WAHA_WEBHOOK_SECRET', secret)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('validates a correct HMAC-SHA512 signature with prefix', () => {
    const hmac = crypto.createHmac('sha512', secret).update(payload).digest('hex')
    const headers = new Headers({
      'x-webhook-hmac': `sha512=${hmac}`,
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers })).toBe(true)
  })

  it('validates a correct HMAC-SHA512 signature without prefix (raw hex)', () => {
    const hmac = crypto.createHmac('sha512', secret).update(payload).digest('hex')
    const headers = new Headers({
      'x-webhook-hmac': hmac,
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers })).toBe(true)
  })

  it('validates a correct HMAC-SHA256 signature with prefix', () => {
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    const headers = new Headers({
      'x-webhook-hmac': `sha256=${hmac}`,
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers })).toBe(true)
  })

  it('rejects an invalid HMAC signature', () => {
    const headers = new Headers({
      'x-webhook-hmac': 'sha512=bad-signature-hex-1234567890abcdef',
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers })).toBe(false)
  })

  it('rejects a payload modified after signing', () => {
    const hmac = crypto.createHmac('sha512', secret).update(payload).digest('hex')
    const headers = new Headers({
      'x-webhook-hmac': `sha512=${hmac}`,
    })
    const tamperedPayload = payload + ' '

    expect(verifyWahaWebhookSignature({ rawBody: tamperedPayload, headers })).toBe(false)
  })

  it('accepts a valid fallback token in x-api-key header when HMAC is not sent', () => {
    const headers = new Headers({
      'x-api-key': secret,
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers })).toBe(true)
  })

  it('rejects an incorrect fallback token', () => {
    const headers = new Headers({
      'x-api-key': 'wrong-token',
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers })).toBe(false)
  })

  it('fails closed when no secret is configured', () => {
    vi.unstubAllEnvs()
    const headers = new Headers({
      'x-api-key': secret,
    })

    expect(verifyWahaWebhookSignature({ rawBody: payload, headers, secret: null })).toBe(false)
  })
})
