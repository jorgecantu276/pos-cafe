import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { act, createElement, useEffect, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as ts from 'typescript';
import * as connection from '../lib/supabase-connection';

function compile(file: string, imports: Record<string, unknown>) {
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', source)((name: string) => imports[name] ?? require(name), exports);
  return exports;
}

test('Cafe retains direct hosted Supabase transport, SDK cookie defaults and merchant photo URLs', async () => {
  const previousApi = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const api = 'https://cafe-fixture.supabase.co';
  const photo = `${api}/storage/v1/object/public/catalog-photos/coffee.jpg`;
  const profile = { posProfile: { id: 'cafe' } };
  const calls: unknown[][] = [];
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = api;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://cafe-fixture.invalid' } } });
    const sdk = compile('../lib/supabase.ts', {
      './pos-profile': profile, './supabase-connection': connection,
      './operations-demo-auth': { operationsDemoAuth: () => ({}) },
      './supabase-public-config': { supabasePublicKey: () => 'synthetic-public-key' },
      '@supabase/ssr': { createBrowserClient: (...args: unknown[]) => { calls.push(args); return { auth: 'cafe-auth' }; } },
    }) as { supabase: { auth: string } };
    assert.equal(sdk.supabase.auth, 'cafe-auth');
    assert.deepEqual(calls, [[api, 'synthetic-public-key', {}]]);
    const serverCalls: unknown[][] = [];
    const server = compile('../lib/supabase-server.ts', {
      './pos-profile': profile, './supabase-connection': connection,
      './operations-demo-auth': { operationsDemoAuth: () => ({}) },
      './supabase-public-config': { supabasePublicKey: () => 'synthetic-public-key' },
      'next/headers': { cookies: async () => ({ getAll: () => [], set() {} }) },
      '@supabase/ssr': { createServerClient: (...args: unknown[]) => { serverCalls.push(args); return 'cafe-server'; } },
    }) as { serverSupabase: () => Promise<string> };
    assert.equal(await server.serverSupabase(), 'cafe-server');
    assert.equal(serverCalls[0][0], api);
    assert.deepEqual(Object.keys(serverCalls[0][2] as object), ['cookies']);
    const photos = compile('../lib/product-photos.ts', { './pos-profile': profile, './supabase-connection': connection }) as { productPhotoSource: (url: string, fallback: string) => string };
    assert.equal(photos.productPhotoSource(photo, '/fallback.webp'), photo);
    const smoothies = compile('../lib/product-photos.ts', { './pos-profile': { posProfile: { id: 'smoothies' } }, './supabase-connection': connection }) as typeof photos;
    assert.equal(smoothies.productPhotoSource(photo, '/fallback.webp'), '/api/backend/storage/v1/object/public/catalog-photos/coffee.jpg');
  } finally {
    if (previousApi === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousApi;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('portable SDK construction waits for a real runtime key and preserves singleton/auth/storage/method contracts', () => {
  const oldPortable = process.env.NEXT_PUBLIC_SMOOTHIES_PORTABLE;
  const oldBuildKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const oldRuntime = process.env.SMOOTHIES_RUNTIME_ANON_KEY;
  const oldOpsDemo = process.env.NEXT_PUBLIC_POS_OPS_DEMO;
  const oldApi = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    process.env.NEXT_PUBLIC_SMOOTHIES_PORTABLE = '1';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'smoothies-runtime-config';
    delete process.env.SMOOTHIES_RUNTIME_ANON_KEY;
    delete process.env.NEXT_PUBLIC_POS_OPS_DEMO;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:58000';
    const window: { smoothiesPublicKey?: string; location: { origin: string } } = { location: { origin: 'https://192.168.1.25:3189' } };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    const config = compile('../lib/supabase-public-config.ts', { './pos-profile': { posProfile: { id: 'smoothies' } } });
    const keys: string[] = [];
    const options: unknown[] = [];
    const auth = { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
    const storage = { from: (name: string) => ({ name }) };
    const actual = { auth, storage, marker: 'actual-client', rpc() { return this.marker; } };
    const { supabase } = compile('../lib/supabase.ts', {
      './pos-profile': { posProfile: { id: 'smoothies' } },
      './supabase-public-config': config,
      './operations-demo-auth': compile('../lib/operations-demo-auth.ts', {}),
      './supabase-connection': connection,
      '@supabase/ssr': { createBrowserClient: (_url: string, key: string, config: unknown) => { keys.push(key); options.push(config); return actual; } },
    }) as { supabase: typeof actual };
    assert.deepEqual(keys, [], 'Evaluating route modules must not create or poison the SDK singleton.');
    assert.throws(() => supabase.rpc(), /configuracion/);
    assert.deepEqual(keys, [], 'Missing portable config must fail before calling the SDK factory.');
    window.smoothiesPublicKey = 'real-local-anon-key';
    const extractedRpc = supabase.rpc;
    assert.equal(extractedRpc(), 'actual-client');
    assert.equal(supabase.auth, auth);
    assert.equal(supabase.storage, storage);
    assert.ok(supabase.auth.onAuthStateChange().data.subscription.unsubscribe);
    assert.deepEqual(keys, ['real-local-anon-key']);
    assert.deepEqual(options, [{ auth: { storageKey: 'sb-127-0-0-1-58000-auth-token' }, cookieOptions: { name: 'sb-127-0-0-1-58000-auth-token', path: '/', sameSite: 'lax', secure: true } }]);
    Reflect.deleteProperty(globalThis, 'window');
    const getKey = config.supabasePublicKey as () => string;
    assert.throws(getKey, /configuracion/);
    process.env.SMOOTHIES_RUNTIME_ANON_KEY = 'real-server-anon-key';
    assert.equal(getKey(), 'real-server-anon-key');
  } finally {
    for (const [key, value] of Object.entries({ NEXT_PUBLIC_SMOOTHIES_PORTABLE: oldPortable,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: oldBuildKey, SMOOTHIES_RUNTIME_ANON_KEY: oldRuntime, NEXT_PUBLIC_POS_OPS_DEMO: oldOpsDemo, NEXT_PUBLIC_SUPABASE_URL: oldApi })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('portable gate recovers delayed, failed, and stalled config without mounting consumers early or remounting ready forms', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:3187/login' });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  let stalled: () => void = () => {};
  dom.window.setTimeout = ((callback: () => void) => { stalled = callback; return 1; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = () => {};
  let script: { src: string; onError: () => void; onReady: () => void };
  let mounts = 0, unmounts = 0;
  function Consumer() {
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return createElement('input', { 'aria-label': 'Unsaved recipe', defaultValue: 'keep this draft' });
  }
  const Gate = compile('../app/SmoothiesRuntimeGate.tsx', {
    'next/script': { __esModule: true, default: (props: typeof script) => { script = props; return null; } },
  }).default as ComponentType<{ children?: ReactNode }>;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(Gate, null, createElement(Consumer))));
    assert.equal(mounts, 0);
    assert.match(dom.window.document.body.textContent!, /Preparando/);
    await act(async () => stalled());
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    assert.equal(mounts, 0);
    await act(async () => dom.window.document.querySelector('button')!.click());
    assert.match(script!.src, /attempt=1/);
    await act(async () => script!.onError());
    assert.equal(mounts, 0);
    await act(async () => dom.window.document.querySelector('button')!.click());
    assert.match(script!.src, /attempt=2/);
    await act(async () => {
      (dom.window as unknown as { smoothiesPublicKey: string }).smoothiesPublicKey = 'real-local-anon-key';
      dom.window.dispatchEvent(new dom.window.Event('smoothies-runtime-ready'));
    });
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0);
    await act(async () => script!.onError());
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0);
    assert.equal(dom.window.document.querySelector('input')!.value, 'keep this draft');
    assert.equal(dom.window.location.pathname, '/login');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
