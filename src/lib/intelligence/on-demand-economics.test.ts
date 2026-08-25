/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  getMockProviderCallCount,
  resetMockProviderCallCount,
} from './providers/mock';
import {
  executeOnDemandAiAction,
  computeInputFingerprint,
  estimateTokenCost,
  sanitizePii,
} from './on-demand';

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

describe('Phase 16 — Internal On-Demand AI Economics & Invocation Tests', () => {
  let db: any;
  let tenantAId: string;
  const userAId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const contactAId = '33333333-3333-4333-a333-333333333333';
  const convAId = '44444444-4444-4444-a444-444444444444';

  beforeEach(async () => {
    resetMockProviderCallCount();
    db = new PGlite();

    // 1. Bootstrap full environment
    await db.exec(`
      CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS UUID AS $$
        SELECT gen_random_uuid();
      $$ LANGUAGE sql;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT,
        raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')::TEXT;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
        SELECT '{}'::JSONB;
      $$ LANGUAGE sql STABLE;

      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner UUID,
        public BOOLEAN DEFAULT false,
        avif_autodetection BOOLEAN DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[],
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        last_accessed_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb,
        path_tokens TEXT[]
      );

      CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] AS $$
        SELECT string_to_array(name, '/');
      $$ LANGUAGE sql;
      CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text AS $$
        SELECT split_part(name, '/', -1);
      $$ LANGUAGE sql;
      CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text AS $$
        SELECT split_part(name, '.', -1);
      $$ LANGUAGE sql;

      CREATE OR REPLACE FUNCTION mock_vector_distance(a text, b text) RETURNS float8 AS $$
        SELECT 0.0::float8;
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OPERATOR <=> (
        LEFTARG = text,
        RIGHTARG = text,
        PROCEDURE = mock_vector_distance
      );

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
          CREATE PUBLICATION supabase_realtime;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS pgmq;
      CREATE TABLE IF NOT EXISTS pgmq.meta (queue_name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS pgmq.messages_log (
        id BIGSERIAL PRIMARY KEY,
        queue_name TEXT,
        msg JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION pgmq.create(queue_name text) RETURNS void AS $$
      BEGIN
        INSERT INTO pgmq.meta (queue_name) VALUES (queue_name) ON CONFLICT DO NOTHING;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION pgmq.create_unlogged(queue_name text) RETURNS void AS $$
      BEGIN
        INSERT INTO pgmq.meta (queue_name) VALUES (queue_name) ON CONFLICT DO NOTHING;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION pgmq.send(queue_name text, msg jsonb) RETURNS bigint AS $$
      DECLARE v_id BIGINT;
      BEGIN
        INSERT INTO pgmq.messages_log (queue_name, msg) VALUES (queue_name, msg) RETURNING id INTO v_id;
        RETURN v_id;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION pgmq.read(queue_name text, p_vt integer, qty integer)
      RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb) AS $$
      BEGIN
        RETURN QUERY SELECT id, 1, created_at, created_at + interval '120 seconds', msg
        FROM pgmq.messages_log WHERE queue_name = $1 LIMIT qty;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION pgmq.archive(queue_name text, msg_id bigint) RETURNS boolean AS $$
      BEGIN RETURN true; END; $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION pgmq.set_vt(queue_name text, p_msg_id bigint, p_vt integer) RETURNS timestamptz AS $$
      BEGIN RETURN now(); END; $$ LANGUAGE plpgsql;
    `);

    // 2. Replay all migrations 001 -> 062
    const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      let sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS[^;]+;/gi, '--');
      if (sql.includes('vector')) {
        sql = sql.replace(/vector\(\d+\)/g, 'text');
        sql = sql.replace(/CREATE INDEX.*USING hnsw.*;/g, '--');
        sql = sql.replace(/CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_embedding_idx[\s\S]*?USING hnsw[\s\S]*?;/g, '--');
      }
      await db.exec(sql);
    }

    // 3. Seed user and retrieve auto-generated account
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${userAId}', 'agent@tenanta.com')
      ON CONFLICT DO NOTHING;
    `);

    const accRes = await db.query(`SELECT id FROM public.accounts WHERE owner_user_id = '${userAId}';`);
    tenantAId = accRes.rows[0].id;

    await db.exec(`
      INSERT INTO public.contacts (id, account_id, user_id, name, phone) VALUES
        ('${contactAId}', '${tenantAId}', '${userAId}', 'Cliente Lead 1', '+5511999990001')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.conversations (id, account_id, user_id, contact_id, status) VALUES
        ('${convAId}', '${tenantAId}', '${userAId}', '${contactAId}', 'open')
      ON CONFLICT DO NOTHING;
    `);
  });

  it('proves the core economic invariant: 100 customer messages in ON_DEMAND mode produce ZERO automatic intelligence jobs and ZERO LLM calls', async () => {
    // 1. Configure tenant for ON_DEMAND mode (the default)
    await db.exec(`
      INSERT INTO public.tenant_intelligence_settings (
        account_id, enabled, invocation_mode, provider, model
      ) VALUES (
        '${tenantAId}', true, 'on_demand', 'mock', 'mock-model-v1'
      ) ON CONFLICT (account_id) DO UPDATE SET
        enabled = true,
        invocation_mode = 'on_demand',
        provider = 'mock';
    `);

    expect(getMockProviderCallCount()).toBe(0);

    // 2. Ingest 100 customer inbound messages
    for (let i = 1; i <= 100; i++) {
      await db.exec(`
        INSERT INTO public.messages (
          id, conversation_id, sender_type, content_text, created_at
        ) VALUES (
          gen_random_uuid(),
          '${convAId}',
          'customer',
          'Olá, tenho interesse na Falcon 400 mensagem #${i}',
          now() + interval '${i} seconds'
        );
      `);
    }

    // 3. Verify: 100 messages exist in CRM
    const msgCountRes = await db.query(
      `SELECT count(*) as count FROM public.messages WHERE conversation_id = '${convAId}';`
    );
    expect(Number(msgCountRes.rows[0].count)).toBe(100);

    // 4. Verify: ZERO jobs enqueued in pgmq intelligence_extraction
    const pgmqRes = await db.query(
      `SELECT count(*) as count FROM pgmq.messages_log WHERE queue_name = 'intelligence_extraction';`
    );
    expect(Number(pgmqRes.rows[0].count)).toBe(0);

    // 5. Verify: ZERO analysis runs created
    const runsRes = await db.query(
      `SELECT count(*) as count FROM public.conversation_analysis_runs WHERE conversation_id = '${convAId}';`
    );
    expect(Number(runsRes.rows[0].count)).toBe(0);

    // 6. Verify: ZERO provider calls made
    expect(getMockProviderCallCount()).toBe(0);
  });

  it('executes on-demand summarize action: 1 provider call, cached on repeat without new messages', async () => {
    await db.exec(`
      INSERT INTO public.tenant_intelligence_settings (
        account_id, enabled, invocation_mode, provider, model
      ) VALUES (
        '${tenantAId}', true, 'on_demand', 'mock', 'mock-model-v1'
      ) ON CONFLICT (account_id) DO UPDATE SET
        enabled = true,
        invocation_mode = 'on_demand',
        provider = 'mock';

      INSERT INTO public.messages (id, conversation_id, sender_type, content_text, created_at)
      VALUES (gen_random_uuid(), '${convAId}', 'customer', 'Quero comprar uma Falcon 400', now());
    `);

    // Create Supabase client shim for PGlite
    const dbShim: any = {
      from: (table: string) => ({
        select: (cols = '*') => ({
          eq: (f1: string, v1: any) => ({
            eq: (f2: string, v2: any) => ({
              eq: (f3: string, v3: any) => ({
                eq: (f4: string, v4: any) => ({
                  eq: (f5: string, v5: any) => ({
                    eq: (f6: string, v6: any) => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => {
                            const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' AND ${f2} = '${v2}' AND ${f3} = '${v3}' AND ${f4} = '${v4}' AND ${f5} = '${v5}' AND ${f6} = '${v6}' LIMIT 1;`);
                            return { data: res.rows[0] || null, error: null };
                          },
                        }),
                      }),
                      limit: () => ({
                        maybeSingle: async () => {
                          const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' AND ${f2} = '${v2}' AND ${f3} = '${v3}' AND ${f4} = '${v4}' AND ${f5} = '${v5}' AND ${f6} = '${v6}' LIMIT 1;`);
                          return { data: res.rows[0] || null, error: null };
                        },
                      }),
                    }),
                  }),
                }),
                maybeSingle: async () => {
                  const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' AND ${f2} = '${v2}' AND ${f3} = '${v3}' LIMIT 1;`);
                  return { data: res.rows[0] || null, error: null };
                },
              }),
              maybeSingle: async () => {
                const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' AND ${f2} = '${v2}' LIMIT 1;`);
                return { data: res.rows[0] || null, error: null };
              },
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' AND ${f2} = '${v2}' LIMIT 1;`);
                    return { data: res.rows[0] || null, error: null };
                  },
                }),
              }),
            }),
            maybeSingle: async () => {
              const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' LIMIT 1;`);
              return { data: res.rows[0] || null, error: null };
            },
            order: (orderCol: string, opts: any) => ({
              order: () => Promise.resolve({ data: [], error: null }),
              then: async (resolve: any) => {
                const res = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f1} = '${v1}' ORDER BY ${orderCol} ${opts?.ascending ? 'ASC' : 'DESC'};`);
                resolve({ data: res.rows, error: null });
              },
            }),
          }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              const keys = Object.keys(row);
              const vals = Object.values(row).map((v) => (v === null ? 'NULL' : typeof v === 'object' ? `'${JSON.stringify(v)}'::jsonb` : `'${v}'`));
              const res = await db.query(`INSERT INTO public.${table} (${keys.join(',')}) VALUES (${vals.join(',')}) RETURNING *;`);
              return { data: res.rows[0], error: null };
            },
          }),
          catch: () => Promise.resolve(),
          then: async (resolve: any) => {
            const keys = Object.keys(row);
            const vals = Object.values(row).map((v) => (v === null ? 'NULL' : typeof v === 'object' ? `'${JSON.stringify(v)}'::jsonb` : `'${v}'`));
            await db.query(`INSERT INTO public.${table} (${keys.join(',')}) VALUES (${vals.join(',')});`);
            if (resolve) resolve({ data: null, error: null });
          },
        }),
        update: (row: any) => ({
          eq: (f1: string, v1: any) => ({
            select: () => ({
              single: async () => {
                const setClauses = Object.entries(row).map(([k, v]) => `${k} = ${v === null ? 'NULL' : typeof v === 'object' ? `'${JSON.stringify(v)}'::jsonb` : `'${v}'`}`);
                const res = await db.query(`UPDATE public.${table} SET ${setClauses.join(', ')} WHERE ${f1} = '${v1}' RETURNING *;`);
                return { data: res.rows[0], error: null };
              },
            }),
          }),
        }),
      }),
    };

    // First user explicit action: summarize
    const res1 = await executeOnDemandAiAction(dbShim, {
      accountId: tenantAId,
      targetType: 'conversation',
      targetId: convAId,
      actionType: 'summarize_conversation',
    });

    expect(res1.cached).toBe(false);
    expect(res1.freshness).toBe('fresh');
    expect(getMockProviderCallCount()).toBe(1);

    // Second action with same boundary: cache hit!
    const res2 = await executeOnDemandAiAction(dbShim, {
      accountId: tenantAId,
      targetType: 'conversation',
      targetId: convAId,
      actionType: 'summarize_conversation',
    });

    expect(res2.cached).toBe(true);
    expect(getMockProviderCallCount()).toBe(1); // STILL 1! Zero provider calls!
  });

  it('validates PII sanitization and pricing calculation', () => {
    const raw = 'Cliente CPF: 123.456.789-00 e cartão 4111 2222 3333 4444 pediu proposta.';
    const clean = sanitizePii(raw);

    expect(clean).toContain('[CPF_PROTEGIDO]');
    expect(clean).toContain('[CARTAO_PROTEGIDO]');
    expect(clean).not.toContain('123.456.789-00');

    // Token cost calculation
    const cost = estimateTokenCost('gpt-4o-mini', 1000, 500);
    expect(cost).toBe(0.00045);
  });
});
