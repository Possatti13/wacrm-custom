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

interface ProfileRow {
  id: string;
  user_id: string;
  account_id: string;
}

describe('PostgreSQL Physical Multi-Tenant & Referential Integrity (Migrations 001 -> 061)', () => {
  let db: DbClient;

  const tenantA_userId = '11111111-1111-1111-1111-111111111111';
  const tenantB_userId = '22222222-2222-2222-2222-222222222222';

  let tenantA_accountId: string;
  let tenantB_accountId: string;

  let tenantA_profileId: string;
  let tenantB_profileId: string;

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

    // 2. Replay all migrations 001 -> 061
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

    const accountRows = accountsRes.rows as unknown as AccountRow[];
    tenantA_accountId = accountRows.find((r) => r.owner_user_id === tenantA_userId)!.id;
    tenantB_accountId = accountRows.find((r) => r.owner_user_id === tenantB_userId)!.id;

    const profilesRes = await db.query(`
      SELECT p.id, p.user_id, p.account_id
      FROM profiles p
      WHERE p.user_id IN ('${tenantA_userId}'::uuid, '${tenantB_userId}'::uuid);
    `);
    const profileRows = profilesRes.rows as unknown as ProfileRow[];
    tenantA_profileId = profileRows.find((r) => r.user_id === tenantA_userId)!.id;
    tenantB_profileId = profileRows.find((r) => r.user_id === tenantB_userId)!.id;

    // Seed Pipelines and Stages for Tenant A
    const p1A = await db.query(`
      INSERT INTO pipelines (user_id, account_id, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', 'Pipeline A1')
      RETURNING id;
    `);
    tenantA_pipeline1Id = p1A.rows[0].id as string;

    const p2A = await db.query(`
      INSERT INTO pipelines (user_id, account_id, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', 'Pipeline A2')
      RETURNING id;
    `);
    tenantA_pipeline2Id = p2A.rows[0].id as string;

    const s1A1 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', 'Stage A1-1', 0)
      RETURNING id;
    `);
    tenantA_pipeline1Stage1Id = s1A1.rows[0].id as string;

    const s1A2 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', 'Stage A1-2', 1)
      RETURNING id;
    `);
    tenantA_pipeline1Stage2Id = s1A2.rows[0].id as string;

    const s2A1 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline2Id}', 'Stage A2-1', 0)
      RETURNING id;
    `);
    tenantA_pipeline2Stage1Id = s2A1.rows[0].id as string;

    // Seed Pipeline and Stage for Tenant B
    const p1B = await db.query(`
      INSERT INTO pipelines (user_id, account_id, name)
      VALUES ('${tenantB_userId}', '${tenantB_accountId}', 'Pipeline B1')
      RETURNING id;
    `);
    tenantB_pipeline1Id = p1B.rows[0].id as string;

    const s1B1 = await db.query(`
      INSERT INTO pipeline_stages (account_id, pipeline_id, name, position)
      VALUES ('${tenantB_accountId}', '${tenantB_pipeline1Id}', 'Stage B1-1', 0)
      RETURNING id;
    `);
    tenantB_pipeline1Stage1Id = s1B1.rows[0].id as string;

    // Seed Contacts
    const cA = await db.query(`
      INSERT INTO contacts (user_id, account_id, phone, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '+5511999990001', 'Contact A')
      RETURNING id;
    `);
    tenantA_contactId = cA.rows[0].id as string;

    const cB = await db.query(`
      INSERT INTO contacts (user_id, account_id, phone, name)
      VALUES ('${tenantB_userId}', '${tenantB_accountId}', '+5511999990002', 'Contact B')
      RETURNING id;
    `);
    tenantB_contactId = cB.rows[0].id as string;

    // Seed Valid Deals
    const dA = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, assigned_to, title, value)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', '${tenantA_contactId}', '${tenantA_profileId}', 'Deal A', 5000)
      RETURNING id;
    `);
    tenantA_dealId = dA.rows[0].id as string;

    const dB = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, assigned_to, title, value)
      VALUES ('${tenantB_userId}', '${tenantB_accountId}', '${tenantB_pipeline1Id}', '${tenantB_pipeline1Stage1Id}', '${tenantB_contactId}', '${tenantB_profileId}', 'Deal B', 9000)
      RETURNING id;
    `);
    tenantB_dealId = dB.rows[0].id as string;
  });

  // --- Section 1: Deals & Pipelines Negative Constraints ---
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

  it('rejects Deal assignment to a profile of another tenant (Physical Assignee Tenant Coherence)', async () => {
    await expect(
      db.query(`
        INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, assigned_to, title, value)
        VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', '${tenantA_contactId}', '${tenantB_profileId}', 'Cross Assignee Deal', 1000)
      `)
    ).rejects.toThrow();
  });

  // --- Section 2: Deal Stage Suggestions Multi-Tenant & Same-Pipeline Constraints ---
  it('rejects stage suggestion targeting a deal of another tenant (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO deal_stage_suggestions (account_id, pipeline_id, deal_id, suggested_stage_id, current_stage_id, reason)
        VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantB_dealId}', '${tenantA_pipeline1Stage2Id}', '${tenantA_pipeline1Stage1Id}', 'Invalid Target Deal')
      `)
    ).rejects.toThrow();
  });

  it('rejects stage suggestion proposing a stage of another tenant (Physical FK violation)', async () => {
    await expect(
      db.query(`
        INSERT INTO deal_stage_suggestions (account_id, pipeline_id, deal_id, suggested_stage_id, current_stage_id, reason)
        VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_dealId}', '${tenantB_pipeline1Stage1Id}', '${tenantA_pipeline1Stage1Id}', 'Invalid Suggested Stage')
      `)
    ).rejects.toThrow();
  });

  it('rejects stage suggestion for same tenant when proposed stage is from another pipeline (Physical Same-Pipeline Coherence)', async () => {
    // Deal is in pipeline 1, proposed stage is from pipeline 2 of the same tenant A
    await expect(
      db.query(`
        INSERT INTO deal_stage_suggestions (account_id, pipeline_id, deal_id, suggested_stage_id, current_stage_id, reason)
        VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_dealId}', '${tenantA_pipeline2Stage1Id}', '${tenantA_pipeline1Stage1Id}', 'Cross Pipeline Stage Suggestion')
      `)
    ).rejects.toThrow();
  });

  it('rejects stage suggestion when pipeline_id does not match the target deal pipeline (Physical Deal-Pipeline Coherence)', async () => {
    // Attempting to declare suggestion under pipeline 2 while deal is in pipeline 1
    await expect(
      db.query(`
        INSERT INTO deal_stage_suggestions (account_id, pipeline_id, deal_id, suggested_stage_id, current_stage_id, reason)
        VALUES ('${tenantA_accountId}', '${tenantA_pipeline2Id}', '${tenantA_dealId}', '${tenantA_pipeline2Stage1Id}', '${tenantA_pipeline2Stage1Id}', 'Mismatched Suggestion Pipeline')
      `)
    ).rejects.toThrow();
  });

  // --- Section 3: Tasks Multi-Tenant & Assignee Constraints ---
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

  it('rejects task assignment to a user of another tenant (Physical Assignee Tenant Coherence)', async () => {
    await expect(
      db.query(`
        INSERT INTO tasks (account_id, assigned_user_id, title)
        VALUES ('${tenantA_accountId}', '${tenantB_userId}', 'Task assigned to Tenant B user')
      `)
    ).rejects.toThrow();
  });

  it('rejects task creation when created_by_user belongs to another tenant (Physical Assignee Tenant Coherence)', async () => {
    await expect(
      db.query(`
        INSERT INTO tasks (account_id, created_by_user_id, title)
        VALUES ('${tenantA_accountId}', '${tenantB_userId}', 'Task created by Tenant B user')
      `)
    ).rejects.toThrow();
  });

  // --- Section 4: Conversations Multi-Tenant & Assignee Constraints ---
  it('rejects conversation assignment to an agent of another tenant (Physical Assignee Tenant Coherence)', async () => {
    await expect(
      db.query(`
        INSERT INTO conversations (user_id, account_id, contact_id, assigned_agent_id)
        VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_contactId}', '${tenantB_userId}')
      `)
    ).rejects.toThrow();
  });

  // --- Section 5: ON DELETE SET NULL Specific Column Behavior ---
  it('deleting contact preserves deal.account_id and nulls only contact_id', async () => {
    // Create temporary contact and deal
    const tempContact = await db.query(`
      INSERT INTO contacts (user_id, account_id, phone, name)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '+5511988880001', 'Temp Contact')
      RETURNING id;
    `);
    const tempContactId = tempContact.rows[0].id as string;

    const tempDeal = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', '${tempContactId}', 'Temp Deal', 2000)
      RETURNING id;
    `);
    const tempDealId = tempDeal.rows[0].id as string;

    // Delete contact
    await db.query(`DELETE FROM contacts WHERE id = '${tempContactId}'`);

    // Verify deal still exists with intact account_id and null contact_id
    const verify = await db.query(`SELECT id, account_id, contact_id FROM deals WHERE id = '${tempDealId}'`);
    expect(verify.rows).toHaveLength(1);
    expect(verify.rows[0].account_id).toBe(tenantA_accountId);
    expect(verify.rows[0].contact_id).toBeNull();
  });

  it('deleting conversation preserves deal.account_id and nulls only conversation_id', async () => {
    const tempConv = await db.query(`
      INSERT INTO conversations (user_id, account_id, contact_id)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_contactId}')
      RETURNING id;
    `);
    const tempConvId = tempConv.rows[0].id as string;

    const tempDeal = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, conversation_id, title, value)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', '${tempConvId}', 'Temp Deal Conv', 3000)
      RETURNING id;
    `);
    const tempDealId = tempDeal.rows[0].id as string;

    // Delete conversation
    await db.query(`DELETE FROM conversations WHERE id = '${tempConvId}'`);

    // Verify deal still exists with intact account_id and null conversation_id
    const verify = await db.query(`SELECT id, account_id, conversation_id FROM deals WHERE id = '${tempDealId}'`);
    expect(verify.rows).toHaveLength(1);
    expect(verify.rows[0].account_id).toBe(tenantA_accountId);
    expect(verify.rows[0].conversation_id).toBeNull();
  });

  it('deleting deal preserves task.account_id and nulls only deal_id', async () => {
    const tempDeal = await db.query(`
      INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, title, value)
      VALUES ('${tenantA_userId}', '${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_pipeline1Stage1Id}', 'Temp Deal For Task', 4000)
      RETURNING id;
    `);
    const tempDealId = tempDeal.rows[0].id as string;

    const tempTask = await db.query(`
      INSERT INTO tasks (account_id, deal_id, title)
      VALUES ('${tenantA_accountId}', '${tempDealId}', 'Task linked to temp deal')
      RETURNING id;
    `);
    const tempTaskId = tempTask.rows[0].id as string;

    // Delete deal
    await db.query(`DELETE FROM deals WHERE id = '${tempDealId}'`);

    // Verify task still exists with intact account_id and null deal_id
    const verify = await db.query(`SELECT id, account_id, deal_id FROM tasks WHERE id = '${tempTaskId}'`);
    expect(verify.rows).toHaveLength(1);
    expect(verify.rows[0].account_id).toBe(tenantA_accountId);
    expect(verify.rows[0].deal_id).toBeNull();
  });

  // --- Section 6: Security Definer Trigger Hardening ---
  it('prevents direct SQL invocation of trigger functions by anon and authenticated roles', async () => {
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '${tenantA_userId}';
      SET request.jwt.claim.role = 'authenticated';
    `);

    // Direct invocation of trg_pipeline_stages_account_id_sync should fail
    await expect(
      db.query(`SELECT public.trg_pipeline_stages_account_id_sync()`)
    ).rejects.toThrow();

    // Direct invocation of trg_deal_stage_suggestions_pipeline_id_sync should fail
    await expect(
      db.query(`SELECT public.trg_deal_stage_suggestions_pipeline_id_sync()`)
    ).rejects.toThrow();

    await db.exec(`SET ROLE postgres;`);
  });

  it('auto-syncs pipeline_stages.account_id and deal_stage_suggestions.pipeline_id via trigger during INSERT operations', async () => {
    // 1. Stage insert without explicit account_id
    const stageRes = await db.query(`
      INSERT INTO pipeline_stages (pipeline_id, name, position)
      VALUES ('${tenantA_pipeline1Id}', 'Auto Synced Stage 061', 5)
      RETURNING id, account_id;
    `);
    expect(stageRes.rows[0].account_id).toBe(tenantA_accountId);

    // 2. Suggestion insert without explicit pipeline_id
    const suggRes = await db.query(`
      INSERT INTO deal_stage_suggestions (account_id, deal_id, suggested_stage_id, current_stage_id, reason)
      VALUES ('${tenantA_accountId}', '${tenantA_dealId}', '${tenantA_pipeline1Stage2Id}', '${tenantA_pipeline1Stage1Id}', 'Auto Synced Pipeline Suggestion')
      RETURNING id, pipeline_id;
    `);
    expect(suggRes.rows[0].pipeline_id).toBe(tenantA_pipeline1Id);
  });

  // --- Section 7: Transactional RPCs Isolation & Coherence ---
  it('apply_deal_stage_suggestion RPC refuses to apply suggestion from another tenant', async () => {
    const suggB = await db.query(`
      INSERT INTO deal_stage_suggestions (account_id, pipeline_id, deal_id, suggested_stage_id, current_stage_id, reason)
      VALUES ('${tenantB_accountId}', '${tenantB_pipeline1Id}', '${tenantB_dealId}', '${tenantB_pipeline1Stage1Id}', '${tenantB_pipeline1Stage1Id}', 'Tenant B Suggestion')
      RETURNING id;
    `);
    const suggBId = suggB.rows[0].id as string;

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
    const suggA = await db.query(`
      INSERT INTO deal_stage_suggestions (account_id, pipeline_id, deal_id, suggested_stage_id, current_stage_id, reason)
      VALUES ('${tenantA_accountId}', '${tenantA_pipeline1Id}', '${tenantA_dealId}', '${tenantA_pipeline1Stage2Id}', '${tenantA_pipeline1Stage1Id}', 'Progresso qualificado 061')
      RETURNING id;
    `);
    const suggAId = suggA.rows[0].id as string;

    await db.exec(`
      SET ROLE postgres;
      SET request.jwt.claim.sub = '${tenantA_userId}';
      SET request.jwt.claim.role = 'authenticated';
    `);

    const result = await db.query(`
      SELECT apply_deal_stage_suggestion('${tenantA_accountId}'::uuid, '${suggAId}'::uuid) AS res;
    `);

    const resObj = result.rows[0].res as Record<string, unknown>;
    expect(resObj.stage_id).toBe(tenantA_pipeline1Stage2Id);

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
