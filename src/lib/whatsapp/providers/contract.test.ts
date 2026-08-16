import { describe, expect, it, vi } from 'vitest'
import { MetaCloudProvider } from './meta/provider'
import { WahaProvider } from './waha/provider'
import { getWhatsAppProvider } from './factory'
import type { WhatsAppProvider } from './types'

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'meta-msg-123' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'meta-media-123' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'meta-tpl-123' })),
  sendReactionMessage: vi.fn(async () => ({ messageId: 'meta-react-123' })),
  sendInteractiveButtonsMessage: vi.fn(async () => ({ messageId: 'meta-btn-123' })),
  sendInteractiveListMessage: vi.fn(async () => ({ messageId: 'meta-list-123' })),
  verifyPhoneNumber: vi.fn(async () => ({
    id: 'pn-123',
    display_phone_number: '+55 11 99999-9999',
    verified_name: 'Ziron CRM',
  })),
}))

vi.mock('@/lib/whatsapp/waha-api', () => ({
  sendWahaTextMessage: vi.fn(async () => ({ id: 'waha-msg-123' })),
  sendWahaMediaMessage: vi.fn(async () => ({ id: 'waha-media-123' })),
  getWahaSession: vi.fn(async () => ({
    name: 'wacrm',
    status: 'WORKING',
    me: { id: '5511999999999@c.us', pushName: 'Ziron' },
  })),
  getWahaQrCode: vi.fn(async () => ({ data: 'base64-qr-image', status: 'qr_ready' })),
  restartWahaSession: vi.fn(async () => ({ status: 'restarted' })),
  logoutWahaSession: vi.fn(async () => ({ status: 'logged_out' })),
}))

describe('WhatsAppProvider Contract Tests', () => {
  const metaProvider = new MetaCloudProvider({
    phoneNumberId: 'pn-123',
    accessToken: 'test-meta-token',
  })

  const wahaProvider = new WahaProvider({
    baseUrl: 'http://localhost:3001',
    apiKey: 'test-waha-key',
    session: 'wacrm',
  })

  const providers: Array<{ name: string; instance: WhatsAppProvider }> = [
    { name: 'MetaCloudProvider', instance: metaProvider },
    { name: 'WahaProvider', instance: wahaProvider },
  ]

  for (const { name, instance } of providers) {
    describe(`${name} common contract`, () => {
      it('has valid capabilities definition', () => {
        const caps = instance.getCapabilities()
        expect(typeof caps.sendText).toBe('boolean')
        expect(typeof caps.sendImage).toBe('boolean')
        expect(typeof caps.sendDocument).toBe('boolean')
        expect(typeof caps.templates).toBe('boolean')
      })

      it('sends text and returns normalized WhatsAppSendResult', async () => {
        const result = await instance.sendText({
          to: '5511999999999',
          text: 'Olá de teste',
        })

        expect(result.provider).toBe(instance.type)
        expect(typeof result.externalMessageId).toBe('string')
        expect(result.externalMessageId.length).toBeGreaterThan(0)
        expect(result.status).toBe('sent')
      })

      it('sends media and returns normalized WhatsAppSendResult', async () => {
        const result = await instance.sendMedia({
          to: '5511999999999',
          mediaType: 'image',
          mediaUrl: 'https://example.com/photo.jpg',
          caption: 'Foto de teste',
        })

        expect(result.provider).toBe(instance.type)
        expect(typeof result.externalMessageId).toBe('string')
        expect(result.status).toBe('sent')
      })

      it('getStatus returns normalized status structure', async () => {
        const status = await instance.getStatus()
        expect(status.status).toBe('connected')
        expect(status.connected).toBe(true)
        expect(typeof status.lastCheckedAt).toBe('string')
      })
    })
  }

  describe('Factory getWhatsAppProvider', () => {
    it('creates MetaCloudProvider when provider is meta or unset', () => {
      const p1 = getWhatsAppProvider({
        provider: 'meta',
        phone_number_id: 'pn-1',
        decrypted_access_token: 'tok-1',
      })
      expect(p1.type).toBe('meta')

      const p2 = getWhatsAppProvider({
        phone_number_id: 'pn-2',
        decrypted_access_token: 'tok-2',
      })
      expect(p2.type).toBe('meta')
    })

    it('creates WahaProvider when provider is waha', () => {
      const p = getWhatsAppProvider({
        provider: 'waha',
        waha_base_url: 'http://localhost:3001',
        waha_session_name: 'test-session',
        decrypted_access_token: 'waha-tok',
      })
      expect(p.type).toBe('waha')
      expect(p.getCapabilities().qrCode).toBe(true)
      expect(p.getCapabilities().templates).toBe(false)
    })
  })
})
