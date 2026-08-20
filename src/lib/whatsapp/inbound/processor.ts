import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import type { NormalizedInboundEvent, NormalizedInboundMessageEvent } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function getDefaultAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export interface ProcessInboundResult {
  processed: boolean
  duplicate?: boolean
  messageId?: string
  conversationId?: string
  contactId?: string
  error?: string
}

export interface InboundProcessorOptions {
  event: NormalizedInboundEvent
  db?: SupabaseClient
  userId?: string | null
}

export async function processNormalizedInboundEvent(
  options: InboundProcessorOptions
): Promise<ProcessInboundResult> {
  const { event } = options
  const db = options.db || getDefaultAdminClient()

  if (event.type === 'unknown') {
    return { processed: true }
  }

  if (event.type === 'status') {
    if (event.externalMessageId) {
      await db
        .from('messages')
        .update({ status: event.status })
        .eq('message_id', event.externalMessageId)
    }
    return { processed: true }
  }

  if (event.type === 'reaction') {
    return { processed: true }
  }

  if (event.type === 'message') {
    return processInboundMessage(event, db, options.userId)
  }

  return { processed: true }
}

async function processInboundMessage(
  event: NormalizedInboundMessageEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  fallbackUserId?: string | null
): Promise<ProcessInboundResult> {
  if (event.fromMe) {
    return { processed: true }
  }

  if (!event.fromPhone) {
    return { processed: false, error: 'missing_from_phone' }
  }

  // 1. Resolve default user_id for tenant if not provided
  let userId: string = fallbackUserId || ''
  if (!userId) {
    const { data: profile } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', event.accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    userId = profile?.user_id || '00000000-0000-0000-0000-000000000000'
  }

  // 2. Find or create Contact strictly within account_id
  const contactOutcome = await findOrCreateContact(
    db,
    event.accountId,
    userId,
    event.fromPhone,
    event.senderName
  )
  if (!contactOutcome || !contactOutcome.contact?.id) {
    return { processed: false, error: 'contact_creation_failed' }
  }
  const contact = contactOutcome.contact

  // 3. Find or create Conversation strictly within account_id + contact_id
  const conversation = await findOrCreateConversation(
    db,
    event.accountId,
    userId,
    contact.id
  )
  if (!conversation || !conversation.id) {
    return { processed: false, error: 'conversation_creation_failed' }
  }

  // 4. Scoped Idempotency Pre-Check (optimization: conversation_id + source_provider + message_id)
  if (event.externalMessageId) {
    const { data: existingMessage } = await db
      .from('messages')
      .select('id, conversation_id')
      .eq('conversation_id', conversation.id)
      .eq('source_provider', event.provider)
      .eq('message_id', event.externalMessageId)
      .maybeSingle()

    if (existingMessage) {
      return {
        processed: true,
        duplicate: true,
        messageId: existingMessage.id,
        conversationId: existingMessage.conversation_id,
        contactId: contact.id,
      }
    }
  }

  // 5. Determine if first inbound message in thread
  const { data: priorCustomerMessages } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .limit(1)

  const isFirstInboundMessage = !priorCustomerMessages || priorCustomerMessages.length === 0

  // 6. Insert message with source_provider
  const { data: insertedMessage, error: insertError } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: event.content.type === 'unknown' ? 'text' : event.content.type,
      content_text: event.content.text || null,
      media_url: event.content.mediaUrl || null,
      message_id: event.externalMessageId || null,
      source_provider: event.provider || null,
      status: 'delivered',
      occurred_at: event.timestamp ? new Date(event.timestamp * 1000).toISOString() : new Date().toISOString(),
    })
    .select('*')
    .single()

  if (insertError) {
    if (
      isUniqueViolation(insertError) ||
      (insertError as { code?: string })?.code === '23505' ||
      insertError.message?.includes('duplicate key') ||
      insertError.message?.includes('uq_messages_conversation_provider_message_id') ||
      insertError.message?.includes('uq_messages_conversation_message_id')
    ) {
      // Atomic deduplication: a concurrent worker inserted the message first
      const { data: racedMessage } = await db
        .from('messages')
        .select('id, conversation_id')
        .eq('conversation_id', conversation.id)
        .eq('source_provider', event.provider)
        .eq('message_id', event.externalMessageId)
        .maybeSingle()

      if (racedMessage) {
        return {
          processed: true,
          duplicate: true,
          messageId: racedMessage.id,
          conversationId: conversation.id,
          contactId: contact.id,
        }
      }
    }

    console.error('[inbound-processor] message insert failed:', insertError.message)
    return { processed: false, error: insertError.message }
  }

  const messageId = insertedMessage?.id || `msg-${Date.now()}`

  // 7. Update conversation unread count & status monotonically
  const messageTimestampIso = event.timestamp
    ? new Date(event.timestamp * 1000).toISOString()
    : new Date().toISOString()

  const previewText = event.content.text || `[${event.content.type}]`

  const { data: currentConv } = await db
    .from('conversations')
    .select('unread_count, last_message_at, status')
    .eq('id', conversation.id)
    .maybeSingle()

  const currentLastMessageAt = currentConv?.last_message_at || conversation.last_message_at
  const currentUnread = currentConv?.unread_count ?? conversation.unread_count ?? 0
  const isMoreRecent = !currentLastMessageAt || messageTimestampIso >= currentLastMessageAt

  const convUpdatePayload: Record<string, unknown> = {
    unread_count: currentUnread + 1,
    status: conversation.status === 'closed' ? 'open' : conversation.status,
  }

  if (isMoreRecent) {
    convUpdatePayload.last_message_at = messageTimestampIso
    convUpdatePayload.last_message_text = previewText
  }

  await db
    .from('conversations')
    .update(convUpdatePayload)
    .eq('id', conversation.id)

  // 8. Trigger Automations hook (Preserved frozen hook)
  try {
    await runAutomationsForTrigger({
      triggerType: 'new_message_received',
      accountId: event.accountId,
      contactId: contact.id,
      context: {
        message_text: event.content.text,
        conversation_id: conversation.id,
        interactive_reply_id: event.content.interactiveReply?.id,
      },
    })

    if (isFirstInboundMessage) {
      await runAutomationsForTrigger({
        triggerType: 'first_inbound_message',
        accountId: event.accountId,
        contactId: contact.id,
        context: {
          message_text: event.content.text,
          conversation_id: conversation.id,
        },
      })
    }
  } catch (err) {
    console.error('[inbound-processor] automation dispatch failed:', err)
  }

  // 9. Trigger AI Auto Reply hook (Preserved frozen hook)
  try {
    await dispatchInboundToAiReply({
      accountId: event.accountId,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId: userId || '00000000-0000-0000-0000-000000000000',
    })
  } catch (err) {
    console.error('[inbound-processor] ai auto reply dispatch failed:', err)
  }

  return {
    processed: true,
    messageId,
    conversationId: conversation.id,
    contactId: contact.id,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateContact(db: any, accountId: string, userId: string, phone: string, name: string) {
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) return { contact: existing, wasCreated: false }

  const { data, error } = await db
    .from('contacts')
    .insert({ account_id: accountId, user_id: userId, phone, name })
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[inbound-processor] contact insert failed:', error.message)
    return null
  }
  return { contact: data, wasCreated: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateConversation(db: any, accountId: string, userId: string, contactId: string) {
  const { data: existing, error: existingError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (existingError) {
    console.error('[inbound-processor] conversation lookup failed:', existingError.message)
    return null
  }
  if (existing && existing.length > 0) return existing[0]

  const { data, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('*')
    .single()

  if (error) {
    console.error('[inbound-processor] conversation insert failed:', error.message)
    return null
  }
  return data
}
