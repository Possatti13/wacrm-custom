/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { createRequire } from 'module'
import { enqueueWhatsAppInboundEvent, enqueueWhatsAppInboundEvents } from './producer'
import { PgmqJobQueue } from './queue'
import type { NormalizedInboundMessageEvent } from '@/lib/whatsapp/inbound/types'

const scratchRequire = createRequire(
  path.join(
    process.env.USERPROFILE || 'C:\\Users\\leopo',
    '.gemini',
    'antigravity',
    'brain',
    '7dd65584-91ac-45ad-828c-ba770c616490',
    'scratch',
    'package.json'
  )
)
const { PGlite } = scratchRequire('@electric-sql/pglite')

describe('WhatsApp Inbound Enqueue & RPC Contract Verification', () => {
  const accountId = 'a0000000-0000-4000-8000-000000000001'

  it('proves that old PL/pgSQL direct assignment failed with malformed array literal and new subquery succeeds', async () => {
    const pg = new PGlite()

    // 1. Setup mock pgmq schema and send_batch returning SETOF bigint
    await pg.exec(`
      CREATE SCHEMA IF NOT EXISTS pgmq;
      CREATE SEQUENCE IF NOT EXISTS pgmq_msg_seq START WITH 1;
      
      -- Mock pgmq.send_batch returning SETOF bigint (exactly as pgmq extension operates)
      CREATE OR REPLACE FUNCTION pgmq.send_batch(
        queue_name text,
        messages jsonb[]
      ) RETURNS SETOF bigint
      LANGUAGE plpgsql
      AS $$
      DECLARE
        m jsonb;
      BEGIN
        FOREACH m IN ARRAY messages LOOP
          RETURN NEXT nextval('pgmq_msg_seq')::bigint;
        END LOOP;
        RETURN;
      END;
      $$;
    `)

    // 2. Old flawed definition (from migration 042)
    await pg.exec(`
      CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_inbound_batch_OLD(
        p_messages jsonb[]
      ) RETURNS bigint[]
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_ids bigint[];
      BEGIN
        IF p_messages IS NULL OR array_length(p_messages, 1) = 0 THEN
          RETURN ARRAY[]::bigint[];
        END IF;

        -- THIS WAS THE ROOT CAUSE BUG:
        v_ids := pgmq.send_batch('whatsapp_inbound', p_messages);
        RETURN v_ids;
      END;
      $$;
    `)

    // 3. New fixed definition (from migration 066)
    await pg.exec(`
      CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_inbound_batch_FIXED(
        p_messages jsonb[]
      ) RETURNS bigint[]
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_ids bigint[];
      BEGIN
        IF p_messages IS NULL OR cardinality(p_messages) = 0 THEN
          RETURN ARRAY[]::bigint[];
        END IF;

        SELECT ARRAY(
          SELECT pgmq.send_batch('whatsapp_inbound', p_messages)
        ) INTO v_ids;

        RETURN COALESCE(v_ids, ARRAY[]::bigint[]);
      END;
      $$;
    `)

    // 4. Executing OLD function MUST throw "malformed array literal"
    let oldError: Error | null = null
    try {
      await pg.query(`
        SELECT public.enqueue_whatsapp_inbound_batch_OLD(ARRAY['{"test": true}'::jsonb]);
      `)
    } catch (err) {
      oldError = err as Error
    }

    expect(oldError).not.toBeNull()
    expect(oldError?.message).toMatch(/malformed array literal: "1"|Array value must start with/i)

    // 5. Executing FIXED function MUST succeed and return bigint[]
    const fixedResult: any = await pg.query(`
      SELECT public.enqueue_whatsapp_inbound_batch_FIXED(
        ARRAY['{"jobId": "j1"}'::jsonb, '{"jobId": "j2"}'::jsonb]
      );
    `)

    expect(fixedResult.rows).toHaveLength(1)
    const returnedIds = fixedResult.rows[0].enqueue_whatsapp_inbound_batch_fixed
    expect(returnedIds).toBeDefined()
    // msg_seq advanced: 2 and 3
    expect(returnedIds).toEqual([2, 3])
  })

  it('enqueues a single WAHA inbound event through Producer layer', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [101],
      error: null,
    })

    const mockDb = {
      rpc: rpcMock,
    } as any

    const event: NormalizedInboundMessageEvent = {
      type: 'message',
      provider: 'waha',
      accountId,
      externalMessageId: 'waha-msg-001',
      externalChatId: '5511999990000@c.us',
      fromPhone: '5511999990000',
      senderName: 'Cliente Real',
      timestamp: 1740699000,
      fromMe: false,
      content: {
        type: 'text',
        text: 'Olá, gostaria de saber mais.',
      },
      rawPayload: {},
    }

    const result = await enqueueWhatsAppInboundEvent(event, { db: mockDb })

    expect(result.jobId).toBeDefined()
    expect(result.messageId).toBe(101)
    expect(rpcMock).toHaveBeenCalledWith('enqueue_whatsapp_inbound_batch', {
      p_messages: [
        expect.objectContaining({
          type: 'whatsapp.inbound',
          accountId,
          payload: event,
        }),
      ],
    })
  })

  it('enqueues a batch of inbound events and returns corresponding message IDs', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [201, 202, 203],
      error: null,
    })

    const mockDb = {
      rpc: rpcMock,
    } as any

    const events: NormalizedInboundMessageEvent[] = [1, 2, 3].map((n) => ({
      type: 'message',
      provider: 'waha',
      accountId,
      externalMessageId: `waha-batch-${n}`,
      externalChatId: '5511999990000@c.us',
      fromPhone: '5511999990000',
      senderName: 'Cliente Batch',
      timestamp: 1740699000 + n,
      fromMe: false,
      content: {
        type: 'text',
        text: `Mensagem ${n}`,
      },
      rawPayload: {},
    }))

    const result = await enqueueWhatsAppInboundEvents(events, { db: mockDb })

    expect(result.jobIds).toHaveLength(3)
    expect(result.messageIds).toEqual([201, 202, 203])
  })

  it('throws descriptive error if queue RPC returns an error', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'malformed array literal: "1"' },
    })

    const mockDb = {
      rpc: rpcMock,
    } as any

    const queue = new PgmqJobQueue()

    await expect(
      queue.enqueueWhatsAppInboundBatch(
        [
          {
            jobId: 'j-err',
            type: 'whatsapp.inbound',
            accountId,
            createdAt: new Date().toISOString(),
            payload: {} as any,
          } as any,
        ],
        mockDb
      )
    ).rejects.toThrow('enqueue_whatsapp_inbound_batch failed: malformed array literal: "1"')
  })
})
