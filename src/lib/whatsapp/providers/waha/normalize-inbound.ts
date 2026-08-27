import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import type {
  NormalizedInboundEvent,
  NormalizedInboundMessageEvent,
  NormalizedInboundStatusEvent,
  NormalizedInboundReactionEvent,
  InboundMessageContentType,
  InboundDeliveryStatus,
} from '../../inbound/types'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function inferContentType(payload: Record<string, unknown>, data: Record<string, unknown>): InboundMessageContentType {
  const typeStr = [
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

  if (typeStr.includes('image')) return 'image'
  if (typeStr.includes('pdf') || typeStr.includes('document') || typeStr.includes('application/')) return 'document'
  if (typeStr.includes('video')) return 'video'
  if (typeStr.includes('audio') || typeStr.includes('ptt')) return 'audio'
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

export function normalizeWahaInbound(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  accountId: string
): NormalizedInboundEvent | null {
  if (!body || typeof body !== 'object') {
    return {
      type: 'unknown',
      provider: 'waha',
      accountId,
      rawPayload: body,
    }
  }

  const event = body.event || ''
  const payload = asRecord(body.payload ?? body)
  const data = asRecord(payload._data)
  const idObj = asRecord(data.id)

  // 1. Reaction event
  if (event === 'message.reaction' || payload.reaction) {
    const reactionObj = asRecord(payload.reaction)
    const rawFrom = str(payload.from) ?? str(data.from) ?? str(idObj.remote) ?? ''
    return {
      type: 'reaction',
      provider: 'waha',
      accountId,
      fromPhone: normalizePhone(rawFrom.replace(/@.+$/, '')),
      targetExternalMessageId: str(reactionObj.messageId) ?? str(payload.targetMessageId) ?? '',
      emoji: str(reactionObj.text) ?? str(payload.reaction) ?? '',
      timestamp: Number(payload.timestamp ?? data.t) || Math.floor(Date.now() / 1000),
      rawPayload: body,
    } as NormalizedInboundReactionEvent
  }

  // 2. Status / ACK event
  if (event === 'message.ack' || typeof payload.ack === 'number') {
    const ack = Number(payload.ack)
    let status: InboundDeliveryStatus = 'sent'
    if (ack === 2) status = 'delivered'
    else if (ack === 3) status = 'read'
    else if (ack < 0) status = 'failed'

    return {
      type: 'status',
      provider: 'waha',
      accountId,
      externalMessageId: str(payload.id) ?? str(idObj._serialized) ?? `waha-ack-${Date.now()}`,
      recipientPhone: normalizePhone(str(payload.to)?.replace(/@.+$/, '') ?? ''),
      status,
      timestamp: Number(payload.timestamp ?? data.t) || Math.floor(Date.now() / 1000),
      rawPayload: body,
    } as NormalizedInboundStatusEvent
  }

  // 3. Message event
  if (event === 'message' || event === 'message.any' || !event) {
    const fromMe = Boolean(payload.fromMe ?? data.fromMe ?? idObj.fromMe)
    const rawContactId = fromMe
      ? (str(idObj.remote) ?? str(payload.chatId) ?? str(data.chatId) ?? str(payload.to) ?? str(data.to) ?? str(payload.from) ?? str(data.from) ?? '')
      : (str(payload.from) ?? str(data.from) ?? str(idObj.remote) ?? str(payload.chatId) ?? str(data.chatId) ?? '')

    const phone = normalizePhone(rawContactId.replace(/@.+$/, ''))
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

    const senderName =
      str(payload.pushName) ??
      str(data.notifyName) ??
      str(data.verifiedBizName) ??
      str(data.sender?.toString()) ??
      'WhatsApp Contact'

    const messageEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId,
      externalMessageId: messageId,
      externalChatId: rawContactId,
      fromPhone: phone,
      senderName,
      timestamp: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
      fromMe,
      content: {
        type: contentType,
        text,
        mediaUrl,
      },
      rawPayload: body,
    }

    return messageEvent
  }

  return {
    type: 'unknown',
    provider: 'waha',
    accountId,
    rawEventType: event,
    rawPayload: body,
  }
}
