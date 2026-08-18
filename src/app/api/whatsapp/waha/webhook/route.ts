import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyWahaWebhookSignature } from '@/lib/whatsapp/waha-signature'
import { normalizeWahaInbound } from '@/lib/whatsapp/providers/waha/normalize-inbound'
import { enqueueWhatsAppInboundEvent } from '@/lib/jobs/producer'
import { processWhatsAppInboundBatch } from '@/lib/jobs/workers/whatsapp-inbound-worker'

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionName = str(body.session) ?? str(asRecord(body.payload).session)
  if (!sessionName) {
    return NextResponse.json({ error: 'Missing WAHA session' }, { status: 400 })
  }

  // 1. Resolve tenant strictly on the authenticated boundary
  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'waha')
    .eq('waha_session_name', sessionName)
    .maybeSingle()

  if (configError || !config) {
    console.error('[waha-webhook] no config for session:', sessionName, configError?.message)
    return NextResponse.json({ status: 'ignored', reason: 'no_config' })
  }

  // 2. Validate cryptographic signature (HMAC-SHA512 / SHA256)
  let sessionSecret: string | null = null
  if (config.access_token) {
    try {
      sessionSecret = decrypt(config.access_token)
    } catch {
      sessionSecret = null
    }
  }

  const isVerified =
    verifyWahaWebhookSignature({
      rawBody,
      headers: request.headers,
      secret: sessionSecret,
    }) ||
    verifyWahaWebhookSignature({
      rawBody,
      headers: request.headers,
      secret: process.env.WAHA_WEBHOOK_SECRET || process.env.WAHA_API_KEY,
    })

  if (!isVerified) {
    console.warn('[waha-webhook] rejected request with invalid or missing signature/token')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 3. Normalize inbound event
  const event = normalizeWahaInbound(body, config.account_id)
  if (!event || event.type === 'unknown') {
    return NextResponse.json({ status: 'ignored', reason: 'unknown_or_empty_event' })
  }

  // 4. Durably enqueue event before responding HTTP 200
  let enqueueResult: { jobId: string; messageId?: number }
  try {
    enqueueResult = await enqueueWhatsAppInboundEvent(event, { db: supabaseAdmin() })
  } catch (enqueueErr) {
    console.error('[waha-webhook] Critical: Failed to enqueue inbound event:', enqueueErr)
    return NextResponse.json({ error: 'Queue persistence failed' }, { status: 500 })
  }

  // 5. Best-effort latency accelerator in background
  after(async () => {
    try {
      await processWhatsAppInboundBatch()
    } catch (drainErr) {
      console.warn('[waha-webhook] after() accelerator encountered an error (queue remains durable):', drainErr)
    }
  })

  return NextResponse.json({
    status: 'received',
    job_id: enqueueResult.jobId,
  })
}
