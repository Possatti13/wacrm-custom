import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { runCopilotAction } from './service';

dotenv.config({ path: '.env.local', override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pxpnkaakurjwpfuezpob.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isLiveConfigured = Boolean(SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL.includes('pxpnkaakurjwpfuezpob'));

describe.runIf(isLiveConfigured)('Live Gemini Staging Copilot Grounding Suite', { timeout: 60000 }, () => {
  const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const tenantId = 'ec86e41e-6fec-41b8-a83f-64922c45d5ed';
  const ownerId = 'b4a10080-263b-4bf8-a22a-7a6741a27bc1';

  let testContact1Id: string;
  let testConv1Id: string;

  let testContact2Id: string;
  let testConv2Id: string;

  let testContact3Id: string;
  let testConv3Id: string;

  beforeAll(async () => {
    // 1. Setup Conversation 1: Price objection on Black Motorcycle
    const { data: c1 } = await adminDb
      .from('contacts')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        name: 'Roberto Alencar',
        phone: '+5511999998881',
      })
      .select('id')
      .single();
    testContact1Id = c1!.id;

    const { data: conv1 } = await adminDb
      .from('conversations')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        contact_id: testContact1Id,
        status: 'open',
      })
      .select('id')
      .single();
    testConv1Id = conv1!.id;

    await adminDb.from('messages').insert([
      {
        conversation_id: testConv1Id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Olá! Gostei muito da opção preta da moto.',
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
      {
        conversation_id: testConv1Id,
        sender_type: 'agent',
        content_type: 'text',
        content_text: 'Excelente escolha, Roberto! A preta está saindo por R$ 12.000.',
        created_at: new Date(Date.now() - 40000).toISOString(),
      },
      {
        conversation_id: testConv1Id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Puxa, R$ 12.000 ficou caro para o meu orçamento agora.',
        created_at: new Date(Date.now() - 20000).toISOString(),
      },
    ]);

    // 2. Setup Conversation 2: Ready to Buy / Pickup
    const { data: c2 } = await adminDb
      .from('contacts')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        name: 'Camila Torres',
        phone: '+5511999998882',
      })
      .select('id')
      .single();
    testContact2Id = c2!.id;

    const { data: conv2 } = await adminDb
      .from('conversations')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        contact_id: testContact2Id,
        status: 'open',
      })
      .select('id')
      .single();
    testConv2Id = conv2!.id;

    await adminDb.from('messages').insert([
      {
        conversation_id: testConv2Id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Consigo retirar o produto amanhã cedo se pagar agora?',
        created_at: new Date(Date.now() - 30000).toISOString(),
      },
      {
        conversation_id: testConv2Id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Pode me mandar a chave PIX para fazer o pagamento?',
        created_at: new Date(Date.now() - 10000).toISOString(),
      },
    ]);

    // 3. Setup Conversation 3: Insufficient Context ("Oi")
    const { data: c3 } = await adminDb
      .from('contacts')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        name: 'Lucas Pereira',
        phone: '+5511999998883',
      })
      .select('id')
      .single();
    testContact3Id = c3!.id;

    const { data: conv3 } = await adminDb
      .from('conversations')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        contact_id: testContact3Id,
        status: 'open',
      })
      .select('id')
      .single();
    testConv3Id = conv3!.id;

    await adminDb.from('messages').insert([
      {
        conversation_id: testConv3Id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Oi',
        created_at: new Date().toISOString(),
      },
    ]);
  });

  afterAll(async () => {
    // Cleanup test data
    if (testConv1Id) await adminDb.from('messages').delete().eq('conversation_id', testConv1Id);
    if (testConv2Id) await adminDb.from('messages').delete().eq('conversation_id', testConv2Id);
    if (testConv3Id) await adminDb.from('messages').delete().eq('conversation_id', testConv3Id);

    if (testConv1Id) await adminDb.from('conversations').delete().eq('id', testConv1Id);
    if (testConv2Id) await adminDb.from('conversations').delete().eq('id', testConv2Id);
    if (testConv3Id) await adminDb.from('conversations').delete().eq('id', testConv3Id);

    if (testContact1Id) await adminDb.from('contacts').delete().eq('id', testContact1Id);
    if (testContact2Id) await adminDb.from('contacts').delete().eq('id', testContact2Id);
    if (testContact3Id) await adminDb.from('contacts').delete().eq('id', testContact3Id);
  });

  it('Case 1 — Identifies price objection and black option from conversation 1 with real Gemini', async () => {
    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'overcome_objection',
      conversationId: testConv1Id,
      contactId: testContact1Id,
      customPrompt: 'Qual é a principal objeção do cliente?',
    });

    console.log('Gemini Case 1 Result:', res);
    expect(res.content.toLowerCase()).toMatch(/preço|valor|caro|12\.?000/);
    expect(res.confidence).toBe('high');
    expect(res.evidence).toBeDefined();
    expect(res.evidence!.length).toBeGreaterThan(0);
  });

  it('Case 2 — Detects high buying intent and payment request from conversation 2', async () => {
    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'analyze_intent',
      conversationId: testConv2Id,
      contactId: testContact2Id,
      customPrompt: 'Esse cliente parece pronto para comprar?',
    });

    console.log('Gemini Case 2 Result:', res);
    expect(res.content.toLowerCase()).toMatch(/pronto|alta|compra|retirar|pix|pagamento/);
    expect(res.confidence).toBe('high');
    expect(res.evidence).toBeDefined();
  });

  it('Case 3 — Reports insufficient context when client only says "Oi"', async () => {
    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'analyze_intent',
      conversationId: testConv3Id,
      contactId: testContact3Id,
      customPrompt: 'O que esse cliente quer?',
    });

    console.log('Gemini Case 3 Result:', res);
    expect(res.content.toLowerCase()).toMatch(/insuficiente|apenas iniciou|não há contexto|pouca informação|inicial/);
  });

  it('Case 4 — Prevents wrong conversation leakage between Conversation 1 and 2', async () => {
    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'custom_query',
      conversationId: testConv2Id,
      contactId: testContact2Id,
      customPrompt: 'O que essa cliente pediu?',
    });

    console.log('Gemini Case 4 Result:', res);
    expect(res.content.toLowerCase()).not.toContain('12.000');
    expect(res.content.toLowerCase()).not.toContain('moto preta');
    expect(res.content.toLowerCase()).toMatch(/pix|retirar|pagamento/);
  });

  it('Case 5 — Human-Like Preference Grounding (Acceptance 52: Azul vs Vermelho)', async () => {
    // Add preference messages
    const { data: convPref } = await adminDb
      .from('conversations')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        contact_id: testContact1Id,
        status: 'open',
      })
      .select('id')
      .single();

    await adminDb.from('messages').insert([
      {
        conversation_id: convPref!.id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Minha preferência é azul, não quero vermelho de jeito nenhum.',
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'custom_query',
      conversationId: convPref!.id,
      contactId: testContact1Id,
      customPrompt: 'Qual cor esse cliente prefere?',
    });

    console.log('Gemini Case 5 Result:', res);
    expect(res.content.toLowerCase()).toContain('azul');
    expect(res.content.toLowerCase()).toMatch(/vermelh|rejeitou|recusou|não quer/);

    // Cleanup
    await adminDb.from('messages').delete().eq('conversation_id', convPref!.id);
    await adminDb.from('conversations').delete().eq('id', convPref!.id);
  });

  it('Case 6 — Prioritizes recent payment change over old message (Acceptance 53)', async () => {
    const { data: convPay } = await adminDb
      .from('conversations')
      .insert({
        account_id: tenantId,
        user_id: ownerId,
        contact_id: testContact1Id,
        status: 'open',
      })
      .select('id')
      .single();

    await adminDb.from('messages').insert([
      {
        conversation_id: convPay!.id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Quero pagar à vista no dinheiro.',
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
      {
        conversation_id: convPay!.id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Mudei de ideia, consigo parcelar em 12x no cartão?',
        created_at: new Date(Date.now() - 10000).toISOString(),
      },
    ]);

    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'custom_query',
      conversationId: convPay!.id,
      contactId: testContact1Id,
      customPrompt: 'Como ele pretende pagar agora?',
    });

    console.log('Gemini Case 6 Result:', res);
    expect(res.content.toLowerCase()).toMatch(/12x|parcelar|cartão/);

    // Cleanup
    await adminDb.from('messages').delete().eq('conversation_id', convPay!.id);
    await adminDb.from('conversations').delete().eq('id', convPay!.id);
  });

  it('Case 7 — Refuses to hallucinate unknown budget (Acceptance 54)', async () => {
    const res = await runCopilotAction(adminDb, tenantId, {
      action: 'custom_query',
      conversationId: testConv2Id,
      contactId: testContact2Id,
      customPrompt: 'Qual o orçamento da cliente?',
    });

    console.log('Gemini Case 7 Result:', res);
    expect(res.content.toLowerCase()).toMatch(/não há informações|não informou|não mencionado|não declarou|não há registro|não consta/);
  });
});
