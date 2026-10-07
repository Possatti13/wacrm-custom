// Controlled fixture only. Refuses every database/tenant except the isolated
// operator staging workspace; preserves A-D and all commercial values.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const stagingHost = 'pxpnkaakurjwpfuezpob.supabase.co';
const accountId = '8eb73d03-a960-48f6-8f04-1b4ecb1c0604';
const contactE = '509a9e05-7379-4d85-98be-9d3b9ef78d76';
const envFile = process.argv[2];
if (!envFile) throw new Error('Provide the staging environment file path');
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, '')];
  }));
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== stagingHost) {
  throw new Error('Refusing non-staging destination');
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
async function read(query) {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function snapshot() {
  const rows = {};
  for (const table of ['contacts', 'conversations', 'contact_lead_profiles', 'contact_lead_scores']) {
    rows[table] = await read(db.from(table).select('*').eq('account_id', accountId).order('id'));
  }
  rows.messages = await read(db.from('messages').select('*')
    .in('conversation_id', rows.conversations.map(row => row.id)).order('id'));
  return rows;
}
function protectedRows(rows) {
  return {
    ...rows,
    contacts: rows.contacts.filter(row => row.id !== contactE),
  };
}
const before = await snapshot();
const contact = before.contacts.find(row => row.id === contactE);
const score = before.contact_lead_scores.find(row => row.contact_id === contactE);
const conversation = before.conversations.find(row => row.contact_id === contactE);
const message = before.messages.find(row => row.conversation_id === conversation?.id);
if (before.contacts.length !== 5 || contact?.phone !== '5511955556666' || score?.score !== 65 ||
    message?.content_text !== 'Olá, gostaria de saber quais as cores disponíveis para pronta entrega.') {
  throw new Error('Unexpected fixture; refusing mutation');
}
const result = await db.from('contacts').update({ name: 'WhatsApp Contact', avatar_url: null })
  .eq('account_id', accountId).eq('id', contactE);
if (result.error) throw new Error(result.error.message);
const after = await snapshot();
if (JSON.stringify(protectedRows(before)) !== JSON.stringify(protectedRows(after))) {
  throw new Error('Unexpected change outside the E identity fixture');
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
console.log(JSON.stringify({ stagingHost, accountId, contactE,
  providerName: 'WhatsApp Contact', trustedSavedName: false,
  expectedIdentity: '+55 (11) 95555-6666', score: 65,
  nextAction: before.contact_lead_profiles.find(row => row.contact_id === contactE)?.next_action,
  protectedRowsBefore: hash(protectedRows(before)), protectedRowsAfter: hash(protectedRows(after)),
}, null, 2));
