import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

interface DbClient {
  exec: (sql: string) => Promise<void>;
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
}

interface AccountRow {
  id: string;
  owner_user_id: string;
}

describe('PostgreSQL Physical Tenant & Pipeline Integrity (Migration 060)', () => {
  let db: DbClient;

  const tenantA_userId = '11111111-1111-1111-1111-111111111111';
  const tenantB_userId = '22222222-2222-2222-2222-222222222222';

  let tenantA_accountId: string;
  let tenantB_accountId: string;

  let tenantA_pipeline1Id: string;
  let tenantA_pipeline2Id: string;
  let tenantA_pipeline1Stage1Id: string;
  let tenantA_pipeline1Stage2Id: string;
  let tenantA_pipeline2Stage1Id: string;

  let tenantB_pipeline1Id: string;
  let tenantB_pipeline1Stage1Id: string;

  let tenantA_contactId: string;
  let tenantB_contactId: string;

  let tenantA_dealId: string;
  let tenantB_dealId: string;

  beforeAll(async () => {
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
    db = new PGlite();

    // 1. Bootstrap mock PostgreSQL environment
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
    `);

    // 2. Replay all migrations 001 -> 060
    const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
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

    // 3. Seed two separate tenants
    await db.query(`
      INSERT INTO auth.users (id, email) VALUES
      ('${tenantA_userId}'::uuid, 'alice@tenant-a.com'),
      ('${tenantB_userId}'::uuid, 'bob@tenant-b.com');
    `);

    const accountsRes = await db.query(`
      SELECT a.id, a.owner_user_id
      FROM accounts a
      WHERE a.owner_user_id IN ('${tenantA_userId}'::uuid, '${tenantB_userId}'::uuid);
    `);

    const rows = accountsRes.rows as unknown as AccountRow[];
    tenantA_accountId = rows.find((r) => r.owner_user_id === tenantA_userId)!.id;
    tenantB_accountId = rows.find((r) => r.owner_user_id === tenantB_userId)!.id;

    // Seed Pipelines and Stages for Tenant A
    const p1A = await db.query(`
      INSERT INTO pipelines (user_id, account_id, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', 'Pipeline A1')
      RETURNING id;
    `);
    tenantA_pipeline1Id = p1A.rows[0].id;

    const p2A = await db.query(`
      INSERT INTO pipelines (user_id, account_id, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', 'Pipeline A2')
      RETURNING id;
    `);
    tenantA_pipeline2Id = p2A.rows[0].id;

    const s1A1 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', 'Stage A1-1', 0)
      RETURNING id;
    `);
    tenantA_pipeline1Stage1Id = s1A1.rows[0].id;

    const s1A2 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', 'Stage A1-2', 1)
      RETURNING id;
    `);
    tenantA_pipeline1Stage2Id = s1A2.rows[0].id;

    const s2A1 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline2Id}', 'Stage A2-1', 0)
      RETURNING id;
    `);
    tenantA_pipeline2Stage1Id = s2A1.rows[0].id;

    // Seed Pipeline and Stage for Tenant B
    const p1B = await db.query(`
      INSERT INTO pipelines (user_id, account_id, name)
      VALUES ('${tenantB_userId}', '${tenantB_accountId}', 'Pipeline B1')
      RETURNING id;
    `);
    tenantB_pipeline1Id = p1B.rows[0].id;

    const s1B1 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantB_accountId}', '${tenantB_pipeline1Id}', 'Stage B1-1', 0)
      RETURNING id;
    `);
    tenantB_pipeline1Stage1Id = s1B1.rows[0].id;

    // Seed Contacts
    const cA = await db.query(`
      INSERT INTO contacts (user_id, account_id, phone, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '+5511999990001', 'Contact A')
      RETURNING id;
    `);
    tenantA_contactId = cA.rows[0].id;

    const cB = await db.query(`
      INSERT INTO contacts (user_id, account_id, phone, name)
      VALUES ('${tenantB_userId}', '${tenantB_accountId}', '+5511999990002', 'Contact B')
      RETURNING id;
    `);
    tenantB_contactId = cB.rows[0].id;

    // Seed Valid Deals
    const dA = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', '${tenantA_contactId}', 'Deal A', 5000)
      RETURNING id;
    `);
    tenantA_dealId = dA.rows[0].id;

    const dB = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value)
      VALUES ('${tenantB_userId}', '${tenantB_accountId}', '${tenantB_pipeline1Id}', '${tenantB_pipeline1Stage1Id}', '${tenantB_contactId}', 'Deal B', 9000)
      RETURNING id;
    `);
    tenantB_dealId = dB.rows[0].id;
  });

  it('rejects Deal creation when account A references account B pipeline (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value)
        VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantB_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', '${tenantA_contactId}', 'Cross Tenant Deal', 1000)
      `)
    ).rejects.toThrow();
  });

  it('rejects Deal creation when account A references account B stage (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value)
        VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantB_pipeline1Stage1Id}', '${tenantA_contactId}', 'Cross Stage Deal', 1000)
      `)
    ).rejects.toThrow();
  });

  it('rejects Deal creation when stage belongs to a different pipeline of the same tenant (Physical Pipeline Coherence)', async () => {
    // Deal in pipeline 1, but stage is from pipeline 2 of Tenant A
    await expect(
      db.query(`
        INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value)
        VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline2Stage1Id}', '${tenantA_contactId}', 'Cross Pipeline Stage Deal', 1000)
      `)
    ).rejects.toThrow();
  });

  it('rejects Deal update when moving to a stage of a different pipeline (Physical Pipeline Coherence)', async () => {
    await expect(
      db.query(`
        UPDATE deals
        SET stage_id = '${tenantA_pipeline2Stage1Id}'
        WHERE id = '${tenantA_dealId}'
      `)
    ).rejects.toThrow();
  });

  it('rejects stage suggestion targeting a deal of another tenant (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO deal_stage_suggestions (account_id, deal_id, suggested_stage_id, current_stage_id, reason)
        VALUES ('${tenantA_accountId}', '${tenantB_dealId}', '${tenantA_pipeline1Stage2Id}', '${tenantA_pipeline1Stage1Id}', 'Invalid Target Deal')
      `)
    ).rejects.toThrow();
  });

  it('rejects stage suggestion proposing a stage of another tenant (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO deal_stage_suggestions (account_id, deal_id, suggested_stage_id, current_stage_id, reason)
        VALUES ('${tenantA_accountId}', '${tenantA_dealId}', '${tenantB_pipeline1Stage1Id}', '${tenantA_pipeline1Stage1Id}', 'Invalid Suggested Stage')
      `)
    ).rejects.toThrow();
  });

  it('rejects task targeting a deal of another tenant (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO tasks (account_id, deal_id, title)
        VALUES ('${tenantA_accountId}', '${tenantB_dealId}', 'Task targeting Tenant B deal')
      `)
    ).rejects.toThrow();
  });

  it('rejects task targeting a contact of another tenant (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO tasks (account_id, contact_id, title)
        VALUES ('${tenantA_accountId}', '${tenantB_contactId}', 'Task targeting Tenant B contact')
      `)
    ).rejects.toThrow();
  });

  it('auto-syncs pipeline_stages.account_id from pipeline via BEFORE INSERT trigger when omitted', async () => {
    const stageRes = await db.query(`
      INSERT INTO pipeline_stages (pipeline_id, name, position)
      VALUES ('${tenantA_pipeline1Id}', 'Auto Synced Stage', 2)
      RETURNING id, account_id;
    `);

    expect(stageRes.rows[0].account_id).toBe(tenantA_accountId);
  });

  it('apply_deal_stage_suggestion RPC refuses to apply suggestion from another tenant', async () => {
    // Insert suggestion in Tenant B
    const suggB = await db.query(`
      INSERT INTO deal_stage_suggestions (account_id, deal_id, suggested_stage_id, current_stage_id, reason)
      VALUES ('${tenantB_accountId}', '${tenantB_dealId}', '${tenantB_pipeline1Stage1Id}', '${tenantB_pipeline1Stage1Id}', 'Tenant B Suggestion')
      RETURNING id;
    `);
    const suggBId = suggB.rows[0].id;

    // Tenant A attempts to execute apply_deal_stage_suggestion on Tenant B's suggestion
    await db.exec(`
      SET ROLE postgres;
      SET request.jwt.claim.sub = '${tenantA_userId}';
      SET request.jwt.claim.role = 'authenticated';
    `);

    await expect(
      db.query(`SELECT apply_deal_stage_suggestion('${tenantA_accountId}'::uuid, '${suggBId}'::uuid)`)
    ).rejects.toThrow();
  });

  it('apply_deal_stage_suggestion RPC successfully transitions deal stage within same tenant and pipeline', async () => {
    // Insert valid suggestion in Tenant A
    const suggA = await db.query(`
      INSERT INTO deal_stage_suggestions (account_id, deal_id, suggested_stage_id, current_stage_id, reason)
      VALUES ('${tenantA_accountId}', '${tenantA_dealId}', '${tenantA_pipeline1Stage2Id}', '${tenantA_pipeline1Stage1Id}', 'Progresso qualificado')
      RETURNING id;
    `);
    const suggAId = suggA.rows[0].id;

    await db.exec(`
      SET ROLE postgres;
      SET request.jwt.claim.sub = '${tenantA_userId}';
      SET request.jwt.claim.role = 'authenticated';
    `);

    const result = await db.query(`
      SELECT apply_deal_stage_suggestion('${tenantA_accountId}'::uuid, '${suggAId}'::uuid) AS res;
    `);

    expect(result.rows[0].res.stage_id).toBe(tenantA_pipeline1Stage2Id);

    // Verify suggestion status is applied
    const verifySugg = await db.query(`
      SELECT status FROM deal_stage_suggestions WHERE id = '${suggAId}';
    `);
    expect(verifySugg.rows[0].status).toBe('applied');

    // Verify deal was updated
    const verifyDeal = await db.query(`
      SELECT stage_id FROM deals WHERE id = '${tenantA_dealId}';
    `);
    expect(verifyDeal.rows[0].stage_id).toBe(tenantA_pipeline1Stage2Id);
  });
});
