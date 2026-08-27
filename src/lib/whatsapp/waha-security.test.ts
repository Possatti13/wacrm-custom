import { describe, it, expect } from 'vitest'
import { verifyWahaWebhookSignature } from './waha-signature'
import crypto from 'crypto'

describe('WAHA Webhook & Multi-Tenant Security Suite', () => {
  const secretKey = 'test-waha-secret-key-32-chars-long!!'
  const payloadStr = JSON.stringify({
    event: 'message',
    session: 'tenant_a_session',
    payload: {
      id: 'waha-msg-12345',
      from: '5511999991111@c.us',
      body: 'Teste de segurança',
    },
  })

  it('validates a correct HMAC SHA512 signature in X-Webhook-Hmac header', () => {
    const hmac512 = crypto
      .createHmac('sha512', secretKey)
      .update(payloadStr, 'utf8')
      .digest('hex')

    const headers = new Headers({
      'x-webhook-hmac': hmac512,
    })

    const isValid = verifyWahaWebhookSignature({
      rawBody: payloadStr,
      headers,
      secret: secretKey,
    })

    expect(isValid).toBe(true)
  })

  it('validates a correct HMAC SHA256 signature in X-Webhook-Hmac header', () => {
    const hmac256 = crypto
      .createHmac('sha256', secretKey)
      .update(payloadStr, 'utf8')
      .digest('hex')

    const headers = new Headers({
      'x-webhook-hmac': hmac256,
    })

    const isValid = verifyWahaWebhookSignature({
      rawBody: payloadStr,
      headers,
      secret: secretKey,
    })

    expect(isValid).toBe(true)
  })

  it('rejects an invalid or tampered HMAC signature', () => {
    const headers = new Headers({
      'x-webhook-hmac': 'tampered_or_invalid_hex_signature_1234567890abcdef',
    })

    const isValid = verifyWahaWebhookSignature({
      rawBody: payloadStr,
      headers,
      secret: secretKey,
    })

    expect(isValid).toBe(false)
  })

  it('rejects requests when payload is tampered after signature generation', () => {
    const hmac512 = crypto
      .createHmac('sha512', secretKey)
      .update(payloadStr, 'utf8')
      .digest('hex')

    const headers = new Headers({
      'x-webhook-hmac': hmac512,
    })

    const tamperedPayload = JSON.stringify({
      event: 'message',
      session: 'tenant_b_session', // forged session!
      payload: {
        id: 'waha-msg-12345',
        from: '5511999991111@c.us',
        body: 'Teste de segurança alterado',
      },
    })

    const isValid = verifyWahaWebhookSignature({
      rawBody: tamperedPayload,
      headers,
      secret: secretKey,
    })

    expect(isValid).toBe(false)
  })

  it('rejects requests when secret key is wrong (cross-tenant key forgery)', () => {
    const otherTenantSecret = 'different-tenant-secret-key-9999!!'
    const hmac512 = crypto
      .createHmac('sha512', otherTenantSecret)
      .update(payloadStr, 'utf8')
      .digest('hex')

    const headers = new Headers({
      'x-webhook-hmac': hmac512,
    })

    const isValid = verifyWahaWebhookSignature({
      rawBody: payloadStr,
      headers,
      secret: secretKey,
    })

    expect(isValid).toBe(false)
  })
})
