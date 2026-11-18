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
  const rows: dashboard.TvOrder[] = Array.from({length:4},(_,i)=>({id:'fixture-'+i,ticket_number:1234+i,created_at:new Date(+now-[840000,540000,300000,60000][i]).toISOString(),status:'completed',receipt_snapshot:{pager_number:[12,8,21,4][i],order_type:i%2?'takeaway':'dine_in',order_note:i===2?'Entregar juntos':'',items:[{quantity:1,product:{name:'Iced coffee',category:'Bebidas'}},{quantity:i===0?2:1,product:{name:['Brownie con nieve','Cheesecake original','Cheese danish fresa','Brownie cheesecake'][i],category:'Postres',note:i===0?'Sin nuez':'',displayExtras:i===0?[{name:'Helado de vainilla'}]:[]}},...(i===1?[{quantity:2,product:{name:'Galleta de chocolate',category:'Postres'}}]:[])]}}));
  let mode: 'ok' | 'offline' | 'denied' | 'hanging' = 'ok', calls = 0;
  const snapshot = () => dashboard.summarizeTvOrders(rows, new Date());
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
  const scrolls: number[] = [];
  Object.defineProperty(dom.window.document.documentElement, 'scrollHeight', { configurable: true, value: 1526 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 768 });
  dom.window.scrollTo = (options: ScrollToOptions | number = {}) => { scrolls.push(typeof options === 'number' ? options : options.top ?? 0); };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const text = () => dom.window.document.body.textContent!;
  try {
    await act(async () => root.render(createElement(Screen)));
    assert.equal(calls, 1); assert.match(text(), /Actualizado/); assert.match(text(), /#1234/);
    assert.doesNotMatch(text(), /Iced coffee/); assert.match(text(), /Brownie con nieve/);
    if (process.env.TV_UI_PREVIEW) {
      const css = readFileSync(new URL('../app/tv/tv.css', import.meta.url), 'utf8');
      writeFileSync(process.env.TV_UI_PREVIEW, `<!doctype html><html lang="es-MX"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TV · Datos sintéticos</title><style>*{box-sizing:border-box;margin:0}body{margin:0}button,a{font:inherit;color:inherit}button{border:0;background:none}a{color:inherit}${css}</style>${dom.window.document.getElementById('root')!.innerHTML}</html>`);
    }
    mode = 'offline';
    await act(async () => t.mock.timers.tick(5_000));
    assert.equal(calls, 2); assert.match(text(), /Datos sin actualizar/); assert.match(text(), /#1234/);
    mode = 'ok';
    await act(async () => t.mock.timers.tick(5_000));
    assert.equal(calls, 3); assert.match(text(), /Actualizado/); assert.match(text(), /Cheesecake original/);
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
    mode = 'offline';
    await act(async () => t.mock.timers.tick(60_000));
    assert.doesNotMatch(text(), /#1234/, 'expired order disappears without refresh or successful fetch');
    mode = 'denied';
    await act(async () => t.mock.timers.tick(5_000));
    assert.match(text(), /Acceso requerido/); assert.doesNotMatch(text(), /#1234/);
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
