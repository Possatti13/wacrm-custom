import { describe, expect, it, vi } from 'vitest'
import {
  handleWhatsAppInboundJob,
  isValidStatusTransition,
} from './whatsapp-inbound'
import type { WhatsAppInboundJobEnvelope } from '../types'

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => {}),
}))

describe('WhatsApp Inbound Handler & Status Monotonicity', () => {
  it('enforces forward-only status ladder (monotonicity)', () => {
    // Valid progression
    expect(isValidStatusTransition('pending', 'sent')).toBe(true)
    expect(isValidStatusTransition('sent', 'delivered')).toBe(true)
    expect(isValidStatusTransition('delivered', 'read')).toBe(true)
    expect(isValidStatusTransition('read', 'replied')).toBe(true)

    // Out-of-order / Regressive transitions rejected
    expect(isValidStatusTransition('read', 'delivered')).toBe(false)
    expect(isValidStatusTransition('read', 'sent')).toBe(false)
    expect(isValidStatusTransition('delivered', 'sent')).toBe(false)

    // Duplicate transitions rejected
    expect(isValidStatusTransition('delivered', 'delivered')).toBe(false)
    expect(isValidStatusTransition('read', 'read')).toBe(false)

    // Failed status behavior
    expect(isValidStatusTransition('pending', 'failed')).toBe(true)
    expect(isValidStatusTransition('sent', 'failed')).toBe(true)
    expect(isValidStatusTransition('failed', 'delivered')).toBe(false)
  })

  it('safely handles reaction events idempotently (add / remove)', async () => {
    const upsertMock = vi.fn(async () => ({ error: null }))
    const deleteMock = vi.fn(async () => ({ error: null }))

    const fakeDb = {
      from: () => {
        const b: Record<string, unknown> = {
          select: vi.fn(() => b),
          eq: vi.fn(() => b),
          maybeSingle: vi.fn(async () => ({
            data: {
              id: 'msg-rec-1',
              conversation_id: 'conv-rec-1',
              conversations: { contact_id: 'contact-rec-1', account_id: 'acc-1' },
            },
            error: null,
          })),
          upsert: vi.fn((data: unknown) => {
            void upsertMock()
            return data && b
          }),
          delete: vi.fn(() => {
            void deleteMock()
            return b
          }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
        }
        return b
      },
    }

    // 1. Add reaction (upsert)
    const addEnvelope: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-react-1',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: {
        type: 'reaction',
        provider: 'meta',
        accountId: 'acc-1',
        fromPhone: '5511999999999',
        targetExternalMessageId: 'wamid.TARGET_1',
        emoji: '👍',
        timestamp: 1700000020,
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resAdd = await handleWhatsAppInboundJob(addEnvelope, fakeDb as any)
    expect(resAdd.success).toBe(true)
    expect(upsertMock).toHaveBeenCalled()

    // 2. Remove reaction (delete)
    const removeEnvelope: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-react-2',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: {
        type: 'reaction',
        provider: 'meta',
        accountId: 'acc-1',
        fromPhone: '5511999999999',
        targetExternalMessageId: 'wamid.TARGET_1',
        emoji: '',
        timestamp: 1700000021,
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resRemove = await handleWhatsAppInboundJob(removeEnvelope, fakeDb as any)
    expect(resRemove.success).toBe(true)
    expect(deleteMock).toHaveBeenCalled()
  })

  it('preserves read status when a delayed delivered status arrives out-of-order', async () => {
    let persistedStatus = 'read'
    const updateMock = vi.fn(async (payload: { status: string }) => {
      persistedStatus = payload.status
      return { error: null }
    })

    const fakeDb = {
      from: (table: string) => {
        const b: Record<string, unknown> = {
          select: vi.fn(() => b),
          eq: vi.fn(() => b),
          maybeSingle: vi.fn(async () => {
            if (table === 'messages') {
              return {
                data: {
                  id: 'msg-ooo-1',
                  status: persistedStatus, // Currently 'read'
                  conversation_id: 'conv-1',
                  conversations: { account_id: 'acc-1' },
                },
                error: null,
              }
            }
            if (table === 'broadcast_recipients') {
              return {
                data: { id: 'rec-1', status: persistedStatus },
                error: null,
              }
            }
            return { data: null, error: null }
          }),
          update: updateMock,
          then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
        }
        return b
      },
    }

    const delayedDeliveredEnvelope: WhatsAppInboundJobEnvelope = {
      version: 1,
      jobId: 'job-status-ooo',
      type: 'whatsapp.inbound',
      accountId: 'acc-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      payload: {
        type: 'status',
        provider: 'meta',
        accountId: 'acc-1',
        externalMessageId: 'wamid.STATUS_TEST',
        status: 'delivered', // Delayed delivered event
        timestamp: 1700000005,
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handleWhatsAppInboundJob(delayedDeliveredEnvelope, fakeDb as any)
    expect(result.success).toBe(true)

    // updateMock should NOT have been called because 'read' cannot transition back to 'delivered'
    expect(updateMock).not.toHaveBeenCalled()
    expect(persistedStatus).toBe('read')
  })
})
