import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import DrawerGate from '../app/register/DrawerGate';
import { drawerWrite, drawerRequestKey, recoverDrawerRequest, enrollCustomer } from '../lib/drawer';

function harness() {
  const values=new Map<string,string>(),locks=new Set<string>();
  const storage:Storage={get length(){return values.size;},clear:()=>values.clear(),key:(index:number)=>[...values.keys()][index]??null,
    getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(key:string,_options:unknown,action:(lock:object|null)=>unknown)=>{
    if(locks.has(key))return action(null);locks.add(key);try{return await action({});}finally{locks.delete(key);}
  }}}});
  return {storage,values,restore(){if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}};
}
function api(run:(name:string,args:{p_request:string;p_payload:Record<string,unknown>})=>Promise<unknown>){return {rpc:(name:string,args:{p_request:string;p_payload:Record<string,unknown>})=>{const p=run(name,args);return Object.assign(p,{abortSignal:()=>p});}} as unknown as Pick<SupabaseClient,'rpc'>;}
test('empty recovery is read-only and does not contend during duplicate page loads',async()=>{
  const h=harness();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request(){assert.fail('No lock needed without a pending write');}}}});
  try{assert.deepEqual(await Promise.all([recoverDrawerRequest(api(async()=>assert.fail()),h.storage,'a','handoff'),recoverDrawerRequest(api(async()=>assert.fail()),h.storage,'a','handoff')]),[null,null]);}
  finally{h.restore();}
});
test('an uncertain handoff acceptance survives reload and replays the exact actor/count/request',async()=>{
  const h=harness(),calls:unknown[]=[];let fail=true;
  const client=api(async(name,args)=>{assert.ok(h.storage.getItem(drawerRequestKey('b','accept')));calls.push([name,args]);return fail?{data:null,error:{message:'Lost response',code:''}}:{error:null,data:{request_id:args.p_request,register:{id:'incoming',opened_by:'b',initial_balance:145,status:'open'}}};});
  try{
    await assert.rejects(drawerWrite(client,h.storage,'b','accept',{handoff:'h',counted:145,note:''}));
    await assert.rejects(drawerWrite(client,h.storage,'b','accept',{handoff:'other',counted:0,note:''}),/cambio pendiente/);assert.equal(calls.length,1);
    fail=false;await recoverDrawerRequest(client,h.storage,'b','accept');assert.deepEqual(calls[0],calls[1]);assert.equal(h.values.size,0);
  }finally{h.restore();}
});
test('customer enrollment retries do not create another person or switch the submitted name',async()=>{
  const h=harness(),calls:unknown[]=[];let fail=true;
  const client=api(async(_name,args)=>{calls.push(args);return fail?{data:null,error:{message:'Network down',code:''}}:{error:null,data:{request_id:args.p_request,customer:{id:'customer',name:args.p_payload.name,points:50}}};});
  try{
    await assert.rejects(enrollCustomer(client,h.storage,'a',{name:'Ana',phone:'8682345678',birthday:null,promos:false}));
    fail=false;const person=await enrollCustomer(client,h.storage,'a',{name:'Nombre editado',phone:'8682345678',birthday:null,promos:false});
    assert.equal(person.name,'Ana');assert.deepEqual(calls[0],calls[1]);assert.equal(h.values.size,0);
  }finally{h.restore();}
});
test('permission uncertainty retains a pending write; storage failure never reaches the server',async()=>{
  const h=harness();let calls=0;const client=api(async()=>{calls++;return {data:null,error:{message:'Session changed',code:'42501'}};});
  try{
    await assert.rejects(drawerWrite(client,{...h.storage,setItem(){throw Error('Disk full');}} as Storage,'a','rate',{rate:20}));assert.equal(calls,0);
    await assert.rejects(drawerWrite(client,h.storage,'a','rate',{rate:20}));assert.equal(calls,1);assert.ok(h.storage.getItem(drawerRequestKey('a','rate')));
    assert.equal(await recoverDrawerRequest(client,h.storage,'b','rate'),null);assert.equal(calls,1);
  }finally{h.restore();}
});

test('drawer receipt asks for USD on demand and a reason only for a valid difference',async()=>{
  const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost'});
  const h = harness(), saved = new Map<string,PropertyDescriptor|undefined>();
  Object.defineProperty(dom.window.navigator,'locks',{value:navigator.locks});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
  for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,localStorage:h.storage,IS_REACT_ACT_ENVIRONMENT:true})) {
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const find = (label:string) => dom.window.document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  const button = (text:string) => [...dom.window.document.querySelectorAll('button')].find(node=>node.textContent===text)!;
  const fill = async (input:HTMLInputElement,value:string) => act(async()=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  const submitted:unknown[]=[];
  const client=api(async(name,{p_request,p_payload})=>{
    assert.equal(name,'pos_accept_drawer_handoff');
    submitted.push({p_request,p_payload});
    if(submitted.length===1)return {error:{message:'Respuesta perdida',code:''},data:null};
    return {error:null,data:{request_id:p_request,register:{id:'next',opened_by:'b',initial_balance:p_payload.counted}}};
  });
  try {
    await act(async()=>root.render(createElement(DrawerGate,{client,status:{active:null,rate:16,cashiers:[],handoff:{id:'h',from_name:'Ana',to_id:'b',to_name:'Bea',delivered:100,rate:16}},actor:'b',isAdmin:false,reload:async()=>{},logout:()=>{}})));
    assert.equal(dom.window.document.querySelectorAll('input').length,1);
    assert.equal(button('Recibir caja').disabled,true);
    assert.equal(button('Recibir caja').parentElement?.tagName,'FOOTER');
    assert.equal(button('Comprobar recepción'),undefined);
    await fill(find('Efectivo recibido MXN')!,'100');
    assert.equal(find('Motivo de diferencia'),null);
    assert.equal(button('Recibir caja').disabled,false);
    await act(async()=>button('Agregar USD').click());
    const dollars = [...dom.window.document.querySelectorAll('label')].find(label=>label.textContent==='Dólares recibidos')?.querySelector('input');
    assert.ok(dollars);
    await fill(dollars,'1');
    assert.equal(button('Recibir caja').disabled,true);
    await fill(find('Motivo de diferencia')!,'Dólar de más');
    assert.equal(button('Recibir caja').disabled,false);
    await act(async()=>button('Recibir caja').click());
    assert.deepEqual((submitted[0] as {p_payload:unknown}).p_payload,{handoff:'h',counted:116,note:'Dólar de más',actor_id:'b'});
    assert.equal(button('Recibir caja'),undefined);
    assert.equal(find('Efectivo recibido MXN')?.disabled,true);
    await act(async()=>button('Comprobar recepción').click());
    assert.deepEqual(submitted[0],submitted[1]);
    assert.equal(button('Comprobar recepción'),undefined);
  } finally {
    await act(async()=>root.unmount());dom.window.close();h.restore();
    for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
