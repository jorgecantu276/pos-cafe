import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import * as ts from 'typescript';
import * as recovery from '../lib/recipe-trial';
import * as resource from '../lib/use-resource';
import * as deadline from '../lib/request-deadline';
import * as types from '../lib/pos-types';
import * as menu from '../lib/menu-cards';

test('recipe UI exposes lost-response recovery after reload and isolates another account including late replies', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://pos.test' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true, navigator: { userAgent: dom.window.navigator.userAgent, locks: { request: async (_key: string, _options: unknown, action: (lock: object) => unknown) => action({}) } } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const calls: Record<string, unknown>[] = [];
  const pending: recovery.RecipeTrialRequest = { actor: 'a', recipeId: '00000000-0000-4000-8000-000000000001', trialId: '00000000-0000-4000-8000-000000000002', values: { name: 'Mango privado', ingredients: '150 g mango', method: '', changes: '' } };
  // Represents a committed save whose reply was lost before the previous page closed.
  const trial = { id: pending.trialId, recipe_id: pending.recipeId, number: 1, ingredients: pending.values.ingredients, method: '', changes: '', created_at: '2026-11-25T12:00:00Z' };
  dom.window.localStorage.setItem(recovery.recipeTrialKey('a'), JSON.stringify(pending));
  let actor = 'a', changed: (_event: string, session: { user: { id: string } } | null) => void = () => {};
  let finish: ((value: unknown) => void) | undefined;
  const client = { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }), onAuthStateChange: (callback: typeof changed) => { changed = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
    rpc: (name: string, args: Record<string, unknown>) => {
      const result = name === 'pos_save_smoothies_recipe_trial' ? (calls.push(args), new Promise(resolve => { finish = resolve; })) : Promise.resolve({ data: [], error: null });
      return Object.assign(result, { abortSignal: () => result });
    } };
  const require = createRequire(import.meta.url), exports: { default?: ComponentType } = {};
  const imports: Record<string, unknown> = { 'next/link': { default: ({ children }: { children: unknown }) => children, __esModule: true }, '@/lib/supabase': { supabase: client }, '@/lib/use-resource': resource,
    '@/lib/recipe-trial': recovery, '@/lib/request-deadline': deadline, '@/lib/pos-types': types, '@/lib/menu-cards': menu, '@/lib/catalog-management': { announceCatalogChange() {} } };
  const compiled = ts.transpileModule(readFileSync(new URL('../app/admin/recetario/RecipeBook.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', compiled)((name: string) => imports[name] ?? require(name), exports);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')].find(row => row.textContent?.includes(text))!;
  const click = async (element: Element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  try {
    await act(async () => root.render(createElement(exports.default!)));
    assert.equal(button('Nueva receta').disabled, true);
    assert.ok(button('Revisar prueba pendiente'));
    actor = 'b'; await act(async () => changed('SIGNED_IN', { user: { id: actor } }));
    assert.equal(button('Revisar prueba pendiente'), undefined);
    assert.equal(button('Nueva receta').disabled, false);
    assert.ok(dom.window.localStorage.getItem(recovery.recipeTrialKey('a')));
    actor = 'a'; await act(async () => changed('SIGNED_IN', { user: { id: actor } }));
    await click(button('Revisar prueba pendiente'));
    assert.equal(calls.length, 1);
    await act(async () => changed('SIGNED_OUT', null));
    assert.ok(dom.window.document.body.textContent?.includes('Inicia sesión para abrir el recetario.'));
    assert.equal(button('Nueva receta'), undefined);
    assert.deepEqual(calls[0], { p_recipe: pending.recipeId, p_trial: pending.trialId, p_name: pending.values.name, p_ingredients: pending.values.ingredients, p_method: '', p_changes: '' });
    actor = 'b'; await act(async () => changed('SIGNED_IN', { user: { id: actor } }));
    await act(async () => finish!({ data: trial, error: null }));
    assert.equal(dom.window.localStorage.getItem(recovery.recipeTrialKey('a')), null);
    assert.ok(!dom.window.document.body.textContent?.includes('Mango privado'));
    assert.equal(button('Nueva receta').disabled, false);
    assert.equal(calls.length, 1);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
