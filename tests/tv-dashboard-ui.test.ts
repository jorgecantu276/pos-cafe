import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as dashboard from '../lib/tv-dashboard';
import * as loginReturn from '../lib/login-return';

test('actual TV UI automatically refreshes, survives a network failure, recovers and hides data on lost access', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const now = new Date('2026-10-27T22:00:00Z');
  const rows: dashboard.TvOrder[] = Array.from({ length: 24 }, (_, i) => ({
    id: `fixture-${i}`, ticket_number: 1040 + i, created_at: new Date(+now - i * 1_200_000).toISOString(),
    total: [85, 145, 65, 210, 120, 55][i % 6], status: i === 1 ? 'pending' : i === 3 ? 'cancelled' : 'completed',
    payment_method: i % 3 === 0 ? 'efectivo' : 'tarjeta',
  }));
  let mode: 'ok' | 'offline' | 'denied' | 'hanging' = 'ok', calls = 0, amount = 0;
  const snapshot = () => dashboard.summarizeTvOrders(rows.map((o, i) => i ? o : { ...o, total: o.total + amount }), new Date());
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/tv'); assert.equal(options.cache, 'no-store'); calls++;
      if (mode === 'offline') throw new Error('Synthetic offline');
      if (mode === 'hanging') return new Promise((_, reject) => options.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      return { ok: mode === 'ok', status: mode === 'denied' ? 403 : 200, json: async () => snapshot() };
    } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: +now });
  const nodeRequire = createRequire(import.meta.url);
  const compile = (path: string, imports: Record<string, unknown>) => {
    const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const exports: { default?: ComponentType } = {};
    new Function('require', 'exports', compiled)((name: string) => imports[name] ?? (name.endsWith('.css') ? {} : nodeRequire(name)), exports);
    return exports.default!;
  };
  const View = compile('../app/tv/TvDashboardView.tsx', { '@/lib/tv-dashboard': dashboard, '@/lib/login-return': loginReturn });
  const Screen = compile('../app/tv/TvDashboard.tsx', { '@/lib/tv-dashboard': dashboard, './TvDashboardView': { __esModule: true, default: View } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const text = () => dom.window.document.body.textContent!;
  try {
    await act(async () => root.render(createElement(Screen)));
    assert.equal(calls, 1); assert.match(text(), /Actualizado/); assert.match(text(), /#1040/);
    assert.match(text(), /Revisar pago/); assert.match(text(), /Cancelada/);
    if (process.env.TV_UI_PREVIEW) {
      const css = readFileSync(new URL('../app/tv/tv.css', import.meta.url), 'utf8');
      writeFileSync(process.env.TV_UI_PREVIEW, `<!doctype html><html lang="es-MX"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TV · Datos sintéticos</title><style>*{box-sizing:border-box;margin:0}body{margin:0}button,a{font:inherit;color:inherit}button{border:0;background:none}a{color:inherit}${css}</style>${dom.window.document.getElementById('root')!.innerHTML}</html>`);
    }
    mode = 'offline';
    await act(async () => t.mock.timers.tick(5_000));
    assert.equal(calls, 2); assert.match(text(), /Datos sin actualizar/); assert.match(text(), /#1040/);
    mode = 'ok'; amount = 100;
    await act(async () => t.mock.timers.tick(5_000));
    assert.equal(calls, 3); assert.match(text(), /Actualizado/); assert.match(text(), /\$185\.00/);
    mode = 'hanging';
    await act(async () => t.mock.timers.tick(5_000));
    const before = calls;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('online')));
    assert.equal(calls, before, 'in-flight requests do not overlap');
    await act(async () => t.mock.timers.tick(12_000));
    assert.match(text(), /Datos sin actualizar/);
    mode = 'ok';
    await act(async () => t.mock.timers.tick(5_000));
    assert.match(text(), /Actualizado/);
    mode = 'denied';
    await act(async () => t.mock.timers.tick(5_000));
    assert.match(text(), /Acceso requerido/); assert.doesNotMatch(text(), /#1040/);
    assert.equal(dom.window.document.querySelector('a[href^="/login"]')?.getAttribute('href'), loginReturn.TV_LOGIN_URL);
    const deniedCalls = calls;
    await act(async () => t.mock.timers.tick(60_000));
    assert.equal(calls, deniedCalls, 'stop polling after access is denied');
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset(); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
