import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, useEffect, type ComponentType } from 'react';
import * as ts from 'typescript';
import * as inventory from '../lib/inventory';
import * as resource from '../lib/use-resource';
import * as deadline from '../lib/request-deadline';
import * as types from '../lib/pos-types';
import * as settings from '../app/admin/Settings';

const actor = 'admin', product = '00000000-0000-4000-8000-000000000001';
type WorkspaceProps = { items: inventory.InventoryItem[]; disabled: boolean;
  onSave(changes: inventory.InventoryChange[]): Promise<boolean> };

async function harness(code: string) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    navigator: { userAgent: dom.window.navigator.userAgent,
      locks: { request: async (_key: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  let props!: WorkspaceProps, mounts = 0, catalogReads = 0, revision = 2;
  const client = { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: (name: string) => {
      let data: unknown = [], error: { code: string; message: string } | null = null;
      if (name === 'pos_inventory_catalog') {
        catalogReads++;
        data = [{ product_id: product, revision, name: 'Synthetic item', quantity: 10, mode: 'counted' }];
      } else if (name === 'pos_inventory_state') data = { enabled: false, revision: 0 };
      else if (name === 'pos_inventory_write') {
        error = { code, message: 'Las existencias cambiaron. Actualiza y revisa el conteo.' };
        revision = 3;
      }
      const result = Promise.resolve({ data, error });
      return Object.assign(result, { abortSignal: () => result });
    } };
  const mocks: Record<string, unknown> = { 'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/supabase': { supabase: client }, '@/lib/use-resource': resource, '@/lib/request-deadline': deadline,
    '@/lib/pos-types': types, '@/lib/inventory': inventory, '@/lib/catalog-management': { announceCatalogChange() {} },
    '../Settings': settings, '@/app/LoadFailure': { default: () => null, __esModule: true }, './inventory.css': {},
    './InventoryWorkspace': { InventoryWorkspace: (value: WorkspaceProps) => {
      props = value; useEffect(() => { mounts++; }, []); return createElement('div');
    } } };
  const require = createRequire(import.meta.url), exports: { default?: ComponentType } = {};
  const source = readFileSync(new URL('../app/admin/inventario/page.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', compiled)((name: string) => mocks[name] ?? require(name), exports);
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(createElement(exports.default!)));
  return { dom, props: () => props, mounts: () => mounts, reads: () => catalogReads,
    async clean() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    } };
}

test('confirmed stale inventory reloads current stock and remounts the entry workspace', async () => {
  const h = await harness('PIV01');
  try {
    assert.equal(h.mounts(), 1); assert.equal(h.reads(), 1);
    await act(async () => {
      assert.equal(await h.props().onSave([{ product_id: product, revision: 2, action: 'count', quantity: 8 }]), false);
    });
    assert.equal(inventory.readInventoryRequest(h.dom.window.localStorage, actor), null);
    assert.equal(h.reads(), 2); assert.equal(h.mounts(), 2);
    assert.equal(h.props().items[0].revision, 3); assert.equal(h.props().disabled, false);
    assert.match(h.dom.window.document.body.textContent!, /Las existencias cambiaron/);
  } finally { await h.clean(); }
});

test('unknown inventory outcome keeps recovery identity and does not reset the entry workspace', async () => {
  const h = await harness('40001');
  try {
    await act(async () => {
      await h.props().onSave([{ product_id: product, revision: 2, action: 'count', quantity: 8 }]);
    });
    const pending = inventory.readInventoryRequest(h.dom.window.localStorage, actor);
    assert.ok(pending); assert.deepEqual(pending.args, { p_changes: [{ product_id: product, revision: 2, action: 'count', quantity: 8 }] });
    assert.equal(h.reads(), 1); assert.equal(h.mounts(), 1); assert.equal(h.props().disabled, true);
    assert.match(h.dom.window.document.body.textContent!, /Revisar cambio pendiente/);
  } finally { await h.clean(); }
});
