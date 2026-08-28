import { describe, expect, it } from 'vitest'
import { normalizeMetaInbound } from '../providers/meta/normalize-inbound'
import { normalizeWahaInbound } from '../providers/waha/normalize-inbound'
import type {
  NormalizedInboundMessageEvent,
  NormalizedInboundStatusEvent,
  NormalizedInboundReactionEvent,
} from './types'

describe('Inbound Event Normalization', () => {
  const accountId = 'acct-12345'

  describe('Meta Inbound Normalizer', () => {
    it('normalizes a plain text inbound message', () => {
      const metaPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15550254321',
                    phone_number_id: 'PN_123',
                  },
                  contacts: [{ profile: { name: 'João Silva' }, wa_id: '5511999999999' }],
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.HBgLM1234567890',
                      timestamp: '1700000000',
                      text: { body: 'Olá, gostaria de mais informações' },
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      }

      const events = normalizeMetaInbound(metaPayload, accountId)
      expect(events).toHaveLength(1)
      const ev = events[0] as NormalizedInboundMessageEvent

      expect(ev.type).toBe('message')
      expect(ev.provider).toBe('meta')
      expect(ev.accountId).toBe(accountId)
      expect(ev.externalMessageId).toBe('wamid.HBgLM1234567890')
      expect(ev.fromPhone).toBe('5511999999999')
      expect(ev.senderName).toBe('João Silva')
      expect(ev.content.type).toBe('text')
      expect(ev.content.text).toBe('Olá, gostaria de mais informações')
    })

    it('normalizes an image inbound message', () => {
      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: 'Maria' }, wa_id: '5511888888888' }],
                  messages: [
                    {
                      from: '5511888888888',
                      id: 'wamid.IMG123',
                      timestamp: '1700000010',
                      type: 'image',
                      image: { id: 'media-id-999', caption: 'Comprovante', mime_type: 'image/jpeg' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      }

      const events = normalizeMetaInbound(metaPayload, accountId)
      const ev = events[0] as NormalizedInboundMessageEvent

      expect(ev.type).toBe('message')
      expect(ev.content.type).toBe('image')
      expect(ev.content.text).toBe('Comprovante')
      expect(ev.content.mediaUrl).toBe('/api/whatsapp/media/media-id-999')
      expect(ev.content.mimeType).toBe('image/jpeg')
    })

    it('normalizes a delivery status update', () => {
      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.STATUS123',
                      status: 'delivered',
                      timestamp: '1700000020',
                      recipient_id: '5511999999999',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      }

      const events = normalizeMetaInbound(metaPayload, accountId)
      const ev = events[0] as NormalizedInboundStatusEvent

      expect(ev.type).toBe('status')
      expect(ev.provider).toBe('meta')
      expect(ev.externalMessageId).toBe('wamid.STATUS123')
      expect(ev.status).toBe('delivered')
      expect(ev.recipientPhone).toBe('5511999999999')
    })

    it('normalizes an incoming reaction', () => {
      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '5511999999999',
                      id: 'wamid.REACT123',
                      timestamp: '1700000030',
                      type: 'reaction',
                      reaction: { message_id: 'wamid.TARGET123', emoji: '👍' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      }

      const events = normalizeMetaInbound(metaPayload, accountId)
      const ev = events[0] as NormalizedInboundReactionEvent

      expect(ev.type).toBe('reaction')
      expect(ev.emoji).toBe('👍')
      expect(ev.targetExternalMessageId).toBe('wamid.TARGET123')
    })
  })

  describe('WAHA Inbound Normalizer', () => {
    it('normalizes a plain text inbound message', () => {
      const wahaPayload = {
        event: 'message',
        session: 'wacrm',
        payload: {
          id: 'false_5511999999999@c.us_WAHA123',
          from: '5511999999999@c.us',
          fromMe: false,
          body: 'Mensagem do cliente via WAHA',
          pushName: 'Carlos Santos',
          timestamp: 1700000040,
        },
      }

      const ev = normalizeWahaInbound(wahaPayload, accountId) as NormalizedInboundMessageEvent

      expect(ev).not.toBeNull()
      expect(ev.type).toBe('message')
      expect(ev.provider).toBe('waha')
      expect(ev.accountId).toBe(accountId)
      expect(ev.fromPhone).toBe('5511999999999')
      expect(ev.senderName).toBe('Carlos Santos')
      expect(ev.content.type).toBe('text')
      expect(ev.content.text).toBe('Mensagem do cliente via WAHA')
    })

    it('normalizes a media message (document) from WAHA', () => {
      const wahaPayload = {
        event: 'message',
        session: 'wacrm',
        payload: {
          id: 'false_5511999999999@c.us_WAHADOC123',
          from: '5511999999999@c.us',
          fromMe: false,
          body: 'Contrato Assinado',
          mediaUrl: 'http://localhost:3001/media/doc.pdf',
          mimetype: 'application/pdf',
          pushName: 'Carlos',
          timestamp: 1700000050,
        },
      }

      const ev = normalizeWahaInbound(wahaPayload, accountId) as NormalizedInboundMessageEvent

      expect(ev.type).toBe('message')
      expect(ev.content.type).toBe('document')
      expect(ev.content.text).toBe('Contrato Assinado')
      expect(ev.content.mediaUrl).toBe('http://localhost:3001/media/doc.pdf')
    })

    it('normalizes a real customer inbound message with ack and ackName as type message', () => {
      const realWahaPayload = {
        event: 'message',
        session: 'ciclopes_ec86e41e',
        payload: {
          id: 'false_5511999998888@c.us_3EB0C34B876A28D44A',
          timestamp: 1740698100,
          from: '5511999998888@c.us',
          fromMe: false,
          to: '5511888887777@c.us',
          body: 'Olá, tudo bem? Quero saber mais.',
          hasMedia: false,
          ack: 1,
          ackName: 'SERVER',
          _data: {
            id: {
              fromMe: false,
              remote: '5511999998888@c.us',
              id: '3EB0C34B876A28D44A',
              _serialized: 'false_5511999998888@c.us_3EB0C34B876A28D44A',
            },
            body: 'Olá, tudo bem? Quero saber mais.',
            type: 'chat',
            t: 1740698100,
            notifyName: 'Cliente Real',
            from: '5511999998888@c.us',
            to: '5511888887777@c.us',
            self: 'in',
            ack: 1,
            isNewMsg: true,
          },
        },
      }

      const ev = normalizeWahaInbound(realWahaPayload, accountId) as NormalizedInboundMessageEvent

      expect(ev).not.toBeNull()
      expect(ev.type).toBe('message')
      expect(ev.provider).toBe('waha')
      expect(ev.accountId).toBe(accountId)
      expect(ev.externalMessageId).toBe('false_5511999998888@c.us_3EB0C34B876A28D44A')
      expect(ev.fromPhone).toBe('5511999998888')
      expect(ev.toPhone).toBe('5511888887777')
      expect(ev.fromMe).toBe(false)
      expect(ev.senderName).toBe('Cliente Real')
      expect(ev.content.type).toBe('text')
      expect(ev.content.text).toBe('Olá, tudo bem? Quero saber mais.')
    })

    it('normalizes a message.any event from customer inbound correctly', () => {
      const realWahaAnyPayload = {
        event: 'message.any',
        session: 'ciclopes_ec86e41e',
        payload: {
          id: 'false_5511999998888@c.us_3EB0C34B876A28D44A',
          timestamp: 1740698100,
          from: '5511999998888@c.us',
          fromMe: false,
          to: '5511888887777@c.us',
          body: 'Mensagem via message.any',
          ack: 1,
          ackName: 'SERVER',
        },
      }

      const ev = normalizeWahaInbound(realWahaAnyPayload, accountId) as NormalizedInboundMessageEvent

      expect(ev).not.toBeNull()
      expect(ev.type).toBe('message')
      expect(ev.fromMe).toBe(false)
      expect(ev.fromPhone).toBe('5511999998888')
      expect(ev.content.text).toBe('Mensagem via message.any')
    })

    it('normalizes an outbound message sent from physical device (fromMe=true)', () => {
      const outboundPayload = {
        event: 'message.any',
        session: 'ciclopes_ec86e41e',
        payload: {
          id: 'true_5511999998888@c.us_3EB099999999',
          timestamp: 1740698150,
          from: '5511888887777@c.us',
          fromMe: true,
          to: '5511999998888@c.us',
          body: 'Resposta enviada direto do WhatsApp do celular',
          ack: 1,
          ackName: 'SERVER',
          _data: {
            id: {
              fromMe: true,
              remote: '5511999998888@c.us',
              id: '3EB099999999',
              _serialized: 'true_5511999998888@c.us_3EB099999999',
            },
          },
        },
      }

      const ev = normalizeWahaInbound(outboundPayload, accountId) as NormalizedInboundMessageEvent

      expect(ev).not.toBeNull()
      expect(ev.type).toBe('message')
      expect(ev.fromMe).toBe(true)
      expect(ev.fromPhone).toBe('5511999998888')
      expect(ev.content.text).toBe('Resposta enviada direto do WhatsApp do celular')
    })

    it('normalizes an ack status update from WAHA', () => {
      const wahaPayload = {
        event: 'message.ack',
        session: 'wacrm',
        payload: {
          id: 'true_5511999999999@c.us_MSG777',
          to: '5511999999999@c.us',
          ack: 3, // read
          timestamp: 1700000060,
        },
      }

      const ev = normalizeWahaInbound(wahaPayload, accountId) as NormalizedInboundStatusEvent

      expect(ev.type).toBe('status')
      expect(ev.status).toBe('read')
      expect(ev.recipientPhone).toBe('5511999999999')
    })

    it('handles unknown or unformatted events safely', () => {
      const wahaPayload = {
        event: 'custom.something_strange',
        session: 'wacrm',
        payload: { foo: 'bar' },
      }

      const ev = normalizeWahaInbound(wahaPayload, accountId)
      expect(ev).not.toBeNull()
      expect(ev?.type).toBe('unknown')
    })
  })
})
