import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { assertBackendProxyOrigin, backendProxyPath, proxyBackendRequest } from '../lib/backend-proxy';
import { browserSupabaseUrl, canonicalCatalogPhoto, proxiedCatalogPhoto, supabaseStorageKey, supabaseCookieOptions } from '../lib/supabase-connection';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const anon = 'synthetic-public-anon', secret = 'synthetic-private-service';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55481', NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret, POS_PUBLIC_ORIGIN: 'https://192.168.1.25:3189', POS_LAN_MODE: '1' };
const request = (method = 'GET', fields: Record<string, string> = {}, body?: string) => new Request(`${env.POS_PUBLIC_ORIGIN}/api/backend/rest/v1/products?select=id`, { method, headers: { host: '192.168.1.25:3189', apikey: anon, ...(method === 'GET' ? {} : { origin: env.POS_PUBLIC_ORIGIN }), ...fields }, body });

test('API paths allow only required public Auth, REST and catalog object families', () => {
  for (const [path, method] of [['auth/v1/token', 'POST'], ['auth/v1/user', 'GET'], ['auth/v1/logout', 'POST'], ['rest/v1/products', 'GET'], ['rest/v1/rpc/pos_checkout', 'POST'], ['storage/v1/object/catalog-photos/photo.jpg', 'POST'], ['storage/v1/object/public/catalog-photos/photo.jpg', 'GET']]) assert.equal(backendProxyPath(path.split('/'), method), path);
  for (const path of ['auth/v1/admin/users', 'auth/v1/signup', 'auth/v1/recover', 'functions/v1/run', 'storage/v1/bucket', 'rest/v1/rpc/private_execute', 'rest/v1/../auth', 'rest/v1/https://elsewhere', 'storage/v1/object/other/photo.jpg']) assert.throws(() => backendProxyPath(path.split('/'), 'POST'));
  for (const rpc of ['pos_business_backup', 'pos_online_payment_record', 'pos_online_service_settings', 'pos_clip_settle', 'pos_unrecognized']) assert.throws(() => backendProxyPath(['rest', 'v1', 'rpc', rpc], 'POST'));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.throws(() => backendProxyPath(['rest', 'v1', 'profiles'], method));
  assert.throws(() => backendProxyPath(['rest', 'v1', 'orders'], 'GET'));
  assert.throws(() => backendProxyPath(['rest', 'v1', 'rpc', 'pos_checkout'], 'GET'));
});

test('the finite proxy contract covers every current browser RPC literal and dynamic helper map including register shortcuts', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const modules = ['app/register/Register.tsx', 'app/login/page.tsx', 'lib/checkout.ts', 'lib/cancellation.ts', 'lib/catalog-management.ts', 'lib/customer-management.ts',
    'lib/drawer.ts', 'lib/shift-state.ts', 'lib/inventory.ts', 'lib/recipe-trial.ts', 'lib/phone-orders.ts', 'lib/shift-printing.ts', 'lib/recent-tickets.ts', 'lib/register-shortcuts.ts', 'lib/staff-active.ts'];
  async function browserPages(directory: string): Promise<void> {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await browserPages(relative);
      else if (/\.tsx$/.test(entry.name) && (await readFile(path.join(root, relative), 'utf8')).includes("'use client'")) modules.push(relative);
    }
  }
  await browserPages('app/admin');
  const names = new Set<string>();
  for (const sourceModule of modules) {
    const source = await readFile(path.join(root, sourceModule), 'utf8');
    for (const match of source.matchAll(/['"]((?:pos_[a-z_]+|get_register_shortcuts))['"]/g)) names.add(match[1]);
    for (const match of source.matchAll(/\.from\(['"]([a-z_]+)['"]\)/g)) assert.equal(backendProxyPath(['rest', 'v1', match[1]], 'GET'), `rest/v1/${match[1]}`, `${sourceModule} table ${match[1]}`);
  }
  assert.ok(names.has('get_register_shortcuts')); assert.ok(names.has('pos_manager_close_drawer')); assert.ok(names.has('pos_shift_expenses'));
  for (const rpc of names) assert.equal(backendProxyPath(['rest', 'v1', 'rpc', rpc], 'POST'), `rest/v1/rpc/${rpc}`, rpc);
});

test('LAN writes require exact canonical TLS origin and host; spoofed cross-origin requests fail', () => {
  assert.doesNotThrow(() => assertBackendProxyOrigin(request('POST'), env));
  for (const fields of [{ origin: 'https://evil.invalid' }, { host: 'evil.invalid' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) assert.throws(() => assertBackendProxyOrigin(request('POST', fields), env));
  const missing = request('POST'); missing.headers.delete('origin'); assert.throws(() => assertBackendProxyOrigin(missing, env));
  assert.throws(() => assertBackendProxyOrigin(request('GET', { host: '127.0.0.1:3179' }), env));
});

test('existing loopback presentation keeps same-origin API access without enabling LAN host guesses', () => {
  const local = { ...env, POS_LAN_MODE: undefined, POS_PUBLIC_ORIGIN: 'http://127.0.0.1:3139' };
  assert.doesNotThrow(() => assertBackendProxyOrigin(new Request('http://127.0.0.1:3139/api/backend/auth/v1/token', { method: 'POST', headers: { host: '127.0.0.1:3139', origin: 'http://127.0.0.1:3139' } }), local));
  assert.throws(() => assertBackendProxyOrigin(request('GET', { host: '192.168.1.50:3139' }), local));
});

test('proxy routes only to the configured upstream and forwards public credentials plus caller JWT, never service key or cookies', async () => {
  let called = false;
  const upstream = async (url: URL, init: RequestInit) => {
    called = true; assert.equal(url.href, 'http://127.0.0.1:55481/rest/v1/products?select=id');
    const headers = new Headers(init.headers); assert.equal(headers.get('apikey'), anon); assert.equal(headers.get('authorization'), 'Bearer caller-session');
    assert.equal(headers.get('cookie'), null); assert.equal(headers.get('x-forwarded-host'), null); assert.doesNotMatch(JSON.stringify(init), new RegExp(secret));
    return Response.json([{ id: 'test' }], { headers: { 'access-control-allow-origin': '*', 'set-cookie': 'upstream=private', 'content-location': 'http://127.0.0.1:55481/private' } });
  };
  const response = await proxyBackendRequest(request('GET', { authorization: 'Bearer caller-session', cookie: 'session=cookie', 'x-forwarded-host': 'evil.invalid' }), ['rest', 'v1', 'products'], env, upstream as typeof fetch);
  assert.equal(response.status, 200); assert.equal(called, true); assert.equal(response.headers.get('access-control-allow-origin'), null); assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('content-location'), null); assert.match(response.headers.get('cache-control')!, /no-store/);
});

test('single-row PostgREST negotiation and response range are preserved through the proxy', async () => {
  const response = await proxyBackendRequest(request('GET', { accept: 'application/vnd.pgrst.object+json' }), ['rest', 'v1', 'profiles'], env, (async (_url: URL, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('accept'), 'application/vnd.pgrst.object+json');
    return Response.json({ id: 'session-profile', role: 'cashier' }, { headers: { 'content-range': '0-0/1' } });
  }) as typeof fetch);
  assert.deepEqual(await response.json(), { id: 'session-profile', role: 'cashier' }); assert.equal(response.headers.get('content-range'), '0-0/1');
});

test('privileged credentials and non-public schema headers cannot cross the browser proxy', async () => {
  const never = async () => { throw new Error('Upstream must not be called'); };
  for (const fields of [{ apikey: secret }, { authorization: `Bearer ${secret}` }, { 'accept-profile': 'cafe_private' }, { 'content-profile': 'auth' }] as Record<string, string>[]) assert.equal((await proxyBackendRequest(request('GET', fields), ['rest', 'v1', 'products'], env, never as typeof fetch)).status, 403);
});

test('Auth token grants are restricted to real password login and refresh, not signup or arbitrary grant types', async () => {
  for (const grant of ['password', 'refresh_token', 'client_credentials']) {
    const req = new Request(`${env.POS_PUBLIC_ORIGIN}/api/backend/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { host: '192.168.1.25:3189', origin: env.POS_PUBLIC_ORIGIN, apikey: anon, 'content-type': 'application/json' }, body: '{}' });
    const response = await proxyBackendRequest(req, ['auth', 'v1', 'token'], env, (async () => Response.json({ ok: true })) as typeof fetch);
    assert.equal(response.status, grant === 'client_credentials' ? 403 : 200);
  }
});

test('catalog uploads preserve multipart bytes and boundary; public images need no browser API-key header', async () => {
  const body = '--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\nimage-bytes\r\n--boundary--';
  const upload = request('POST', { 'content-type': 'multipart/form-data; boundary=boundary', authorization: 'Bearer caller' }, body);
  const uploaded = await proxyBackendRequest(upload, ['storage', 'v1', 'object', 'catalog-photos', 'photo.jpg'], env, (async (_url: URL, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('content-type'), 'multipart/form-data; boundary=boundary'); assert.equal(new TextDecoder().decode(init.body as Uint8Array), body); return Response.json({ Key: 'catalog-photos/photo.jpg' });
  }) as typeof fetch); assert.equal(uploaded.status, 200);
  const image = request(); image.headers.delete('apikey');
  assert.equal((await proxyBackendRequest(image, ['storage', 'v1', 'object', 'public', 'catalog-photos', 'photo.jpg'], env, (async () => new Response('image')) as typeof fetch)).status, 200);
});

test('oversize uploads and backend redirects fail closed without relaying internal locations', async () => {
  const oversized = request('POST', { 'content-length': String(21 * 1024 * 1024) }, '{}');
  assert.equal((await proxyBackendRequest(oversized, ['rest', 'v1', 'rpc', 'pos_checkout'], env)).status, 413);
  assert.equal((await proxyBackendRequest(request(), ['rest', 'v1', 'products'], env, (async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid' } })) as typeof fetch)).status, 502);
});

test('browser API URL and SSR use a stable shared cookie namespace despite distinct host origins', () => {
  assert.equal(browserSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL, env.POS_PUBLIC_ORIGIN), `${env.POS_PUBLIC_ORIGIN}/api/backend`);
  assert.equal(browserSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL), env.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(supabaseStorageKey(env.NEXT_PUBLIC_SUPABASE_URL), 'sb-127-0-0-1-55481-auth-token');
  assert.equal(supabaseStorageKey('https://owned.supabase.co'), 'sb-owned-auth-token');
});

test('real Supabase browser/server clients agree on Auth storage key across proxy and internal API URLs', () => {
  const storageKey = supabaseStorageKey(env.NEXT_PUBLIC_SUPABASE_URL);
  const cookieOptions = supabaseCookieOptions(env.NEXT_PUBLIC_SUPABASE_URL, env.POS_PUBLIC_ORIGIN);
  const browser = createBrowserClient(browserSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL, env.POS_PUBLIC_ORIGIN), anon, { isSingleton: false, auth: { storageKey, autoRefreshToken: false, persistSession: false }, cookieOptions });
  const server = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, anon, { auth: { storageKey, autoRefreshToken: false }, cookieOptions, cookies: { getAll: () => [], setAll: () => {} } });
  assert.equal((browser.auth as unknown as { storageKey: string }).storageKey, storageKey);
  assert.equal((server.auth as unknown as { storageKey: string }).storageKey, storageKey);
  browser.auth.stopAutoRefresh(); server.auth.stopAutoRefresh();
});

test('local development, primary demo and review databases have distinct host-cookie namespaces', () => {
  const profiles = ['http://127.0.0.1:55881', 'http://127.0.0.1:55641', 'http://127.0.0.1:55481'];
  assert.equal(new Set(profiles.map(supabaseStorageKey)).size, 3);
  for (const api of profiles) {
    const key = supabaseStorageKey(api); assert.notEqual(key, 'sb-127-auth-token'); assert.match(key, /^[A-Za-z0-9_-]+$/);
    assert.equal(supabaseCookieOptions(api, 'https://192.168.1.25:3189').name, key);
    assert.equal(supabaseCookieOptions(api, 'https://192.168.1.25:3189').secure, true);
    assert.equal(supabaseCookieOptions(api, 'http://127.0.0.1:3141').secure, false);
  }
  assert.notEqual(supabaseStorageKey('http://localhost:55881'), supabaseStorageKey('http://localhost:55481'));
});

test('real Auth cookie writes isolate profiles on one browser host, preserve legacy sessions and set Secure for visible HTTPS', async () => {
  const jar = new Map<string, string>([['sb-127-auth-token', 'untouched-live-legacy-session']]);
  const writes: { name: string; secure?: boolean }[] = [];
  const cookies = { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (values: { name: string; value: string; options: { secure?: boolean } }[]) => {
    for (const { name, value, options } of values) { writes.push({ name, secure: options.secure }); if (value) jar.set(name, value); else jar.delete(name); }
  } };
  const clients = [];
  try {
    for (const [index, port] of [55481, 55641, 55881].entries()) {
      const api = `http://127.0.0.1:${port}`, visible = index === 2 ? 'https://192.168.1.25:3189' : 'http://127.0.0.1:3139';
      const user = { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, aud: 'authenticated', created_at: '2026-11-23T12:00:00Z', app_metadata: {}, user_metadata: {} };
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: expiry, role: 'authenticated' })).toString('base64url'), 'synthetic-signature'].join('.');
      const fetchFixture = (async () => Response.json({ access_token: token, refresh_token: `fixture-refresh-${port}`, token_type: 'bearer', expires_in: 3600, user })) as typeof fetch;
      const common = { auth: { storageKey: supabaseStorageKey(api), autoRefreshToken: false }, cookieOptions: supabaseCookieOptions(api, visible), cookies, global: { fetch: fetchFixture } };
      const server = createServerClient(api, anon, common), browser = createBrowserClient(browserSupabaseUrl(api, visible), anon, { ...common, isSingleton: false });
      clients.push(server, browser);
      const result = await server.auth.signInWithPassword({ email: 'fixture@example.invalid', password: 'synthetic-password-not-real' });
      assert.equal(result.error, null); assert.equal(result.data.user?.id, user.id);
      const key = supabaseStorageKey(api); assert.ok([...jar.keys()].some(name => name === key || name.startsWith(key + '.')));
      assert.equal((server.auth as unknown as { storageKey: string }).storageKey, (browser.auth as unknown as { storageKey: string }).storageKey);
      const profileWrites = writes.filter(write => write.name === key || write.name.startsWith(key + '.')); assert.ok(profileWrites.length > 0);
      assert.equal(profileWrites.every(write => write.secure === (index === 2)), true);
    }
    assert.equal(jar.get('sb-127-auth-token'), 'untouched-live-legacy-session');
    for (const port of [55481, 55641, 55881]) assert.ok([...jar.keys()].some(name => name.startsWith(supabaseStorageKey(`http://127.0.0.1:${port}`))));
  } finally { clients.forEach(client => client.auth.stopAutoRefresh()); }
});

test('stored loopback catalog image URLs become same-origin paths without rewriting third-party content', () => {
  const saved = canonicalCatalogPhoto('photo.jpg', env.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(new URL(saved).origin, env.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(proxiedCatalogPhoto(saved, env.NEXT_PUBLIC_SUPABASE_URL), '/api/backend/storage/v1/object/public/catalog-photos/photo.jpg');
  assert.equal(proxiedCatalogPhoto('http://127.0.0.1:55481/storage/v1/object/public/catalog-photos/photo.jpg', env.NEXT_PUBLIC_SUPABASE_URL), '/api/backend/storage/v1/object/public/catalog-photos/photo.jpg');
  assert.equal(proxiedCatalogPhoto('https://elsewhere.invalid/photo.jpg', env.NEXT_PUBLIC_SUPABASE_URL), 'https://elsewhere.invalid/photo.jpg');
  assert.equal(proxiedCatalogPhoto('/client-products/generic.svg', env.NEXT_PUBLIC_SUPABASE_URL), '/client-products/generic.svg');
});
