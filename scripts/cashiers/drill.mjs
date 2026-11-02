import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {reportClone} from '../reports/local-restore.mjs';

// All Auth, enrollment and handoff writes stay in an owned disposable restore.
let clone;const clients=[];
const ok=response=>{assert.ifError(response.error&&Error(response.error.message));return response.data;};
try{
  clone=await reportClone();const {db,config,runId}=clone;
  const make=(key=config.anon)=>{const c=createClient(config.api,key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(c);return c;};
  const service=make(config.service),actors={};
  for(const role of ['admin','cashier','barista']){
    const username=`handoff_${role}_${runId.slice(0,8)}`,email=`${username}@local.invalid`,password=randomBytes(24).toString('base64url');
    const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;
    ok(await service.from('profiles').insert({id:user.id,full_name:`Prueba ${role}`,username,role,is_active:true}));
    const api=make();ok(await api.auth.signInWithPassword({email,password}));actors[role]={id:user.id,api};
  }
  await db.query("update cash_registers set status='closed' where status='open'");
  assert.equal((await db.query('select count(*)::int n from cafe_private.drawer_handoffs where accepted_at is null')).rows[0].n,0,'Use a fresh synthetic archive without an outstanding handoff');
  const rpc=async(actor,name,payload,key=randomUUID())=>ok(await actor.api.rpc(name,{p_request:key,p_payload:payload}));
  await rpc(actors.admin,'pos_set_drawer_rate',{rate:20});
  const register=ok(await actors.cashier.api.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:20}));
  assert.ok((await actors.barista.api.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:0,p_rate:20})).error);
  const person=await rpc(actors.cashier,'pos_enroll_customer',{name:'Cliente de prueba de entrega',phone:'8682345678',birthday:null,promos:false});
  assert.equal(person.customer.points,50);
  const id=randomUUID();await db.query("insert into products(id,name,price,is_active,customizable) values($1,'Venta prueba caja única',50,true,false)",[id]);
  const key=randomUUID(),payload={register_id:register.id,items:[{product_id:id,quantity:1,extra_ids:[],note:''}],expected_total:50,payment_method:'efectivo',tender_mxn:50,tender_usd:0,customer_id:person.customer.id,order_type:'En Local',order_note:'',pager_number:1};
  const receipts=await Promise.all(Array.from({length:20},()=>actors.cashier.api.rpc('pos_checkout',{p_request:key,p_payload:payload}).then(ok)));
  assert.equal(new Set(receipts.map(r=>r.id)).size,1);
  assert.equal((await db.query('select points from customers where id=$1',[person.customer.id])).rows[0].points,55);
  const summary=ok(await actors.cashier.api.rpc('pos_shift_summary',{p_register:register.id}));
  const transferKey=randomUUID(),transfer={register:register.id,to:actors.barista.id,counted:150,expenses:summary.expenses,preview:summary};
  const handoff=await rpc(actors.cashier,'pos_begin_drawer_handoff',transfer,transferKey);
  assert.deepEqual(await rpc(actors.cashier,'pos_begin_drawer_handoff',transfer,transferKey),handoff);
  assert.ok((await actors.cashier.api.rpc('pos_accept_drawer_handoff',{p_request:randomUUID(),p_payload:{handoff:transferKey,counted:150,note:''}})).error);
  const acceptKey=randomUUID(),accept={handoff:transferKey,counted:145,note:'Diferencia sintética contada al recibir'};
  const incoming=await rpc(actors.barista,'pos_accept_drawer_handoff',accept,acceptKey);
  assert.deepEqual(await rpc(actors.barista,'pos_accept_drawer_handoff',accept,acceptKey),incoming);
  assert.equal(Number(incoming.register.initial_balance),145);
  assert.equal(ok(await actors.barista.api.rpc('pos_drawer_status')).active.cashier_id,actors.barista.id);
  const history=ok(await actors.admin.api.rpc('pos_drawer_history'));assert.equal(history[0].difference,-5);
  assert.ok((await actors.cashier.api.rpc('pos_checkout',{p_request:randomUUID(),p_payload:payload})).error);
  const end=ok(await actors.barista.api.rpc('pos_shift_summary',{p_register:incoming.register.id}));
  ok(await actors.barista.api.rpc('pos_close_shift',{p_register:incoming.register.id,p_counted:145,p_expenses:end.expenses,p_preview:end}));
  await rpc(actors.admin,'pos_set_drawer_rate',{rate:19.75});
  await clone.verifyArchive();
  console.log('PASS real local Auth/PostgREST: one drawer, 20 checkout retries, required-phone enrollment, loyalty, separate-cashier counted handoff, acceptance replay, difference audit and saved rate. No hosted data or physical printers.');
}finally{for(const c of clients)c.auth.stopAutoRefresh();await clone?.cleanup();}
