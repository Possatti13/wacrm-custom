// Explicit staging-only operational setup and disposable probes. No production
// credentials, scoring configuration changes, or edits to approved A-E records.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [mode, envFile, accessFile, stateFile] = process.argv.slice(2);
if (!['snapshot', 'configure', 'create', 'inspect', 'append', 'duplicate', 'cleanup'].includes(mode) || !stateFile) {
  throw new Error('Usage: script MODE staging-env operator-manifest probe-state');
}
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')];
  }));
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (host !== 'pxpnkaakurjwpfuezpob.supabase.co') throw new Error('Refusing non-staging destination');
const access = JSON.parse(fs.readFileSync(accessFile, 'utf8'));
const accountId = '8eb73d03-a960-48f6-8f04-1b4ecb1c0604';
const operationalAccount = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
if (access.accountId !== accountId || access.originalAccountId !== operationalAccount || access.scenarios.length !== 5) throw new Error('Wrong operator manifest');
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { host, accountId, probes: [] };
if (state.host !== host || state.accountId !== accountId) throw new Error('Wrong probe state');
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
async function checked(query) { const { data, error } = await query; if (error) throw new Error(error.message); return data; }
async function protectedRows() {
  const result = {};
  for (const table of ['contacts', 'conversations', 'contact_lead_profiles', 'contact_lead_scores', 'messages']) {
    const key = table === 'contacts' || table === 'conversations' || table === 'messages' ? 'id' : 'contact_id';
    let query = db.from(table).select('*');
    if (table === 'messages') query = query.in('conversation_id', access.scenarios.map(s => s.conversationId));
    else query = query.eq('account_id', accountId).in(key, access.scenarios.map(s => table === 'conversations' ? s.conversationId : s.contactId));
    result[table] = await checked(query.order('id'));
  }
  return { rows: result, hash: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex') };
}
async function main() {
  if (mode === 'snapshot') { state.protectedBefore = await protectedRows(); save(); console.log(JSON.stringify({ protectedHash: state.protectedBefore.hash })); }
  if (mode === 'configure') {
    // Verified existing credential in the SAME staging project. It remains
    // encrypted and is never printed or transported into production.
    const source = await checked(db.from('ai_configs').select('provider,api_key').eq('account_id', operationalAccount).single());
    const settings = await checked(db.from('tenant_intelligence_settings').select('provider,model').eq('account_id', operationalAccount).single());
    if (source.provider !== 'gemini' || settings.provider !== source.provider || !source.api_key) throw new Error('Invalid staging provider setup');
    const owner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const login = await owner.auth.signInWithPassword({ email: access.email, password: access.password });
    if (login.error) throw new Error(login.error.message);
    const profile = await checked(owner.from('profiles').select('account_id,account_role').eq('user_id', login.data.user.id).single());
    if (profile.account_id !== accountId || profile.account_role !== 'owner') throw new Error('Wrong owner context');
    const configured = await checked(owner.rpc('save_tenant_intelligence_settings', { p_account_id: accountId, p_settings: {
      enabled: true, invocation_mode: 'on_demand', provider: source.provider, model: settings.model,
      extractor_version: 'v1', prompt_version: 'v1', temperature: 0.1, timeout_ms: 30000,
      max_ai_actions_per_day: 50, max_ai_actions_per_month: 200, monthly_budget_limit_usd: null,
      encrypted_api_key: source.api_key,
    } }));
    state.configuration = { accountId, enabled: configured.enabled, invocationMode: configured.invocation_mode,
      provider: configured.provider, model: configured.model, credentialSource: { host, accountId: operationalAccount }, scoringConfigurationChanged: false };
    save(); console.log(JSON.stringify(state.configuration));
  }
  if (mode === 'create') {
    if (state.probes.length) throw new Error('Probes already exist');
    for (const tenant of [accountId, operationalAccount]) {
      const owner = await checked(db.from('profiles').select('user_id').eq('account_id', tenant).eq('account_role', 'owner').limit(1).single());
      const probe = { accountId: tenant, contactId: crypto.randomUUID(), conversationId: crypto.randomUUID(),
        phone: '+55119' + crypto.randomInt(10000000, 100000000), messageIds: [] };
      state.probes.push(probe); save();
      await checked(db.from('contacts').insert({ id: probe.contactId, account_id: tenant, user_id: owner.user_id,
        name: 'Certificação temporária — Reanálise', phone: probe.phone }));
      await checked(db.from('conversations').insert({ id: probe.conversationId, account_id: tenant, user_id: owner.user_id,
        contact_id: probe.contactId, status: 'open', commercial_state_dirty: false }));
      const messageId = crypto.randomUUID(); probe.messageIds.push(messageId); save();
      await checked(db.from('messages').insert({ id: messageId, conversation_id: probe.conversationId,
        sender_type: 'customer', content_type: 'text', status: 'delivered',
        content_text: 'Olá, quero comprar a Tank preta esta semana. Tenho R$ 1.000 de entrada e preciso de uma simulação de financiamento. Pode enviar as condições e confirmar a pronta entrega?', created_at: new Date().toISOString() }));
      // No background scheduler may race this explicit manual certification.
      await checked(db.from('conversations').update({ commercial_state_dirty: false, intelligence_eligible_at: null }).eq('account_id', tenant).eq('id', probe.conversationId));
    }
    console.log(JSON.stringify({ probes: state.probes }));
  }
  if (mode === 'append') {
    for (const probe of state.probes) {
      const id = crypto.randomUUID(); probe.messageIds.push(id); save();
      await checked(db.from('messages').insert({ id, conversation_id: probe.conversationId, sender_type: 'customer', content_type: 'text', status: 'delivered',
        content_text: 'Continuo com a intenção de compra da Tank preta e quero fechar esta semana. Pode me mandar a proposta de financiamento com entrada de R$ 1.000?', created_at: new Date().toISOString() }));
      await checked(db.from('conversations').update({ commercial_state_dirty: false, intelligence_eligible_at: null }).eq('account_id', probe.accountId).eq('id', probe.conversationId));
    }
    console.log(JSON.stringify({ appended: true }));
  }
  if (mode === 'inspect') {
    const result = [];
    for (const probe of state.probes) {
      const records = { ...probe };
      for (const table of ['conversation_analysis_runs', 'conversation_insights', 'conversation_analysis_messages', 'internal_ai_requests']) {
        const key = table === 'internal_ai_requests' ? 'target_id' : 'conversation_id';
        records[table] = await checked(db.from(table).select('*').eq('account_id', probe.accountId).eq(key, probe.conversationId));
      }
      for (const table of ['contact_lead_profiles', 'contact_lead_scores', 'contact_commercial_provenance']) {
        records[table] = await checked(db.from(table).select('*').eq('account_id', probe.accountId).eq('contact_id', probe.contactId));
      }
      records.scoringConfig = await checked(db.from('lead_scoring_configs').select('*').eq('account_id', probe.accountId));
      result.push(records);
    }
    console.log(JSON.stringify(result, null, 2));
  }
  if (mode === 'duplicate') {
    // Separate RPC stress probe; never presented as an LLM/provider result.
    const probe = state.probes.find(p => p.accountId === accountId);
    if (!probe) throw new Error('No isolated persistence probe');
    const id = crypto.randomUUID(), createdAt = new Date().toISOString();
    probe.messageIds.push(id); save();
    await checked(db.from('messages').insert({ id, conversation_id: probe.conversationId, sender_type: 'customer',
      content_type: 'text', status: 'delivered', content_text: 'quero comprar', created_at: createdAt }));
    const claim = await checked(db.rpc('claim_conversation_analysis_run', { p_account_id: accountId, p_conversation_id: probe.conversationId,
      p_extractor_version: 'v1', p_prompt_version: 'v1', p_provider: 'gemini', p_model: 'gemini-3.5-flash-lite', p_batch_limit: 25, p_lease_seconds: 300 }));
    if (claim.status !== 'claimed') throw new Error('Persistence probe was not claimed');
    const dedupeKey = 'certification-duplicate-' + id;
    const observation = { insight_type: 'intent', value_text: 'purchase', value_json: {}, confidence: 0.8,
      source: 'intelligence', dedupe_key: dedupeKey, observed_at: createdAt,
      evidence: [{ message_id: id, start_offset: 0, end_offset: 13, snippet: 'quero comprar' }] };
    const persisted = await checked(db.rpc('persist_conversation_analysis_batch', { p_account_id: accountId,
      p_conversation_id: probe.conversationId, p_run_id: claim.run_id, p_extractor_version: 'v1',
      p_insights: [observation, { ...observation, confidence: 0.9 }], p_analyzed_message_ids: [id],
      p_last_message_id: id, p_last_message_created_at: createdAt, p_input_tokens: 0, p_output_tokens: 0, p_total_tokens: 0, p_latency_ms: 0 }));
    const facts = await checked(db.from('conversation_insights').select('confidence,analysis_run_id').eq('account_id', accountId).eq('conversation_id', probe.conversationId).eq('dedupe_key', dedupeKey));
    if (persisted.status !== 'completed' || facts.length !== 1 || Number(facts[0].confidence) !== 0.8 || facts[0].analysis_run_id !== claim.run_id) throw new Error('Duplicate mutated facts');
    console.log(JSON.stringify({ duplicatePersistence: 'PASS', uniqueFacts: facts.length, confidencePreserved: true, provenancePreserved: true, runId: claim.run_id }));
  }
  if (mode === 'cleanup') {
    const errors = [];
    const retainedAuditContacts = [];
    for (const probe of state.probes) {
      // Analyzed-message references intentionally restrict message deletion.
      // Remove only our disposable probe markers before deleting its chat.
      const markers = await db.from('conversation_analysis_messages').delete().eq('account_id', probe.accountId).eq('conversation_id', probe.conversationId);
      if (markers.error) errors.push({ table: 'conversation_analysis_messages', error: markers.error.message });
      const evidence = await db.from('conversation_insight_evidence').delete().eq('account_id', probe.accountId).eq('conversation_id', probe.conversationId);
      if (evidence.error) errors.push({ table: 'conversation_insight_evidence', error: evidence.error.message });
      const history = await db.from('contact_lead_score_history').select('id', { count: 'exact', head: true }).eq('account_id', probe.accountId).eq('contact_id', probe.contactId);
      if (history.error) throw new Error(history.error.message);
      for (const [table, key, value] of [['conversations', 'id', probe.conversationId], ['contacts', 'id', probe.contactId]]) {
        if (table === 'contacts' && history.count > 0) {
          // Preserve the immutable scoring ledger and its parent contact.
          retainedAuditContacts.push({ accountId: probe.accountId, contactId: probe.contactId, reason: 'immutable_scoring_history' });
          continue;
        }
        const { error } = await db.from(table).delete().eq('account_id', probe.accountId).eq(key, value);
        if (error) errors.push({ table, error: error.message });
      }
    }
    const after = await protectedRows(); state.protectedAfter = after; state.cleanupErrors = errors; state.retainedAuditContacts = retainedAuditContacts; save();
    if (errors.length || state.protectedBefore.hash !== after.hash) throw new Error(JSON.stringify({ errors, protectedDataChanged: state.protectedBefore.hash !== after.hash }));
    console.log(JSON.stringify({ cleanup: 'PASS', retainedAuditContacts, protectedBefore: state.protectedBefore.hash, protectedAfter: after.hash }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
