import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readStaffActivation,saveStaffActivation} from '../lib/staff-active';
import {saveStaffChange,staffActiveKey,staffPendingKey} from '../lib/staff-requests';

test('staff activation recovers the exact request after a lost response without creating an account or changing credentials',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator'),memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}}});
  let fail=true;const calls:Array<Record<string,unknown>>=[];
  const client={rpc:async(name:string,args:Record<string,unknown>)=>{assert.equal(name,'pos_set_staff_active');calls.push(args);return fail?{data:null,error:{code:'',message:'Respuesta perdida'}}:{data:{request_id:args.p_request,id:args.p_id,is_active:args.p_active,management_revision:5},error:null};}} as unknown as Pick<SupabaseClient,'rpc'>;
  try{
    await assert.rejects(saveStaffActivation(client,storage,'owner',{id:'same-user',revision:4,active:true}),/perdida/);const pending=readStaffActivation(storage,'owner');assert.equal(pending?.id,'same-user');assert.doesNotMatch(memory.get(staffActiveKey('owner'))!,/password|username/);
    await assert.rejects(saveStaffActivation(client,storage,'owner',{id:'different-user',revision:0,active:false}),/Comprueba el acceso/);assert.equal(calls.length,1);
    await assert.rejects(saveStaffChange(storage,{operation:'edit',username:'ana',id:'same-user'},{password:'never-sent'},{actor:'owner',fetch:async()=>assert.fail('An unrelated profile/password edit must remain blocked')}),/activación pendiente/);
    fail=false;const result=await saveStaffActivation(client,storage,'owner');assert.equal(result.id,'same-user');assert.deepEqual(calls[0],calls[1]);assert.equal(memory.size,0);
    memory.set(staffPendingKey,JSON.stringify({operation:'create',username:'previous'}));await assert.rejects(saveStaffActivation(client,storage,'owner',{id:'same-user',revision:5,active:false}),/usuario sin confirmar/);assert.equal(calls.length,2);
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}
});

test('uncertain SQLSTATEs retain the staff activation identity; only known business and validation rejections retire it',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}}});
  try{
    for(const code of ['08006','08007','40003','42501','PGRST301','', 'P0001','22023','23505']){
      const memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
      const calls:Array<Record<string,unknown>>=[];let recovering=false;
      const client={rpc:async(_name:string,args:Record<string,unknown>)=>{calls.push(args);return recovering?{data:{request_id:args.p_request,id:args.p_id,is_active:args.p_active,management_revision:5},error:null}:{data:null,error:{code,message:'No se confirmó el resultado'}};}} as unknown as Pick<SupabaseClient,'rpc'>;
      await assert.rejects(saveStaffActivation(client,storage,'owner',{id:'same-user',revision:4,active:true}),/No se confirmó/);
      const rejected=['P0001','22023','23505'].includes(code);assert.equal(Boolean(readStaffActivation(storage,'owner')),!rejected,`${code||'network'} must ${rejected?'retire':'retain'} the request`);
      if(!rejected){
        const pending=memory.get(staffActiveKey('owner'));await assert.rejects(saveStaffActivation(client,storage,'owner',{id:'other-user',revision:0,active:false}),/Comprueba el acceso/);assert.equal(memory.get(staffActiveKey('owner')),pending);assert.equal(calls.length,1);
        recovering=true;await saveStaffActivation(client,storage,'owner');assert.deepEqual(calls[0],calls[1]);assert.equal(memory.size,0);
      }
    }
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}
});
