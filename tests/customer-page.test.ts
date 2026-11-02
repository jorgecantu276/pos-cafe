import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as management from '../lib/customer-management';
import * as reports from '../lib/reports';
import * as types from '../lib/pos-types';
import * as deadline from '../lib/request-deadline';
import * as resource from '../lib/use-resource';

test('actual CRM retains a lost correction for recovery, blocks other edits and refreshes after confirmation',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'}),saved=new Map<string,PropertyDescriptor|undefined>();
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async(_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}});
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const calls:unknown[]=[],loads=new Set<unknown>();let lost=true;
  const client={auth:{getUser:async()=>({data:{user:{id:'manager'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    rpc:(name:string,args:{p_request:string;p_payload:{customer_id:string;name:string;phone:string}})=>{
      if (name === 'pos_customer_history') { const response = Promise.resolve({ error: null, data: { captured_at:'2026-11-02T12:00:00Z',as_of:'2026-11-02T12:00:00Z',page:0,page_size:50,summary:{rows:1,sales:55},orders:[{id:'sale',ticket_number:27,created_at:'2026-11-02T12:00:00Z',total:55,status:'completed',payment_method:'efectivo',order_items:[{quantity:1,total_price:55,notes:'Sin azúcar',product_snapshot:{name:'Café histórico'}}]}] } }); return Object.assign(response,{abortSignal:()=>response}); }
      assert.equal(name,'pos_edit_customer');calls.push(args);
      const response=Promise.resolve(lost?{data:null,error:{message:'Respuesta perdida',code:''}}:{error:null,data:{request_id:args.p_request,
        customer:{id:args.p_payload.customer_id,name:args.p_payload.name,phone:args.p_payload.phone,points:173,total_spent:345.25}}});
      return Object.assign(response,{abortSignal:()=>response});
    }};
  const report={captured_at:'2026-10-30T12:00:00Z',page:0,page_size:50,summary:{rows:1,sales:345.25},customers:[{id:'member',name:'Ana',phone:'8682345678',points:173,completed_spent:345.25}]};
  const imports:Record<string,unknown>={
    '@/lib/customer-management':management,'@/lib/reports':reports,'@/lib/pos-types':types,'@/lib/request-deadline':deadline,'@/lib/supabase':{supabase:client},
    '@/lib/use-resource':{useResource:(load:unknown)=>{loads.add(load);return{data:report,loading:false,error:null,reload:async()=>{}};}},
    '@/app/LoadFailure':{default:()=>null,__esModule:true},'../ReportControls':{ReportPagination:()=>null},
  };
  const source=readFileSync(new URL('../app/admin/clientes/page.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:{default?:ComponentType}={},require=createRequire(import.meta.url);
  const historyExports:{default?:ComponentType}={};
  const historyCompiled=ts.transpileModule(readFileSync(new URL('../app/admin/clientes/CustomerHistory.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',historyCompiled)((name:string)=>name==='@/lib/use-resource'?resource:imports[name]??require(name),historyExports);
  imports['./CustomerHistory']={...historyExports,__esModule:true};
  new Function('require','exports',compiled)((name:string)=>imports[name]??require(name),exports);
  const root=createRoot(dom.window.document.getElementById('root')!);
  const button=(label:string)=>{const node=[...dom.window.document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent?.trim())===label);assert.ok(node,`Missing ${label}`);return node;};
  const click=async(label:string)=>{const node=button(label);assert.equal(node.disabled,false);await act(async()=>{node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
  try{
    await act(async()=>root.render(createElement(exports.default!)));
    await click('Corregir datos de Ana');
    assert.equal((dom.window.document.querySelector('[aria-label="Nombre del cliente"]')as HTMLInputElement).value,'Ana');
    assert.equal((dom.window.document.querySelector('[aria-label="Teléfono del cliente"]')as HTMLInputElement).value,'8682345678');
    await act(async()=>{dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/Respuesta perdida/);
    assert.ok(dom.window.localStorage.getItem(management.customerEditKey('manager')));
    assert.equal(button('Corregir datos de Ana').disabled,true);
    assert.equal((dom.window.document.querySelector('fieldset')as HTMLFieldSetElement).disabled,true);
    await click('Cerrar edición');
    assert.ok(dom.window.document.querySelector('[aria-label="Corrección pendiente"]'));
    lost=false;await click('Recuperar la misma corrección');
    assert.deepEqual(calls[0],calls[1]);assert.equal(calls.length,2);assert.equal(loads.size,2);
    assert.equal(dom.window.localStorage.getItem(management.customerEditKey('manager')),null);
    assert.equal(dom.window.document.querySelector('[aria-label="Corrección pendiente"]'),null);
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!,/Datos guardados: Ana.*528682345678/);
    assert.equal(button('Corregir datos de Ana').disabled,false);
    await click('Ver compras');
    const history=dom.window.document.querySelector('[aria-label="Compras de Ana"]');
    assert.ok(history); assert.match(history.textContent!,/Folio 27/); assert.match(history.textContent!,/1 × Café histórico/); assert.match(history.textContent!,/Sin azúcar/);
    assert.doesNotMatch(dom.window.document.body.textContent!,/Sin correo/);
    await click('Cerrar historial'); assert.equal(dom.window.document.querySelector('[aria-label="Compras de Ana"]'),null);
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
