import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendReactionMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import type {
  WhatsAppProvider,
  TemplateCapableProvider,
  InteractiveCapableProvider,
  ReactionCapableProvider,
  WhatsAppProviderCapabilities,
  WhatsAppProviderStatus,
  WhatsAppSendResult,
  SendTextOptions,
  SendMediaOptions,
  SendTemplateOptions,
  SendReactionOptions,
  SendInteractiveOptions,
} from '../types'

export interface MetaCloudProviderConfig {
  phoneNumberId: string
  accessToken: string
  wabaId?: string | null
}

export class MetaCloudProvider
  implements
    WhatsAppProvider,
    TemplateCapableProvider,
    InteractiveCapableProvider,
    ReactionCapableProvider
{
  readonly type = 'meta' as const

  constructor(private config: MetaCloudProviderConfig) {
    if (!config.phoneNumberId) throw new Error('MetaCloudProvider requires phoneNumberId')
    if (!config.accessToken) throw new Error('MetaCloudProvider requires accessToken')
  }

  getCapabilities(): WhatsAppProviderCapabilities {
    return {
      sendText: true,
      sendImage: true,
      sendDocument: true,
      sendAudio: true,
      sendVideo: true,
      templates: true,
      interactiveMessages: true,
      reactions: true,
      qrCode: false,
      sessionLifecycle: false,
    }
  }

  async sendText(options: SendTextOptions): Promise<WhatsAppSendResult> {
    const res = await sendTextMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: options.to,
      text: options.text,
    })

    return {
      provider: 'meta',
      externalMessageId: res.messageId,
      status: 'sent',
      raw: res,
    }
  }

  async sendMedia(options: SendMediaOptions): Promise<WhatsAppSendResult> {
    const res = await sendMediaMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: options.to,
      kind: options.mediaType,
      link: options.mediaUrl,
      caption: options.caption,
      filename: options.fileName,
    })

    return {
      provider: 'meta',
      externalMessageId: res.messageId,
      status: 'sent',
      raw: res,
    }
  }

  async sendTemplate(options: SendTemplateOptions): Promise<WhatsAppSendResult> {
    const res = await sendTemplateMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: options.to,
      templateName: options.templateName,
      language: options.language,
      params: options.bodyParams || [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messageParams: options.components as any,
    })

    return {
      provider: 'meta',
      externalMessageId: res.messageId,
      status: 'sent',
      raw: res,
    }
  }

  async sendReaction(options: SendReactionOptions): Promise<WhatsAppSendResult> {
    const res = await sendReactionMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: options.to,
      targetMessageId: options.messageId,
      emoji: options.emoji,
    })

    return {
      provider: 'meta',
      externalMessageId: res.messageId,
      status: 'sent',
      raw: res,
    }
  }

  async sendInteractive(options: SendInteractiveOptions): Promise<WhatsAppSendResult> {
    let res: { messageId: string }
    if (options.type === 'button') {
      res = await sendInteractiveButtons({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to: options.to,
        bodyText: options.bodyText,
        buttons: (options.buttons ?? []).map((b) => ({ id: b.id, title: b.title })),
        headerText: options.headerText,
        footerText: options.footerText,
      })
    } else {
      res = await sendInteractiveList({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to: options.to,
        bodyText: options.bodyText,
        buttonLabel: 'Options',
        sections: (options.sections ?? []).map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
        })),
        headerText: options.headerText,
        footerText: options.footerText,
      })
    }

    return {
      provider: 'meta',
      externalMessageId: res.messageId,
      status: 'sent',
      raw: res,
    }
  }

  async getStatus(): Promise<WhatsAppProviderStatus> {
    const now = new Date().toISOString()
    try {
      const info = await verifyPhoneNumber({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
      })

      return {
        status: 'connected',
        connected: true,
        phoneNumber: info.display_phone_number,
        rawStatus: info,
        lastCheckedAt: now,
      }
    } catch (err) {
      return {
        status: 'disconnected',
        connected: false,
        rawStatus: err instanceof Error ? { error: err.message } : err,
        lastCheckedAt: now,
      }
    }
  }
}
