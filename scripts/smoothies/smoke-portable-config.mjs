import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

const folder = path.resolve(process.argv[2]);
const base = 'http://127.0.0.1:3187';
const publicKey = 'smoke-public-key';
const privateKey = 'smoke-private-key';
const child = spawn(path.join(folder, 'node.exe'), [path.join(folder, 'app/server.js')], {
  windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_POS_PROFILE: 'smoothies', HOSTNAME: '127.0.0.1', PORT: '3187', NEXT_TELEMETRY_DISABLED: '1',
    SMOOTHIES_RUNTIME_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: privateKey },
  stdio: 'inherit',
});
const finished = once(child, 'exit');
try {
  let config;
  for (let attempt = 0; attempt < 60 && child.exitCode === null; attempt++) {
    config = await fetch(`${base}/smoothies-config.js`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (config) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(config?.status, 200, 'The packaged public config must load on the actual standalone HTTP server.');
  assert.equal(await config.text(), `window.smoothiesPublicKey="${publicKey}";`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const login = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) });
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /smoothies-config\.js/);
  assert.ok(!html.includes(privateKey));
} finally {
  child.kill();
  await finished;
}
