import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import { normalizeMetaInbound } from '@/lib/whatsapp/providers/meta/normalize-inbound'
import { processNormalizedInboundEvent } from '@/lib/whatsapp/inbound/processor'
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

// POST - Receive messages & status updates
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

  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('Error processing Meta webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = (body.entry as any[]) || []
  if (entries.length === 0) return

  for (const entry of entries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = (entry.changes as any[]) || []
    for (const change of changes) {
      // Template lifecycle updates
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
        .select('*')
        .eq('phone_number_id', phoneNumberId)

      if (configError) {
        console.error('Error fetching whatsapp_config for phone_number_id:', phoneNumberId, configError)
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      if (configRows.length > 1) {
        console.error(`Multiple configs found for phone_number_id: ${phoneNumberId} — dropping event`)
        continue
      }

      const config = configRows[0]

      // 1. Normalize events from this entry
      const normalizedEvents = normalizeMetaInbound({ entry: [entry] }, config.account_id)

      // 2. Dispatch each normalized event
      for (const event of normalizedEvents) {
        await dispatchNormalizedMetaEvent(event, config)
      }
    }
  }
}

async function dispatchNormalizedMetaEvent(
  event: NormalizedInboundEvent,
  config: { account_id: string; user_id: string }
) {
  if (event.type === 'status') {
    await handleStatusUpdate(event)
    return
  }

  if (event.type === 'reaction') {
    await handleReaction(event)
    return
  }

  if (event.type === 'message') {
    const result = await processNormalizedInboundEvent({
      event,
      db: supabaseAdmin(),
      userId: config.user_id,
    })

    if (result.processed && result.contactId) {
      await flagBroadcastReplyIfAny(config.account_id, result.contactId)
    }
  }
}

const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

async function handleStatusUpdate(status: {
  externalMessageId: string
  status: string
  timestamp?: number
}) {
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.externalMessageId)

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  const tsIso = status.timestamp
    ? new Date(status.timestamp * 1000).toISOString()
    : new Date().toISOString()

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.externalMessageId)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
  } else if (recipient && isValidStatusTransition(recipient.status, status.status)) {
    const update: Record<string, unknown> = { status: status.status }
    if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
    if (status.status === 'delivered') update.delivered_at = tsIso
    if (status.status === 'read') update.read_at = tsIso

    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr)
    }
  }

  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.externalMessageId)
    .limit(1)
    .maybeSingle()

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null
    const accountId = conv?.account_id
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: status.externalMessageId,
          conversation_id: msgRow.conversation_id,
          status: status.status,
        }
      )
    }
  }
}

async function handleReaction(reaction: {
  targetExternalMessageId?: string
  emoji?: string
  fromPhone?: string
  accountId: string
}) {
  if (!reaction.targetExternalMessageId) return

  const { data: targetMessage } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id, conversations!inner(contact_id, account_id)')
    .eq('message_id', reaction.targetExternalMessageId)
    .eq('conversations.account_id', reaction.accountId)
    .maybeSingle()

  if (!targetMessage) {
    console.warn('[webhook] reaction target message not found:', reaction.targetExternalMessageId)
    return
  }

  const contactId = (targetMessage.conversations as { contact_id: string })?.contact_id
  if (!contactId) return

  if (!reaction.emoji) {
    await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetMessage.id)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    return
  }

  await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetMessage.id,
        conversation_id: targetMessage.conversation_id,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}
