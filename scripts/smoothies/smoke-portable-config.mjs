import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const source = path.resolve(process.argv[2]);
const temporaryRoot = path.resolve(tmpdir());
const scratch = mkdtempSync(path.join(temporaryRoot, 'smoothies-portable-smoke-'));
const folder = path.join(scratch, 'release');
const base = 'http://127.0.0.1:3187';
const publicKey = 'smoke-public-key';
const privateKey = 'smoke-private-key';
let child, finished, browser;
try {
  // Next writes route caches at runtime. Execute only a verified disposable copy,
  // so inspecting a release can never change the package waiting to be archived.
  const indexBytes = readFileSync(path.join(source, 'SHA256.json'));
  const index = JSON.parse(indexBytes.toString('utf8'));
  assert.ok(Array.isArray(index) && index.length > 0, 'The package file index is missing.');
  for (const entry of index) {
    assert.ok(typeof entry.file === 'string' && !path.isAbsolute(entry.file), 'The package index requires relative paths.');
    const original = path.resolve(source, entry.file);
    const relative = path.relative(source, original);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      'The package index cannot leave its release folder.');
    const bytes = readFileSync(original);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.file);
    const target = path.join(folder, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  writeFileSync(path.join(folder, 'SHA256.json'), indexBytes);
  child = spawn(path.join(folder, 'node.exe'), [path.join(folder, 'app/server.js')], {
    windowsHide: true,
    cwd: path.join(folder, 'app'),
    env: { ...process.env, NEXT_PUBLIC_POS_PROFILE: 'smoothies', HOSTNAME: '127.0.0.1', PORT: '3187', NEXT_TELEMETRY_DISABLED: '1',
      SMOOTHIES_RUNTIME_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: privateKey },
    stdio: 'inherit',
  });
  finished = once(child, 'exit');
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
  try {
    await browser?.close();
  } finally {
    try {
      if (child?.exitCode === null) child.kill();
      if (finished) await finished;
    } finally {
      assert.equal(path.dirname(scratch), temporaryRoot);
      assert.ok(path.basename(scratch).startsWith('smoothies-portable-smoke-'));
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
