/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';
import { sendMessageToConversation } from './send-message';
import { normalizeWahaInbound } from './providers/waha/normalize-inbound';
import { processNormalizedInboundEvent } from './inbound/processor';
import { encrypt } from '@/lib/whatsapp/encryption';
import type { NormalizedInboundMessageEvent } from './inbound/types';

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}));

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}));

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
);
const { PGlite } = scratchRequire('@electric-sql/pglite');

describe('CICLOPES V1.1.2 — E2E Operator Attribution & Physical WhatsApp Inbound Pipeline', () => {
  let pg: any;
  const accountId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
  const sellerAId = 'a1111111-1111-4111-a111-111111111111';
  const sellerBId = 'b2222222-2222-4222-b222-222222222222';
  const contactId = '463eb74e-8b05-4c88-b096-dd9acac31f80';
  const convId = 'ff38fefd-667a-472f-b9c2-4470c896fb00';
  const rawApiKey = 'wacrm-local-dev-key';

  beforeEach(async () => {
    pg = new PGlite();

    await pg.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        account_id UUID NOT NULL,
        full_name TEXT NOT NULL,
        account_role TEXT DEFAULT 'agent'
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        user_id UUID,
        phone TEXT,
        whatsapp_lid TEXT,
        name TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        user_id UUID,
        contact_id UUID NOT NULL REFERENCES contacts(id),
        external_chat_id TEXT,
        status TEXT DEFAULT 'open',
        unread_count INTEGER DEFAULT 0,
        assigned_agent_id UUID,
        first_customer_message_at TIMESTAMPTZ,
        first_response_at TIMESTAMPTZ,
        first_response_duration_seconds INTEGER,
        last_customer_message_at TIMESTAMPTZ,
        last_agent_message_at TIMESTAMPTZ,
        unattended_since TIMESTAMPTZ,
        last_message_text TEXT,
        last_message_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (account_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id),
        sender_type TEXT NOT NULL,
        sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        content_type TEXT DEFAULT 'text',
        content_text TEXT,
        media_url TEXT,
        media_mimetype TEXT,
        media_filename TEXT,
        template_name TEXT,
        template_language TEXT,
        template_params JSONB,
        interactive_payload JSONB,
        reply_to_message_id TEXT,
        message_id TEXT,
        source_provider TEXT,
        status TEXT DEFAULT 'sent',
        occurred_at TIMESTAMPTZ DEFAULT now(),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT uq_messages_conversation_provider_message_id UNIQUE (conversation_id, source_provider, message_id)
      );

      CREATE TABLE IF NOT EXISTS whatsapp_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        provider TEXT DEFAULT 'waha',
        status TEXT DEFAULT 'connected',
        waha_base_url TEXT DEFAULT 'http://localhost:3001',
        waha_session_name TEXT DEFAULT 'ciclopes_ec86e41e',
        access_token TEXT
      );

      INSERT INTO auth.users (id, email) VALUES
        ('${sellerAId}', 'seller.a.v11@ciclopes.test'),
        ('${sellerBId}', 'seller.b.v11@ciclopes.test');

      INSERT INTO accounts (id, name) VALUES ('${accountId}', 'Pilot Account');
      INSERT INTO profiles (user_id, account_id, full_name, account_role) VALUES
        ('${sellerAId}', '${accountId}', 'Vendedor Alpha', 'agent'),
        ('${sellerBId}', '${accountId}', 'Vendedor Beta', 'agent');

      INSERT INTO contacts (id, account_id, user_id, phone, whatsapp_lid, name) VALUES
        ('${contactId}', '${accountId}', '${sellerAId}', '5513974135365', '25190000009361@lid', 'Leo Possatti');

      INSERT INTO conversations (id, account_id, user_id, contact_id, external_chat_id, assigned_agent_id) VALUES
        ('${convId}', '${accountId}', '${sellerAId}', '${contactId}', '25190000009361@lid', '${sellerAId}');

      INSERT INTO whatsapp_config (account_id, provider, status, waha_base_url, waha_session_name, access_token) VALUES
        ('${accountId}', 'waha', 'connected', 'http://localhost:3001', 'ciclopes_ec86e41e', '${encrypt(rawApiKey)}');
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createPgShim(db: any) {
    return {
      from: (table: string) => {
        const filters: Array<{ col: string; op: string; val: any }> = [];
        let orderCol: string | null = null;
        let isAsc = true;
        let limitVal: number | null = null;
        let insertData: any = null;
        let updateData: any = null;

        const builder: any = {
          select: () => builder,
          eq: (col: string, val: any) => {
            filters.push({ col, op: '=', val });
            return builder;
          },
          like: (col: string, val: any) => {
            filters.push({ col, op: 'LIKE', val });
            return builder;
          },
          ilike: (col: string, val: any) => {
            filters.push({ col, op: 'ILIKE', val });
            return builder;
          },
          not: (col: string, _op: string, val: any) => {
            if (val === null) {
              filters.push({ col, op: 'IS NOT', val: null });
            }
            return builder;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            orderCol = col;
            isAsc = opts?.ascending ?? true;
            return builder;
          },
          limit: (n: number) => {
            limitVal = n;
            return builder;
          },
          insert: (data: any) => {
            insertData = data;
            return builder;
          },
          update: (data: any) => {
            updateData = data;
            return builder;
          },
          maybeSingle: async () => {
            const res = await builder.then((v: any) => v);
            const item = Array.isArray(res.data) ? res.data[0] : res.data;
            return {
              data: item || null,
              error: res.error,
            };
          },
          single: async () => {
            const res = await builder.then((v: any) => v);
            const item = Array.isArray(res.data) ? res.data[0] : res.data;
            return {
              data: item || null,
              error: res.error,
            };
          },
          then: async (resolve: (v: any) => any) => {
            try {
              if (insertData) {
                const row = Array.isArray(insertData) ? insertData[0] : insertData;
                const cols = Object.keys(row);
                const vals = Object.values(row);
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`;
                const qRes = await db.query(query, vals);
                return resolve({ data: Array.isArray(insertData) ? qRes.rows : qRes.rows[0], error: null });
              }

              if (updateData) {
                const cols = Object.keys(updateData);
                const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
                const vals = cols.map((c) => updateData[c]);
                let whereClause = '';
                if (filters.length > 0) {
                  whereClause =
                    ' WHERE ' +
                    filters
                      .map((f, i) =>
                        f.op === 'IS NOT'
                          ? `${f.col} IS NOT NULL`
                          : `${f.col} ${f.op} $${vals.length + i + 1}`
                      )
                      .join(' AND ');
                  filters.forEach((f) => {
                    if (f.op !== 'IS NOT') vals.push(f.val);
                  });
                }
                const query = `UPDATE ${table} SET ${setClauses}${whereClause} RETURNING *`;
                const qRes = await db.query(query, vals);
                return resolve({ data: qRes.rows, error: null });
              }

              // SELECT
              let whereClause = '';
              const vals: any[] = [];
              if (filters.length > 0) {
                whereClause =
                  ' WHERE ' +
                  filters
                    .map((f, i) =>
                      f.op === 'IS NOT'
                        ? `${f.col} IS NOT NULL`
                        : `${f.col} ${f.op} $${i + 1}`
                    )
                    .join(' AND ');
                filters.forEach((f) => {
                  if (f.op !== 'IS NOT') vals.push(f.val);
                });
              }
              let orderClause = '';
              if (orderCol) {
                orderClause = ` ORDER BY ${orderCol} ${isAsc ? 'ASC' : 'DESC'}`;
              }
              let limitClause = '';
              if (limitVal !== null) {
                limitClause = ` LIMIT ${limitVal}`;
              }

              const query = `SELECT * FROM ${table}${whereClause}${orderClause}${limitClause}`;
              const qRes = await db.query(query, vals);
              return resolve({ data: qRes.rows, error: null });
            } catch (err: any) {
              return resolve({ data: null, error: err });
            }
          },
        };

        return builder;
      },
    };
  }

  it('1. SELLER A sends outbound message via WAHA E2E -> persisted with real WAHA message ID and seller_id', async () => {
    const shim = createPgShim(pg);
    const expectedWahaMsgId = 'false_5513974135365@c.us_3EB0C1C10PE5A111';

    // Mock WAHA HTTP fetch response with valid headers
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/sendText')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            id: expectedWahaMsgId,
            _data: { id: { id: expectedWahaMsgId, _serialized: expectedWahaMsgId } },
          }),
          text: async () => JSON.stringify({ id: expectedWahaMsgId }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '{}',
      };
    });

    const result = await sendMessageToConversation(shim as any, accountId, {
      conversationId: convId,
      senderUserId: sellerAId,
      messageType: 'text',
      contentText: 'V1.1.2 REAL OPERADOR A',
    });

    expect(result.whatsappMessageId).toBe(expectedWahaMsgId);

    // Verify row persisted in messages table
    const msgQuery = await pg.query(`SELECT * FROM messages WHERE id = '${result.messageId}';`);
    const savedMsg = msgQuery.rows[0] as any;
    expect(savedMsg.sender_type).toBe('agent');
    expect(savedMsg.sender_id).toBe(sellerAId);
    expect(savedMsg.message_id).toBe(expectedWahaMsgId);
    expect(savedMsg.source_provider).toBe('waha');
    expect(savedMsg.content_text).toBe('V1.1.2 REAL OPERADOR A');
  });

  it('2. SELLER B sends outbound message via WAHA E2E -> persisted with real WAHA message ID and seller_id B', async () => {
    const shim = createPgShim(pg);
    const expectedWahaMsgId = 'false_5513974135365@c.us_3EB0C1C10PE5B222';

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/sendText')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            id: expectedWahaMsgId,
            _data: { id: { id: expectedWahaMsgId, _serialized: expectedWahaMsgId } },
          }),
          text: async () => JSON.stringify({ id: expectedWahaMsgId }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '{}',
      };
    });

    const result = await sendMessageToConversation(shim as any, accountId, {
      conversationId: convId,
      senderUserId: sellerBId,
      messageType: 'text',
      contentText: 'V1.1.2 REAL OPERADOR B',
    });

    expect(result.whatsappMessageId).toBe(expectedWahaMsgId);

    const msgQuery = await pg.query(`SELECT * FROM messages WHERE id = '${result.messageId}';`);
    const savedMsg = msgQuery.rows[0] as any;
    expect(savedMsg.sender_type).toBe('agent');
    expect(savedMsg.sender_id).toBe(sellerBId);
    expect(savedMsg.message_id).toBe(expectedWahaMsgId);
    expect(savedMsg.source_provider).toBe('waha');
    expect(savedMsg.content_text).toBe('V1.1.2 REAL OPERADOR B');
  });

  it('3. Physical WhatsApp outbound sync (fromMe=true) -> persisted with sender_type=agent, sender_id=NULL', async () => {
    const shim = createPgShim(pg);
    const physicalMsgId = 'true_5513974135365@c.us_3EB0PHYSICAL999';

    const rawWahaPayload = {
      event: 'message',
      session: 'ciclopes_ec86e41e',
      payload: {
        id: physicalMsgId,
        timestamp: Math.floor(Date.now() / 1000),
        from: '5513974135365@c.us',
        fromMe: true,
        to: '5513974135365@c.us',
        body: 'V1.1.2 REAL PHYSICAL',
        _data: {
          id: { id: physicalMsgId, fromMe: true, remote: '5513974135365@c.us' },
          t: Math.floor(Date.now() / 1000),
          body: 'V1.1.2 REAL PHYSICAL',
          type: 'chat',
        },
      },
    };

    const norm = normalizeWahaInbound(rawWahaPayload, accountId);
    expect(norm).not.toBeNull();
    expect(norm!.type).toBe('message');
    expect((norm as NormalizedInboundMessageEvent).fromMe).toBe(true);

    const procRes = await processNormalizedInboundEvent({
      event: norm as NormalizedInboundMessageEvent,
      db: shim as any,
    });
    expect(procRes.processed).toBe(true);

    const msgQuery = await pg.query(`SELECT * FROM messages WHERE message_id = '${physicalMsgId}';`);
    expect(msgQuery.rows).toHaveLength(1);
    const savedMsg = msgQuery.rows[0] as any;
    expect(savedMsg.sender_type).toBe('agent');
    expect(savedMsg.sender_id).toBeNull();
    expect(savedMsg.message_id).toBe(physicalMsgId);
    expect(savedMsg.source_provider).toBe('waha');
    expect(savedMsg.content_text).toBe('V1.1.2 REAL PHYSICAL');
  });
});
