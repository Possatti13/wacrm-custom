/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { routeCopilotQuery } from './router';
import {
  getMockProviderCallCount,
  resetMockProviderCallCount,
} from '../intelligence/providers/mock';

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

describe('Phase 16 — Deterministic-First Copilot Router Tests', () => {
  let db: any;
  let tenantAId: string;
  const userAId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const contactAId = '33333333-3333-4333-a333-333333333333';
  const convAId = '44444444-4444-4444-a444-444444444444';
  const itemAId = '55555555-5555-4555-a555-555555555555';
  const revAId = '66666666-6666-4666-a666-666666666666';

  beforeEach(async () => {
    resetMockProviderCallCount();
    db = new PGlite();

    // Bootstrap
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

    // Replay migrations 001 -> 062
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

    // Seed user and account under migration 092 invite-only model
    tenantAId = '11111111-1111-4111-a111-111111111111';
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${userAId}', 'agent@tenanta.com') ON CONFLICT DO NOTHING;
      INSERT INTO public.accounts (id, name, owner_user_id) VALUES ('${tenantAId}', 'Tenant A', '${userAId}') ON CONFLICT DO NOTHING;
      INSERT INTO public.profiles (user_id, email, full_name, account_id, account_role) VALUES ('${userAId}', 'agent@tenanta.com', 'Agent Tenant A', '${tenantAId}', 'owner') ON CONFLICT DO NOTHING;
    `);

    // Seed scoring revision
    await db.exec(`
      INSERT INTO public.lead_scoring_revisions (id, account_id, revision_number, snapshot, snapshot_hash)
      VALUES ('${revAId}', '${tenantAId}', 1, '{"base_score": 10}'::jsonb, 'hash-init')
      ON CONFLICT DO NOTHING;
    `);

    // Seed fixtures
    await db.exec(`
      INSERT INTO public.contacts (id, account_id, user_id, name, phone) VALUES ('${contactAId}', '${tenantAId}', '${userAId}', 'Carlos Falcon Silva', '+5511999990001') ON CONFLICT DO NOTHING;
      INSERT INTO public.conversations (id, account_id, user_id, contact_id, status, unread_count) VALUES ('${convAId}', '${tenantAId}', '${userAId}', '${contactAId}', 'open', 1) ON CONFLICT DO NOTHING;

      INSERT INTO public.catalog_items (id, account_id, name, type, sku, status)
      VALUES ('${itemAId}', '${tenantAId}', 'Falcon 400', 'product', 'FALCON-400', 'active')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.contact_catalog_interests (account_id, contact_id, catalog_item_id, status)
      VALUES ('${tenantAId}', '${contactAId}', '${itemAId}', 'active')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.contact_lead_scores (account_id, contact_id, score, scoring_revision_id, scoring_revision_number, input_fingerprint, breakdown)
      VALUES ('${tenantAId}', '${contactAId}', 85, '${revAId}', 1, 'fp-123', '{"base": 10, "intent": 30, "urgency": 20, "interests": 25}'::jsonb)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.contact_lead_profiles (account_id, contact_id, current_intent, urgency)
      VALUES ('${tenantAId}', '${contactAId}', 'purchase', 'high')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.tasks (id, account_id, contact_id, title, status, due_at, priority)
      VALUES (gen_random_uuid(), '${tenantAId}', '${contactAId}', 'Enviar contrato da Falcon', 'pending', now() - interval '2 days', 'urgent')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.messages (id, conversation_id, sender_type, content_text, created_at)
      VALUES (gen_random_uuid(), '${convAId}', 'customer', 'Qual o valor da entrada?', now())
      ON CONFLICT DO NOTHING;
    `);
  });

  const createDbShim = () => ({
    from: (table: string) => ({
      select: (cols = '*') => {
        const conditions: string[] = [];
        let orderBy = '';
        let limitClause = '';

        const chain: any = {
          eq: (field: string, val: any) => {
            conditions.push(`${field} = '${val}'`);
            return chain;
          },
          lt: (field: string, val: any) => {
            conditions.push(`${field} < '${val}'`);
            return chain;
          },
          or: (expr: string) => {
            const parsed = expr.split(',').map((p) => {
              const [f, op, val] = p.split('.');
              return `${f} ILIKE '${val}'`;
            }).join(' OR ');
            conditions.push(`(${parsed})`);
            return chain;
          },
          ilike: (field: string, val: any) => {
            conditions.push(`${field} ILIKE '${val}'`);
            return chain;
          },
          in: (field: string, vals: any[]) => {
            conditions.push(`${field} IN (${vals.map((v) => `'${v}'`).join(',')})`);
            return chain;
          },
          order: (col: string, opts?: any) => {
            orderBy = `ORDER BY ${col} ${opts?.ascending ? 'ASC' : 'DESC'}`;
            return chain;
          },
          limit: (n: number) => {
            limitClause = `LIMIT ${n}`;
            return chain;
          },
          maybeSingle: async () => {
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            let queryStr = `SELECT * FROM public.${table} ${where} ${orderBy} LIMIT 1;`;
            if (table === 'contact_lead_scores') {
              queryStr = `SELECT s.*, jsonb_build_object('name', c.name) as contacts, jsonb_build_object('current_intent', p.current_intent, 'urgency', p.urgency) as contact_lead_profiles FROM public.contact_lead_scores s LEFT JOIN public.contacts c ON s.contact_id = c.id LEFT JOIN public.contact_lead_profiles p ON s.contact_id = p.contact_id WHERE s.account_id = '${tenantAId}' LIMIT 1;`;
            }
            const res = await db.query(queryStr);
            return { data: res.rows[0] || null, error: null };
          },
          then: async (resolve: any) => {
            let queryStr = '';
            
            // Custom mock joins for nested objects in tests
            if (table === 'contact_catalog_interests') {
              queryStr = `SELECT i.*, jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) as contacts, jsonb_build_object('id', it.id, 'name', it.name, 'type', it.type) as catalog_items FROM public.contact_catalog_interests i JOIN public.contacts c ON i.contact_id = c.id JOIN public.catalog_items it ON i.catalog_item_id = it.id WHERE i.account_id = '${tenantAId}' ${orderBy} ${limitClause};`;
            } else if (table === 'contact_lead_scores') {
              queryStr = `SELECT s.*, jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) as contacts, jsonb_build_object('current_intent', p.current_intent, 'urgency', p.urgency) as contact_lead_profiles FROM public.contact_lead_scores s LEFT JOIN public.contacts c ON s.contact_id = c.id LEFT JOIN public.contact_lead_profiles p ON s.contact_id = p.contact_id WHERE s.account_id = '${tenantAId}' ${orderBy} ${limitClause};`;
            } else if (table === 'tasks') {
              queryStr = `SELECT t.*, jsonb_build_object('name', c.name) as contacts, jsonb_build_object('title', 'Deal') as deals FROM public.tasks t LEFT JOIN public.contacts c ON t.contact_id = c.id WHERE t.account_id = '${tenantAId}' AND t.status = 'pending' AND t.due_at < now() ${orderBy} ${limitClause};`;
            } else if (table === 'messages') {
              queryStr = `SELECT m.*, jsonb_build_object('contact_id', c.contact_id, 'contacts', jsonb_build_object('name', ct.name)) as conversations FROM public.messages m JOIN public.conversations c ON m.conversation_id = c.id JOIN public.contacts ct ON c.contact_id = ct.id WHERE c.account_id = '${tenantAId}' AND m.content_text ILIKE '%entrada%' ${orderBy} ${limitClause};`;
            } else if (table === 'conversations') {
              queryStr = `SELECT c.*, jsonb_build_object('name', ct.name, 'phone', ct.phone) as contacts, jsonb_agg(jsonb_build_object('id', m.id, 'sender_type', m.sender_type, 'content_text', m.content_text, 'created_at', m.created_at)) as messages FROM public.conversations c JOIN public.contacts ct ON c.contact_id = ct.id LEFT JOIN public.messages m ON m.conversation_id = c.id WHERE c.account_id = '${tenantAId}' GROUP BY c.id, ct.id ${orderBy} ${limitClause};`;
            } else {
              const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
              queryStr = `SELECT * FROM public.${table} ${where} ${orderBy} ${limitClause};`;
            }

            const res = await db.query(queryStr);
            resolve({ data: res.rows, error: null });
          },
        };
        return chain;
      },
    }),
  });

  it('resolves catalog interest queries via deterministic tool with ZERO LLM calls', async () => {
    const res = await routeCopilotQuery(
      createDbShim() as any,
      tenantAId,
      'Quem perguntou da Falcon?'
    );

    expect(res.source).toBe('deterministic_tool');
    expect(res.toolName).toBe('searchContactsByCatalogItem');
    expect(res.llmCalls).toBe(0);
    expect(res.responseText).toContain('Carlos Falcon Silva');
    expect(getMockProviderCallCount()).toBe(0);
  });

  it('resolves top lead score queries via deterministic tool with ZERO LLM calls', async () => {
    const res = await routeCopilotQuery(
      createDbShim() as any,
      tenantAId,
      'Me mostre os top leads com maior score'
    );

    expect(res.source).toBe('deterministic_tool');
    expect(res.toolName).toBe('getTopLeadScores');
    expect(res.llmCalls).toBe(0);
    expect(res.responseText).toContain('85/100');
    expect(getMockProviderCallCount()).toBe(0);
  });

  it('resolves overdue tasks queries via deterministic tool with ZERO LLM calls', async () => {
    const res = await routeCopilotQuery(
      createDbShim() as any,
      tenantAId,
      'Quais tarefas estão atrasadas?'
    );

    expect(res.source).toBe('deterministic_tool');
    expect(res.toolName).toBe('getOverdueTasks');
    expect(res.llmCalls).toBe(0);
    expect(res.responseText).toContain('Enviar contrato da Falcon');
    expect(getMockProviderCallCount()).toBe(0);
  });

  it('resolves message mention queries via deterministic tool with ZERO LLM calls', async () => {
    const res = await routeCopilotQuery(
      createDbShim() as any,
      tenantAId,
      'Quem falou "entrada"?'
    );

    expect(res.source).toBe('deterministic_tool');
    expect(res.toolName).toBe('searchMessageMentions');
    expect(res.llmCalls).toBe(0);
    expect(res.responseText).toContain('Qual o valor da entrada?');
    expect(getMockProviderCallCount()).toBe(0);
  });

  it('explains lead score deterministically without LLM calls', async () => {
    const res = await routeCopilotQuery(
      createDbShim() as any,
      tenantAId,
      'Por que o score é 85?',
      { contactId: contactAId }
    );

    expect(res.source).toBe('deterministic_tool');
    expect(res.toolName).toBe('explainLeadScore');
    expect(res.llmCalls).toBe(0);
    expect(res.responseText).toContain('85/100');
    expect(res.responseText).toContain('**Pontuação Base**: +10 pts');
    expect(getMockProviderCallCount()).toBe(0);
  });
});
