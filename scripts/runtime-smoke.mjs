import http from 'http';

const routes = [
  '/login',
  '/signup',
  '/forgot-password',
  '/dashboard',
  '/inbox',
  '/tasks',
  '/contacts',
  '/pipelines',
  '/catalog',
  '/intelligence',
  '/reports',
  '/settings',
  '/settings?tab=overview',
  '/settings?tab=profile',
  '/settings?tab=security',
  '/settings?tab=appearance',
  '/settings?tab=whatsapp',
  '/settings?tab=intelligence',
  '/settings?tab=templates',
  '/settings?tab=quick-replies',
  '/settings?tab=fields',
  '/settings?tab=deals',
  '/settings?tab=members',
  '/settings?tab=api'
];

async function fetchRoute(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ path, status: res.statusCode, length: data.length }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('=== RUNNING COMPREHENSIVE RUNTIME SMOKE TEST ===');
  let passCount = 0;
  let failCount = 0;

  for (const r of routes) {
    try {
      const res = await fetchRoute(r);
      const isOk = res.status === 200 || res.status === 307 || res.status === 302;
      if (isOk) passCount++;
      else failCount++;
      console.log(`${isOk ? '✅' : '❌'} [${res.status}] ${res.path} (${res.length} bytes)`);
    } catch (e) {
      failCount++;
      console.error(`💥 Failed to fetch ${r}: ${e.message}`);
    }
  }

  console.log('=== SMOKE TEST SUMMARY ===');
  console.log(`Passed: ${passCount} / ${routes.length}`);
  console.log(`Failed: ${failCount} / ${routes.length}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

run();
