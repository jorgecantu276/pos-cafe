import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { chromium } from 'playwright-core';

const folder = path.resolve(process.argv[2]);
const base = 'http://127.0.0.1:3187';
const publicKey = 'smoke-public-key';
const privateKey = 'smoke-private-key';
const child = spawn(path.join(folder, 'node.exe'), [path.join(folder, 'app/server.js')], {
  windowsHide: true,
  cwd: path.join(folder, 'app'),
  env: { ...process.env, NEXT_PUBLIC_POS_PROFILE: 'smoothies', HOSTNAME: '127.0.0.1', PORT: '3187', NEXT_TELEMETRY_DISABLED: '1',
    SMOOTHIES_RUNTIME_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: privateKey },
  stdio: 'inherit',
});
const finished = once(child, 'exit');
let browser;
try {
  let config;
  for (let attempt = 0; attempt < 60 && child.exitCode === null; attempt++) {
    config = await fetch(`${base}/smoothies-config.js`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (config) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(config?.status, 200, 'The packaged public config must load on the actual standalone HTTP server.');
  assert.equal(await config.text(), `window.smoothiesPublicKey="${publicKey}";window.dispatchEvent(new Event("smoothies-runtime-ready"));`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const login = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) });
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /smoothies-config\.js/);
  assert.ok(!html.includes(privateKey));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const scenario of ['delayed', 'failed', 'stalled']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const rpcKeys = [];
    const errors = [];
    let configRequests = 0;
    let releasedConfig = false;
    let stalledRoute;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'http://127.0.0.1:58000') {
        const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '' });
        const key = request.headers().apikey;
        rpcKeys.push(key);
        const valid = releasedConfig && key === publicKey && request.headers().authorization === `Bearer ${publicKey}`;
        return route.fulfill({ status: valid ? 200 : 401, contentType: 'application/json', headers,
          body: JSON.stringify(valid ? [{ id: '00000000-0000-4000-8000-000000000001',
            full_name: 'Administrador', username: 'admin', avatar_url: null }]
            : { message: 'Public config was not ready or the client used the baked placeholder.' }) });
      }
      if (url.origin === base) {
        if (url.pathname === '/smoothies-config.js') {
          configRequests++;
          if (scenario === 'failed' && configRequests === 1) return route.abort('failed');
          if (scenario === 'stalled' && configRequests === 1) { stalledRoute = route; return; }
          // The module graph is deliberately allowed to evaluate before this config executes.
          await new Promise(resolve => setTimeout(resolve, 300));
          releasedConfig = true;
        }
        return route.continue();
      }
      return route.abort();
    });
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    if (scenario !== 'delayed') {
      await page.getByRole('alert').getByText('No se pudo preparar la caja. Vuelve a intentar.').waitFor();
      assert.deepEqual(rpcKeys, [], 'A missing runtime config must not create a placeholder client or send an RPC.');
      await page.getByRole('button', { name: 'Volver a intentar', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Administrador', exact: true }).waitFor();
    assert.ok(rpcKeys.length > 0);
    assert.ok(rpcKeys.every(key => key === publicKey), 'The first and every later SDK request must use the actual runtime key.');
    if (stalledRoute) {
      await page.getByRole('button', { name: 'Administrador', exact: true }).click();
      await page.getByLabel('Contraseña', { exact: true }).fill('preserved login input');
      await stalledRoute.abort('failed');
      assert.equal(await page.getByLabel('Contraseña', { exact: true }).inputValue(), 'preserved login input');
    }
    assert.deepEqual(errors, [], 'Loading runtime config must not crash the client module graph.');
    await context.close();
  }
  console.log('PASS: packaged login waits for delayed runtime config; failed or stalled config retries without a reload or placeholder requests.');
} finally {
  await browser?.close();
  child.kill();
  await finished;
}
