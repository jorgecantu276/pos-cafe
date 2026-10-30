import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as ts from 'typescript';
import * as ssr from '@supabase/ssr';
import type { CookieMethodsServer, CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import * as loginReturn from '../lib/login-return';
import * as userManagement from '../lib/user-management';
import * as deadline from '../lib/request-deadline';

test('actual SSR refresh retains every chunk/deletion and cache header on normal, redirect and denied responses', async () => {
  const endpoint = 'https://session-fixture.supabase.co', key = 'sb-session-fixture-auth-token';
  const previous = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = endpoint; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic';
  const require = createRequire(import.meta.url);
  const compiled = ts.transpileModule(readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const now = Math.floor(Date.now() / 1000);
  const user = { id: 'a0000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
    email: 'fixture@local.invalid', created_at: '2026-10-30T12:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { padding: 'x'.repeat(6000) } };
  const jwt = (exp: number) => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp })).toString('base64url'), 'synthetic'].join('.');
  const expired = { access_token: jwt(now - 3600), refresh_token: 'synthetic', token_type: 'bearer', expires_in: 3600, expires_at: now - 3600, user };
  const chunks = ssr.createChunks(key, 'base64-' + ssr.stringToBase64URL(JSON.stringify(expired)));
  assert.ok(chunks.length > 1);
  try {
    for (const [route, mode] of [['/', 'large'], ['/login?returnTo=%2Ftv', 'large'], ['/', 'shrink'], ['/protected', 'remove'], ['/api/printing', 'remove']] as const) {
      const writes = new Map<string, { value: string; options: CookieOptions }>();
      const exported: { middleware?: (request: NextRequest) => Promise<NextResponse> } = {};
      const imports: Record<string, unknown> = { '@/lib/login-return': loginReturn, '@/lib/user-management': userManagement, '@/lib/request-deadline': deadline,
        '@supabase/ssr': { ...ssr, createServerClient(url: string, anon: string, options: { cookies: CookieMethodsServer }) {
          return ssr.createServerClient(url, anon, { ...options, global: { fetch: async input => {
            const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            assert.ok(address.startsWith(endpoint + '/auth/v1/'));
            if (mode === 'remove') return Response.json({ error: 'invalid_grant', error_code: 'refresh_token_not_found', msg: 'Synthetic expired refresh' }, { status: 400 });
            const freshUser = mode === 'shrink' ? { ...user, user_metadata: {} } : user;
            return Response.json(address.includes('/token') ? { ...expired, access_token: jwt(now + 3600), expires_at: now + 3600, user: freshUser } : freshUser);
          } }, cookies: { getAll: options.cookies.getAll, setAll(values, headers) {
            values.forEach(c => writes.set(c.name, c));
            return options.cookies.setAll!(values, headers);
          } } });
        } } };
      new Function('require', 'exports', compiled)((name: string) => imports[name] ?? require(name), exported);
      const request = new NextRequest('http://localhost:3112' + route, { headers: { cookie: chunks.map(c => `${c.name}=${c.value}`).join('; ') } });
      const response = await exported.middleware!(request);
      assert.ok(writes.size >= chunks.length, `${mode}: all original chunks handled`);
      for (const [name, expected] of writes) {
        const sent = response.cookies.get(name);
        assert.ok(sent, `${route}/${mode} lost ${name}`);
        assert.equal(sent.value, expected.value);
        if (expected.options.maxAge === 0) assert.equal(sent.maxAge, 0);
      }
      assert.match(response.headers.get('cache-control')!, /private.*no-store/);
      assert.equal(response.headers.get('pragma'), 'no-cache'); assert.equal(response.headers.get('expires'), '0');
      assert.match(response.headers.get('vary')!, /Cookie/);
      if (mode === 'shrink' || mode === 'remove') assert.ok([...writes.values()].some(c => c.options.maxAge === 0));
      if (mode === 'large' && route === '/') assert.ok(response.headers.get('x-middleware-request-cookie')?.includes(key));
      if (route.startsWith('/login')) assert.equal(response.headers.get('location'), 'http://localhost:3112/tv');
      if (mode === 'remove') assert.equal(response.status, route.startsWith('/api/') ? 401 : 307);
    }
  } finally {
    for (const [i, name] of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].entries()) {
      if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
    }
  }
});
