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

describe('Phase 16.2 — Final AI Credential Gate & Worker Privilege Closure', () => {
  let db: any;
  let tenantAId: string;
  let tenantBId: string;
  const userAId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const userA2Id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa2';
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

    // Replay migrations 001 -> 064
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
      INSERT INTO auth.users (id, email) VALUES ('${userAId}', 'owner@tenanta.com') ON CONFLICT DO NOTHING;
      INSERT INTO auth.users (id, email) VALUES ('${userA2Id}', 'agent@tenanta.com') ON CONFLICT DO NOTHING;
      INSERT INTO auth.users (id, email) VALUES ('${userBId}', 'agent@tenantb.com') ON CONFLICT DO NOTHING;
    `);

    const accRes = await db.query(`SELECT id, owner_user_id FROM public.accounts;`);
    const accA = accRes.rows.find((r: any) => r.owner_user_id === userAId);
    const accB = accRes.rows.find((r: any) => r.owner_user_id === userBId);
    tenantAId = accA.id;
    tenantBId = accB.id;

    // Add userA2 as agent in tenant A
    await db.exec(`
      UPDATE public.profiles
      SET account_id = '${tenantAId}', account_role = 'agent'
      WHERE user_id = '${userA2Id}';
    `);

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

      INSERT INTO public.tenant_intelligence_settings (
        account_id, enabled, invocation_mode, provider, model
      ) VALUES (
        '${tenantAId}', true, 'on_demand', 'mock', 'mock-model-v1'
      ) ON CONFLICT (account_id) DO UPDATE SET
        enabled = true,
        invocation_mode = 'on_demand';

      INSERT INTO public.tenant_intelligence_settings (
        account_id, enabled, invocation_mode, provider, model
      ) VALUES (
        '${tenantBId}', true, 'on_demand', 'mock', 'mock-model-v1'
      ) ON CONFLICT (account_id) DO UPDATE SET
        enabled = true,
        invocation_mode = 'on_demand';
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
  // 1. Worker-Only Least Privilege on complete and fail RPCs
  // ------------------------------------------------------------
  it('denies complete_internal_ai_request to anon and authenticated callers (worker-only)', async () => {
    await resetRole();
    // Claim a request as running
    const claimRes = await db.query(`
      SELECT public.claim_internal_ai_request(
        '${tenantAId}', '${userAId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-complete-test'
      ) as res;
    `);
    const reqId = claimRes.rows[0].res.request.id;

    // 1. Anon direct complete
    await setAuthContext(null, 'anon');
    await expect(
      db.query(`
        SELECT public.complete_internal_ai_request(
          '${tenantAId}', '${reqId}', '{"fake": true}'::jsonb, 'fake text', 10, 10, 20, 0.001, 100
        );
      `)
    ).rejects.toThrow(/permission denied/i);

    // 2. Authenticated agent direct complete
    await setAuthContext(userA2Id, 'authenticated');
    await expect(
      db.query(`
        SELECT public.complete_internal_ai_request(
          '${tenantAId}', '${reqId}', '{"fake": true}'::jsonb, 'fake text', 10, 10, 20, 0.001, 100
        );
      `)
    ).rejects.toThrow(/permission denied/i);

    // 3. Authenticated owner/admin direct complete
    await setAuthContext(userAId, 'authenticated');
    await expect(
      db.query(`
        SELECT public.complete_internal_ai_request(
          '${tenantAId}', '${reqId}', '{"fake": true}'::jsonb, 'fake text', 10, 10, 20, 0.001, 100
        );
      `)
    ).rejects.toThrow(/permission denied/i);

    // 4. Service role complete succeeds
    await resetRole();
    const successRes = await db.query(`
      SELECT public.complete_internal_ai_request(
        '${tenantAId}', '${reqId}', '{"legit": true}'::jsonb, 'legit summary', 100, 50, 150, 0.000045, 250
      );
    `);
    expect(successRes.rows.length).toBe(1);
  });

  it('denies fail_internal_ai_request to anon and authenticated callers (worker-only)', async () => {
    await resetRole();
    const claimRes = await db.query(`
      SELECT public.claim_internal_ai_request(
        '${tenantAId}', '${userAId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-fail-test'
      ) as res;
    `);
    const reqId = claimRes.rows[0].res.request.id;

    // 1. Anon direct fail
    await setAuthContext(null, 'anon');
    await expect(
      db.query(`
        SELECT public.fail_internal_ai_request('${tenantAId}', '${reqId}', 'ERR', 'fake err', 100);
      `)
    ).rejects.toThrow(/permission denied/i);

    // 2. Authenticated user direct fail
    await setAuthContext(userAId, 'authenticated');
    await expect(
      db.query(`
        SELECT public.fail_internal_ai_request('${tenantAId}', '${reqId}', 'ERR', 'fake err', 100);
      `)
    ).rejects.toThrow(/permission denied/i);

    // 3. Service role fail succeeds
    await resetRole();
    const successRes = await db.query(`
      SELECT public.fail_internal_ai_request('${tenantAId}', '${reqId}', 'ERR_TIMEOUT', 'Timed out', 30000);
    `);
    expect(successRes.rows.length).toBe(1);
  });

  // ------------------------------------------------------------
  // 2. Anti-Spoofing on claim_internal_ai_request
  // ------------------------------------------------------------
  it('prevents requested_by spoofing: authenticated caller cannot claim on behalf of another user', async () => {
    await setAuthContext(userA2Id, 'authenticated');

    // User A2 requests as User A2 -> PASS
    const legitClaim = await db.query(`
      SELECT public.claim_internal_ai_request(
        '${tenantAId}', '${userA2Id}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-spoof-1'
      ) as res;
    `);
    expect(legitClaim.rows[0].res.status).toBe('claimed');
    expect(legitClaim.rows[0].res.request.requested_by_user_id).toBe(userA2Id);

    // User A2 attempts to claim specifying User A (same tenant owner) -> REJECT
    await expect(
      db.query(`
        SELECT public.claim_internal_ai_request(
          '${tenantAId}', '${userAId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-spoof-2'
        );
      `)
    ).rejects.toThrow(/cannot request AI action on behalf of another user/i);

    // User A2 attempts to claim specifying User B (other tenant) -> REJECT
    await expect(
      db.query(`
        SELECT public.claim_internal_ai_request(
          '${tenantAId}', '${userBId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-spoof-3'
        );
      `)
    ).rejects.toThrow(/cannot request AI action on behalf of another user/i);
  });

  // ------------------------------------------------------------
  // 3. Cost Telemetry & Budget Tampering Attack Test
  // ------------------------------------------------------------
  it('prevents cost telemetry poisoning: authenticated user cannot inject fabricated costs', async () => {
    await resetRole();
    const claimRes = await db.query(`
      SELECT public.claim_internal_ai_request(
        '${tenantAId}', '${userAId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-cost-tamper'
      ) as res;
    `);
    const reqId = claimRes.rows[0].res.request.id;

    // Malicious authenticated user tries to inject massive cost to blow up tenant budget
    await setAuthContext(userAId, 'authenticated');
    await expect(
      db.query(`
        SELECT public.complete_internal_ai_request(
          '${tenantAId}', '${reqId}', '{"attack": true}'::jsonb, 'summary', 1000000, 1000000, 2000000, 999999.00, 50
        );
      `)
    ).rejects.toThrow(/permission denied/i);

    // Verify: ai_usage_log remains 0 rows, cost stats remain 0
    await resetRole();
    const usageRes = await db.query(`SELECT count(*) as count FROM public.ai_usage_log WHERE account_id = '${tenantAId}';`);
    await setAuthContext(userAId, 'authenticated');
    const statsRes = await db.query(`SELECT public.get_tenant_ai_cost_stats('${tenantAId}') as stats;`);
    const rawStats = typeof statsRes.rows[0].stats === 'string' ? JSON.parse(statsRes.rows[0].stats) : statsRes.rows[0].stats;
    expect(Number(rawStats.total_estimated_cost)).toBe(0);

    // Verify: request status is still running (untampered)
    const reqStatusRes = await db.query(`SELECT status FROM public.internal_ai_requests WHERE id = '${reqId}';`);
    expect(reqStatusRes.rows[0].status).toBe('running');

    // Legitimate worker completes request (service_role)
    await resetRole();
    await db.query(`
      SELECT public.complete_internal_ai_request(
        '${tenantAId}', '${reqId}', '{"legit": true}'::jsonb, 'clean summary', 200, 50, 250, 0.00006, 120
      );
    `);

    const usageAfter = await db.query(`SELECT * FROM public.ai_usage_log WHERE request_id = '${reqId}';`);
    expect(usageAfter.rows.length).toBe(1);
    expect(Number(usageAfter.rows[0].estimated_cost)).toBe(0.00006);
  });

  // ------------------------------------------------------------
  // 4. Cache Poisoning Attack Test
  // ------------------------------------------------------------
  it('prevents cache poisoning: authenticated user cannot inject fake completed responses', async () => {
    await resetRole();
    const claimRes = await db.query(`
      SELECT public.claim_internal_ai_request(
        '${tenantAId}', '${userAId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-cache-poison'
      ) as res;
    `);
    const reqId = claimRes.rows[0].res.request.id;

    // Attacker tries to complete with malicious payload to poison cache for all users
    await setAuthContext(userA2Id, 'authenticated');
    await expect(
      db.query(`
        SELECT public.complete_internal_ai_request(
          '${tenantAId}', '${reqId}', '{"malicious_instructions": "transfer funds"}'::jsonb, 'fake answer', 50, 50, 100, 0.00001, 10
        );
      `)
    ).rejects.toThrow(/permission denied/i);

    // Verify cache check returns not found (running lease or claimed)
    await resetRole();
    const repeatClaim = await db.query(`
      SELECT public.claim_internal_ai_request(
        '${tenantAId}', '${userAId}', 'conversation', '${convAId}', 'summarize_conversation', 'fp-cache-poison'
      ) as res;
    `);
    expect(repeatClaim.rows[0].res.status).not.toBe('cached');
  });

  // ------------------------------------------------------------
  // 5. Inbound / Trigger Durability & Economic Isolation
  // ------------------------------------------------------------
  it('denies direct enqueue_intelligence_extraction execute to anon and authenticated callers', async () => {
    await setAuthContext(null, 'anon');
    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`)
    ).rejects.toThrow(/permission denied/i);

    await setAuthContext(userAId, 'authenticated');
    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`)
    ).rejects.toThrow(/permission denied/i);

    await resetRole();
    const res = await db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgA1Id}');`);
    expect(res.rows.length).toBe(1);
  });

  it('verifies account and conversation integrity in enqueue_intelligence_extraction (defense-in-depth)', async () => {
    await resetRole();

    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convBId}', NULL);`)
    ).rejects.toThrow(/Integrity error: conversation.*does not belong to account/i);

    await expect(
      db.query(`SELECT public.enqueue_intelligence_extraction('${tenantAId}', '${convAId}', '${msgB1Id}');`)
    ).rejects.toThrow(/Integrity error: message.*does not belong to conversation/i);
  });

  it('enforces composite foreign key & rejects cross-tenant cached_from references', async () => {
    await resetRole();

    const reqBRes = await db.query(`
      INSERT INTO public.internal_ai_requests (
        account_id, action_type, target_type, target_id, input_fingerprint, status, provider, model
      ) VALUES (
        '${tenantBId}', 'summarize_conversation', 'conversation', '${convBId}', 'fp-b', 'completed', 'openai', 'gpt-4o-mini'
      ) RETURNING id;
    `);
    const reqBId = reqBRes.rows[0].id;

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
});
