import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {inventoryQuantity,stockQuantity,inventoryRequestKey,readInventoryRequest,recoverInventory,saveInventory} from '../lib/inventory';

const payload={id:'product',kind:'product',operation:'entrada',quantity:5,reason:'Producción'};
function harness(){
  const map=new Map<string,string>();const storage:Storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);},clear:()=>map.clear(),key:(i:number)=>[...map.keys()][i]??null,get length(){return map.size;}};
  const locks=new Set<string>();const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(key:string,_options:unknown,action:(lock:object|null)=>Promise<unknown>)=>{
    if(locks.has(key))return action(null);locks.add(key);try{return await action({});}finally{locks.delete(key);}
  }}}});
  return {storage,map,restore:()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else Reflect.deleteProperty(globalThis,'navigator');}};
}
// Supabase builders are promise-like and carry abortSignal; a single invocation
// must be used even when awaiting is interrupted before an HTTP request starts.
function api(run:(name:string,args:{p_request:string;p_payload:Record<string,unknown>})=>Promise<unknown>){
  return {rpc:(name:string,args:{p_request:string;p_payload:Record<string,unknown>})=>{const p=run(name,args);return Object.assign(p,{abortSignal:()=>p});}} as unknown as Pick<SupabaseClient,'rpc'>;
}
test('inventory quantities convert real stock units exactly and reject fractional pieces or silent rounding',()=>{
  assert.equal(inventoryQuantity('1.25','lt'),1250);assert.equal(inventoryQuantity('0,5','kg'),500);assert.equal(inventoryQuantity('1','oz'),29.57);assert.equal(inventoryQuantity('0','pza'),0);
  assert.equal(stockQuantity('1','lt','ml'),1000);assert.throws(()=>stockQuantity('1','kg','ml'));assert.throws(()=>stockQuantity('1','lt','lt'));
  for(const [value,unit] of [['1.5','pza'],['0.001','ml'],['-1','gr'],['1e4','ml'],['NaN','ml'],['999999999999','lt'],['0.5','oz']])assert.throws(()=>inventoryQuantity(value,unit));
});
test('inventory request is stored before I/O and lost-response recovery reuses exact identity and actor',async()=>{
  const h=harness();const calls:unknown[]=[];let fail=true;
  try{
    const c=api(async(name,args)=>{assert.ok(h.storage.getItem(inventoryRequestKey('owner')));calls.push([name,args]);
      return fail?{data:null,error:{message:'Failed to fetch',code:''}}:{data:{request_id:args.p_request,actor_id:'owner',operation:'movement',id:'product',revision:1},error:null};});
    await assert.rejects(saveInventory(c,h.storage,'owner','movement',payload));
    assert.equal(readInventoryRequest(h.storage,'owner')?.payload.quantity,5);
    await assert.rejects(saveInventory(c,h.storage,'owner','movement',{...payload,quantity:9}));assert.equal(calls.length,1);
    fail=false;await recoverInventory(c,h.storage,'owner');assert.deepEqual(calls[0],calls[1]);assert.equal(h.map.size,0);
  }finally{h.restore();}
});
test('inventory storage failure sends nothing; confirmed SQL conflict retires only its own pending request',async()=>{
  const h=harness();let calls=0;
  try{
    const c=api(async()=>{calls++;return {data:null,error:{message:'El inventario cambió',code:'P0001'}};});
    await assert.rejects(saveInventory(c,{...h.storage,setItem:()=>{throw Error('Disk full');}} as Storage,'owner','movement',payload));assert.equal(calls,0);
    await assert.rejects(saveInventory(c,h.storage,'owner','movement',payload));assert.equal(calls,1);assert.equal(h.map.size,0);
  }finally{h.restore();}
});
test('inventory tabs cannot replace an in-flight request and a wrong-actor response remains recoverable',async()=>{
  const h=harness();let release!:(v:unknown)=>void;const response=new Promise(resolve=>{release=resolve;});
  try{
    const c=api(async()=>response);const saving=saveInventory(c,h.storage,'owner','movement',payload);
    await assert.rejects(saveInventory(c,h.storage,'owner','movement',payload),/Otra ventana/);
    const pending=readInventoryRequest(h.storage,'owner')!;release({data:{request_id:pending.request,actor_id:'other-admin',operation:'movement',id:'product',revision:1},error:null});
    await assert.rejects(saving,/Respuesta/);assert.equal(readInventoryRequest(h.storage,'owner')?.request,pending.request);
  }finally{h.restore();}
});
test('aborting an Auth-stalled inventory retry retains its identity and never invents a second movement',async()=>{
  const h=harness();
  try{
    const failed=api(async()=>({data:null,error:{message:'network',code:''}}));await assert.rejects(saveInventory(failed,h.storage,'owner','movement',payload));
    const original=h.storage.getItem(inventoryRequestKey('owner'));const controller=new AbortController();
    const recovering=recoverInventory(api(async()=>new Promise(()=>{})),h.storage,'owner',controller.signal);controller.abort();
    await assert.rejects(recovering,/Recupera|recupera/);assert.equal(h.storage.getItem(inventoryRequestKey('owner')),original);
  }finally{h.restore();}
});
