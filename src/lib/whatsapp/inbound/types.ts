import type { WhatsAppProviderType } from '../providers/types'

export type InboundEventType = 'message' | 'status' | 'reaction' | 'unknown'

export type InboundMessageContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'interactive'
  | 'template'
  | 'unknown'

export interface InboundMessageContent {
  type: InboundMessageContentType
  text: string
  mediaUrl?: string | null
  mimeType?: string | null
  fileName?: string | null
  location?: {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
  interactiveReply?: {
    id: string
    title: string
    type: 'button' | 'list'
  }
}

export interface NormalizedInboundMessageEvent {
  type: 'message'
  provider: WhatsAppProviderType
  accountId: string
  externalMessageId: string
  externalChatId?: string
  fromPhone: string
  toPhone?: string
  senderName: string
  timestamp: number // unix epoch in seconds
  fromMe: boolean
  content: InboundMessageContent
  rawPayload?: unknown
}

export type InboundDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface NormalizedInboundStatusEvent {
  type: 'status'
  provider: WhatsAppProviderType
  accountId: string
  externalMessageId: string
  recipientPhone?: string
  status: InboundDeliveryStatus
  timestamp: number
  error?: {
    code?: string | number
    message?: string
  }
  rawPayload?: unknown
}

export interface NormalizedInboundReactionEvent {
  type: 'reaction'
  provider: WhatsAppProviderType
  accountId: string
  fromPhone: string
  targetExternalMessageId: string
  emoji: string
  timestamp: number
  rawPayload?: unknown
}

export interface NormalizedInboundUnknownEvent {
  type: 'unknown'
  provider: WhatsAppProviderType
  accountId: string
  rawEventType?: string
  rawPayload?: unknown
}

export type NormalizedInboundEvent =
  | NormalizedInboundMessageEvent
  | NormalizedInboundStatusEvent
  | NormalizedInboundReactionEvent
  | NormalizedInboundUnknownEvent
