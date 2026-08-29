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
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const convId = 'ff38fefd-667a-472f-b9c2-4470c896fb00';
const projectRef = 'pxpnkaakurjwpfuezpob';

async function sendAsSeller(email, password, text) {
  console.log(`\n================ Authenticating ${email} ================`);
  const supabase = createClient(supabaseUrl, anonKey);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.session) {
    console.error(`❌ Auth failed for ${email}:`, authError?.message);
    return { status: 401, error: authError?.message };
  }

  const session = authData.session;
  console.log(`✅ Authenticated via GoTrue! User ID: ${authData.user.id}`);

  const sessionStr = JSON.stringify(session);
  const b64 = Buffer.from(sessionStr).toString('base64');
  const cookieHeader = `sb-${projectRef}-auth-token=base64-${b64}; sb-${projectRef}-auth-token.0=base64-${b64}`;

  console.log(`Calling POST http://localhost:3000/api/whatsapp/send with text: "${text}"...`);
  try {
    const res = await fetch('http://localhost:3000/api/whatsapp/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({
        conversation_id: convId,
        message_type: 'text',
        content_text: text,
      }),
    });

    const status = res.status;
    const json = await res.json().catch(() => null);
    console.log(`HTTP Status: ${status}`);
    console.log('Response Body:', json);

    return {
      status,
      body: json,
      whatsappMessageId: json?.whatsapp_message_id,
      messageId: json?.message_id,
    };
  } catch (err) {
    console.error('Fetch error:', err.message);
    return { status: 500, error: err.message };
  }
}

async function main() {
  const sellerA = await sendAsSeller('seller.a.v11@ciclopes.test', 'TestPassword123!', 'CICLOPES REAL A 82941');
  const sellerB = await sendAsSeller('seller.b.v11@ciclopes.test', 'TestPassword123!', 'CICLOPES REAL B 57326');

  console.log('\n================ FINAL RESULTS ================');
  console.log('SELLER A:', JSON.stringify(sellerA, null, 2));
  console.log('SELLER B:', JSON.stringify(sellerB, null, 2));
}

main();
