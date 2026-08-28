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
  if (event === 'message.reaction' || (!event && Boolean(payload.reaction))) {
    const reactionObj = asRecord(payload.reaction)
    const rawFrom = str(payload.from) ?? str(data.from) ?? str(idObj.remote) ?? ''
    const isLid = rawFrom.endsWith('@lid')
    return {
      type: 'reaction',
      provider: 'waha',
      accountId,
      fromPhone: isLid ? '' : normalizePhone(rawFrom.replace(/@.+$/, '')),
      lid: isLid ? rawFrom : undefined,
      targetExternalMessageId: str(reactionObj.messageId) ?? str(payload.targetMessageId) ?? '',
      emoji: str(reactionObj.text) ?? str(payload.reaction) ?? '',
      timestamp: Number(payload.timestamp ?? data.t) || Math.floor(Date.now() / 1000),
      rawPayload: body,
    } as NormalizedInboundReactionEvent
  }

  // 2. Status / ACK event (ONLY explicit message.ack / message.status events)
  // ack / ackName exist inside standard message payloads (e.g. ack: 1, ackName: "SERVER")
  // and MUST NOT cause message events to be normalized as status.
  if (
    event === 'message.ack' ||
    event === 'message.status' ||
    (!event && typeof payload.ack === 'number' && !payload.body && !payload.fromMe && !payload.from)
  ) {
    const ack = Number(payload.ack)
    let status: InboundDeliveryStatus = 'sent'
    if (ack === 2) status = 'delivered'
    else if (ack === 3) status = 'read'
    else if (ack < 0) status = 'failed'

    const rawTo = str(payload.to) ?? str(data.to) ?? ''
    const isLid = rawTo.endsWith('@lid')

    return {
      type: 'status',
      provider: 'waha',
      accountId,
      externalMessageId: str(payload.id) ?? str(idObj._serialized) ?? `waha-ack-${Date.now()}`,
      recipientPhone: isLid ? '' : normalizePhone(rawTo.replace(/@.+$/, '')),
      lid: isLid ? rawTo : undefined,
      status,
      timestamp: Number(payload.timestamp ?? data.t) || Math.floor(Date.now() / 1000),
      rawPayload: body,
    } as NormalizedInboundStatusEvent
  }

  // 3. Message event (event === 'message' || event === 'message.any' || !event / fallback)
  if (event === 'message' || event === 'message.any' || !event || event.startsWith('message.')) {
    const fromMe = Boolean(payload.fromMe ?? data.fromMe ?? idObj.fromMe)
    const rawContactId = fromMe
      ? (str(idObj.remote) ?? str(payload.chatId) ?? str(data.chatId) ?? str(payload.to) ?? str(data.to) ?? str(payload.from) ?? str(data.from) ?? '')
      : (str(payload.from) ?? str(data.from) ?? str(idObj.remote) ?? str(payload.chatId) ?? str(data.chatId) ?? '')

    const isLid = rawContactId.endsWith('@lid')
    const lid = isLid ? rawContactId : undefined

    // 1:1 message invariant: exclude groups, broadcasts, channels, and status updates
    const lowerContact = rawContactId.toLowerCase()
    if (
      lowerContact.endsWith('@g.us') ||
      lowerContact.endsWith('@broadcast') ||
      lowerContact.endsWith('@newsletter') ||
      lowerContact.includes('status@')
    ) {
      return null
    }

    const phone = isLid ? '' : normalizePhone(rawContactId.replace(/@.+$/, ''))

    const rawToId = fromMe
      ? (str(payload.from) ?? str(data.from) ?? '')
      : (str(payload.to) ?? str(data.to) ?? '')
    const toPhone = rawToId.endsWith('@lid') ? '' : normalizePhone(rawToId.replace(/@.+$/, ''))

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
      (fromMe ? 'Agent' : 'WhatsApp Contact')

    const messageEvent: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId,
      externalMessageId: messageId,
      externalChatId: rawContactId,
      fromPhone: phone,
      toPhone: toPhone || undefined,
      lid,
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
