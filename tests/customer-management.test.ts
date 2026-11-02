import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { customerEditKey, readCustomerCorrection, saveCustomerCorrection, recoverCustomerCorrection } from '../lib/customer-management';

function harness() {
  const values=new Map<string,string>(),locks=new Set<string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(key:string,_options:unknown,action:(lock:object|null)=>unknown)=>{
    if(locks.has(key))return action(null);locks.add(key);try{return await action({});}finally{locks.delete(key);}
  }}}});
  return{values,storage,restore(){if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}};
}
type Args={p_request:string;p_payload:{customer_id:string;name:string;phone:string;actor_id:string}};
function api(run:(name:string,args:Args)=>Promise<unknown>){return{rpc:(name:string,args:Args)=>{const response=run(name,args);return Object.assign(response,{abortSignal:()=>response});}} as unknown as Pick<SupabaseClient,'rpc'>;}
const correction={customer_id:'existing-member',name:' Ana corregida ',phone:'+52 (868) 234-5678'};

test('a lost correction response preserves the exact actor, customer and request across recovery',async()=>{
  const h=harness(),calls:unknown[]=[];let fail=true;
  const client=api(async(name,args)=>{assert.equal(name,'pos_edit_customer');assert.ok(h.storage.getItem(customerEditKey('admin')));calls.push(args);
    return fail?{data:null,error:{message:'Respuesta perdida',code:''}}:{error:null,data:{request_id:args.p_request,customer:{id:args.p_payload.customer_id,name:args.p_payload.name,phone:args.p_payload.phone,points:173,total_spent:345.25}}};});
  try{
    await assert.rejects(saveCustomerCorrection(client,h.storage,'admin',correction),/perdida/);
    const persisted=readCustomerCorrection(h.storage,'admin')!;assert.equal(persisted.payload.phone,'528682345678');assert.equal(persisted.payload.name,'Ana corregida');
    await assert.rejects(saveCustomerCorrection(client,h.storage,'admin',{...correction,name:'Otro cliente'}),/Comprueba/);assert.equal(calls.length,1);
    fail=false;const customer=await recoverCustomerCorrection(client,h.storage,'admin');
    assert.deepEqual(calls[0],calls[1]);assert.equal(customer.id,'existing-member');assert.equal(customer.points,173);assert.equal(customer.total_spent,345.25);assert.equal(h.values.size,0);
  }finally{h.restore();}
});

test('confirmed correction rejection permits correcting the form; uncertain permission and malformed responses retain recovery',async()=>{
  const h=harness();
  try{
    await assert.rejects(saveCustomerCorrection(api(async()=>({error:{code:'P0001',message:'Teléfono duplicado'}})),h.storage,'admin',correction),/duplicado/);assert.equal(h.values.size,0);
    await assert.rejects(saveCustomerCorrection(api(async()=>({error:{code:'42501',message:'Sesión cambiada'}})),h.storage,'admin',correction),/Sesión/);assert.ok(readCustomerCorrection(h.storage,'admin'));
    await assert.rejects(recoverCustomerCorrection(api(async(_name,args)=>({error:null,data:{request_id:args.p_request,customer:{id:'wrong-person',name:args.p_payload.name,phone:args.p_payload.phone}}})),h.storage,'admin'),/No se confirmó el guardado/);
    assert.ok(readCustomerCorrection(h.storage,'admin'));
    await assert.rejects(recoverCustomerCorrection(api(async()=>assert.fail()),h.storage,'another-admin'),/No hay/);
  }finally{h.restore();}
});

test('invalid corrections and failure to persist never reach the server; another window cannot double-submit',async()=>{
  const h=harness();let calls=0,release!:()=>void;
  const client=api(async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return{error:{message:'Respuesta perdida',code:''}};});
  try{
    for(const change of [{name:' '},{phone:'555'},{phone:'call 8682345678'},{phone:'1234567890123456'}])await assert.rejects(saveCustomerCorrection(client,h.storage,'admin',{...correction,...change}),/válido/);
    await assert.rejects(saveCustomerCorrection(client,{...h.storage,setItem(){throw Error('Almacenamiento lleno');}},'admin',correction),/lleno/);assert.equal(calls,0);
    const first=saveCustomerCorrection(client,h.storage,'admin',correction);
    await assert.rejects(saveCustomerCorrection(client,h.storage,'admin',correction),/Otra ventana/);assert.equal(calls,1);
    release();await assert.rejects(first,/perdida/);
  }finally{h.restore();}
});
