import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {act,createElement,type ComponentType} from 'react';
import * as ts from 'typescript';
import * as settings from '../app/admin/Settings';

test('manager closing counts USD with the active shift rate and saves exact cents',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async(_key:string,_options:unknown,action:(lock:object)=>unknown)=>action({})}});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,confirm:()=>true})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const summary={register_id:'shift',status:'open',opened_at:'2026-11-21T12:00:00Z',starting_cash:0,exchange_rate:15.075,cash_sales:135.68,total_sales:135.68,expected_cash:135.68,expenses:[],expenses_revision:0,payments:{mixto:135.68}};
  let payload:Record<string,unknown>|undefined;
  const client={rpc(name:string,args:{p_payload:Record<string,unknown>;p_request:string}){
    const data=name==='pos_shift_summary'?summary:{request_id:args.p_request};
    if(name==='pos_manager_close_drawer')payload=args.p_payload;else assert.equal(name,'pos_shift_summary');
    const result=Promise.resolve({data,error:null});return Object.assign(result,{abortSignal:()=>result});
  }};
  const source=readFileSync(new URL('../app/admin/caja/ManagerRecovery.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:{default?:ComponentType<{actor:string;status:unknown;reload:()=>Promise<void>}>}={},require=createRequire(import.meta.url);
  new Function('require','exports',compiled)((name:string)=>name==='@/lib/supabase'?{supabase:client}:name==='../Settings'?settings:require(name),exports);
  const {createRoot}=await import('react-dom/client'),root=createRoot(dom.window.document.getElementById('root')!);
  const click=async(label:string)=>{const button=[...dom.window.document.querySelectorAll('button')].find(node=>node.textContent===label)!;assert.ok(button,label);assert.equal(button.disabled,false);await act(async()=>button.click());};
  const fill=async(input:HTMLInputElement,value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
  try{
    await act(async()=>root.render(createElement(exports.default!,{actor:'admin',status:{active:{id:'shift',cashier_id:'a',cashier_name:'Ana'},handoff:null,rate:16,cashiers:[]},reload:async()=>{}})));
    await click('Revisar turno');
    await fill(dom.window.document.querySelector<HTMLInputElement>('[aria-label="Conteo del responsable MXN"]')!,'0');
    await fill([...dom.window.document.querySelectorAll('label')].find(label=>label.textContent==='Dólares contados')!.querySelector('input')!,'9');
    await fill([...dom.window.document.querySelectorAll('label')].find(label=>label.textContent==='Motivo del cierre')!.querySelector('input')!,'Conteo físico');
    assert.ok(dom.window.document.body.textContent!.includes('$135.68 MXN'));
    await act(async()=>dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Cerrar turno');
    assert.equal(payload?.counted,135.68);
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
