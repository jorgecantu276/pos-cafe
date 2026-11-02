import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {beginPhoneRequest,completePhoneRequest,listPhoneOrders,phoneRequestKey,readPhoneRequest,submitPhoneRequest,validPhoneContact,type PhoneOrder,type PhoneRequest} from '../lib/phone-orders';
import {checkoutPayload} from '../lib/checkout';

const product={id:'coffee',name:'Café',price:50,category:'Bebidas'},items=[{id:'line',quantity:2,product}],now='2026-11-02T18:00:00Z';
const order:PhoneOrder={id:'phone',folio:30,status:'pending',contact_name:'Ana',contact_phone:'528681234567',customer_id:null,created_by:'cashier',created_at:now,revision:0,paid_order_id:null,snapshot:{items,total:100,customer_name:'Ana',order_type:'Para Llevar',order_note:'sin tapa',created_at:now,source:'phone',inventory_reserved:false}};
const pending:PhoneRequest={actor:'cashier',request:crypto.randomUUID(),kind:'save',payload:{items:[{product_id:'coffee',quantity:2,extra_ids:[],note:''}],expected_total:100,contact_name:'Ana',contact_phone:'8681234567',customer_id:null,order_type:'Para Llevar',order_note:'sin tapa'}};
function memory(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}

test('phone save keeps its exact identity after a lost response and rejects a different new operation',async()=>{
  const storage=memory(),calls:unknown[]=[];beginPhoneRequest(storage,pending);
  const client={rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return calls.length===1?{data:null,error:{message:'Connection lost',code:''}}:{data:order,error:null};}} as unknown as Pick<SupabaseClient,'rpc'>;
  await assert.rejects(submitPhoneRequest(client,storage,pending),/Connection lost/);assert.deepEqual(readPhoneRequest(storage,'cashier'),pending);
  assert.throws(()=>beginPhoneRequest(storage,{...pending,request:crypto.randomUUID()}),/Comprueba el pedido/);assert.equal(calls.length,1);
  assert.equal((await submitPhoneRequest(client,storage,readPhoneRequest(storage,'cashier')!)).id,'phone');assert.deepEqual(calls[0],calls[1]);
  assert.ok(storage.getItem(phoneRequestKey('cashier')),'The caller must retain recovery until print intent and draft retirement succeed');completePhoneRequest(storage,pending);assert.equal(storage.values.size,0);
});

test('phone cancellation persists explicit saleable quantities and request identity, with no automatic all-returned default',async()=>{
  const storage=memory(),request:PhoneRequest={actor:'cashier',request:crypto.randomUUID(),kind:'cancel',id:order.id,revision:0,reason:'No recogió',returns:[{line_id:'line',return_quantity:0}]};beginPhoneRequest(storage,request);
  let sent:unknown;const client={rpc:async(name:string,args:unknown)=>{assert.equal(name,'pos_phone_cancel');sent=args;return{data:{...order,status:'cancelled',revision:1},error:null};}} as unknown as Pick<SupabaseClient,'rpc'>;
  await submitPhoneRequest(client,storage,request);assert.deepEqual(sent,{p_request:request.request,p_id:'phone',p_revision:0,p_reason:'No recogió',p_returns:[{line_id:'line',return_quantity:0}]});assert.ok(readPhoneRequest(storage,'cashier'));
});

test('phone checkout exemption requires a persisted order identity and revision, while counter still requires1–30',()=>{
  const fields={register_id:'shift',expected_total:100,payment_method:'efectivo',tender_mxn:100,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:null};
  assert.throws(()=>checkoutPayload(items,fields),/Elige un control/);
  const payload=checkoutPayload(items,{...fields,phone_order_id:'phone',phone_order_revision:0});assert.equal(payload.pager_number,null);assert.equal(payload.phone_order_id,'phone');
  for(const phone_order_revision of [undefined,-1,1.2])assert.throws(()=>checkoutPayload(items,{...fields,phone_order_id:'phone',phone_order_revision}));
  assert.throws(()=>checkoutPayload(items,{...fields,phone_order_id:'phone',phone_order_revision:0,pager_number:1}));
  assert.equal(validPhoneContact('Ana','8681234567'),true);assert.equal(validPhoneContact('A'.repeat(121),'8681234567'),false);assert.equal(validPhoneContact('Ana','123'),false);
});

test('phone queue requests the older-folio cursor instead of silently limiting all pending orders to200',async()=>{
  const calls:unknown[]=[];const client={rpc:async(_name:string,args:unknown)=>{calls.push(args);return{data:[order],error:null};}} as unknown as Pick<SupabaseClient,'rpc'>;
  await listPhoneOrders(client,'Ana');await listPhoneOrders(client,'Ana',undefined,'30');assert.deepEqual(calls,[{p_status:'pending',p_search:'Ana',p_before:null},{p_status:'pending',p_search:'Ana',p_before:'30'}]);
});
