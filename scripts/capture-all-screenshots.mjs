import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const outDir = path.join(root, 'screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Artifact dir
const artifactDir = 'C:\\Users\\leopo\\.gemini\\antigravity\\brain\\c8f2fa5e-8fe1-4f6a-93f4-482411fb08fc\\screenshots';
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
  console.log('=== CAPTURING REAL LOCAL SCREENSHOT PACKAGE ===');

  // 1. Ensure admin user has known password
  const { data: users } = await adminClient.auth.admin.listUsers();
  const adminUser = users.users.find(u => u.email === 'admin.v12@ciclopes.test') || users.users[0];
  if (!adminUser) {
    throw new Error('No user found to login');
  }

  await adminClient.auth.admin.updateUserById(adminUser.id, {
    password: 'TestPassword123!',
    email_confirm: true,
  });

  console.log(`Using admin user: ${adminUser.email}`);

  // 2. Launch Edge in headless mode
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });

  const page = await browser.newPage();

  // 3. Login
  console.log('Logging in at http://localhost:3000/login ...');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });

  await page.type('input[type="email"]', adminUser.email);
  await page.type('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));

  console.log('Current URL after login:', page.url());

  async function snap(filename, delay = 1500) {
    await new Promise((r) => setTimeout(r, delay));
    const p1 = path.join(outDir, filename);
    const p2 = path.join(artifactDir, filename);
    await page.screenshot({ path: p1, fullPage: false });
    fs.copyFileSync(p1, p2);
    console.log(`📸 Captured: ${filename}`);
  }

  // --- DESKTOP SCREENSHOTS (1440x900) ---
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // 01_inbox.png (Inbox with thread selected)
  await page.goto('http://localhost:3000/inbox', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => {
    const convButtons = document.querySelectorAll('button[class*="group relative"]');
    if (convButtons.length > 0) {
      convButtons[0].click();
    }
  });
  await snap('01_inbox.png', 2000);

  // 02_inbox_copilot.png (Open Copilot Sheet)
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copBtn = btns.find(b => b.textContent?.includes('Copiloto'));
      if (copBtn) copBtn.click();
    });
    await snap('02_inbox_copilot.png', 1500);
  } catch (e) {
    console.warn('Copilot open err:', e);
    await snap('02_inbox_copilot.png', 1000);
  }

  // 03_followups.png
  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle2' });
  await snap('03_followups.png', 2000);

  // 04_pipeline.png
  await page.goto('http://localhost:3000/pipelines', { waitUntil: 'networkidle2' });
  await snap('04_pipeline.png', 2000);

  // 05_cockpit.png
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle2' });
  await snap('05_cockpit.png', 2000);

  // 06_cockpit_ask.png (Open Ask Ciclopes drawer)
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const askBtn = btns.find(b => b.textContent?.includes('Pergunte ao Ciclopes') || b.textContent?.includes('Ask Ciclopes'));
      if (askBtn) askBtn.click();
    });
    await snap('06_cockpit_ask.png', 1500);
  } catch (e) {
    await snap('06_cockpit_ask.png', 1000);
  }

  // 07_coaching.png
  try {
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const coachTab = btns.find(b => b.textContent?.includes('Coaching'));
      if (coachTab) coachTab.click();
    });
    await snap('07_coaching.png', 1500);
  } catch (e) {
    await snap('07_coaching.png', 1000);
  }

  // 08_contacts.png
  await page.goto('http://localhost:3000/contacts', { waitUntil: 'networkidle2' });
  await snap('08_contacts.png', 2000);

  // 09_catalog.png
  await page.goto('http://localhost:3000/catalog', { waitUntil: 'networkidle2' });
  await snap('09_catalog.png', 2000);

  // 10_settings.png
  await page.goto('http://localhost:3000/settings?tab=intelligence', { waitUntil: 'networkidle2' });
  await snap('10_settings.png', 2000);

  // 11_onboarding_whatsapp.png
  await page.goto('http://localhost:3000/onboarding', { waitUntil: 'networkidle2' });
  await snap('11_onboarding_whatsapp.png', 2000);

  // 12_onboarding_business_context.png
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const step2Btn = btns.find(b => b.textContent?.includes('Contexto') || b.textContent?.includes('Continuar'));
      if (step2Btn) step2Btn.click();
    });
    await snap('12_onboarding_business_context.png', 1500);
  } catch (e) {
    await snap('12_onboarding_business_context.png', 1000);
  }

  // --- MOBILE SCREENSHOTS (390x844) ---
  console.log('\n--- CAPTURING MOBILE SCREENSHOTS (390x844) ---');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });

  // m01_conversations.png (List of conversations)
  await page.goto('http://localhost:3000/inbox', { waitUntil: 'networkidle2' });
  await snap('m01_conversations.png', 2000);

  // m02_chat.png (Active Chat)
  try {
    await page.evaluate(() => {
      const convButtons = document.querySelectorAll('button[class*="group relative"]');
      if (convButtons.length > 0) {
        convButtons[0].click();
      }
    });
    await snap('m02_chat.png', 1500);
  } catch (e) {
    await snap('m02_chat.png', 1000);
  }

  // m03_context.png (Open Intelligence Sheet on mobile)
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const ctxBtn = btns.find(b => b.textContent?.includes('Contexto') || b.getAttribute('title')?.includes('Contexto') || b.getAttribute('aria-label')?.includes('contexto'));
      if (ctxBtn) ctxBtn.click();
    });
    await snap('m03_context.png', 1500);
  } catch (e) {
    await snap('m03_context.png', 1000);
  }

  // m04_copilot.png (Open Copilot on mobile)
  try {
    await page.goto('http://localhost:3000/inbox', { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      const convButtons = document.querySelectorAll('button[class*="group relative"]');
      if (convButtons.length > 0) {
        convButtons[0].click();
      }
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const copBtn = btns.find(b => b.textContent?.includes('Copiloto'));
      if (copBtn) copBtn.click();
    });
    await snap('m04_copilot.png', 1500);
  } catch (e) {
    await snap('m04_copilot.png', 1000);
  }

  // m05_followups.png
  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle2' });
  await snap('m05_followups.png', 2000);

  // m06_pipeline.png (Mobile stage selector view)
  await page.goto('http://localhost:3000/pipelines', { waitUntil: 'networkidle2' });
  await snap('m06_pipeline.png', 2000);

  // m07_cockpit.png
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle2' });
  await snap('m07_cockpit.png', 2000);

  // m08_onboarding.png
  await page.goto('http://localhost:3000/onboarding', { waitUntil: 'networkidle2' });
  await snap('m08_onboarding.png', 2000);

  await browser.close();
  console.log('\n✅ ALL 20 REAL SCREENSHOTS CAPTURED AND SAVED IN SCREENSHOTS/ DIRECTORY!');
}

main().catch(err => {
  console.error('Failed capturing screenshots:', err);
  process.exit(1);
});
