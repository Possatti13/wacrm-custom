import crypto from 'node:crypto'

export interface WahaSignatureValidationOptions {
  rawBody: string
  headers: Headers
  secret?: string | null
}

/**
 * Verify HMAC signature or authentication token attached to WAHA webhook POSTs.
 *
 * WAHA supports HMAC webhook signatures when configured on the session:
 *   webhooks: [{ url: "...", events: [...], hmac: { key: "secret" } }]
 *
 * Headers verified in order of preference:
 *   1. `x-webhook-hmac` / `x-webhook-hmac-sha512` / `x-webhook-hmac-sha256` / `x-waha-hmac`
 *   2. `x-api-key` / `x-waha-token`
 *
 * Supported HMAC formats:
 *   - `sha512=<hex>` or raw 128-char hex (HMAC-SHA512)
 *   - `sha256=<hex>` or raw 64-char hex (HMAC-SHA256)
 *
 * Uses `crypto.timingSafeEqual` for constant-time comparison to prevent timing attacks.
 */
export function verifyWahaWebhookSignature(
  options: WahaSignatureValidationOptions,
): boolean {
  const secret =
    options.secret ||
    process.env.WAHA_WEBHOOK_SECRET ||
    process.env.WAHA_API_KEY

  if (!secret) {
    console.error(
      '[waha-webhook] No secret configured for WAHA webhook verification. Set WAHA_WEBHOOK_SECRET or WAHA_API_KEY.',
    )
    return false
  }

  const signatureHeader =
    options.headers.get('x-webhook-hmac') ||
    options.headers.get('x-webhook-hmac-sha512') ||
    options.headers.get('x-webhook-hmac-sha256') ||
    options.headers.get('x-waha-hmac')

  if (signatureHeader) {
    const rawSignature = signatureHeader.trim()

    // 1. Check sha512
    const hmac512 = crypto.createHmac('sha512', secret).update(options.rawBody).digest('hex')
    if (safeCompare(rawSignature, `sha512=${hmac512}`) || safeCompare(rawSignature, hmac512)) {
      return true
    }

    // 2. Check sha256
    const hmac256 = crypto.createHmac('sha256', secret).update(options.rawBody).digest('hex')
    if (safeCompare(rawSignature, `sha256=${hmac256}`) || safeCompare(rawSignature, hmac256)) {
      return true
    }

    return false
  }

  // Fallback: direct token header if HMAC is not enabled on the WAHA instance
  const tokenHeader =
    options.headers.get('x-api-key') ||
    options.headers.get('x-waha-token') ||
    options.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (tokenHeader) {
    return safeCompare(tokenHeader.trim(), secret.trim())
  }

  return false
}

function safeCompare(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr)
  const b = Buffer.from(bStr)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
