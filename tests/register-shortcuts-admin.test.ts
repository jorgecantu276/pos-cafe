import * as catalogManagement from '../lib/catalog-management';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as shortcuts from '../lib/register-shortcuts';
import * as types from '../lib/pos-types';

test('actual favorites page retains ordered draft after lost save, blocks replacement and recovers the exact request',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'}),saved=new Map<string,PropertyDescriptor|undefined>();
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async(_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}});
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
  type Args={p_request:string;p_payload:{product_ids:string[];revision:number}};
  const calls:Args[]=[];let lost=true,reloads=0;
  const client={rpc:(name:string,args:Args)=>{
    assert.equal(name,'pos_set_register_shortcuts');calls.push(args);
    if(!lost){config.product_ids=[...args.p_payload.product_ids];config.revision=args.p_payload.revision+1;}
    const response=Promise.resolve(lost?{data:null,error:{message:'Respuesta perdida',code:''}}:{error:null,data:{request_id:args.p_request,product_ids:args.p_payload.product_ids,revision:args.p_payload.revision+1}});
    return Object.assign(response,{abortSignal:()=>response});
  }};
  const config={product_ids:[first,second],revision:4};
  const imports:Record<string,unknown>={
    '@/lib/register-shortcuts':shortcuts,'@/lib/catalog-management':catalogManagement,'@/lib/pos-types':types,'@/lib/supabase':{supabase:client},
    '@/lib/use-resource':{useResource:()=>{const[,refresh]=useState(0);return{data:{actor:'owner',config:{...config},products:[{id:first,name:'Americano',price:50,is_active:true},{id:second,name:'Latte',price:70,is_active:true}],pending:false},loading:false,error:null,reload:async()=>{reloads++;refresh(value=>value+1);}};}},
    '@/app/LoadFailure':{default:()=>null,__esModule:true},'./favoritos.css':{},
  };
  const source=readFileSync(new URL('../app/admin/favoritos/page.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:{default?:ComponentType}={},require=createRequire(import.meta.url);
  new Function('require','exports',compiled)((name:string)=>imports[name]??require(name),exports);
  const root=createRoot(dom.window.document.getElementById('root')!);
  const button=(label:string)=>{const node=[...dom.window.document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent?.trim())===label);assert.ok(node,`Missing ${label}`);return node;};
  const click=async(label:string)=>{const node=button(label);assert.equal(node.disabled,false);await act(async()=>{node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
  const order=()=>[...dom.window.document.querySelectorAll('ol strong')].map(node=>node.textContent);
  try{
    await act(async()=>root.render(createElement(exports.default!)));
    await click('Subir Latte');assert.deepEqual(order(),['1. Latte','2. Americano']);
    await click('Guardar favoritos');
    assert.match(dom.window.document.querySelector('[role="status"]')!.textContent!,/Respuesta perdida/);
    assert.deepEqual(order(),['1. Latte','2. Americano']);assert.deepEqual(config.product_ids,[first,second]);
    assert.equal(button('Guardar favoritos').disabled,true);assert.equal(button('Quitar Latte').disabled,true);
    assert.ok(dom.window.localStorage.getItem(shortcuts.registerShortcutsKey('owner')));
    lost=false;await click('Comprobar guardado');
    assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0].p_payload.product_ids,[second,first]);assert.equal(calls.length,2);assert.equal(reloads,1);
    assert.equal(dom.window.localStorage.getItem(shortcuts.registerShortcutsKey('owner')),null);assert.equal(button('Guardar favoritos').disabled,false);
    assert.deepEqual(order(),['1. Latte','2. Americano']);assert.equal(config.revision,5);
    const confirmation=dom.window.document.querySelector('[role="status"]')!;
    assert.match(confirmation.textContent!,/Favoritos guardados/);
    assert.equal(confirmation.closest('section'),button('Guardar favoritos').closest('section'),'Save confirmation stays beside the saved selection and its action controls');
    await click('Subir Americano');
    assert.equal(dom.window.document.querySelector('[role="status"]'),null,'An unsaved edit cannot retain a saved confirmation');
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
