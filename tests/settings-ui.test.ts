import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {act,createElement,type ComponentType} from 'react';
import * as ts from 'typescript';
import * as drawer from '../lib/drawer';
import * as resource from '../lib/use-resource';
import * as types from '../lib/pos-types';
import * as settings from '../app/admin/Settings';

const actor='admin';
const old={actor,operation:'rate',request:'00000000-0000-4000-8000-000000000016',payload:{rate:16,actor_id:actor}};
async function harness(active=false,initialPending=false){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'}),saved=new Map<string,PropertyDescriptor|undefined>(),calls:{name:string;args:Record<string,unknown>}[]=[];
  for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,navigator:{userAgent:dom.window.navigator.userAgent,locks:{request:async(_name:unknown,_options:unknown,fn:(lock:object)=>unknown)=>fn({})}}})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  if(initialPending)dom.window.localStorage.setItem(drawer.drawerRequestKey(actor,'rate'),JSON.stringify(old));
  const {createRoot}=await import('react-dom/client');
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:()=>{const q=Object.assign(Promise.resolve({data:{exchange_rate:18},error:null}),{select:()=>q,eq:()=>q,abortSignal:()=>q,single:()=>q});return q;},rpc:(name:string,args:Record<string,unknown>={})=>{
    let data:unknown;
    if(name==='pos_drawer_status')data={rate:16,active:active?{id:'shift',cashier_id:'cashier',cashier_name:'Ana'}:null,handoff:null,cashiers:[]};
    else if(name==='pos_drawer_history')data=[];
    else{calls.push({name,args});data={request_id:args.p_request,rate:(args.p_payload as {rate:number}).rate};}
    const result=Promise.resolve({data,error:null});return Object.assign(result,{abortSignal:()=>result});
  }};
  const imports:Record<string,unknown>={'@/lib/supabase':{supabase:client},'@/lib/use-resource':resource,'@/lib/pos-types':types,'@/lib/drawer':drawer,'../Settings':settings,'./ManagerRecovery':{default:()=>null,__esModule:true},'@/app/LoadFailure':{default:()=>null,__esModule:true}};
  const require=createRequire(import.meta.url),exports:{default?:ComponentType}={};
  const compiled=ts.transpileModule(readFileSync(new URL('../app/admin/caja/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',compiled)((name:string)=>imports[name]??require(name),exports);
  const root=createRoot(dom.window.document.getElementById('root')!);await act(async()=>root.render(createElement(exports.default!)));
  const button=(label:string)=>[...dom.window.document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent)===label);
  const click=async(label:string)=>{const b=button(label);assert.ok(b,label);assert.equal(b.disabled,false);await act(async()=>b.click());};
  return{dom,calls,button,click,inject:()=>dom.window.localStorage.setItem(drawer.drawerRequestKey(actor,'rate'),JSON.stringify(old)),async clean(){await act(async()=>root.unmount());dom.window.close();for(const[key,d]of saved){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}}};
}

test('drawer settings show saved 16 separately from the open shift at 18 and omit the unavailable editor',async()=>{
  const h=await harness(true);try{
    assert.match(h.dom.window.document.body.textContent!,/Próxima apertura/);assert.match(h.dom.window.document.body.textContent!,/1 USD = 16 MXN/);assert.match(h.dom.window.document.body.textContent!,/Turno actual/);assert.match(h.dom.window.document.body.textContent!,/1 USD = 18 MXN/);
    assert.match(h.dom.window.document.body.textContent!,/Podrás editarlo al cerrar la caja/);
    assert.equal(h.button('Revisar cambio pendiente'),undefined);assert.equal(h.button('Editar tipo de cambio'),undefined);
    assert.equal(h.dom.window.document.querySelector('input[aria-label="Tipo de cambio guardado MXN por USD"]'),null);assert.equal(h.calls.length,0);
  }finally{await h.clean();}
});

test('drawer settings show recovery only for a real pending rate change',async()=>{
  const h=await harness(false,true);try{
    assert.ok(h.button('Revisar cambio pendiente'));assert.equal(h.button('Editar tipo de cambio'),undefined);await h.click('Revisar cambio pendiente');
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'pos_set_drawer_rate');assert.deepEqual(h.calls[0].args,{p_request:old.request,p_payload:old.payload});
    assert.equal(h.button('Revisar cambio pendiente'),undefined);
  }finally{await h.clean();}
});

test('saving a new rate cannot silently recover a change created in another window',async()=>{
  const h=await harness();try{
    await h.click('Editar tipo de cambio');const input=h.dom.window.document.querySelector<HTMLInputElement>('input[aria-label="Tipo de cambio guardado MXN por USD"]')!;
    const setter=Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype,'value')!.set!;await act(async()=>{setter.call(input,'20');input.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));});h.inject();
    await act(async()=>h.dom.window.document.querySelector('form')!.dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(h.calls.length,0);assert.equal(h.button('Editar tipo de cambio'),undefined);assert.ok(h.button('Revisar cambio pendiente'));assert.equal(h.dom.window.localStorage.getItem(drawer.drawerRequestKey(actor,'rate')),JSON.stringify(old));
    await h.click('Revisar cambio pendiente');assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].args,{p_request:old.request,p_payload:old.payload});
  }finally{await h.clean();}
});
