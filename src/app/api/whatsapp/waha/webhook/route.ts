import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyWahaWebhookSignature } from '@/lib/whatsapp/waha-signature'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

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

type WahaWebhookBody = {
  event?: string
  session?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function inferContentType(payload: Record<string, unknown>, data: Record<string, unknown>) {
  const type = [
    str(payload.type),
    str(data.type),
    str(payload.mediaType),
    str(data.mediaType),
    str(payload.mimetype),
    str(data.mimetype),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (type.includes('image')) return 'image'
  if (type.includes('pdf') || type.includes('document') || type.includes('application/')) return 'document'
  if (type.includes('video')) return 'video'
  if (type.includes('audio') || type.includes('ptt')) return 'audio'
  return 'text'
}

function extractMediaUrl(payload: Record<string, unknown>, data: Record<string, unknown>): string | null {
  const file = asRecord(payload.file ?? data.file)
  const media = asRecord(payload.media ?? data.media)
  return (
    str(payload.mediaUrl) ??
    str(data.mediaUrl) ??
    str(payload.downloadUrl) ??
    str(data.downloadUrl) ??
    str(payload.url) ??
    str(data.url) ??
    str(file.url) ??
    str(media.url) ??
    null
  )
}

function extractMessage(body: WahaWebhookBody) {
  const payload = asRecord(body.payload ?? body)
  const data = asRecord(payload._data)
  const idObj = asRecord(data.id)

  const fromMe = Boolean(payload.fromMe ?? data.fromMe ?? idObj.fromMe)
  const rawFrom =
    str(payload.from) ??
    str(data.from) ??
    str(idObj.remote) ??
    str(payload.chatId) ??
    str(data.chatId)

  const messageId =
    str(payload.id) ??
    str(data.id) ??
    str(idObj._serialized) ??
    str(idObj.id) ??
    `waha-${Date.now()}`

  const text =
    str(payload.body) ??
    str(data.body) ??
    str(payload.text) ??
    str(data.caption) ??
    ''

  const mediaUrl = extractMediaUrl(payload, data)
  const contentType = mediaUrl ? inferContentType(payload, data) : 'text'

  const timestampRaw = payload.timestamp ?? data.t ?? payload.t
  const timestamp =
    typeof timestampRaw === 'number'
      ? timestampRaw
      : typeof timestampRaw === 'string'
        ? Number(timestampRaw)
        : Math.floor(Date.now() / 1000)

  const pushName =
    str(payload.pushName) ??
    str(data.notifyName) ??
    str(data.verifiedBizName) ??
    str(data.sender?.toString()) ??
    'WhatsApp Contact'

  return {
    fromMe,
    rawFrom,
    phone: normalizePhone((rawFrom ?? '').replace(/@.+$/, '')),
    messageId,
    text,
    contentType,
    mediaUrl,
    timestamp: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
    pushName,
  }
}

async function findOrCreateContact(
  accountId: string,
  userId: string,
  phone: string,
  name: string
) {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone)
  if (existing) return { contact: existing, wasCreated: false }

  const { data, error } = await supabaseAdmin()
    .from('contacts')
    .insert({ account_id: accountId, user_id: userId, phone, name })
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[waha-webhook] contact insert failed:', error.message)
    return null
  }
  return { contact: data, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  userId: string,
  contactId: string
) {
  const { data: existing, error: existingError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (existingError) {
    console.error('[waha-webhook] conversation lookup failed:', existingError.message)
    return null
  }
  if (existing && existing.length > 0) return existing[0]

  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('*')
    .single()

  if (error) {
    console.error('[waha-webhook] conversation insert failed:', error.message)
    return null
  }
  return data
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  let body: WahaWebhookBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = body.event ?? ''
  // WAHA can emit either `message` or `message.any` depending on engine/version.
  // Process both; the duplicate guard below keys by message_id so receiving both
  // events for the same WhatsApp message is harmless.
  if (event && event !== 'message' && event !== 'message.any') {
    return NextResponse.json({ status: 'ignored', event })
  }

  const sessionName = str(body.session) ?? str(asRecord(body.payload).session)
  if (!sessionName) {
    return NextResponse.json({ error: 'Missing WAHA session' }, { status: 400 })
  }

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

  const msg = extractMessage(body)
  if (msg.fromMe) return NextResponse.json({ status: 'ignored', reason: 'fromMe' })
  if (!msg.phone) return NextResponse.json({ status: 'ignored', reason: 'no_phone' })

  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    msg.phone,
    msg.pushName
  )
  if (!contactOutcome) return NextResponse.json({ error: 'contact_failed' }, { status: 500 })

  const conversation = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactOutcome.contact.id
  )
  if (!conversation) return NextResponse.json({ error: 'conversation_failed' }, { status: 500 })

  const { data: priorCustomerMessages } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .limit(1)

  const isFirstInboundMessage = !priorCustomerMessages || priorCustomerMessages.length === 0

  const { data: existingMessage, error: existingMessageError } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('message_id', msg.messageId)
    .limit(1)

  if (existingMessageError) {
    console.error('[waha-webhook] duplicate message lookup failed:', existingMessageError.message)
  } else if (existingMessage && existingMessage.length > 0) {
    return NextResponse.json({ status: 'duplicate' })
  }

  const { error: insertError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: msg.contentType,
    content_text: msg.text,
    media_url: msg.mediaUrl,
    message_id: msg.messageId,
    status: 'delivered',
    created_at: new Date(msg.timestamp * 1000).toISOString(),
  })

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      return NextResponse.json({ status: 'duplicate' })
    }
    console.error('[waha-webhook] message insert failed:', insertError.message)
    return NextResponse.json({ error: 'message_failed' }, { status: 500 })
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: msg.text || '[message]',
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = ['new_message_received', 'keyword_match']

  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId: config.account_id,
      triggerType,
      contactId: contactOutcome.contact.id,
      context: {
        message_text: msg.text,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[waha-webhook] automation dispatch failed:', err))
  }

  if (msg.text.trim()) {
    await dispatchInboundToAiReply({
      accountId: config.account_id,
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
      configOwnerUserId: config.user_id,
    })
  }

  return NextResponse.json({ status: 'received' })
}
