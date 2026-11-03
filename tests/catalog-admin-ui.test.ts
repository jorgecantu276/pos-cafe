import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import * as ts from 'typescript';
import * as management from '../lib/catalog-management';
import * as resource from '../lib/use-resource';
import * as types from '../lib/pos-types';
import CatalogEditor from '../app/admin/productos/CatalogEditor';

test('actual catalog blocks double submit, restores uncertain save after reload and exposes failed extra deactivation', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' }), saved = new Map<string, PropertyDescriptor | undefined>();
  Object.defineProperty(dom.window.navigator, 'locks', { value: { request: async (_key: string, _options: unknown, action: (lock: object) => unknown) => action({}) } });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const id = '00000000-0000-4000-8000-000000000001';
  const inactiveProduct='00000000-0000-4000-8000-000000000002',inactiveExtra='00000000-0000-4000-8000-000000000003';
  const fixtures: Record<string, unknown[]> = { products: [
    { id, name: 'Café', price: 55, category: 'Bebidas', customizable: false, wizard_steps: [], image_url: '', is_active: true },
    { id: 'dessert', name: 'Pastel de nuez', price: 80, category: 'Postres', customizable: false, wizard_steps: [], image_url: '', is_active: true },
    { id: inactiveProduct, name: 'Café retirado', price: 40, category: 'Bebidas', is_active: false,catalog_revision:4 },
  ], extras: [{ id, name: 'Almendra', price: 10, phase: 'Leche', active: true },{id:inactiveExtra,name:'Coco retirado',price:15,phase:'Tipo de Leche',active:false,catalog_revision:2}] };
  type Args = { p_request: string; p_payload: management.CatalogChange };
  const calls: Args[] = []; let release!: (value: unknown) => void;
  const firstResponse = new Promise(resolve => { release = resolve; });
  const replays=new Map<string,unknown>();let loseReactivation=true;
  const photoUrl = 'https://storage.example.test/catalog-photos/photo.png';
  let uploaded: File | undefined;
  const client = { storage: { from: (bucket: string) => {
    assert.equal(bucket, 'catalog-photos');
    return {
      upload: async (path: string, file: File) => {
        assert.match(path, /^[0-9a-f-]+\.png$/);
        uploaded = file;
        return { error: null };
      },
      getPublicUrl: () => ({ data: { publicUrl: photoUrl } }),
    };
  } }, auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    from: (table: string) => { const query = Object.assign(Promise.resolve({ data: structuredClone(fixtures[table]), error: null }), { select: () => query, order: () => query, abortSignal: () => query }); return query; },
    rpc: (name: string, args: Args) => {
      assert.equal(name, 'pos_save_catalog'); calls.push(args);
      if(args.p_payload.action==='reactivate'){
        if(!replays.has(args.p_request)){
          const item=fixtures[args.p_payload.kind==='product'?'products':'extras'].find(item=>(item as {id:string}).id===args.p_payload.id) as Record<string,unknown>;assert.ok(item);item[args.p_payload.kind==='product'?'is_active':'active']=true;item.catalog_revision=Number(item.catalog_revision)+1;
          replays.set(args.p_request,{error:null,data:{request_id:args.p_request,kind:args.p_payload.kind,action:'reactivate',id:item.id,revision:item.catalog_revision}});
          if(loseReactivation){loseReactivation=false;const result=Promise.resolve({error:{code:'',message:'Respuesta de reactivación perdida'},data:null});return Object.assign(result,{abortSignal:()=>result});}
        }
        const result=Promise.resolve(replays.get(args.p_request));return Object.assign(result,{abortSignal:()=>result});
      }
      const response = calls.length === 1 ? firstResponse : Promise.resolve(args.p_payload.action === 'deactivate' ? { error: { code: 'P0001', message: 'No se pudo desactivar' } } : { error: null, data: { request_id: args.p_request, kind: args.p_payload.kind, action: args.p_payload.action, id } });
      return Object.assign(response, { abortSignal: () => response });
    } };
  const imports: Record<string, unknown> = { '@/components/ProductPhoto': { default: () => null, __esModule: true }, '@/lib/catalog-management': management, '@/lib/pos-types': types, '@/lib/use-resource': resource,
    '@/lib/supabase': { supabase: client }, './CatalogEditor': { default: CatalogEditor, __esModule: true }, '@/app/LoadFailure': { default: () => null, __esModule: true } };
  const compiled = ts.transpileModule(readFileSync(new URL('../app/admin/productos/page.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { default?: ComponentType } = {}, require = createRequire(import.meta.url);
  new Function('require', 'exports', compiled)((name: string) => imports[name] ?? require(name), exports);
  let root = createRoot(dom.window.document.getElementById('root')!);
  const button = (label: string) => { const node = [...dom.window.document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label); assert.ok(node, label); return node; };
  const click = async (label: string) => { await act(async () => { button(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  try {
    await act(async () => root.render(createElement(exports.default!)));
    const search = dom.window.document.querySelector('input[type="search"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(search, 'cafe'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    assert.equal(dom.window.document.querySelectorAll('.catalog-row').length, 1, 'Search ignores accents and inactive records');
    const category = dom.window.document.querySelector('select')!;
    await act(async () => { category.value = 'Postres'; category.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.match(dom.window.document.body.textContent!, /No hay resultados/);
    await act(async () => { setValue.call(search, ''); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    assert.ok(button('Editar Pastel de nuez')); assert.equal(dom.window.document.querySelectorAll('.catalog-row').length, 1);
    await act(async () => { category.value = ''; category.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.equal(calls.length, 0, 'Finding products performs no catalog writes');
    await click('Editar Café');
    const fileInput = dom.window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const photo = new dom.window.File(['test'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [photo] });
    await act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.equal(uploaded, photo);
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[name="image_url"]')?.value, photoUrl);
    const fields = [...dom.window.document.querySelectorAll('dialog input:not([type="checkbox"]),dialog select')];
    assert.ok(fields.every(e => (e as HTMLInputElement).labels?.length), 'Every catalog field has a persistent label');
    await act(async () => { const form = dom.window.document.querySelector('form')!; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.match(JSON.stringify(calls[0].p_payload), /storage\.example\.test\/catalog-photos\/photo\.png/);
    assert.equal(calls.length, 1); assert.ok(dom.window.document.querySelector('fieldset')!.disabled);
    await act(async () => release({ error: { code: '', message: 'Respuesta perdida' } }));
    assert.match(dom.window.document.body.textContent!, /Respuesta perdida/); assert.ok(management.readCatalogRequest(dom.window.localStorage, 'owner'));
    await act(async () => root.unmount()); root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => root.render(createElement(exports.default!)));
    assert.ok(button('Editar Café').matches(':disabled'));
    await click('Comprobar guardado');
    assert.deepEqual(calls[0], calls[1]); assert.equal(management.readCatalogRequest(dom.window.localStorage, 'owner'), null);
    assert.match(dom.window.document.body.textContent!, /Cambios guardados/);
    await click('Extras'); await click('Desactivar Almendra');
    assert.match(dom.window.document.body.textContent!, /No se pudo desactivar/);
    assert.ok(button('Editar Almendra')); assert.equal(management.readCatalogRequest(dom.window.localStorage, 'owner'), null);
    assert.equal(calls[2].p_payload.action, 'deactivate');
    await click('Productos');await click('Inactivos');await click('Reactivar Café retirado');
    assert.match(dom.window.document.body.textContent!,/reactivación perdida/);assert.ok(management.readCatalogRequest(dom.window.localStorage,'owner'));
    await click('Comprobar guardado');assert.deepEqual(calls[3],calls[4]);assert.deepEqual(calls[3].p_payload,{kind:'product',action:'reactivate',id:inactiveProduct,revision:4,actor_id:'owner'});
    await click('Activos');assert.ok(button('Editar Café retirado'));assert.equal((fixtures.products.find(p=>(p as {id:string}).id===inactiveProduct) as {price:number}).price,40);
    await click('Extras');await click('Inactivos');await click('Reactivar Coco retirado');await click('Activos');assert.ok(button('Editar Coco retirado'));
    assert.deepEqual(calls[5].p_payload,{kind:'extra',action:'reactivate',id:inactiveExtra,revision:2,actor_id:'owner'});assert.equal((fixtures.extras.find(p=>(p as {id:string}).id===inactiveExtra) as {price:number}).price,15);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
