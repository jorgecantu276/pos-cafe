import * as deadline from '../lib/request-deadline';
import * as reprint from '../lib/receipt-reprint';
import {WorkspaceKeyboard} from '../app/register/WorkspaceRegister';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as ts from 'typescript';
import { NextRequest } from 'next/server';
import * as loginReturn from '../lib/login-return';
import * as userManagement from '../lib/user-management';
import StaffAvatar from '../components/StaffAvatar';

function compile(file: string, imports: Record<string, unknown>) {
  const nodeRequire = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', source)((name: string) => imports[name] ?? nodeRequire(name), exports);
  return exports;
}

test('login return accepts only the TV route and defaults safely to POS', () => {
  assert.equal(loginReturn.loginReturnTarget('/tv'), '/tv');
  for (const value of [null, '', '/', '/login', '/admin', '//example.com', 'https://example.com/tv',
    'javascript:alert(1)', '/\\example.com', '/tv?next=https://example.com', '%2Ftv', '/tv/../login']) {
    assert.equal(loginReturn.loginReturnTarget(value), '/');
  }
});

test('middleware preserves TV destination for expired sessions and safely redirects an already signed-in login', async () => {
  const previousApi = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:58000';
  try {
  let signedIn = false;
  const { middleware } = compile('../middleware.ts', {
    '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'synthetic' } : null }, error: null }) } }) },
    '@/lib/request-deadline':deadline, '@/lib/login-return': loginReturn, '@/lib/user-management': userManagement,
  }) as { middleware: (request: NextRequest) => Promise<Response> };
  const request = (path: string) => middleware(new NextRequest(`http://localhost:3112${path}`));
  const expired = await request('/tv?unrelated=discard');
  assert.equal(expired.headers.get('location'), 'http://localhost:3112/login?returnTo=%2Ftv');
  assert.equal((await request('/api/tv')).status, 401);
  signedIn = true;
  assert.equal((await request(loginReturn.TV_LOGIN_URL)).headers.get('location'), 'http://localhost:3112/tv');
  for (const path of ['/login', '/login?returnTo=https://example.com', '/login?returnTo=%2F%2Fexample.com']) {
    assert.equal((await request(path)).headers.get('location'), 'http://localhost:3112/');
  }
  } finally {
    if (previousApi === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousApi;
  }
});

test('LAN middleware redirects through the configured HTTPS origin despite Next internal HTTP URLs', async () => {
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'POS_LAN_MODE', 'POS_PUBLIC_ORIGIN'];
  const previous = names.map(name => process.env[name]);
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:58000', POS_LAN_MODE: '1', POS_PUBLIC_ORIGIN: 'https://192.168.1.25:3443' });
  let signedIn = false;
  try {
    const { middleware } = compile('../middleware.ts', {
      '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'synthetic' } : null }, error: null }) } }) },
      '@/lib/request-deadline': deadline, '@/lib/login-return': loginReturn, '@/lib/user-management': userManagement,
    }) as { middleware: (request: NextRequest) => Promise<Response> };
    const request = (pathname: string) => middleware(new NextRequest(`http://127.0.0.1:3180${pathname}`, { headers: { host: '192.168.1.25:3443' } }));
    assert.equal((await request('/')).headers.get('location'), 'https://192.168.1.25:3443/login');
    assert.equal((await request('/tv')).headers.get('location'), 'https://192.168.1.25:3443/login?returnTo=%2Ftv');
    signedIn = true;
    assert.equal((await request('/login')).headers.get('location'), 'https://192.168.1.25:3443/');
    assert.equal((await request('/api/backend/auth/v1/token')).status, 200);
    assert.equal((await request('/api/ops-demo/login')).status, 404);
  } finally { names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); }
});

test('actual login form preserves TV destination through failed authentication and replaces it only after success', async () => {
  for (const [path, target] of [[loginReturn.TV_LOGIN_URL, '/tv'], ['/login', '/'], ['/login?returnTo=https://example.com', '/']]) {
    const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost:3112${path}` });
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    const destinations: string[] = [];
    let fail = true, refreshes = 0;
    const client = { rpc: async () => ({ data: [{ id: 'test-admin', username: 'testowner', full_name: 'Prueba local', avatar_url: '/staff-avatars/avatar-2.svg' }], error: null }),
      auth: { signInWithPassword: async () => ({ error: fail ? { message: 'Synthetic rejection' } : null }) } };
    const Page = compile('../app/login/page.tsx', {
      '@/components/StaffAvatar': { default: StaffAvatar, __esModule: true },
      '@/lib/request-deadline':deadline, '@/lib/receipt-reprint':reprint, '@/lib/supabase': { supabase: client }, '@/lib/login-return': loginReturn,
      '../register/WorkspaceRegister': {WorkspaceKeyboard}, '../register/workspace.css':{}, './login.css':{},
      'next/navigation': { useRouter: () => ({ replace: (url: string) => destinations.push(url), refresh: () => refreshes++ }) },
    }).default as ComponentType;
    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await act(async () => root.render(createElement(Page)));
      assert.equal(dom.window.document.querySelector('.workspace-login-avatar')?.getAttribute('src'),'/staff-avatars/avatar-2.svg');
      const profile = [...dom.window.document.querySelectorAll('span')].find(e => e.textContent === 'Prueba')!;
      assert.ok(profile);
      await act(async () => profile.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      const submit = () => act(async () => { dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
      await submit();
      assert.deepEqual(destinations, []); assert.equal(refreshes, 0);
      assert.match(dom.window.document.body.textContent!, /Contraseña incorrecta/);
      assert.equal(dom.window.location.pathname + dom.window.location.search, path);
      fail = false;
      await submit();
      assert.deepEqual(destinations, [target]); assert.equal(refreshes, 1);
    } finally {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
});
