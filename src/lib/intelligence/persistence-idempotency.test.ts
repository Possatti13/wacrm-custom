import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

interface SqlDb {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}
const scratchRequire = createRequire(path.join(process.env.USERPROFILE || 'C:\\Users\\leopo', '.gemini/antigravity/brain/7dd65584-91ac-45ad-828c-ba770c616490/scratch/package.json'));
const { PGlite } = scratchRequire('@electric-sql/pglite') as { PGlite: new () => SqlDb };
let db: SqlDb;
afterEach(async () => { await db?.close(); });

it('deduplicates factual observations without mutating provenance or weakening immutability', async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE conversations (id uuid PRIMARY KEY, account_id uuid, contact_id uuid, commercial_state_dirty bool, pending_message_count int, intelligence_claimed_at timestamptz, intelligence_eligible_at timestamptz);
    CREATE TABLE messages (id uuid PRIMARY KEY, conversation_id uuid, sender_type text, created_at timestamptz);
    CREATE TABLE conversation_analysis_runs (id uuid PRIMARY KEY, account_id uuid, conversation_id uuid, status text, insights_count int, input_tokens int, output_tokens int, total_tokens int, latency_ms int, completed_at timestamptz, lease_expires_at timestamptz);
    CREATE TABLE conversation_insights (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid, conversation_id uuid, insight_type text, value_text text, value_json jsonb, catalog_item_id uuid, confidence numeric, source text, status text, analysis_run_id uuid, dedupe_key text, observed_at timestamptz, created_at timestamptz, updated_at timestamptz, supersedes_insight_id uuid);
    CREATE UNIQUE INDEX dedupe ON conversation_insights(account_id,conversation_id,dedupe_key) WHERE status='active' AND dedupe_key IS NOT NULL;
    CREATE TABLE conversation_insight_evidence (account_id uuid, conversation_id uuid, insight_id uuid, message_id uuid, start_offset int, end_offset int, snippet text, created_at timestamptz);
    CREATE UNIQUE INDEX evidence ON conversation_insight_evidence(account_id,insight_id,message_id,start_offset,end_offset);
    CREATE TABLE conversation_analysis_messages (account_id uuid, conversation_id uuid, message_id uuid, extractor_version text, analysis_run_id uuid, analyzed_at timestamptz, UNIQUE(conversation_id,message_id,extractor_version));
    CREATE TABLE conversation_analysis_state (account_id uuid, conversation_id uuid, extractor_version text, last_analyzed_message_id uuid, last_analyzed_message_created_at timestamptz, last_analysis_run_id uuid, last_analyzed_at timestamptz, updated_at timestamptz, UNIQUE(account_id,conversation_id,extractor_version));
    CREATE FUNCTION project_contact_commercial_state(uuid,uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
  `);
  const migrations = path.join(process.cwd(), 'supabase/migrations');
  const triggerSql = fs.readFileSync(path.join(migrations, '047_conversation_insights_and_evidence.sql'), 'utf8')
    .match(/CREATE OR REPLACE FUNCTION public\.trg_protect_conversation_insights_immutability\(\)[\s\S]*?\$\$;/)![0];
  await db.exec(triggerSql);
  await db.exec('CREATE TRIGGER protect BEFORE UPDATE ON conversation_insights FOR EACH ROW EXECUTE FUNCTION trg_protect_conversation_insights_immutability();');
  const functionSql = fs.readFileSync(path.join(migrations, '075_smart_automatic_intelligence_runtime.sql'), 'utf8')
    .match(/CREATE OR REPLACE FUNCTION public\.persist_conversation_analysis_batch\([\s\S]*?\$\$;/)![0];
  await db.exec(functionSql);
  const fix = path.join(migrations, '095_intelligence_persistence_idempotency.sql');
  if (fs.existsSync(fix)) { await db.exec(fs.readFileSync(fix, 'utf8')); await db.exec(fs.readFileSync(fix, 'utf8')); }
  const account = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', conv = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const run = 'cccccccc-cccc-4ccc-accc-cccccccccccc', msg = 'dddddddd-dddd-4ddd-addd-dddddddddddd';
  await db.exec(`INSERT INTO conversations(id,account_id) VALUES('${conv}','${account}'); INSERT INTO conversation_analysis_runs(id,account_id,conversation_id,status) VALUES('${run}','${account}','${conv}','processing'); INSERT INTO messages VALUES('${msg}','${conv}','customer','2026-10-07T12:00:00Z');`);
  const observation = { insight_type: 'intent', value_text: 'purchase', value_json: {}, confidence: 0.8, source: 'intelligence', dedupe_key: 'same-meaning-and-evidence', evidence: [{ message_id: msg, start_offset: 0, end_offset: 12, snippet: 'quero comprar' }] };
  const result = await db.query<{ result: { status: string } }>(`SELECT persist_conversation_analysis_batch('${account}','${conv}','${run}','v1','${JSON.stringify([observation, { ...observation, confidence: 0.9 }])}'::jsonb,ARRAY['${msg}'::uuid],'${msg}','2026-10-07T12:00:00Z') AS result;`);
  expect(result.rows[0].result.status).toBe('completed');
  const facts = await db.query<{ confidence: string; analysis_run_id: string }>('SELECT confidence::text,analysis_run_id FROM conversation_insights');
  expect(facts.rows).toEqual([{ confidence: '0.8', analysis_run_id: run }]);
  expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM conversation_insight_evidence')).rows[0].count).toBe(1);
  await expect(db.exec("UPDATE conversation_insights SET value_text='not_interested'")).rejects.toThrow(/Immutable factual fields/);
});
