import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import { normalizeMetaInbound } from '@/lib/whatsapp/providers/meta/normalize-inbound'
import { enqueueWhatsAppInboundEvents } from '@/lib/jobs/producer'
import { processWhatsAppInboundBatch } from '@/lib/jobs/workers/whatsapp-inbound-worker'
import type { NormalizedInboundEvent } from '@/lib/whatsapp/inbound/types'

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

// GET - Webhook verification
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  try {
    const { data: configs, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')
      .not('verify_token', 'is', null)

    if (error) {
      console.error('Error fetching whatsapp configs:', error)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    const matchedConfig = configs?.find((c: { id: string; verify_token: string }) => {
      try {
        const decrypted = decrypt(c.verify_token)
        return decrypted === token
      } catch {
        return false
      }
    })

    if (matchedConfig) {
      if (isLegacyFormat(matchedConfig.verify_token)) {
        const verifyToken = decrypt(matchedConfig.verify_token)
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error: upgradeErr }: { error: unknown }) => {
            if (upgradeErr) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (upgradeErr as { message?: string })?.message ?? upgradeErr
              )
            }
          })
      }
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages & status updates into durable queue
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = (body.entry as any[]) || []
  const allNormalizedEvents: NormalizedInboundEvent[] = []

  for (const entry of entries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = (entry.changes as any[]) || []
    for (const change of changes) {
      // Template lifecycle updates are handled inline
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value },
          supabaseAdmin()
        )
        continue
      }

      const value = change.value || {}
      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) continue

      // Resolve tenant strictly by phone_number_id
      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('account_id, user_id')
        .eq('phone_number_id', phoneNumberId)

      if (configError || !configRows || configRows.length === 0) {
        console.error('No valid config found for phone_number_id:', phoneNumberId, configError?.message)
        continue
      }

      if (configRows.length > 1) {
        console.error(`Multiple configs found for phone_number_id: ${phoneNumberId} — dropping event`)
        continue
      }

      const config = configRows[0]
      const events = normalizeMetaInbound({ entry: [entry] }, config.account_id)
      allNormalizedEvents.push(...events)
    }
  }

  if (allNormalizedEvents.length > 0) {
    try {
      // 1. Atomic Durable Enqueue: All events in the batch are persisted or none are acknowledged
      await enqueueWhatsAppInboundEvents(allNormalizedEvents, { db: supabaseAdmin() })
    } catch (enqueueErr) {
      console.error('[webhook] Critical: Failed to enqueue inbound events to durable queue:', enqueueErr)
      return NextResponse.json(
        { error: 'Queue persistence failed' },
        { status: 500 }
      )
    }

    // 2. Best-effort latency accelerator: trigger immediate batch drainage in background
    after(async () => {
      try {
        await processWhatsAppInboundBatch()
      } catch (drainErr) {
        console.warn('[webhook] after() accelerator encountered an error (queue remains durable):', drainErr)
      }
    })
  }

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
