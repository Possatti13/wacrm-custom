import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const outDir = path.join(root, 'screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const conversationId = 'cdce6cd9-2213-4322-a991-7f44742d82a7';
const artifactDir = path.join('C:\\Users\\leopo\\.gemini\\antigravity\\brain', conversationId, 'screenshots');
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
  .split(/\r?\n/)
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    if (k && v.length) acc[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
    return acc;
  }, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(supabaseUrl, serviceKey);

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  console.log('=== CICLOPES RESPONSIVE HOTFIX 01 — FULL VISUAL VERIFICATION ===');

  // 1. Ensure test user has known credentials & profile
  const { data: users } = await adminClient.auth.admin.listUsers();
  const adminUser = users.users.find(u => u.email === 'admin.v12@ciclopes.test') || users.users[0];
  if (!adminUser) {
    throw new Error('No test user found in Supabase Auth');
  }

  await adminClient.auth.admin.updateUserById(adminUser.id, {
    password: 'TestPassword123!',
    email_confirm: true,
  });

  const { data: profile } = await adminClient
    .from('profiles')
    .select('account_id')
    .eq('user_id', adminUser.id)
    .single();

  const accountId = profile.account_id;
  console.log(`Using account ID: ${accountId} for user: ${adminUser.email}`);

  // 2. Ensure at least one active conversation exists with messages
  let { data: conv } = await adminClient
    .from('conversations')
    .select('id, contact_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();

  if (!conv) {
    // Create test contact
    const { data: contact } = await adminClient
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: adminUser.id,
        name: 'Mariana Silva',
        phone: '5511987654321',
      })
      .select('id')
      .single();

    const { data: newConv } = await adminClient
      .from('conversations')
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        status: 'open',
        last_message_at: new Date().toISOString(),
        last_message_preview: 'Olá! Gostaria de saber mais sobre a proposta comercial.',
      })
      .select('id, contact_id')
      .single();

    conv = newConv;

    // Insert test messages
    await adminClient.from('messages').insert([
      {
        conversation_id: conv.id,
        sender_type: 'contact',
        body: 'Olá! Gostaria de saber mais sobre a proposta comercial enviada ontem.',
        direction: 'inbound',
        status: 'received',
      },
      {
        conversation_id: conv.id,
        sender_type: 'agent',
        body: 'Olá Mariana! Perfeito, nossa equipe preparou condições especiais com desconto de 15%.',
        direction: 'outbound',
        status: 'delivered',
      }
    ]);
  }

  console.log(`Active conversation ID ready: ${conv.id}`);

  // 3. Launch browser
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });

  const page = await browser.newPage();

  async function snap(filename, delay = 1200) {
    await new Promise((r) => setTimeout(r, delay));
    const p1 = path.join(outDir, filename);
    const p2 = path.join(artifactDir, filename);
    await page.screenshot({ path: p1, fullPage: false });
    fs.copyFileSync(p1, p2);
    console.log(`📸 Saved screenshot: ${filename}`);
  }

  // 4. Login
  console.log('Logging in at http://localhost:3000/login ...');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });

  await page.type('input[type="email"]', adminUser.email);
  await page.type('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  console.log('Authenticated URL:', page.url());

  // ==========================================
  // 5. TARGET AUDIT AT 400x841 (EXACT INCIDENT DIMENSIONS)
  // ==========================================
  console.log('\n--- 1. AUDITING 400x841 GEOMETRY ---');
  await page.setViewport({ width: 400, height: 841, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/inbox', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const geometry400 = await page.evaluate(() => {
    const mainEl = document.querySelector('main');
    const asideEl = document.querySelector('aside');
    const convListEl = document.querySelector('div[class*="border-border"][class*="bg-card"]');
    const bodyScrollWidth = document.documentElement.scrollWidth;
    const bodyClientWidth = document.documentElement.clientWidth;

    const mainRect = mainEl?.getBoundingClientRect();
    const asideRect = asideEl?.getBoundingClientRect();
    const convListRect = convListEl?.getBoundingClientRect();

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      main: {
        x: mainRect?.x ?? 0,
        width: mainRect?.width ?? 0,
        height: mainRect?.height ?? 0,
      },
      aside: {
        x: asideRect?.x ?? 0,
        width: asideRect?.width ?? 0,
        isInFlow: asideEl ? window.getComputedStyle(asideEl).position !== 'fixed' : false,
      },
      conversationList: {
        x: convListRect?.x ?? 0,
        width: convListRect?.width ?? 0,
      },
      scrollWidth: bodyScrollWidth,
      clientWidth: bodyClientWidth,
      hasHorizontalOverflow: bodyScrollWidth > bodyClientWidth,
    };
  });

  console.log('400x841 List Geometry:', JSON.stringify(geometry400, null, 2));
  await snap('hotfix_01_inbox_mobile_400x841_list.png');

  // Navigate to chat mode via deep link & click
  console.log('Opening conversation in 400x841 ...');
  await page.goto(`http://localhost:3000/inbox?c=${conv.id}`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const chatGeometry400 = await page.evaluate(() => {
    const threadEl = document.querySelector('div[class*="flex min-w-0 flex-1 flex-col"]');
    const threadRect = threadEl?.getBoundingClientRect();
    const composerEl = document.querySelector('textarea, div[class*="message-composer"]');
    const composerRect = composerEl?.getBoundingClientRect();
    const backBtn = document.querySelector('button[aria-label*="voltar" i], button[aria-label*="conversas" i]');

    return {
      thread: {
        x: threadRect?.x ?? 0,
        width: threadRect?.width ?? 0,
      },
      composer: {
        visible: Boolean(composerRect && composerRect.height > 0),
        y: composerRect?.y ?? 0,
      },
      hasBackButton: Boolean(backBtn),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  console.log('400x841 Chat Geometry:', JSON.stringify(chatGeometry400, null, 2));
  await snap('hotfix_02_inbox_mobile_400x841_chat.png');

  // Open Copilot Sheet in 400x841
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copBtn = btns.find(b => b.textContent?.includes('Copiloto') || b.title?.includes('Copiloto'));
      if (copBtn) copBtn.click();
    });
    await snap('hotfix_03_inbox_mobile_400x841_copilot.png', 1500);

    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 600));
  } catch (e) {
    console.error('Failed to snapshot copilot sheet:', e.message);
  }

  // Open Context Sheet in 400x841
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const ctxBtn = btns.find(b => b.getAttribute('aria-label')?.includes('painel') || b.title?.includes('contato') || b.title?.includes('Contexto'));
      if (ctxBtn) ctxBtn.click();
    });
    await snap('hotfix_04_inbox_mobile_400x841_context.png', 1500);

    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 600));
  } catch (e) {
    console.error('Failed to snapshot context sheet:', e.message);
  }

  // ==========================================
  // 6. FULL RESPONSIVE BREAKPOINT MATRIX
  // ==========================================
  console.log('\n--- 2. AUDITING FULL BREAKPOINT MATRIX ---');
  const breakpoints = [
    { name: '360x800_phone', width: 360, height: 800 },
    { name: '390x844_phone', width: 390, height: 844 },
    { name: '430x932_phone', width: 430, height: 932 },
    { name: '768x1024_tablet_portrait', width: 768, height: 1024 },
    { name: '820x1180_tablet_portrait', width: 820, height: 1180 },
    { name: '1024x768_tablet_landscape', width: 1024, height: 768 },
    { name: '1280x720_desktop', width: 1280, height: 720 },
    { name: '1366x768_desktop', width: 1366, height: 768 },
    { name: '1440x900_desktop', width: 1440, height: 900 },
    { name: '1920x1080_desktop', width: 1920, height: 1080 },
  ];

  for (const bp of breakpoints) {
    await page.setViewport({ width: bp.width, height: bp.height, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:3000/inbox?c=${conv.id}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));
    await snap(`matrix_${bp.name}_inbox.png`, 1000);
  }

  // ==========================================
  // 7. MOBILE NAVIGATION ACROSS ALL CORE ROUTES (390px & 400px)
  // ==========================================
  console.log('\n--- 3. AUDITING ALL ROUTES AT 390x844 MOBILE ---');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });

  const routes = [
    { path: '/inbox', name: '01_mobile_inbox', h2: 'hotfix02_390_inbox' },
    { path: '/tasks', name: '02_mobile_followups', h2: 'hotfix02_390_followups' },
    { path: '/pipelines', name: '03_mobile_pipelines', h2: 'hotfix02_390_pipeline' },
    { path: '/dashboard', name: '04_mobile_cockpit', h2: 'hotfix02_390_cockpit' },
    { path: '/contacts', name: '05_mobile_contacts', h2: 'hotfix02_390_contacts' },
    { path: '/catalog', name: '06_mobile_catalog', h2: 'hotfix02_390_catalog' },
    { path: '/settings', name: '07_mobile_settings', h2: 'hotfix02_390_settings' },
  ];

  const routeResults = [];
  for (const r of routes) {
    await page.goto(`http://localhost:3000${r.path}`, { waitUntil: 'networkidle2' });
    await new Promise(res => setTimeout(res, 1200));

    const check = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    }));

    routeResults.push({ path: r.path, ...check });
    await snap(`${r.name}.png`);
    await snap(`${r.h2}.png`);
  }

  console.log('All routes mobile overflow check:', JSON.stringify(routeResults, null, 2));

  // Cockpit 400x841 capture
  await page.setViewport({ width: 400, height: 841, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle2' });
  await new Promise(res => setTimeout(res, 1200));
  await snap('hotfix02_400_cockpit.png');
  await snap('hotfix02_before_cockpit_400x841.png');

  // Tablet captures (768x1024)
  console.log('\n--- 4. AUDITING TABLET 768x1024 ---');
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
  for (const r of [
    { path: '/inbox', name: 'hotfix02_768_inbox' },
    { path: '/pipelines', name: 'hotfix02_768_pipeline' },
    { path: '/dashboard', name: 'hotfix02_768_cockpit' },
    { path: '/settings', name: 'hotfix02_768_settings' },
  ]) {
    await page.goto(`http://localhost:3000${r.path}`, { waitUntil: 'networkidle2' });
    await new Promise(res => setTimeout(res, 1200));
    await snap(`${r.name}.png`);
  }

  // Desktop captures (1366x768)
  console.log('\n--- 5. AUDITING DESKTOP 1366x768 ---');
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  for (const r of [
    { path: '/inbox', name: 'hotfix02_1366_inbox' },
    { path: '/pipelines', name: 'hotfix02_1366_pipeline' },
    { path: '/dashboard', name: 'hotfix02_1366_cockpit' },
    { path: '/settings', name: 'hotfix02_1366_settings' },
  ]) {
    await page.goto(`http://localhost:3000${r.path}`, { waitUntil: 'networkidle2' });
    await new Promise(res => setTimeout(res, 1200));
    await snap(`${r.name}.png`);
  }

  await browser.close();
  console.log('\n=== RESPONSIVE HOTFIX VERIFICATION COMPLETE ===');
}

main().catch(err => {
  console.error('Error running responsive verification:', err);
  process.exit(1);
});
