export type WhatsAppProviderType = 'meta' | 'waha'

export type WhatsAppNormalizedStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'degraded'
  | 'unknown'

export interface WhatsAppProviderCapabilities {
  sendText: boolean
  sendImage: boolean
  sendDocument: boolean
  sendAudio: boolean
  sendVideo: boolean
  templates: boolean
  interactiveMessages: boolean
  reactions: boolean
  qrCode: boolean
  sessionLifecycle: boolean
}

export interface WhatsAppProviderStatus {
  status: WhatsAppNormalizedStatus
  connected: boolean
  phoneNumber?: string | null
  sessionName?: string | null
  rawStatus?: unknown
  lastCheckedAt: string
}

export interface WhatsAppSendResult {
  provider: WhatsAppProviderType
  externalMessageId: string
  status?: string
  raw?: unknown
}

export interface SendTextOptions {
  to: string
  text: string
  previewUrl?: boolean
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

export interface SendMediaOptions {
  to: string
  mediaType: MediaKind
  mediaUrl: string
  caption?: string
  fileName?: string
}

export interface SendTemplateOptions {
  to: string
  templateName: string
  language: string
  bodyParams?: string[]
  headerParams?: string[]
  components?: unknown[]
}

export interface SendReactionOptions {
  to: string
  messageId: string
  emoji: string
}

export interface SendInteractiveOptions {
  to: string
  type: 'button' | 'list'
  bodyText: string
  buttons?: Array<{ id: string; title: string }>
  sections?: Array<{
    title?: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>
  headerText?: string
  footerText?: string
}

export interface WhatsAppProvider {
  readonly type: WhatsAppProviderType
  getCapabilities(): WhatsAppProviderCapabilities
  sendText(options: SendTextOptions): Promise<WhatsAppSendResult>
  sendMedia(options: SendMediaOptions): Promise<WhatsAppSendResult>
  getStatus(): Promise<WhatsAppProviderStatus>
}

export interface TemplateCapableProvider extends WhatsAppProvider {
  sendTemplate(options: SendTemplateOptions): Promise<WhatsAppSendResult>
}

export interface InteractiveCapableProvider extends WhatsAppProvider {
  sendInteractive(options: SendInteractiveOptions): Promise<WhatsAppSendResult>
}

export interface ReactionCapableProvider extends WhatsAppProvider {
  sendReaction(options: SendReactionOptions): Promise<WhatsAppSendResult>
}

export interface SessionCapableProvider extends WhatsAppProvider {
  getQrCode(): Promise<{ qr?: string; status: string; raw?: unknown }>
  restartSession(): Promise<{ status: string; raw?: unknown }>
  logoutSession(): Promise<{ status: string; raw?: unknown }>
}

export function isTemplateCapable(provider: WhatsAppProvider): provider is TemplateCapableProvider {
  return provider.getCapabilities().templates && 'sendTemplate' in provider
}

export function isInteractiveCapable(provider: WhatsAppProvider): provider is InteractiveCapableProvider {
  return provider.getCapabilities().interactiveMessages && 'sendInteractive' in provider
}

export function isReactionCapable(provider: WhatsAppProvider): provider is ReactionCapableProvider {
  return provider.getCapabilities().reactions && 'sendReaction' in provider
}

export function isSessionCapable(provider: WhatsAppProvider): provider is SessionCapableProvider {
  return (
    (provider.getCapabilities().qrCode || provider.getCapabilities().sessionLifecycle) &&
    'getQrCode' in provider
  )
}
