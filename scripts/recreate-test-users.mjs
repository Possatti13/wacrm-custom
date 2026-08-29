import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const envPath = path.join(root, '.env.local');
const env = fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return acc;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return acc;
    acc[trimmed.slice(0, idx)] = trimmed.slice(idx + 1).replace(/^['"]|['"]$/g, '');
    return acc;
  }, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const accountId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';

const adminClient = createClient(supabaseUrl, serviceKey);

async function setupUsers() {
  console.log('--- Setting up test users via Supabase Admin Auth API ---');

  // 1. Delete existing if any to recreate cleanly
  const { data: list } = await adminClient.auth.admin.listUsers();
  for (const u of list.users) {
    if (u.email === 'seller.a.v11@ciclopes.test' || u.email === 'seller.b.v11@ciclopes.test') {
      console.log(`Deleting old user ${u.email} (${u.id})...`);
      await adminClient.auth.admin.deleteUser(u.id);
    }
  }

  // 2. Create SELLER A
  const { data: userA, error: errA } = await adminClient.auth.admin.createUser({
    email: 'seller.a.v11@ciclopes.test',
    password: 'TestPassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Vendedor Alpha' },
  });
  if (errA) throw errA;
  console.log('✅ Created SELLER A:', userA.user.id);

  // 3. Create SELLER B
  const { data: userB, error: errB } = await adminClient.auth.admin.createUser({
    email: 'seller.b.v11@ciclopes.test',
    password: 'TestPassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Vendedor Beta' },
  });
  if (errB) throw errB;
  console.log('✅ Created SELLER B:', userB.user.id);

  // 4. Update profiles
  await adminClient
    .from('profiles')
    .update({ account_id: accountId, account_role: 'agent', full_name: 'Vendedor Alpha' })
    .eq('user_id', userA.user.id);

  await adminClient
    .from('profiles')
    .update({ account_id: accountId, account_role: 'agent', full_name: 'Vendedor Beta' })
    .eq('user_id', userB.user.id);

  console.log('✅ Profiles updated in STAGING!');
}

setupUsers().catch(console.error);
