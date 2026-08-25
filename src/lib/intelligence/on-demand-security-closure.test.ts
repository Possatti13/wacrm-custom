/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  executeOnDemandAiAction,
  computeInputFingerprint,
} from './on-demand';
import {
  getMockProviderCallCount,
  resetMockProviderCallCount,
} from './providers/mock';

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

describe('Phase 16.1 — Internal AI Security Closure & Least Privilege Hardening', () => {
  let db: any;
  let tenantAId: string;
  let tenantBId: string;
  const userAId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const userBId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const convAId = '11111111-1111-4111-a111-111111111111';
  const convBId = '22222222-2222-4222-a222-222222222222';
  const msgA1Id = '33333333-3333-4333-a333-333333333331';
  const msgB1Id = '44444444-4444-4444-a444-444444444441';
  const contactAId = '55555555-5555-4555-a555-555555555551';
  const contactBId = '66666666-6666-4666-a666-666666666661';

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

    // Replay migrations 001 -> 063
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

    // Seed tenants & users
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${userAId}', 'agent@tenanta.com') ON CONFLICT DO NOTHING;
      INSERT INTO auth.users (id, email) VALUES ('${userBId}', 'agent@tenantb.com') ON CONFLICT DO NOTHING;
    `);

    const accRes = await db.query(`SELECT id, owner_user_id FROM public.accounts;`);
    const accA = accRes.rows.find((r: any) => r.owner_user_id === userAId);
    const accB = accRes.rows.find((r: any) => r.owner_user_id === userBId);
    tenantAId = accA.id;
    tenantBId = accB.id;

    // Seed contacts & conversations
    await db.exec(`
      INSERT INTO public.contacts (id, account_id, user_id, name, phone)
      VALUES ('${contactAId}', '${tenantAId}', '${userAId}', 'Cliente A', '+5511900000001');

      INSERT INTO public.contacts (id, account_id, user_id, name, phone)
      VALUES ('${contactBId}', '${tenantBId}', '${userBId}', 'Cliente B', '+5511900000002');

      INSERT INTO public.conversations (id, account_id, user_id, contact_id, status)
      VALUES ('${convAId}', '${tenantAId}', '${userAId}', '${contactAId}', 'open');

      INSERT INTO public.conversations (id, account_id, user_id, contact_id, status)
      VALUES ('${convBId}', '${tenantBId}', '${userBId}', '${contactBId}', 'open');

      INSERT INTO public.messages (id, conversation_id, sender_type, content_text, created_at)
      VALUES ('${msgA1Id}', '${convAId}', 'customer', 'Olá Tenho interesse no produto A', now());

      INSERT INTO public.messages (id, conversation_id, sender_type, content_text, created_at)
      VALUES ('${msgB1Id}', '${convBId}', 'customer', 'Olá Tenho interesse no produto B', now());
    `);
  });

  const setAuthContext = async (userId: string | null, role = 'authenticated') => {
    if (!userId) {
      await db.exec(`
        RESET ROLE;
        SET "request.jwt.claim.sub" = '';
        SET "request.jwt.claim.role" = 'anon';
        SET ROLE anon;
      `);
    } else {
      await db.exec(`
        RESET ROLE;
        SET "request.jwt.claim.sub" = '${userId}';
        SET "request.jwt.claim.role" = '${role}';
        SET ROLE ${role};
      `);
    }
  };

  const resetRole = async () => {
    await db.exec(`
      RESET ROLE;
      SET "request.jwt.claim.sub" = '';
      SET "request.jwt.claim.role" = 'service_role';
    `);
  };

  // ------------------------------------------------------------
  // 1. enqueue_intelligence_extraction Permissions & Integrity
  // ------------------------------------------------------------
  it('denies direct enqueue_intelligence_extraction execute to anon and authenticated callers', async () => {
    // 1. Anon
    await setAuthContext(null, 'anon');
    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`)
    ).rejects.toThrow(/permission denied/i);

    // 2. Authenticated user
    await setAuthContext(userAId, 'authenticated');
    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`)
    ).rejects.toThrow(/permission denied/i);

    // 3. Service role succeeds
    await resetRole();
    const res = await db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`);
    expect(res.rows.length).toBe(1);
  });

  it('verifies account and conversation integrity in enqueue_intelligence_extraction (defense-in-depth)', async () => {
    await resetRole();

    // Account A with Conversation B -> Reject
    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convBId}', NULL);`)
    ).rejects.toThrow(/Integrity error: conversation.*does not belong to account/i);

    // Conversation A with Message from Conversation B -> Reject
    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgB1Id}');`)
    ).rejects.toThrow(/Integrity error: message.*does not belong to conversation/i);
  });

  // ------------------------------------------------------------
  // 2. Direct Mutation Lockdown on Tables
  // ------------------------------------------------------------
  it('denies direct INSERT and UPDATE on internal_ai_requests by authenticated users', async () => {
    await setAuthContext(userAId, 'authenticated');

    // Direct INSERT attempt
    await expect(
      db.exec(`
        INSERT INTO public.internal_ai_requests (
          account_id, action_type, target_type, target_id, input_fingerprint, status
        ) VALUES (
          '${tenantAId}', 'summarize_conversation', 'conversation', '${convAId}', 'fp-test', 'completed'
        );
      `)
    ).rejects.toThrow(/permission denied/i);

    // Direct UPDATE attempt
    await expect(
      db.exec(`
        UPDATE public.internal_ai_requests
        SET status = 'completed', estimated_cost = 0;
      `)
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies direct INSERT on ai_usage_log by authenticated users (prevents cost fabrication)', async () => {
    await setAuthContext(userAId, 'authenticated');

    await expect(
      db.exec(`
        INSERT INTO public.ai_usage_log (
          account_id, mode, provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost
        ) VALUES (
          '${tenantAId}', 'internal_on_demand', 'openai', 'gpt-4o-mini', 0, 0, 0, 0
        );
      `)
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies direct UPDATE on tenant_intelligence_settings by authenticated users', async () => {
    await setAuthContext(userAId, 'authenticated');

    await expect(
      db.exec(`
        UPDATE public.tenant_intelligence_settings
        SET invocation_mode = 'automatic', enabled = true
        WHERE account_id = '${tenantAId}';
      `)
    ).rejects.toThrow(/permission denied/i);
  });

  // ------------------------------------------------------------
  // 3. Cross-Tenant Integrity in claim_internal_ai_request
  // ------------------------------------------------------------
  it('enforces composite foreign key & rejects cross-tenant cached_from references', async () => {
    await resetRole();

    // Create completed request in Tenant B
    const reqBRes = await db.query(`
      INSERT INTO public.internal_ai_requests (
        account_id, action_type, target_type, target_id, input_fingerprint, status, provider, model
      ) VALUES (
        '${tenantBId}', 'summarize_conversation', 'conversation', '${convBId}', 'fp-b', 'completed', 'openai', 'gpt-4o-mini'
      ) RETURNING id;
    `);
    const reqBId = reqBRes.rows[0].id;

    // Attempt to link Tenant A request with Tenant B cached request
    await expect(
      db.exec(`
        INSERT INTO public.internal_ai_requests (
          account_id, action_type, target_type, target_id, input_fingerprint, status, cached_from_request_id, provider, model
        ) VALUES (
          '${tenantAId}', 'summarize_conversation', 'conversation', '${convAId}', 'fp-a', 'cached', '${reqBId}', 'openai', 'gpt-4o-mini'
        );
      `)
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it('rejects cross-tenant requested_by user and target in claim_internal_ai_request RPC', async () => {
    await setAuthContext(userAId, 'authenticated');

    // Tenant A with User B (belongs to Tenant B) -> Reject
    await expect(
      db.query(`
        SELECT public.claim_internal_ai_request(
          '${tenantAId}',
          '${userBId}',
          'conversation',
          '${convAId}',
          'summarize_conversation',
          'fp-cross-user'
        );
      `)
    ).rejects.toThrow(/requested_by user.*is not a member of account/i);

    // Tenant A with Conversation B (belongs to Tenant B) -> Reject
    await expect(
      db.query(`
        SELECT public.claim_internal_ai_request(
          '${tenantAId}',
          '${userAId}',
          'conversation',
          '${convBId}',
          'summarize_conversation',
          'fp-cross-target'
        );
      `)
    ).rejects.toThrow(/conversation.*does not belong to account/i);
  });

  // ------------------------------------------------------------
  // 4. Economic Attack Test & Lifecycle Flow
  // ------------------------------------------------------------
  it('proves economic attack resistance: spamming unauthorized RPCs produces 0 jobs & 0 LLM calls', async () => {
    // Malicious user attempts unauthorized enqueue calls
    await setAuthContext(userAId, 'authenticated');

    for (let i = 0; i < 10; i++) {
      await expect(
        db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`)
      ).rejects.toThrow(/permission denied/i);
    }

    expect(getMockProviderCallCount()).toBe(0);

    await resetRole();
    const queueRes = await db.query(`SELECT count(*) FROM pgmq.messages_log;`);
    expect(Number(queueRes.rows[0].count)).toBe(0);
  });

  it('proves get_tenant_ai_cost_stats membership isolation: Tenant A cannot read Tenant B stats', async () => {
    // User A reads Tenant A stats -> OK
    await setAuthContext(userAId, 'authenticated');
    const statsA = await db.query(`SELECT public.get_tenant_ai_cost_stats('${tenantAId}');`);
    expect(statsA.rows.length).toBe(1);

    // User A attempts to read Tenant B stats -> Access Denied
    await expect(
      db.query(`SELECT public.get_tenant_ai_cost_stats('${tenantBId}');`)
    ).rejects.toThrow(/Access denied: viewer role required for account/i);
  });
});
