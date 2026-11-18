import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { JSDOM } from 'jsdom';
import * as ts from 'typescript';
import * as resource from '../lib/use-resource';

type Recipe = { id: string; name: string; product_id: string | null; trial_count: number };
type Product = { id: string; name: string; is_active: boolean };
type Trial = { id: string; number: number; ingredients: string; method: string; changes: string; created_at: string };
const recipeId = '90000000-0000-4000-8000-000000000401';
const productId = '90000000-0000-4000-8000-000000000501';
const trial: Trial = { id: '90000000-0000-4000-8000-000000000601', number: 1,
  ingredients: 'Para 1 vaso: 150 g de mango', method: 'Licuar.', changes: 'Menos hielo.', created_at: '2026-11-17T12:00:00Z' };

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

async function withRecipe(options: { product?: Product; publishProduct?: Product; failProductRead?: boolean }, check: (view: {
  document: Document; click: (text: string) => Promise<void>; fill: (selector: string, value: string) => Promise<void>;
  submit: () => Promise<void>; calls: { name: string; args?: Record<string, unknown> }[];
}) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://127.0.0.1:3181/admin/recetario?receta=${recipeId}` });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, location: dom.window.location,
    confirm: () => true, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const recipe: Recipe = { id: recipeId, name: 'Mango con coco', product_id: options.product?.id ?? null, trial_count: 1 };
  let products = options.product ? [options.product] : [];
  let failed = false;
  const client = {
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      let data: unknown;
      if (name === 'pos_smoothies_recipes') data = [recipe, { ...recipe, id: 'other-recipe', name: 'Otra receta', product_id: null }];
      else if (name === 'pos_smoothies_recipe_trials') data = [trial];
      else if (name === 'pos_save_smoothies_recipe_trial') data = { ...trial, id: args!.p_trial, number: 2 };
      else if (name === 'pos_publish_smoothies_recipe') {
        assert.equal(args!.p_recipe, recipeId);
        assert.equal(args!.p_trial, trial.id);
        products = [options.publishProduct ?? { id: productId, name: 'Mango del menú', is_active: false }];
        data = productId;
      } else throw Error(`Unexpected mutation ${name}`);
      return { abortSignal: () => Promise.resolve({ data, error: null }) };
    },
    from(name: string) {
      assert.equal(name, 'products');
      let single = false;
      const query = {
        select(fields: string) { assert.equal(fields, 'id,name,is_active'); return query; },
        in(_field: string, ids: string[]) { assert.deepEqual(ids, [productId]); return query; },
        eq(_field: string, id: string) { assert.equal(id, productId); return query; },
        single() { single = true; return query; },
        abortSignal() {
          return Object.assign(Promise.resolve({ data: products, error: null }), {
            single: () => {
              single = true;
              if (options.failProductRead && !failed) { failed = true; return Promise.resolve({ data: null, error: { message: 'Sin respuesta' } }); }
              return Promise.resolve({ data: single ? products[0] : products, error: null });
            },
          });
        },
      };
      return query;
    },
  };
  const Component = compile('../app/admin/recetario/RecipeBook.tsx', {
    'next/link': { __esModule: true, default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement('a', { ...props, href }, children) },
    '@/lib/catalog-management': { announceCatalogChange() {} },
    '@/lib/pos-types': { errorMessage: (error: Error) => error.message },
    '@/lib/menu-cards': { normalizeMenuText: (text: string) => text.toLowerCase() },
    '@/lib/supabase': { supabase: client }, '@/lib/use-resource': resource,
  }).default as ComponentType<{ initialRecipe: string }>;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(Component, { initialRecipe: recipeId })));
    await check({ document: dom.window.document, calls,
      click: async text => { const button = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent?.trim() === text); assert.ok(button, text); await act(async () => button.click()); },
      fill: async (selector, value) => { const input = dom.window.document.querySelector<HTMLInputElement>(selector); assert.ok(input, selector);
        const prototype = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); },
      submit: async () => { const form = dom.window.document.querySelector('form'); assert.ok(form); await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); },
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('recipe deep link selects the right private recipe and exact inactive product', async () => {
  await withRecipe({ product: { id: productId, name: 'Mango del menú', is_active: false } }, async ({ document, calls }) => {
    assert.equal(document.querySelector('.recipe-book-detail h2')?.textContent, 'Mango con coco');
    assert.equal(document.querySelector('.recipe-stage')?.textContent, 'Fuera de venta');
    assert.equal(document.querySelector('.recipe-next-step a')?.getAttribute('href'), `/admin/productos?producto=${productId}`);
    assert.equal(document.querySelector('.recipe-steps [aria-current] strong')?.textContent, 'Prepara el menú');
    assert.deepEqual(calls.map(call => call.name), ['pos_smoothies_recipes', 'pos_smoothies_recipe_trials']);
  });
});

test('another private trial retains the linked active product and leaves selling unchanged', async () => {
  await withRecipe({ product: { id: productId, name: 'Mango del menú', is_active: true } }, async ({ document, click, submit, calls }) => {
    await click('Hacer otra prueba');
    await submit();
    assert.equal(document.querySelector('.recipe-stage')?.textContent, 'Disponible en caja');
    assert.match(document.querySelector('.recipe-next-step')!.textContent!, /Las nuevas pruebas no cambian el producto/);
    assert.equal(calls.filter(call => call.name === 'pos_save_smoothies_recipe_trial').length, 1);
    assert.equal(calls.filter(call => call.name === 'pos_publish_smoothies_recipe').length, 0);
  });
});

for (const activeReplay of [false, true]) test(`recipe handoff reads actual product state after ${activeReplay ? 'an active replay' : 'creating a draft'}`, async () => {
  await withRecipe({ publishProduct: { id: productId, name: 'Mango del menú', is_active: activeReplay }, failProductRead: activeReplay }, async ({ document, click, fill, submit, calls }) => {
    await click('Llevar al menú');
    await fill('.recipe-publication input:not([inputmode])', 'Mango del menú');
    await fill('.recipe-publication input[inputmode="decimal"]', '90');
    await submit();
    if (activeReplay) { assert.match(document.querySelector('[role="alert"]')!.textContent!, /Sin respuesta/); await submit(); }
    assert.equal(document.querySelector('.recipe-stage')?.textContent, activeReplay ? 'Disponible en caja' : 'Fuera de venta');
    assert.equal(document.querySelector('.recipe-next-step a')?.getAttribute('href'), `/admin/productos?producto=${productId}`);
    const published = calls.filter(call => call.name === 'pos_publish_smoothies_recipe');
    assert.equal(published.length, activeReplay ? 2 : 1);
    if (activeReplay) assert.deepEqual(published[0], published[1], 'Retry must preserve the same recipe and trial.');
  });
});

for (const recipeLookupFails of [false, true]) test(`catalog finds the exact inactive product and requires activation${recipeLookupFails ? ' when private recipe links fail' : ''}`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://127.0.0.1:3181/admin/productos?producto=${productId}` });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const product = { id: productId, name: 'Mango del menú', price: 90, category: 'Smoothies', is_active: false, catalog_revision: 7 };
  const writes: unknown[] = [];
  const query = (data: unknown, error: unknown = null) => {
    const result = Object.assign(Promise.resolve({ data, error }), { select: () => result, order: () => result, abortSignal: () => result });
    return result;
  };
  const Component = compile('../app/admin/productos/page.tsx', {
    '@/lib/pos-profile': { posProfile: { id: 'smoothies' } },
    'next/navigation': { useSearchParams: () => new URLSearchParams(dom.window.location.search) },
    'next/link': { __esModule: true, default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement('a', { ...props, href }, children) },
    './smoothies-catalog.css': {},
    '@/components/ProductPhoto': { __esModule: true, default: () => null },
    './CatalogEditor': { __esModule: true, default: () => null },
    './SmoothiesImport': { __esModule: true, default: () => null },
    './WeeklySpecial': { __esModule: true, default: () => null },
    './OpeningCount': { __esModule: true, default: () => null },
    '@/app/LoadFailure': { __esModule: true, default: () => createElement('p', null, 'Load failed') },
    '@/lib/use-resource': resource,
    '@/lib/pos-types': { errorMessage: (error: Error) => error.message },
    '@/lib/catalog-management': { announceCatalogChange() {}, readCatalogRequest: () => null,
      saveCatalogChange: async (_client: unknown, _storage: unknown, actor: string, change: unknown) => {
        assert.equal(actor, 'demo-owner'); writes.push(change); product.is_active = true;
      } },
    '@/lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'demo-owner' } }, error: null }) },
      from: (table: string) => query(table === 'products' ? [structuredClone(product)] : []),
      rpc: (name: string) => { assert.equal(name, 'pos_smoothies_recipes'); return query([{ id: recipeId, name: 'Mango con coco', product_id: productId }], recipeLookupFails ? { message: 'Sin respuesta' } : null); },
    } },
  }).default as ComponentType;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(Component)));
    const focus = dom.window.document.querySelector('.smoothies-product-focus')!;
    assert.ok(focus, 'A recipe draft must be visible even while the catalog filter defaults to active.');
    assert.match(focus.textContent!, /Mango del menú[\s\S]*90\.00/);
    assert.equal(writes.length, 0, 'Opening the product must never activate it.');
    if (recipeLookupFails) assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /enlaces a tus recetas/);
    else assert.equal(focus.querySelector('a')?.getAttribute('href'), `/admin/recetario?receta=${recipeId}`);
    const activate = [...focus.querySelectorAll('button')].find(button => button.textContent === 'Poner en venta')!;
    await act(async () => activate.click());
    assert.deepEqual(writes, [{ kind: 'product', action: 'reactivate', id: productId, revision: 7 }]);
    assert.equal(focus.querySelector('.smoothies-product-state')?.textContent, 'En venta');
    assert.equal(focus.querySelector('a')?.getAttribute('href'), '/');
    assert.equal(product.price, 90);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
