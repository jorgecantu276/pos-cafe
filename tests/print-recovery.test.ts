import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {PrintJournal,type PrintAdapter} from '../lib/print-journal-server';
import {handlePrintRequest} from '../lib/print-dispatch-server';
import {printConfig} from '../lib/windows-print-server';
import type {SavedOrder} from '../lib/checkout';
import type {PrintAudience} from '../lib/sale-printing';

const queues={customer:'POS80 Printer',barista:'Y813BT Sticker'};
function fixture(adapter:PrintAdapter){
  const directory=mkdtempSync(path.join(tmpdir(),'pos-manager-print-')),filename=path.join(directory,'jobs.sqlite');
  let actor='outgoing',status='completed',clock=Date.now();
  const ids:Record<string,string>=Object.fromEntries(['outgoing','incoming','manager'].map(name=>[name,randomUUID()]));
  const lookups:string[][]=[];
  const order:SavedOrder={id:randomUUID(),ticket_number:76,status:'completed',total:80,
    items:[{id:'a',quantity:1,product:{id:'coffee',name:'Cappuccino',price:80,category:'Bebidas'}}],
    customer_name:'Cliente sintético',order_type:'Para Llevar',order_note:'',created_at:'2026-10-30T17:00:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:18,change_mxn:0};
  let journal=new PrintJournal(filename,adapter,()=>clock);
  const names=[{id:ids.outgoing,full_name:'Caja saliente'},{id:ids.incoming,full_name:'Caja entrante'},{id:ids.manager,full_name:'Responsable'}];
  const client={auth:{getUser:async()=>({data:{user:{id:ids[actor]}},error:null})},from(table:string){
    assert.ok(['profiles','orders'].includes(table));
    const query={select:()=>query,eq:()=>query,in:(_column:string,values:string[])=>{
      assert.ok(values.every(value=>Object.values(ids).includes(value)),'Profile lookup must contain real user UUIDs only');lookups.push(values);return query;
    },abortSignal:()=>query,
      single:async()=>({error:null,data:table==='profiles'?{role:actor==='manager'?'admin':'cashier',is_active:true}:
        {id:order.id,ticket_number:order.ticket_number,status,cashier_id:ids.outgoing,receipt_snapshot:order}}),
      then(resolve:(value:unknown)=>unknown){return Promise.resolve(resolve({error:null,data:names}));}};
    return query;
  },rpc(){assert.fail('Recovery must not charge or alter business data');}} as unknown as SupabaseClient;
  const config=printConfig({POS_PRINT_MODE:'mock',POS_PRINT_DATA_DIR:directory});
  const request=(body?:unknown,scope=false)=>handlePrintRequest(new Request(`http://127.0.0.1:3000/api/printing${scope?'?scope=all':''}`,{
    method:body?'POST':'GET',headers:{'X-Pos-Print':'1','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),client,journal,config);
  return {order,request,names,lookups,uid:(name:string)=>ids[name],get journal(){return journal;},actor(value:string){actor=value;},status(value:string){status=value;},advance(ms:number){clock+=ms;},
    restart(){journal.close();journal=new PrintJournal(filename,adapter,()=>clock);},close(){journal.close();rmSync(directory,{recursive:true,force:true});}};
}
const review=(orderId:string,audience:PrintAudience,action:string)=>({orderId,audience,action,requestId:randomUUID(),reason:'Se revisó el papel y la cola correspondiente.',confirmed:true});

test('manager recovers outgoing cashier blocked copy after handoff; owner and audit survive restart and replay',async()=>{
  let offline=true;const sent:PrintAudience[]=[];
  const f=fixture({async prepare(job){if(job.audience==='barista'&&offline)throw Error('Bluetooth desconectado');return{async submit(){sent.push(job.audience);},dispose(){}};}});
  try{
    await f.request({orderId:f.order.id});assert.deepEqual(sent,['customer']);
    f.actor('incoming');assert.equal((await f.request()).jobs.length,0);
    await assert.rejects(f.request(undefined,true),/responsable/);
    await assert.rejects(f.request({orderId:f.order.id,audience:'barista'}),/no pertenece/);
    await assert.rejects(f.request(review(f.order.id,'barista','retry')),/responsable/);
    f.actor('manager');const all=await f.request(undefined,true);
    assert.equal(all.jobs.length,2);assert.ok('cashiers'in all);assert.deepEqual(all.cashiers,f.names);
    assert.equal('cashierId'in all.jobs[0]&&all.jobs[0].cashierId,f.uid('outgoing'));
    await assert.rejects(f.request({orderId:f.order.id,audience:'barista'}),/Administración/);
    offline=false;const body=review(f.order.id,'barista','retry');await f.request(body);
    assert.deepEqual(sent,['customer','barista']);assert.deepEqual(f.journal.list(f.uid('manager')),[]);
    const audit=f.journal.recoveryHistory();assert.equal(audit.length,1);assert.equal(audit[0].actor,f.uid('manager'));assert.equal(audit[0].owner,f.uid('outgoing'));assert.equal(audit[0].ticket,'76');
    f.restart();await f.request(body);assert.equal(sent.length,2);assert.deepEqual(f.journal.recoveryHistory(),audit);
    await assert.rejects(f.request({...body,reason:'Otra explicación para una identidad ya usada.'}),/otra revisión/);
  }finally{f.close();}
});

test('manager acknowledges physically printed uncertain copy without resending, with required inspection and durable audit',async()=>{
  const sent:PrintAudience[]=[];const f=fixture({async prepare(job){return{async submit(){sent.push(job.audience);if(job.audience==='barista')throw Error('Respuesta perdida');},dispose(){}};}});
  try{
    await f.request({orderId:f.order.id});f.actor('manager');
    const body=review(f.order.id,'barista','confirm_printed');
    await assert.rejects(f.request({...body,confirmed:false}),/Confirma/);
    await assert.rejects(f.request({...body,reason:'sí'}),/Confirma/);
    await f.request(body);await f.request(body);
    assert.deepEqual(sent,['customer','barista']);assert.equal(f.journal.get(f.uid('outgoing'),f.order.id).find(j=>j.audience==='barista')?.state,'submitted');
    assert.match(f.journal.get(f.uid('outgoing'),f.order.id).find(j=>j.audience==='barista')!.message,/confirmó/);
    assert.equal(f.journal.recoveryHistory().length,1);f.restart();assert.equal(f.journal.recoveryHistory()[0].action,'confirm_printed');
  }finally{f.close();}
});

test('one inspected replacement reprints only uncertain audience; a lost response cannot authorize it twice',async()=>{
  const sent:PrintAudience[]=[];let lost=true;
  const f=fixture({async prepare(job){return{async submit(){sent.push(job.audience);if(job.audience==='barista'&&lost)throw Error('Acknowledgment lost');},dispose(){}};}});
  try{
    await f.request({orderId:f.order.id});await f.request({orderId:f.order.id});assert.equal(sent.length,2);
    f.actor('manager');lost=false;const body=review(f.order.id,'barista','replace_missing');
    await f.request(body);await f.request(body);f.restart();await f.request(body);
    assert.deepEqual(sent,['customer','barista','barista']);
    const rows=f.journal.get(f.uid('outgoing'),f.order.id);assert.ok(rows.every(row=>row.state==='submitted'));
    assert.equal(rows.find(row=>row.audience==='customer')?.attempts,1);assert.equal(rows.find(row=>row.audience==='barista')?.attempts,2);
    assert.equal(f.journal.recoveryHistory().length,1);assert.equal(f.journal.recoveryHistory()[0].action,'replace_missing');
  }finally{f.close();}
});

test('active spool handoff cannot be overridden, and cancelled sales cannot receive replacement copies',async()=>{
  let calls=0;const f=fixture({async prepare(){return{submit(){calls++;return new Promise<void>(()=>{});},dispose(){}};}});
  try{
    f.journal.ensure(f.uid('outgoing'),f.order,queues);void f.journal.dispatch(f.uid('outgoing'),f.order.id,'barista');
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);f.actor('manager');
    await assert.rejects(f.request(review(f.order.id,'barista','replace_missing')),/Actualiza el estado/);
    assert.equal(f.journal.recoveryHistory().length,0);f.advance(121_000);f.status('cancelled');
    await assert.rejects(f.request(review(f.order.id,'barista','replace_missing')),/no está completada/);assert.equal(calls,1);
    await f.request(review(f.order.id,'barista','confirm_printed'));assert.equal(calls,1);assert.equal(f.journal.recoveryHistory().length,1);
  }finally{f.close();}
});

test('manager may explicitly replace accepted-but-missing paper after inspection, without resending the other copy',async()=>{
  const sent:PrintAudience[]=[];const f=fixture({async prepare(job){return{async submit(){sent.push(job.audience);},dispose(){}};}});
  try{
    await f.request({orderId:f.order.id});f.actor('manager');
    const body=review(f.order.id,'barista','replace_missing');
    await assert.rejects(f.request({...body,confirmed:false}),/Confirma/);
    await f.request(body);await f.request(body);
    assert.deepEqual(sent,['customer','barista','barista']);assert.equal(f.journal.recoveryHistory()[0].previousState,'submitted');
  }finally{f.close();}
});

test('manager can read the preserved hardware journal and audit alongside real cashier jobs without invalid UUID queries or resubmission',async()=>{
  let submitted=0;
  const f=fixture({async prepare(){return{async submit(){submitted++;},dispose(){}};}});
  try{
    const legacy={...f.order,id:randomUUID(),ticket_number:'PRUEBA-D2'};
    f.journal.ensure('physical-test-only',legacy,queues,{testOnly:true});
    f.journal.authorizeRecovery({requestId:randomUUID(),actor:'onsite-review',owner:'physical-test-only',orderId:legacy.id,
      audience:'barista',action:'retry',reason:'Se revisó la cola de la prueba física.'});
    await f.journal.dispatch('physical-test-only',legacy.id);
    const before=f.journal.get('physical-test-only',legacy.id),history=f.journal.recoveryHistory();
    f.actor('manager');
    const onlyLegacy=await f.request(undefined,true);
    assert.equal(onlyLegacy.jobs.length,2);assert.deepEqual(onlyLegacy.cashiers,[]);assert.deepEqual(f.lookups,[]);
    f.actor('outgoing');await f.request({orderId:f.order.id});f.actor('manager');
    const all=await f.request(undefined,true);assert.equal(all.jobs.length,4);
    assert.deepEqual(f.lookups,[[f.uid('outgoing')]]);
    assert.equal(all.jobs.filter(job=>'cashierId'in job&&job.cashierId==='physical-test-only').length,2);
    assert.deepEqual(all.history,history);assert.deepEqual(f.journal.get('physical-test-only',legacy.id),before);
    f.restart();await f.request(undefined,true);assert.equal(submitted,4);
    assert.deepEqual(f.journal.get('physical-test-only',legacy.id),before);assert.deepEqual(f.journal.recoveryHistory(),history);
  }finally{f.close();}
});
