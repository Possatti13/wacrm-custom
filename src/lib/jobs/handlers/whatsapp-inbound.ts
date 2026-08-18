import type { SupabaseClient } from '@supabase/supabase-js'
import { processNormalizedInboundEvent } from '@/lib/whatsapp/inbound/processor'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { WhatsAppInboundJobEnvelope } from '../types'
import type {
  NormalizedInboundStatusEvent,
  NormalizedInboundReactionEvent,
} from '@/lib/whatsapp/inbound/types'

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

export function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on ladder
  return ii > ci // monotonic forward-only transition
}

export async function handleWhatsAppInboundJob(
  envelope: WhatsAppInboundJobEnvelope,
  db: SupabaseClient
): Promise<{ success: boolean; error?: string }> {
  const event = envelope.payload

  if (!event || typeof event !== 'object') {
    return { success: true }
  }

  if (event.type === 'unknown') {
    return { success: true }
  }

  if (event.type === 'message') {
    const result = await processNormalizedInboundEvent({
      event,
      db,
    })

    if (!result.processed) {
      throw new Error(result.error || 'Failed to process normalized inbound message')
    }

    if (result.contactId) {
      await flagBroadcastReplyIfAny(db, event.accountId, result.contactId)
    }

    return { success: true }
  }

  if (event.type === 'status') {
    await handleStatusUpdate(db, event)
    return { success: true }
  }

  if (event.type === 'reaction') {
    await handleReaction(db, event)
    return { success: true }
  }

  return { success: true }
}

async function handleStatusUpdate(
  db: SupabaseClient,
  event: NormalizedInboundStatusEvent
) {
  if (!event.externalMessageId) return

  // 1. Monotonic status update on messages table
  const { data: currentMsg } = await db
    .from('messages')
    .select('id, status, conversation_id, conversations(account_id)')
    .eq('message_id', event.externalMessageId)
    .maybeSingle()

  if (currentMsg) {
    if (isValidStatusTransition(currentMsg.status, event.status)) {
      await db
        .from('messages')
        .update({ status: event.status })
        .eq('id', currentMsg.id)
    }

    const conv = (currentMsg.conversations as unknown) as { account_id: string } | null
    const accountId = conv?.account_id || event.accountId
    if (accountId) {
      await dispatchWebhookEvent(
        db,
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: event.externalMessageId,
          conversation_id: currentMsg.conversation_id,
          status: event.status,
        }
      )
    }
  }

  // 2. Monotonic status update on broadcast_recipients table
  const tsIso = event.timestamp
    ? new Date(event.timestamp * 1000).toISOString()
    : new Date().toISOString()

  const { data: recipient, error: recFetchErr } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', event.externalMessageId)
    .maybeSingle()

  if (!recFetchErr && recipient && isValidStatusTransition(recipient.status, event.status)) {
    const update: Record<string, unknown> = { status: event.status }
    if (event.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
    if (event.status === 'delivered') update.delivered_at = tsIso
    if (event.status === 'read') update.read_at = tsIso

    await db
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)
  }
}

async function handleReaction(
  db: SupabaseClient,
  event: NormalizedInboundReactionEvent
) {
  if (!event.targetExternalMessageId) return

  const { data: targetMessage } = await db
    .from('messages')
    .select('id, conversation_id, conversations!inner(contact_id, account_id)')
    .eq('message_id', event.targetExternalMessageId)
    .eq('conversations.account_id', event.accountId)
    .maybeSingle()

  if (!targetMessage) {
    console.warn('[job-handler] reaction target message not found:', event.targetExternalMessageId)
    return
  }

  const contactId = ((targetMessage.conversations as unknown) as { contact_id: string })?.contact_id
  if (!contactId) return

  if (!event.emoji) {
    // Empty emoji = removal
    await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetMessage.id)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    return
  }

  // Idempotent upsert
  await db
    .from('message_reactions')
    .upsert(
      {
        message_id: targetMessage.id,
        conversation_id: targetMessage.conversation_id,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: event.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
}

async function flagBroadcastReplyIfAny(
  db: SupabaseClient,
  accountId: string,
  contactId: string
) {
  try {
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
  } catch (err) {
    console.error('[job-handler] flagBroadcastReplyIfAny failed:', err)
  }
}
