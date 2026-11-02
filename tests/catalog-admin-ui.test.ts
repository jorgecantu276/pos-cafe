import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as management from '../lib/catalog-management';
import * as resource from '../lib/use-resource';
import * as types from '../lib/pos-types';

test('actual catalog blocks double submit, restores uncertain save after reload and exposes failed extra deactivation', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' }), saved = new Map<string, PropertyDescriptor | undefined>();
  Object.defineProperty(dom.window.navigator, 'locks', { value: { request: async (_key: string, _options: unknown, action: (lock: object) => unknown) => action({}) } });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const id = '00000000-0000-4000-8000-000000000001';
  const fixtures: Record<string, unknown[]> = { products: [{ id, name: 'Café', price: 55, category: 'Bebidas', customizable: false, wizard_steps: [], image_url: '', is_active: true }], extras: [{ id, name: 'Almendra', price: 10, phase: 'Leche', active: true }] };
  type Args = { p_request: string; p_payload: management.CatalogChange };
  const calls: Args[] = []; let release!: (value: unknown) => void;
  const firstResponse = new Promise(resolve => { release = resolve; });
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    from: (table: string) => { const query = Object.assign(Promise.resolve({ data: fixtures[table], error: null }), { select: () => query, order: () => query, abortSignal: () => query }); return query; },
    rpc: (name: string, args: Args) => {
      assert.equal(name, 'pos_save_catalog'); calls.push(args);
      const response = calls.length === 1 ? firstResponse : Promise.resolve(args.p_payload.action === 'deactivate' ? { error: { code: 'P0001', message: 'No se pudo desactivar' } } : { error: null, data: { request_id: args.p_request, kind: args.p_payload.kind, action: args.p_payload.action, id } });
      return Object.assign(response, { abortSignal: () => response });
    } };
  const imports: Record<string, unknown> = { '@/components/ProductPhoto': { default: () => null, __esModule: true }, '@/lib/catalog-management': management, '@/lib/pos-types': types, '@/lib/use-resource': resource,
    '@/lib/supabase': { supabase: client }, '@/app/LoadFailure': { default: () => null, __esModule: true } };
  const compiled = ts.transpileModule(readFileSync(new URL('../app/admin/productos/page.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { default?: ComponentType } = {}, require = createRequire(import.meta.url);
  new Function('require', 'exports', compiled)((name: string) => imports[name] ?? require(name), exports);
  let root = createRoot(dom.window.document.getElementById('root')!);
  const button = (label: string) => { const node = [...dom.window.document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label); assert.ok(node, label); return node; };
  const click = async (label: string) => { await act(async () => { button(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  try {
    await act(async () => root.render(createElement(exports.default!)));
    await click('Editar Café');
    await act(async () => { const form = dom.window.document.querySelector('form')!; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(calls.length, 1); assert.ok(dom.window.document.querySelector('fieldset')!.disabled);
    await act(async () => release({ error: { code: '', message: 'Respuesta perdida' } }));
    assert.match(dom.window.document.body.textContent!, /Respuesta perdida/); assert.ok(management.readCatalogRequest(dom.window.localStorage, 'owner'));
    await act(async () => root.unmount()); root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => root.render(createElement(exports.default!)));
    assert.ok(button('Editar Café').matches(':disabled'));
    await click('Recuperar guardado pendiente');
    assert.deepEqual(calls[0], calls[1]); assert.equal(management.readCatalogRequest(dom.window.localStorage, 'owner'), null);
    assert.match(dom.window.document.body.textContent!, /Catálogo guardado/);
    await click('Extras'); await click('Desactivar Almendra');
    assert.match(dom.window.document.body.textContent!, /No se pudo desactivar/);
    assert.ok(button('Editar Almendra')); assert.equal(management.readCatalogRequest(dom.window.localStorage, 'owner'), null);
    assert.equal(calls[2].p_payload.action, 'deactivate');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
