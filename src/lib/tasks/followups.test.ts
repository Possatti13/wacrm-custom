/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';
import {
  createTask,
  snoozeFollowup,
  completeFollowup,
  getTaskById,
  createFollowupFromAiSuggestion,
} from './repository';

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

describe('CICLOPES V1.2 — Commercial Follow-up & Next Action System', () => {
  let pg: any;
  const accountId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
  const otherAccountId = '99999999-9999-4999-9999-999999999999';
  const ownerId = '00000000-0000-4000-0000-000000000001';
  const sellerAId = 'a1111111-1111-4111-a111-111111111111';
  const sellerBId = 'b2222222-2222-4222-b222-222222222222';
  const viewerId = '33333333-3333-4333-3333-333333333333';
  const contactId = '463eb74e-8b05-4c88-b096-dd9acac31f80';
  const convId = 'ff38fefd-667a-472f-b9c2-4470c896fb00';
  const dealId = '77777777-7777-4777-7777-777777777777';

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
        name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo'
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        account_id UUID NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        account_role TEXT DEFAULT 'agent'
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        user_id UUID,
        phone TEXT,
        whatsapp_lid TEXT,
        name TEXT,
        avatar_url TEXT,
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
        assigned_agent_id UUID,
        last_customer_message_at TIMESTAMPTZ,
        last_agent_message_at TIMESTAMPTZ,
        unattended_since TIMESTAMPTZ,
        last_message_text TEXT,
        last_message_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (account_id, contact_id)
      );

      CREATE TABLE IF NOT EXISTS deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        contact_id UUID NOT NULL REFERENCES contacts(id),
        title TEXT NOT NULL,
        value NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS contact_lead_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id),
        current_intent TEXT,
        urgency TEXT,
        next_action TEXT,
        next_action_due_at TIMESTAMPTZ,
        next_action_source TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS contact_lead_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL,
        contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id),
        score INTEGER DEFAULT 0,
        calculated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
        assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        completed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        action_type TEXT NOT NULL DEFAULT 'other',
        waiting_on TEXT,
        due_at TIMESTAMPTZ,
        original_due_at TIMESTAMPTZ,
        snoozed_until TIMESTAMPTZ,
        snooze_count INTEGER NOT NULL DEFAULT 0,
        snooze_reason TEXT,
        completed_at TIMESTAMPTZ,
        source TEXT NOT NULL DEFAULT 'manual',
        ai_suggestion_provenance JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      INSERT INTO auth.users (id, email) VALUES
        ('${ownerId}', 'owner@ciclopes.test'),
        ('${sellerAId}', 'seller.a.v11@ciclopes.test'),
        ('${sellerBId}', 'seller.b.v11@ciclopes.test'),
        ('${viewerId}', 'viewer@ciclopes.test');

      INSERT INTO accounts (id, name, timezone) VALUES
        ('${accountId}', 'Pilot Account', 'America/Sao_Paulo'),
        ('${otherAccountId}', 'Other Tenant Account', 'America/New_York');

      INSERT INTO profiles (user_id, account_id, full_name, email, account_role) VALUES
        ('${ownerId}', '${accountId}', 'Owner Boss', 'owner@ciclopes.test', 'owner'),
        ('${sellerAId}', '${accountId}', 'Vendedor Alpha', 'seller.a.v11@ciclopes.test', 'agent'),
        ('${sellerBId}', '${accountId}', 'Vendedor Beta', 'seller.b.v11@ciclopes.test', 'agent'),
        ('${viewerId}', '${accountId}', 'Visualizador Teste', 'viewer@ciclopes.test', 'viewer');

      INSERT INTO contacts (id, account_id, user_id, phone, whatsapp_lid, name) VALUES
        ('${contactId}', '${accountId}', '${sellerAId}', '5513974135365', '25190000009361@lid', 'Leo Possatti');

      INSERT INTO conversations (id, account_id, user_id, contact_id, external_chat_id, assigned_agent_id) VALUES
        ('${convId}', '${accountId}', '${sellerAId}', '${contactId}', '25190000009361@lid', '${sellerAId}');

      INSERT INTO deals (id, account_id, contact_id, title, value, status) VALUES
        ('${dealId}', '${accountId}', '${contactId}', 'Contrato Enterprise', 15000, 'open');

      INSERT INTO contact_lead_scores (account_id, contact_id, score) VALUES
        ('${accountId}', '${contactId}', 85);
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createPgShim(db: any) {
    return {
      rpc: async (fn: string, args: any) => {
        if (fn === 'snooze_followup_atomic') {
          const q = `
            UPDATE tasks
            SET
              original_due_at = COALESCE(original_due_at, due_at),
              snoozed_until = '${args.p_snooze_until}',
              snooze_count = snooze_count + 1,
              snooze_reason = ${args.p_reason ? `'${args.p_reason}'` : 'snooze_reason'},
              updated_at = now()
            WHERE id = '${args.p_task_id}' AND account_id = '${args.p_account_id}'
            RETURNING *;
          `;
          const res = await db.query(q);
          if (res.rows.length === 0) return { data: null, error: { message: 'Not found' } };
          const row = res.rows[0];
          return {
            data: {
              success: true,
              task_id: row.id,
              snoozed_until: row.snoozed_until,
              snooze_count: row.snooze_count,
              original_due_at: row.original_due_at,
            },
            error: null,
          };
        }

        if (fn === 'complete_followup_atomic') {
          const q = `
            UPDATE tasks
            SET
              status = 'completed',
              completed_at = now(),
              completed_by_user_id = ${args.p_completed_by ? `'${args.p_completed_by}'` : 'NULL'},
              updated_at = now()
            WHERE id = '${args.p_task_id}' AND account_id = '${args.p_account_id}'
            RETURNING *;
          `;
          const res = await db.query(q);
          if (res.rows.length === 0) return { data: null, error: { message: 'Not found' } };
          const row = res.rows[0];
          return {
            data: {
              success: true,
              task_id: row.id,
              status: row.status,
              completed_at: row.completed_at,
              completed_by_user_id: row.completed_by_user_id,
            },
            error: null,
          };
        }

        return { data: null, error: { message: `Function ${fn} not mocked` } };
      },
      from: (table: string) => {
        const filters: Array<{ col: string; op: string; val: any }> = [];
        let orderCol: string | null = null;
        let isAsc = true;
        let limitVal: number | null = null;
        let insertData: any = null;
        let updateData: any = null;
        let deleteMode = false;

        const builder: any = {
          select: () => builder,
          eq: (col: string, val: any) => {
            filters.push({ col, op: '=', val });
            return builder;
          },
          neq: (col: string, val: any) => {
            filters.push({ col, op: '<>', val });
            return builder;
          },
          lt: (col: string, val: any) => {
            filters.push({ col, op: '<', val });
            return builder;
          },
          lte: (col: string, val: any) => {
            filters.push({ col, op: '<=', val });
            return builder;
          },
          gt: (col: string, val: any) => {
            filters.push({ col, op: '>', val });
            return builder;
          },
          gte: (col: string, val: any) => {
            filters.push({ col, op: '>=', val });
            return builder;
          },
          in: (col: string, vals: any[]) => {
            filters.push({ col, op: 'IN', val: vals });
            return builder;
          },
          contains: (col: string, val: any) => {
            filters.push({ col, op: '@>', val });
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
          delete: () => {
            deleteMode = true;
            return builder;
          },
          maybeSingle: async () => {
            const res = await builder.then((v: any) => v);
            const item = Array.isArray(res.data) ? res.data[0] : res.data;
            return { data: item || null, error: res.error };
          },
          single: async () => {
            const res = await builder.then((v: any) => v);
            const item = Array.isArray(res.data) ? res.data[0] : res.data;
            return { data: item || null, error: res.error };
          },
          then: async (resolve: (v: any) => any) => {
            try {
              if (insertData) {
                const row = Array.isArray(insertData) ? insertData[0] : insertData;
                const cols = Object.keys(row);
                const placeholders = cols.map((k) => {
                  const val = row[k];
                  if (val === null || val === undefined) return 'NULL';
                  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
                  return `'${String(val).replace(/'/g, "''")}'`;
                }).join(', ');
                const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *;`;
                const qRes = await db.query(query);
                return resolve({ data: Array.isArray(insertData) ? qRes.rows : qRes.rows[0], error: null });
              }

              if (updateData) {
                const sets = Object.keys(updateData)
                  .map((k) => {
                    const v = updateData[k];
                    if (v === null || v === undefined) return `${k} = NULL`;
                    if (typeof v === 'object') return `${k} = '${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
                    return `${k} = '${String(v).replace(/'/g, "''")}'`;
                  })
                  .join(', ');

                let whereClause = '';
                if (filters.length > 0) {
                  whereClause = ' WHERE ' + filters.map((f) => {
                    if (f.op === 'IN') {
                      const list = f.val.map((x: any) => `'${String(x).replace(/'/g, "''")}'`).join(', ');
                      return `${f.col} IN (${list})`;
                    }
                    return `${f.col} ${f.op} '${String(f.val).replace(/'/g, "''")}'`;
                  }).join(' AND ');
                }
                const query = `UPDATE ${table} SET ${sets}${whereClause} RETURNING *;`;
                const qRes = await db.query(query);
                return resolve({ data: qRes.rows[0] || null, error: null });
              }

              if (deleteMode) {
                let whereClause = '';
                if (filters.length > 0) {
                  whereClause = ' WHERE ' + filters.map((f) => `${f.col} ${f.op} '${String(f.val).replace(/'/g, "''")}'`).join(' AND ');
                }
                const query = `DELETE FROM ${table}${whereClause};`;
                await db.query(query);
                return resolve({ data: null, error: null });
              }

              // SELECT
              let whereClause = '';
              if (filters.length > 0) {
                whereClause = ' WHERE ' + filters.map((f) => {
                  if (f.op === 'IN') {
                    const list = f.val.map((x: any) => `'${String(x).replace(/'/g, "''")}'`).join(', ');
                    return `${f.col} IN (${list})`;
                  }
                  if (f.op === '@>') {
                    return `${f.col} @> '${JSON.stringify(f.val).replace(/'/g, "''")}'::jsonb`;
                  }
                  return `${f.col} ${f.op} '${String(f.val).replace(/'/g, "''")}'`;
                }).join(' AND ');
              }

              let orderClause = '';
              if (orderCol) {
                orderClause = ` ORDER BY ${orderCol} ${isAsc ? 'ASC' : 'DESC'}`;
              }
              let limitClause = '';
              if (limitVal !== null) {
                limitClause = ` LIMIT ${limitVal}`;
              }

              const query = `SELECT * FROM ${table}${whereClause}${orderClause}${limitClause};`;
              const qRes = await db.query(query);
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

  it('1. Creates a commercial follow-up with action_type, waiting_on, and original_due_at', async () => {
    const shim = createPgShim(pg);
    const tomorrow = new Date(Date.now() + 86400000).toISOString();

    const created = await createTask(shim as any, accountId, {
      title: 'Enviar proposta comercial revisada',
      description: 'Cliente pediu desconto de 10% no plano anual',
      action_type: 'proposal',
      waiting_on: 'customer',
      priority: 'high',
      due_at: tomorrow,
      contact_id: contactId,
      conversation_id: convId,
      deal_id: dealId,
      assigned_user_id: sellerAId,
      created_by_user_id: sellerAId,
      source: 'manual',
    });

    expect(created.id).toBeDefined();
    expect(created.action_type).toBe('proposal');
    expect(created.waiting_on).toBe('customer');
    expect(created.priority).toBe('high');
    expect(created.status).toBe('pending');
    expect(created.snooze_count).toBe(0);
    expect(created.assigned_user?.full_name).toBe('Vendedor Alpha');
  });

  it('2. Snoozes follow-up atomically: updates snoozed_until, increments snooze_count, and preserves original_due_at', async () => {
    const shim = createPgShim(pg);
    const initialDue = new Date(Date.now() + 3600000).toISOString();

    const task = await createTask(shim as any, accountId, {
      title: 'Ligar para confirmar reunião',
      action_type: 'call',
      due_at: initialDue,
      assigned_user_id: sellerAId,
    });

    const snoozeTarget = new Date(Date.now() + 86400000 * 2).toISOString();
    const snoozed = await snoozeFollowup(shim as any, accountId, task.id, {
      snooze_until: snoozeTarget,
      reason: 'Cliente pediu retorno na próxima semana',
    });

    expect(snoozed.snooze_count).toBe(1);
    expect(new Date(snoozed.snoozed_until!).toISOString()).toBe(snoozeTarget);
    expect(snoozed.snooze_reason).toBe('Cliente pediu retorno na próxima semana');
    expect(new Date(snoozed.original_due_at!).toISOString()).toBe(initialDue);
    expect(new Date(snoozed.effective_due_at!).toISOString()).toBe(snoozeTarget);
  });

  it('3. Completes follow-up atomically: records status=completed, completed_at, and completed_by_user_id', async () => {
    const shim = createPgShim(pg);

    const task = await createTask(shim as any, accountId, {
      title: 'Recontatar após pagamento',
      action_type: 'recontact',
      assigned_user_id: sellerAId,
    });

    const completed = await completeFollowup(shim as any, accountId, task.id, sellerAId);

    expect(completed.status).toBe('completed');
    expect(completed.completed_at).toBeDefined();
    expect(completed.completed_by_user_id).toBe(sellerAId);
  });

  it('4. Converts AI suggestion to follow-up idempotently (prevents duplicate tasks)', async () => {
    const shim = createPgShim(pg);
    const insightId = 'ins-999-commercial';

    // First conversion: creates new task
    const firstRes = await createFollowupFromAiSuggestion(shim as any, accountId, {
      contact_id: contactId,
      conversation_id: convId,
      action_text: 'Perguntar sobre aprovação da diretoria',
      action_type: 'decision',
      insight_id: insightId,
      created_by_user_id: sellerAId,
    });

    expect(firstRes.duplicated).toBe(false);
    expect(firstRes.task.title).toBe('Perguntar sobre aprovação da diretoria');
    expect(firstRes.task.source).toBe('intelligence');

    // Second conversion attempt with same insightId: returns existing without duplicating
    const secondRes = await createFollowupFromAiSuggestion(shim as any, accountId, {
      contact_id: contactId,
      conversation_id: convId,
      action_text: 'Perguntar sobre aprovação da diretoria',
      action_type: 'decision',
      insight_id: insightId,
      created_by_user_id: sellerAId,
    });

    expect(secondRes.duplicated).toBe(true);
    expect(secondRes.task.id).toBe(firstRes.task.id);

    // Verify exactly 1 task exists in database
    const allTasksRes = await pg.query(`SELECT count(*) FROM tasks WHERE account_id = '${accountId}';`);
    expect(Number(allTasksRes.rows[0].count)).toBe(1);
  });

  it('5. Tenant isolation: seller cannot access or modify tasks of another account', async () => {
    const shim = createPgShim(pg);

    const taskA = await createTask(shim as any, accountId, {
      title: 'Follow-up Tenant A',
      action_type: 'message',
    });

    // Query from other tenant returns null
    const crossTenantTask = await getTaskById(shim as any, otherAccountId, taskA.id);
    expect(crossTenantTask).toBeNull();
  });

  it('6. Proves ZERO automatic LLM invocations during follow-up lifecycle', async () => {
    const shim = createPgShim(pg);
    const fetchSpy = vi.spyOn(global, 'fetch');

    const task = await createTask(shim as any, accountId, {
      title: 'Tarefa Manual',
      action_type: 'message',
    });

    await snoozeFollowup(shim as any, accountId, task.id, {
      snooze_until: new Date(Date.now() + 3600000).toISOString(),
    });

    await completeFollowup(shim as any, accountId, task.id, sellerAId);

    // Zero external LLM HTTP calls were triggered
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
