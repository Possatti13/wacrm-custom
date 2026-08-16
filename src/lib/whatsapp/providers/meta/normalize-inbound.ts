import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import type {
  NormalizedInboundEvent,
  NormalizedInboundMessageEvent,
  NormalizedInboundStatusEvent,
  NormalizedInboundReactionEvent,
  InboundDeliveryStatus,
} from '../../inbound/types'

export function normalizeMetaInbound(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  accountId: string
): NormalizedInboundEvent[] {
  const events: NormalizedInboundEvent[] = []

  if (!payload || !Array.isArray(payload.entry)) {
    return [
      {
        type: 'unknown',
        provider: 'meta',
        accountId,
        rawPayload: payload,
      },
    ]
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      const value = change.value || {}
      const contacts = value.contacts || []
      const contactNameMap = new Map<string, string>()

      for (const c of contacts) {
        if (c.wa_id && c.profile?.name) {
          contactNameMap.set(c.wa_id, c.profile.name)
        }
      }

      // 1. Process Messages
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) {
          const rawFrom = msg.from || ''
          const phone = normalizePhone(rawFrom)
          const senderName = contactNameMap.get(rawFrom) || 'WhatsApp Contact'
          const timestamp = Number(msg.timestamp) || Math.floor(Date.now() / 1000)
          const messageId = msg.id || `meta-${Date.now()}`

          if (msg.type === 'reaction' && msg.reaction) {
            const reactionEvent: NormalizedInboundReactionEvent = {
              type: 'reaction',
              provider: 'meta',
              accountId,
              fromPhone: phone,
              targetExternalMessageId: msg.reaction.message_id || '',
              emoji: msg.reaction.emoji || '',
              timestamp,
              rawPayload: msg,
            }
            events.push(reactionEvent)
            continue
          }

          let contentType: NormalizedInboundMessageEvent['content']['type'] = 'text'
          let text = ''
          let mediaUrl: string | null = null
          let mimeType: string | null = null
          let fileName: string | null = null
          let interactiveReply: NormalizedInboundMessageEvent['content']['interactiveReply'] | undefined

          if (msg.type === 'text' && msg.text) {
            contentType = 'text'
            text = msg.text.body || ''
          } else if (msg.type === 'image' && msg.image) {
            contentType = 'image'
            text = msg.image.caption || ''
            mimeType = msg.image.mime_type || 'image/jpeg'
            mediaUrl = msg.image.id ? `/api/whatsapp/media/${msg.image.id}` : null
          } else if (msg.type === 'video' && msg.video) {
            contentType = 'video'
            text = msg.video.caption || ''
            mimeType = msg.video.mime_type || 'video/mp4'
            mediaUrl = msg.video.id ? `/api/whatsapp/media/${msg.video.id}` : null
          } else if (msg.type === 'audio' && msg.audio) {
            contentType = 'audio'
            mimeType = msg.audio.mime_type || 'audio/ogg'
            mediaUrl = msg.audio.id ? `/api/whatsapp/media/${msg.audio.id}` : null
          } else if (msg.type === 'document' && msg.document) {
            contentType = 'document'
            text = msg.document.caption || ''
            fileName = msg.document.filename || 'document'
            mimeType = msg.document.mime_type || 'application/pdf'
            mediaUrl = msg.document.id ? `/api/whatsapp/media/${msg.document.id}` : null
          } else if (msg.type === 'interactive' && msg.interactive) {
            contentType = 'interactive'
            if (msg.interactive.type === 'button_reply' && msg.interactive.button_reply) {
              text = msg.interactive.button_reply.title || ''
              interactiveReply = {
                id: msg.interactive.button_reply.id || '',
                title: msg.interactive.button_reply.title || '',
                type: 'button',
              }
            } else if (msg.interactive.type === 'list_reply' && msg.interactive.list_reply) {
              text = msg.interactive.list_reply.title || ''
              interactiveReply = {
                id: msg.interactive.list_reply.id || '',
                title: msg.interactive.list_reply.title || '',
                type: 'list',
              }
            }
          } else if (msg.type === 'button' && msg.button) {
            contentType = 'interactive'
            text = msg.button.text || ''
            interactiveReply = {
              id: msg.button.payload || '',
              title: msg.button.text || '',
              type: 'button',
            }
          } else if (msg.type === 'location' && msg.location) {
            contentType = 'location'
            text = msg.location.name || `${msg.location.latitude}, ${msg.location.longitude}`
          } else {
            contentType = 'unknown'
            text = ''
          }

          const messageEvent: NormalizedInboundMessageEvent = {
            type: 'message',
            provider: 'meta',
            accountId,
            externalMessageId: messageId,
            fromPhone: phone,
            senderName,
            timestamp,
            fromMe: false,
            content: {
              type: contentType,
              text,
              mediaUrl,
              mimeType,
              fileName,
              interactiveReply,
            },
            rawPayload: msg,
          }

          events.push(messageEvent)
        }
      }

      // 2. Process Statuses (sent / delivered / read / failed)
      if (Array.isArray(value.statuses)) {
        for (const statusObj of value.statuses) {
          const rawStatus = (statusObj.status || '').toLowerCase()
          let deliveryStatus: InboundDeliveryStatus = 'sent'

          if (rawStatus === 'delivered') deliveryStatus = 'delivered'
          else if (rawStatus === 'read') deliveryStatus = 'read'
          else if (rawStatus === 'failed') deliveryStatus = 'failed'
          else deliveryStatus = 'sent'

          const statusEvent: NormalizedInboundStatusEvent = {
            type: 'status',
            provider: 'meta',
            accountId,
            externalMessageId: statusObj.id || '',
            recipientPhone: statusObj.recipient_id ? normalizePhone(statusObj.recipient_id) : undefined,
            status: deliveryStatus,
            timestamp: Number(statusObj.timestamp) || Math.floor(Date.now() / 1000),
            error: statusObj.errors?.[0] ? {
              code: statusObj.errors[0].code,
              message: statusObj.errors[0].message || statusObj.errors[0].title,
            } : undefined,
            rawPayload: statusObj,
          }

          events.push(statusEvent)
        }
      }
    }
  }

  return events.length > 0 ? events : [{ type: 'unknown', provider: 'meta', accountId, rawPayload: payload }]
}
