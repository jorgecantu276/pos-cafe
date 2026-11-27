// Bounded transport/middleware check using an isolated production build and a
// synthetic Auth API. Real transactional sale recovery is local-sale-drill.mjs.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserClient } from '@supabase/ssr';
import { supabaseStorageKey, supabaseCookieOptions } from '../../lib/supabase-connection.ts';

const root = await realpath(path.resolve(import.meta.dirname, '../..'));
const stage = await realpath(process.argv[2]);
assert.equal(path.dirname(stage), root);
assert.ok(path.basename(stage).startsWith('.build-check-'), 'Only an isolated synthetic production build is accepted.');
assert.ok((await readFile(path.join(stage, '.next/BUILD_ID'), 'utf8')).trim());
const visible = 'https://192.168.1.25:3443', api = 'http://127.0.0.1:59999';
const anon = 'synthetic-public-key-for-build-only';
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' })).toString('base64url'), 'synthetic-signature'].join('.');
const upstream = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url.startsWith('/auth/v1/token')) response.end(JSON.stringify({ access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer', user }));
  else if (request.url === '/auth/v1/user') response.end(JSON.stringify(user));
  else if (request.url.startsWith('/rest/v1/products')) response.end(JSON.stringify([{ id: 'synthetic-product', name: 'Mango', price: 85 }]));
  else { response.statusCode = 404; response.end('{}'); }
});
let child, sdk;
const jar = new Map();
try {
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(59999, '127.0.0.1', resolve); });
  // Next's port is selected by the OS; the fixture owns and closes its child.
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let diagnostics = '';
  child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: stage, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: api, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
      POS_LAN_MODE: '1', POS_PUBLIC_ORIGIN: visible, POS_PRINT_MODE: 'disabled', POS_CLIP_ENABLED: '0',
      POS_LAUNCH_PACKAGE_ID: 'deadbeefdeadbeef', NEXT_TELEMETRY_DISABLED: '1' },
  });
  child.stdout.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
  child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
  const transport = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, visible);
    const headers = new Headers(request.headers); headers.set('host', new URL(visible).host);
    headers.set('x-forwarded-host', new URL(visible).host); headers.set('x-forwarded-proto', 'https');
    if (!['GET', 'HEAD'].includes(request.method)) headers.set('origin', visible);
    if (jar.size) headers.set('cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
    // Match the HTTPS front's core HTTP transport, preserving the visible Host.
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest({ hostname: '127.0.0.1', port, path: url.pathname + url.search,
        method: request.method, headers: Object.fromEntries(headers), timeout: 5000 }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode,
          headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value])) })));
      });
      outgoing.on('timeout', () => outgoing.destroy(Error('Synthetic Next fixture timed out.')));
      outgoing.on('error', reject); outgoing.end(body);
    });
  };
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw Error(diagnostics);
    try { if ((await transport(`${visible}/api/app-version`)).ok) { ready = true; break; } } catch { /* Owned child is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, diagnostics);
  const unauthenticated = await transport(visible);
  assert.equal(unauthenticated.status, 307);
  assert.equal(new URL(unauthenticated.headers.get('location'), visible).href, `${visible}/login`);
  assert.equal((await transport(`${visible}/login`)).status, 200);
  sdk = createBrowserClient(`${visible}/api/backend`, anon, { isSingleton: false,
    auth: { storageKey: supabaseStorageKey(api), autoRefreshToken: false }, cookieOptions: supabaseCookieOptions(api, visible),
    global: { fetch: transport }, cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => { if (value) jar.set(name, value); else jar.delete(name); }) } });
  const login = await sdk.auth.signInWithPassword({ email: 'synthetic@example.invalid', password: 'synthetic-password' });
  assert.equal(login.error, null);
  assert.equal(login.data.user.id, user.id);
  const signedIn = await transport(`${visible}/login`);
  assert.equal(signedIn.status, 307);
  assert.equal(new URL(signedIn.headers.get('location'), visible).href, `${visible}/`);
  const products = await sdk.from('products').select('*');
  assert.equal(products.error, null); assert.equal(products.data[0].name, 'Mango');
  const version = await (await transport(`${visible}/api/app-version`)).json();
  assert.deepEqual(version, { protocol: 1, packageId: 'deadbeefdeadbeef' });
  console.log('PASS: built Next login/proxy/SSR cookies and HTTPS redirects; synthetic loopback fixtures only.');
} finally {
  await sdk?.auth.stopAutoRefresh();
  if (child && child.exitCode === null) {
    const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed;
  }
  await new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); });
}
