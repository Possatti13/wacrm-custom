/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import { createRequire } from 'module'
import { normalizeWahaInbound } from './providers/waha/normalize-inbound'
import { processNormalizedInboundEvent } from './inbound/processor'
import type { NormalizedInboundMessageEvent } from './inbound/types'

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))

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

describe('WAHA Real Message End-to-End Pipeline & DB Persistence', () => {
  let pg: any
  const accountId = 'b0000000-0000-4000-8000-000000000001'
  const userId = 'c0000000-0000-4000-8000-000000000001'

  beforeEach(async () => {
    pg = new PGlite()

    // 1. Create schema for profiles, contacts, conversations, messages
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        account_id uuid NOT NULL,
        role text DEFAULT 'member',
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL,
        user_id uuid,
        phone text,
        whatsapp_lid text,
        name text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL,
        user_id uuid,
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        external_chat_id text,
        status text DEFAULT 'open',
        unread_count integer DEFAULT 0,
        last_message_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        CONSTRAINT uq_conversations_account_contact UNIQUE (account_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_type text NOT NULL,
        content_type text DEFAULT 'text',
        content_text text,
        media_url text,
        message_id text,
        source_provider text,
        status text DEFAULT 'sent',
        occurred_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(),
        CONSTRAINT uq_messages_conversation_provider_message_id UNIQUE (conversation_id, source_provider, message_id)
      );

      INSERT INTO profiles (user_id, account_id, role) VALUES ('${userId}', '${accountId}', 'admin');
    `)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function createPgShim(db: any) {
    return {
      from: (table: string) => {
        const filters: Array<{ col: string; op: string; val: any }> = []
        let orderCol: string | null = null
        let isAsc = true
        let limitVal: number | null = null
        let insertData: any = null
        let updateData: any = null

        const builder: any = {
          select: (_cols?: string) => builder,
          eq: (col: string, val: any) => {
            filters.push({ col, op: '=', val })
            return builder
          },
          like: (col: string, val: any) => {
            filters.push({ col, op: 'LIKE', val })
            return builder
          },
          ilike: (col: string, val: any) => {
            filters.push({ col, op: 'ILIKE', val })
            return builder
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            orderCol = col
            isAsc = opts?.ascending ?? true
            return builder
          },
          limit: (n: number) => {
            limitVal = n
            return builder
          },
          insert: (data: any) => {
            insertData = data
            return builder
          },
          update: (data: any) => {
            updateData = data
            return builder
          },
          maybeSingle: async () => {
            const res = await builder.then((v: any) => v)
            const item = Array.isArray(res.data) ? res.data[0] : res.data
            return {
              data: item || null,
              error: res.error,
            }
          },
          single: async () => {
            const res = await builder.then((v: any) => v)
            const item = Array.isArray(res.data) ? res.data[0] : res.data
            return {
              data: item || null,
              error: res.error,
            }
          },
          then: async (resolve: (v: any) => any) => {
            try {
              if (insertData) {
                const row = Array.isArray(insertData) ? insertData[0] : insertData
                const cols = Object.keys(row)
                const vals = Object.values(row)
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
                const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`
                const qRes = await db.query(query, vals)
                return resolve({ data: Array.isArray(insertData) ? qRes.rows : qRes.rows[0], error: null })
              }

              if (updateData) {
                const cols = Object.keys(updateData)
                const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')
                const vals = cols.map((c) => updateData[c])
                let whereClause = ''
                if (filters.length > 0) {
                  whereClause = ' WHERE ' + filters.map((f, i) => `${f.col} ${f.op} $${vals.length + i + 1}`).join(' AND ')
                  filters.forEach((f) => vals.push(f.val))
                }
                const query = `UPDATE ${table} SET ${setClauses}${whereClause} RETURNING *`
                const qRes = await db.query(query, vals)
                return resolve({ data: qRes.rows, error: null })
              }

              // SELECT
              let whereClause = ''
              const vals: any[] = []
              if (filters.length > 0) {
                whereClause = ' WHERE ' + filters.map((f, i) => `${f.col} ${f.op} $${i + 1}`).join(' AND ')
                filters.forEach((f) => vals.push(f.val))
              }
              let orderClause = ''
              if (orderCol) {
                orderClause = ` ORDER BY ${orderCol} ${isAsc ? 'ASC' : 'DESC'}`
              }
              let limitClause = ''
              if (limitVal !== null) {
                limitClause = ` LIMIT ${limitVal}`
              }

              const query = `SELECT * FROM ${table}${whereClause}${orderClause}${limitClause}`
              const qRes = await db.query(query, vals)
              return resolve({ data: qRes.rows, error: null })
            } catch (err: any) {
              return resolve({ data: null, error: err })
            }
          },
        }

        return builder
      },
    }
  }

  it('normalizes WAHA payload with ackName=SERVER to message, processes via inbound processor, and creates 1 contact, 1 conversation, 1 message', async () => {
    const rawWahaPayload = {
      event: 'message',
      session: 'ciclopes_ec86e41e',
      payload: {
        id: 'false_5511999998888@c.us_3EB0C34B876A28D44A',
        timestamp: 1740698100,
        from: '5511999998888@c.us',
        fromMe: false,
        to: '5511888887777@c.us',
        body: 'Olá, gostaria de saber o valor da Falcon 400',
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
          body: 'Olá, gostaria de saber o valor da Falcon 400',
          type: 'chat',
          t: 1740698100,
          notifyName: 'Leandro Possatti',
          from: '5511999998888@c.us',
          to: '5511888887777@c.us',
          self: 'in',
          ack: 1,
          isNewMsg: true,
        },
      },
    }

    // 1. Webhook Normalization
    const normalized = normalizeWahaInbound(rawWahaPayload, accountId)
    expect(normalized).not.toBeNull()
    expect(normalized?.type).toBe('message')
    expect((normalized as NormalizedInboundMessageEvent).fromMe).toBe(false)
    expect((normalized as NormalizedInboundMessageEvent).fromPhone).toBe('5511999998888')
    expect((normalized as NormalizedInboundMessageEvent).content.text).toBe('Olá, gostaria de saber o valor da Falcon 400')

    // 2. Inbound Processor Execution against real PG schema
    const shim = createPgShim(pg)
    const processResult = await processNormalizedInboundEvent({
      event: normalized as NormalizedInboundMessageEvent,
      db: shim as any,
    })

    expect(processResult.processed).toBe(true)
    expect(processResult.duplicate).toBeUndefined()

    // 3. Verify Database State: Exactly 1 Contact, 1 Conversation, 1 Message
    const contactsRes = await pg.query('SELECT * FROM contacts WHERE account_id = $1', [accountId])
    expect(contactsRes.rows).toHaveLength(1)
    expect(contactsRes.rows[0].phone).toBe('5511999998888')
    expect(contactsRes.rows[0].name).toBe('Leandro Possatti')

    const convsRes = await pg.query('SELECT * FROM conversations WHERE account_id = $1', [accountId])
    expect(convsRes.rows).toHaveLength(1)
    expect(convsRes.rows[0].contact_id).toBe(contactsRes.rows[0].id)
    expect(convsRes.rows[0].unread_count).toBe(1)
    expect(convsRes.rows[0].status).toBe('open')

    const msgsRes = await pg.query('SELECT * FROM messages WHERE conversation_id = $1', [convsRes.rows[0].id])
    expect(msgsRes.rows).toHaveLength(1)
    expect(msgsRes.rows[0].sender_type).toBe('customer')
    expect(msgsRes.rows[0].content_text).toBe('Olá, gostaria de saber o valor da Falcon 400')
    expect(msgsRes.rows[0].source_provider).toBe('waha')
    expect(msgsRes.rows[0].message_id).toBe('false_5511999998888@c.us_3EB0C34B876A28D44A')

    // 4. Duplicate Replay Test: WAHA also sends message.any with identical externalMessageId
    const rawWahaAnyPayload = {
      event: 'message.any',
      session: 'ciclopes_ec86e41e',
      payload: {
        id: 'false_5511999998888@c.us_3EB0C34B876A28D44A',
        timestamp: 1740698100,
        from: '5511999998888@c.us',
        fromMe: false,
        to: '5511888887777@c.us',
        body: 'Olá, gostaria de saber o valor da Falcon 400',
        ack: 1,
        ackName: 'SERVER',
      },
    }

    const normalizedAny = normalizeWahaInbound(rawWahaAnyPayload, accountId)
    const secondResult = await processNormalizedInboundEvent({
      event: normalizedAny as NormalizedInboundMessageEvent,
      db: shim as any,
    })

    expect(secondResult.processed).toBe(true)
    expect(secondResult.duplicate).toBe(true)

    // Verify DB count remains strictly 1 message, 1 contact, 1 conversation
    const finalMsgs = await pg.query('SELECT * FROM messages WHERE conversation_id = $1', [convsRes.rows[0].id])
    expect(finalMsgs.rows).toHaveLength(1)

    const finalConvs = await pg.query('SELECT * FROM conversations WHERE account_id = $1', [accountId])
    expect(finalConvs.rows).toHaveLength(1)
  })

  it('correctly processes agent outbound messages sent from physical WhatsApp device (fromMe=true)', async () => {
    const rawOutboundPayload = {
      event: 'message.any',
      session: 'ciclopes_ec86e41e',
      payload: {
        id: 'true_5511999998888@c.us_3EB0AGENT123',
        timestamp: 1740698200,
        from: '5511888887777@c.us',
        fromMe: true,
        to: '5511999998888@c.us',
        body: 'Olá! A Falcon 400 está por R$ 38.000.',
        ack: 1,
        ackName: 'SERVER',
        _data: {
          id: {
            fromMe: true,
            remote: '5511999998888@c.us',
            id: '3EB0AGENT123',
            _serialized: 'true_5511999998888@c.us_3EB0AGENT123',
          },
        },
      },
    }

    const normalizedOutbound = normalizeWahaInbound(rawOutboundPayload, accountId)
    expect(normalizedOutbound?.type).toBe('message')
    expect((normalizedOutbound as NormalizedInboundMessageEvent).fromMe).toBe(true)
    expect((normalizedOutbound as NormalizedInboundMessageEvent).fromPhone).toBe('5511999998888')

    const shim = createPgShim(pg)
    const result = await processNormalizedInboundEvent({
      event: normalizedOutbound as NormalizedInboundMessageEvent,
      db: shim as any,
    })

    expect(result.processed).toBe(true)

    const msgs = await pg.query('SELECT * FROM messages WHERE message_id = $1', ['true_5511999998888@c.us_3EB0AGENT123'])
    expect(msgs.rows).toHaveLength(1)
    expect(msgs.rows[0].sender_type).toBe('agent')
    expect(msgs.rows[0].content_text).toBe('Olá! A Falcon 400 está por R$ 38.000.')
  })

  it('handles inbound message with WhatsApp Privacy LID where PN is resolved', async () => {
    const rawLidPayload = {
      event: 'message',
      session: 'ciclopes_ec86e41e',
      payload: {
        id: 'false_25190000009361@lid_3EB05B8AA3703F261BE423',
        timestamp: 1740698200,
        from: '25190000009361@lid',
        fromMe: false,
        to: '5511888887777@c.us',
        body: 'TESTE CICLOPES 05 - mensagem real',
        hasMedia: false,
        ack: 1,
        ackName: 'SERVER',
        _data: {
          id: {
            fromMe: false,
            remote: '25190000009361@lid',
            id: '3EB05B8AA3703F261BE423',
            _serialized: 'false_25190000009361@lid_3EB05B8AA3703F261BE423',
          },
          body: 'TESTE CICLOPES 05 - mensagem real',
          notifyName: 'Leo Possatti',
          from: '25190000009361@lid',
          to: '5511888887777@c.us',
        },
      },
    }

    const normalized = normalizeWahaInbound(rawLidPayload, accountId) as NormalizedInboundMessageEvent
    expect(normalized.lid).toBe('25190000009361@lid')
    expect(normalized.externalChatId).toBe('25190000009361@lid')
    expect(normalized.fromPhone).toBe('') // Normalizer leaves empty, does NOT put LID into phone

    // Simulate resolved phone from WAHA LID API
    normalized.fromPhone = '5513974135365'

    const shim = createPgShim(pg)
    const result = await processNormalizedInboundEvent({
      event: normalized,
      db: shim as any,
    })

    expect(result.processed).toBe(true)

    // Check DB: contact has phone=5513974135365 and whatsapp_lid=25190000009361@lid
    const contactsRes = await pg.query('SELECT * FROM contacts WHERE account_id = $1', [accountId])
    expect(contactsRes.rows).toHaveLength(1)
    expect(contactsRes.rows[0].phone).toBe('5513974135365')
    expect(contactsRes.rows[0].whatsapp_lid).toBe('25190000009361@lid')
    expect(contactsRes.rows[0].name).toBe('Leo Possatti')

    // Conversation has external_chat_id=25190000009361@lid
    const convsRes = await pg.query('SELECT * FROM conversations WHERE account_id = $1', [accountId])
    expect(convsRes.rows).toHaveLength(1)
    expect(convsRes.rows[0].external_chat_id).toBe('25190000009361@lid')
  })

  it('handles inbound message with WhatsApp Privacy LID where PN is unresolvable (null)', async () => {
    const rawLidPayload = {
      event: 'message',
      session: 'ciclopes_ec86e41e',
      payload: {
        id: 'false_99990000009999@lid_3EB0UNKNOWN',
        timestamp: 1740698300,
        from: '99990000009999@lid',
        fromMe: false,
        to: '5511888887777@c.us',
        body: 'Mensagem de LID anônimo',
        hasMedia: false,
        ack: 1,
        ackName: 'SERVER',
        _data: {
          id: {
            fromMe: false,
            remote: '99990000009999@lid',
            id: '3EB0UNKNOWN',
            _serialized: 'false_99990000009999@lid_3EB0UNKNOWN',
          },
          body: 'Mensagem de LID anônimo',
          notifyName: 'Cliente Privado',
          from: '99990000009999@lid',
          to: '5511888887777@c.us',
        },
      },
    }

    const normalized = normalizeWahaInbound(rawLidPayload, accountId) as NormalizedInboundMessageEvent
    expect(normalized.lid).toBe('99990000009999@lid')
    expect(normalized.fromPhone).toBe('')

    const shim = createPgShim(pg)
    const result = await processNormalizedInboundEvent({
      event: normalized,
      db: shim as any,
    })

    expect(result.processed).toBe(true)

    // Check DB: phone is NULL, NOT 99990000009999
    const contactsRes = await pg.query('SELECT * FROM contacts WHERE whatsapp_lid = $1', ['99990000009999@lid'])
    expect(contactsRes.rows).toHaveLength(1)
    expect(contactsRes.rows[0].phone).toBeNull()
    expect(contactsRes.rows[0].whatsapp_lid).toBe('99990000009999@lid')
    expect(contactsRes.rows[0].name).toBe('Cliente Privado')

    // Conversation has external_chat_id=99990000009999@lid
    const convsRes = await pg.query('SELECT * FROM conversations WHERE contact_id = $1', [contactsRes.rows[0].id])
    expect(convsRes.rows).toHaveLength(1)
    expect(convsRes.rows[0].external_chat_id).toBe('99990000009999@lid')
  })
})
