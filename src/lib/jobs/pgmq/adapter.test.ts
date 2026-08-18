import { describe, expect, it, vi } from 'vitest'
import { PgmqJobQueue } from '../queue'
import type { WhatsAppInboundJobEnvelope } from '../types'

describe('PgmqJobQueue Adapter Contract', () => {
  it('calls enqueue_whatsapp_inbound_batch RPC with serialized envelopes', async () => {
    const queue = new PgmqJobQueue()
    const rpcMock = vi.fn(async () => {
      return { data: [42, 43], error: null }
    })
    const fakeDb = { rpc: rpcMock }

    const envelopes: WhatsAppInboundJobEnvelope[] = [
      {
        version: 1,
        jobId: 'job-1',
        type: 'whatsapp.inbound',
        accountId: 'acc-1',
        createdAt: '2026-08-18T00:00:00.000Z',
        payload: { type: 'unknown', provider: 'meta', accountId: 'acc-1', rawPayload: {} },
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = await queue.enqueueWhatsAppInboundBatch(envelopes, fakeDb as any)
    expect(ids).toEqual([42, 43])
    expect(rpcMock).toHaveBeenCalledWith('enqueue_whatsapp_inbound_batch', {
      p_messages: envelopes,
    })
  })

  it('calls read_whatsapp_inbound RPC and transforms rows', async () => {
    const queue = new PgmqJobQueue()
    const rpcMock = vi.fn(async () => ({
      data: [
        {
          msg_id: '101',
          read_ct: '2',
          enqueued_at: '2026-08-18T00:00:00.000Z',
          vt: '2026-08-18T00:02:00.000Z',
          message: { version: 1, jobId: 'j-1', type: 'whatsapp.inbound' },
        },
      ],
      error: null,
    }))
    const fakeDb = { rpc: rpcMock }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = await queue.readWhatsAppInbound(120, 10, fakeDb as any)
    expect(messages).toHaveLength(1)
    expect(messages[0].msg_id).toBe(101)
    expect(messages[0].read_ct).toBe(2)
  })

  it('calls archive_whatsapp_inbound RPC', async () => {
    const queue = new PgmqJobQueue()
    const rpcMock = vi.fn(async () => ({ data: true, error: null }))
    const fakeDb = { rpc: rpcMock }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await queue.archiveWhatsAppInbound(101, fakeDb as any)
    expect(ok).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('archive_whatsapp_inbound', { p_msg_id: 101 })
  })

  it('calls dead_letter_whatsapp_inbound RPC', async () => {
    const queue = new PgmqJobQueue()
    const rpcMock = vi.fn(async () => ({ data: true, error: null }))
    const fakeDb = { rpc: rpcMock }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await queue.deadLetterWhatsAppInbound(101, { version: 1 }, { reason: 'max_retries' }, fakeDb as any)
    expect(ok).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith('dead_letter_whatsapp_inbound', {
      p_msg_id: 101,
      p_message: { version: 1 },
      p_error_info: { reason: 'max_retries' },
    })
  })
})
