import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

interface SqlDb {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}
const sqlRequire = createRequire(path.join(process.env.USERPROFILE || 'C:\\Users\\leopo', '.gemini/antigravity/brain/7dd65584-91ac-45ad-828c-ba770c616490/scratch/package.json'));
const { PGlite } = sqlRequire('@electric-sql/pglite') as { PGlite: new () => SqlDb };
const migrations = path.join(process.cwd(), 'supabase/migrations');
const patchFile = path.join(migrations, '20261008020000_096_insight_rpc_security_closure.sql');
const account = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const otherAccount = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const agent = '11111111-1111-4111-a111-111111111111';
const viewer = '22222222-2222-4222-a222-222222222222';
const outsider = '33333333-3333-4333-a333-333333333333';
const missing = 'cccccccc-cccc-4ccc-accc-cccccccccccc';
let db: SqlDb;

function definition(file: string, name: string) {
  const sql = fs.readFileSync(path.join(migrations, file), 'utf8');
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\([\\s\\S]*?\\$\\$;`));
  if (!match) throw new Error(`Missing versioned function: ${name}`);
  return match[0];
}
const signatures = [
  { count: 10, types: 'uuid,uuid,uuid,text,text,jsonb,uuid,numeric,text,jsonb', args: "'intent','purchase','{}'::jsonb,NULL::uuid,0.8::numeric,'manual','[]'::jsonb" },
  { count: 11, types: 'uuid,uuid,uuid,text,text,jsonb,uuid,numeric,text,text,jsonb', args: "'intent','purchase','{}'::jsonb,NULL::uuid,0.8::numeric,'manual','security-test','[]'::jsonb" },
];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role',true),'')
    $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TYPE account_role_enum AS ENUM ('owner','admin','agent','viewer');
    CREATE TABLE profiles(user_id uuid,account_id uuid,account_role account_role_enum);
    CREATE TABLE conversation_insights(id uuid,account_id uuid,conversation_id uuid,status text);
    INSERT INTO profiles VALUES('${agent}','${account}','agent'),('${viewer}','${account}','viewer'),('${outsider}','${otherAccount}','owner');
  `);
  // Load the real membership hierarchy and both real RPC bodies, not permission doubles.
  await db.exec(definition('017_account_sharing.sql', 'is_account_member'));
  await db.exec(definition('047_conversation_insights_and_evidence.sql', 'supersede_conversation_insight'));
  await db.exec(definition('051_commercial_state_projector_hardening.sql', 'supersede_conversation_insight'));
  // Reproduce production: 10 args restricted; 11 args PUBLIC + explicit anon.
  await db.exec(`REVOKE ALL ON FUNCTION public.supersede_conversation_insight(${signatures[0].types}) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.supersede_conversation_insight(${signatures[0].types}) TO authenticated,service_role;
    GRANT EXECUTE ON FUNCTION public.supersede_conversation_insight(${signatures[1].types}) TO anon,authenticated,service_role;`);
  if (fs.existsSync(patchFile)) await db.exec(fs.readFileSync(patchFile, 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });

async function call(signature: typeof signatures[number], role: string, uid: string, claim: string, target = account) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${uid}',false),set_config('request.jwt.claim.role','${claim}',false);`);
  try {
    return await db.query(`SELECT public.supersede_conversation_insight('${target}'::uuid,'${missing}'::uuid,'${missing}'::uuid,${signature.args});`);
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false);");
  }
}

for (const signature of signatures) {
  describe(`${signature.count}-argument overload`, () => {
    it('has no PUBLIC or anon EXECUTE', async () => {
      const result = await db.query<{ anon: boolean; public_execute: boolean }>(`SELECT
        has_function_privilege('anon','public.supersede_conversation_insight(${signature.types})','EXECUTE') AS anon,
        EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE p.oid='public.supersede_conversation_insight(${signature.types})'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute`);
      expect(result.rows[0]).toEqual({ anon: false, public_execute: false });
    });
    it.each([
      ['anon', '', 'anon'],
      ['authenticated', '', 'authenticated'],
      ['authenticated', viewer, 'authenticated'],
      ['authenticated', outsider, 'authenticated'],
      ['authenticated', '', 'service_role'],
      ['service_role', '', 'authenticated'],
    ])('denies role=%s sub=%s claim=%s before privileged lookup', async (role, uid, claim) => {
      await expect(call(signature, role, uid, claim)).rejects.toMatchObject({ code: '42501' });
    });
    it('denies a member crossing to another tenant', async () => {
      await expect(call(signature, 'authenticated', agent, 'authenticated', otherAccount)).rejects.toMatchObject({ code: '42501' });
    });
    it('allows an authorized member through to the domain not-found check', async () => {
      await expect(call(signature, 'authenticated', agent, 'authenticated')).rejects.toMatchObject({ code: 'P0002' });
    });
    it('allows the real worker role through to the domain not-found check', async () => {
      await expect(call(signature, 'service_role', '', 'service_role')).rejects.toMatchObject({ code: 'P0002' });
    });
  });
}

it('is idempotent and preserves both OIDs, owner, search_path and security mode', async () => {
  const catalog = "SELECT oid,proowner,prosecdef,proconfig,proacl,prosrc FROM pg_proc WHERE proname='supersede_conversation_insight' ORDER BY oid";
  const before = (await db.query(catalog)).rows;
  expect(before).toHaveLength(2);
  expect(fs.existsSync(patchFile)).toBe(true);
  await db.exec(fs.readFileSync(patchFile, 'utf8'));
  expect((await db.query(catalog)).rows).toEqual(before);
  for (const row of before) {
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig).toEqual(['search_path=""']);
  }
});

it('rejects an unexpected alternative signature atomically', async () => {
  expect(fs.existsSync(patchFile)).toBe(true);
  await db.exec("CREATE FUNCTION public.supersede_conversation_insight(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;");
  try {
    await expect(db.exec(fs.readFileSync(patchFile, 'utf8'))).rejects.toThrow(/Unexpected supersede_conversation_insight overload/);
  } finally {
    await db.exec('DROP FUNCTION public.supersede_conversation_insight(uuid);');
  }
});
