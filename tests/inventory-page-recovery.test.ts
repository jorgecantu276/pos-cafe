import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {act,createElement,type ComponentType} from 'react';
import * as ts from 'typescript';
import * as inventory from '../lib/inventory';
import * as resource from '../lib/use-resource';
import * as deadline from '../lib/request-deadline';
import * as types from '../lib/pos-types';
import * as settings from '../app/admin/Settings';

const actor='admin',product='00000000-0000-4000-8000-000000000001';
const old:inventory.InventoryRequest={actor,request:'00000000-0000-4000-8000-000000000009',rpc:'pos_inventory_write',args:{p_changes:[{product_id:product,revision:2,action:'count',quantity:8}]}};
const other:inventory.InventoryChange[]=[{product_id:'00000000-0000-4000-8000-000000000002',revision:0,action:'count',quantity:5}];

async function harness(file:'page.tsx'|'InventoryReturn.tsx'){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'}),saved=new Map<string,PropertyDescriptor|undefined>(),calls:{name:string;args:Record<string,unknown>}[]=[];
  for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,navigator:{userAgent:dom.window.navigator.userAgent,locks:{request:async(_name:unknown,_options:unknown,fn:(lock:object)=>unknown)=>fn({})}}})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const {createRoot}=await import('react-dom/client');
  let onSave:((changes:inventory.InventoryChange[])=>Promise<boolean>)|undefined;
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:(name:string,args:Record<string,unknown>={})=>{
    let data:unknown;
    if(name==='pos_inventory_catalog')data=[];
    else if(name==='pos_inventory_history')data=[];
    else if(name==='pos_inventory_state')data={enabled:false,revision:0};
    else if(name==='pos_inventory_sale_lines')data=[{id:1,product_name:'Brownie',unit:'pieza',sold:2,returned:0}];
    else {calls.push({name,args});data=name==='pos_inventory_write'?[{product_id:product,revision:3}]:name==='pos_inventory_set_enabled'?{enabled:args.p_enabled,revision:Number(args.p_revision)+1}:[{id:1,returned:1}];}
    const result=Promise.resolve({data,error:null});return Object.assign(result,{abortSignal:()=>result});
  }};
  const imports:Record<string,unknown>={'next/navigation':{useRouter:()=>({refresh:()=>{}})},'@/lib/supabase':{supabase:client},'@/lib/use-resource':resource,'@/lib/request-deadline':deadline,'@/lib/pos-types':types,'@/lib/inventory':inventory,'@/lib/catalog-management':{announceCatalogChange:()=>{}},'../Settings':settings,'./InventoryWorkspace':{InventoryWorkspace:(props:{onSave:typeof onSave})=>{onSave=props.onSave;return createElement('div');}},'@/app/LoadFailure':{default:()=>null,__esModule:true},'./inventory.css':{}};
  const require=createRequire(import.meta.url),exports:{default?:ComponentType<{orderId?:string}>}={};
  const compiled=ts.transpileModule(readFileSync(new URL('../app/admin/inventario/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',compiled)((name:string)=>imports[name]??require(name),exports);
  const root=createRoot(dom.window.document.getElementById('root')!);
  await act(async()=>root.render(createElement(exports.default!,{orderId:'ticket-A'})));
  const click=async(element:Element)=>act(async()=>{element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
  const recover=()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Revisar cambio pendiente')!;
  return {dom,calls,click,recover,save:()=>onSave!,inject:()=>dom.window.localStorage.setItem(inventory.inventoryRequestKey(actor),JSON.stringify(old)),async clean(){await act(async()=>root.unmount());dom.window.close();for(const [key,d]of saved){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}}};
}

test('a new inventory save cannot silently recover an operation created in another window',async()=>{
  const h=await harness('page.tsx');try{
    h.inject();let result:unknown;await act(async()=>{result=await h.save()(other);});
    assert.equal(result,false);assert.equal(h.calls.length,0);assert.deepEqual(inventory.readInventoryRequest(h.dom.window.localStorage,actor),old);
    await h.click(h.recover());assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,old.rpc);assert.deepEqual(h.calls[0].args,{...old.args,p_request:old.request,p_actor:actor});
  }finally{await h.clean();}
});

test('a newly requested activation cannot replace or recover another window’s pending stock change',async()=>{
  const h=await harness('page.tsx');try{
    const checkbox=h.dom.window.document.querySelector('input[type=checkbox]')!;await h.click(checkbox);h.inject();
    const button=[...h.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Activar inventario')!;assert.equal(button.disabled,false);await h.click(button);
    assert.equal(h.calls.length,0);assert.deepEqual(inventory.readInventoryRequest(h.dom.window.localStorage,actor),old);assert.ok(h.recover());
  }finally{await h.clean();}
});

test('a new return keeps its entered quantity when another ticket or operation becomes pending',async()=>{
  const h=await harness('InventoryReturn.tsx');try{
    const input=h.dom.window.document.querySelector<HTMLInputElement>('input[type=number]')!;
    const setter=Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype,'value')!.set!;
    await act(async()=>{setter.call(input,'1');input.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));});
    await h.click(h.dom.window.document.querySelector('input[type=checkbox]')!);h.inject();
    await act(async()=>{h.dom.window.document.querySelector('form')!.dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));});
    assert.equal(h.calls.length,0);assert.deepEqual(inventory.readInventoryRequest(h.dom.window.localStorage,actor),old);
    await h.click(h.recover());assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,old.rpc);
    assert.equal(h.dom.window.document.querySelector<HTMLInputElement>('input[type=number]')!.value,'1');
    assert.equal(h.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,true);
  }finally{await h.clean();}
});
