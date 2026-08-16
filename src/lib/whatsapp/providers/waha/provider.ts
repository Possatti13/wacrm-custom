import {
  sendWahaTextMessage,
  sendWahaMediaMessage,
  getWahaSession,
  startWahaSession,
  type WahaConfig,
} from '@/lib/whatsapp/waha-api'
import type {
  WhatsAppProvider,
  SessionCapableProvider,
  WhatsAppProviderCapabilities,
  WhatsAppProviderStatus,
  WhatsAppNormalizedStatus,
  WhatsAppSendResult,
  SendTextOptions,
  SendMediaOptions,
} from '../types'

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export class WahaProvider implements WhatsAppProvider, SessionCapableProvider {
  readonly type = 'waha' as const

  constructor(private config: WahaConfig) {
    if (!config.baseUrl) throw new Error('WahaProvider requires baseUrl')
    if (!config.session) throw new Error('WahaProvider requires session name')
  }

  getCapabilities(): WhatsAppProviderCapabilities {
    return {
      sendText: true,
      sendImage: true,
      sendDocument: true,
      sendAudio: true,
      sendVideo: true,
      templates: false,
      interactiveMessages: false,
      reactions: false,
      qrCode: true,
      sessionLifecycle: true,
    }
  }

  async sendText(options: SendTextOptions): Promise<WhatsAppSendResult> {
    const res = await sendWahaTextMessage(this.config, options.to, options.text)

    return {
      provider: 'waha',
      externalMessageId: typeof res === 'string' ? res : (res as { id?: string })?.id || `waha-${Date.now()}`,
      status: 'sent',
      raw: res,
    }
  }

  async sendMedia(options: SendMediaOptions): Promise<WhatsAppSendResult> {
    const kind = options.mediaType === 'document' ? 'document' : 'image'
    const res = await sendWahaMediaMessage(this.config, options.to, {
      kind,
      mediaUrl: options.mediaUrl,
      caption: options.caption,
      filename: options.fileName,
    })

    return {
      provider: 'waha',
      externalMessageId: typeof res === 'string' ? res : (res as { id?: string })?.id || `waha-${Date.now()}`,
      status: 'sent',
      raw: res,
    }
  }

  async getStatus(): Promise<WhatsAppProviderStatus> {
    const now = new Date().toISOString()
    try {
      const session = await getWahaSession(this.config)
      const rawStatusUpper = (session?.status || '').toUpperCase()

      let normalizedStatus: WhatsAppNormalizedStatus = 'unknown'
      let isConnected = false

      if (rawStatusUpper === 'WORKING') {
        normalizedStatus = 'connected'
        isConnected = true
      } else if (rawStatusUpper === 'SCAN_QR_CODE' || rawStatusUpper === 'STARTING') {
        normalizedStatus = 'connecting'
      } else if (rawStatusUpper === 'STOPPED') {
        normalizedStatus = 'disconnected'
      } else if (rawStatusUpper === 'FAILED') {
        normalizedStatus = 'degraded'
      }

      const phone = session?.me?.id ? session.me.id.replace(/@.+$/, '') : null

      return {
        status: normalizedStatus,
        connected: isConnected,
        phoneNumber: phone,
        sessionName: this.config.session,
        rawStatus: session,
        lastCheckedAt: now,
      }
    } catch (err) {
      return {
        status: 'disconnected',
        connected: false,
        sessionName: this.config.session,
        rawStatus: err instanceof Error ? { error: err.message } : err,
        lastCheckedAt: now,
      }
    }
  }

  async getQrCode(): Promise<{ qr?: string; status: string; raw?: unknown }> {
    const url = `${cleanBaseUrl(this.config.baseUrl)}/api/${encodeURIComponent(this.config.session)}/auth/qr`
    const res = await fetch(url, {
      headers: { 'X-Api-Key': this.config.apiKey },
      cache: 'no-store',
    })

    if (!res.ok) {
      return { status: 'qr_unavailable' }
    }

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = await res.json()
      return { qr: data.value, status: 'qr_ready', raw: data }
    }

    return { status: 'qr_ready' }
  }

  async restartSession(): Promise<{ status: string; raw?: unknown }> {
    const res = await startWahaSession(this.config)
    return { status: 'restarted', raw: res }
  }

  async logoutSession(): Promise<{ status: string; raw?: unknown }> {
    const url = `${cleanBaseUrl(this.config.baseUrl)}/api/sessions/${encodeURIComponent(this.config.session)}/logout`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Api-Key': this.config.apiKey,
        'Content-Type': 'application/json',
      },
    })
    const data = await res.json().catch(() => null)
    return { status: 'logged_out', raw: data }
  }
}
