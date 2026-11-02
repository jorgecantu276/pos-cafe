import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as inventory from '../lib/inventory';

test('inventory workspace keeps unknown counts distinct, saves zero intentionally, toggles drinks and shows audit history', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key,value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const require = createRequire(import.meta.url);
  const code = ts.transpileModule(readFileSync(new URL('../app/admin/inventario/InventoryWorkspace.tsx',import.meta.url),'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { InventoryWorkspace?: ComponentType<Record<string,unknown>> } = {};
  const mocks: Record<string,unknown> = { '@/lib/inventory':inventory, '@/lib/supabase':{}, '@/lib/use-resource':{},
    '@/lib/request-deadline':{}, '@/lib/pos-types':{}, '@/app/LoadFailure':{}, './inventory.css':{} };
  new Function('require','exports',code)((name:string)=>mocks[name]??require(name),exports);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const items: inventory.InventoryItem[] = [{ product_id:'brownie',code:'CM-000001',name:'Brownie tradicional',category:'Postres',is_active:true,
    mode:'counted',quantity:null,unit:'pieza',minimum:3,available:true,revision:4,last_counted_at:null },
    { product_id:'coffee',code:'CM-000002',name:'Iced coffee',category:'Bebidas',is_active:true,mode:'availability',quantity:null,unit:'pieza',minimum:null,available:true,revision:0,last_counted_at:null }];
  const writes: inventory.InventoryChange[][]=[];
  const props={items,history:[{id:1,product_id:'brownie',product_name:'Brownie tradicional',unit:'pieza',actor_name:'Sandra',kind:'count',before_quantity:null,after_quantity:8,reason:'Conteo físico',created_at:'2026-10-30T16:00:00Z',ticket_number:null}],
    disabled:false,onSave:async(changes:inventory.InventoryChange[])=>{writes.push(changes);return true;},onRefresh:()=>{},before:null,onHistoryPage:()=>{}};
  const click=async(text:string)=>{const button=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);assert.ok(button,`Missing ${text}`);assert.equal(button.disabled,false);await act(async()=>{button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
  try {
    await act(async()=>{root.render(createElement(exports.InventoryWorkspace!,props));});
    assert.match(dom.window.document.body.textContent!,/Sin contar/);
    await click('Brownie tradicionalCM-000001 · pieza—Sin contar');
    const actions=[...dom.window.document.querySelectorAll('.inventory-actions button')];assert.equal((actions[0] as HTMLButtonElement).disabled,true);
    await click('Contar stock');
    // React's numeric input onChange normalizes both native input/change events.
    const input=dom.window.document.querySelector<HTMLInputElement>('.inventory-detail input[type=number]')!;
    const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
    await act(async()=>{setter.call(input,'0');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    await act(async()=>{dom.window.document.querySelector('.inventory-detail form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    assert.deepEqual(writes[0],[{product_id:'brownie',revision:4,action:'count',quantity:0,reason:undefined}]);
    await click('Iced coffeeCM-000002 · Disponibilidad—Disponible');await click('Marcar agotado');
    assert.deepEqual(writes.at(-1),[{product_id:'coffee',revision:0,action:'availability',available:false}]);
    await click('Movimientos');assert.equal(dom.window.document.getElementById('inventory-history')!.hidden,false);assert.match(dom.window.document.getElementById('inventory-history')!.textContent!,/Sandra/);
    await act(async()=>{root.render(createElement(exports.InventoryWorkspace!,{...props,disabled:true}));});
    assert.equal([...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Marcar agotado')!.disabled,true);
  } finally { await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);} }
});
