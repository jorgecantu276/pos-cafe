import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {phoneOrderDocuments,saleDocuments,type PrintAudience} from '../lib/sale-printing';
import {PrintJournal} from '../lib/print-journal-server';
import {handlePhonePrintRequest} from '../lib/phone-print-dispatch-server';
import {handlePrintRequest} from '../lib/print-dispatch-server';
import {printConfig} from '../lib/windows-print-server';

function phoneOrder(){return {id:randomUUID(),folio:42,status:'pending',created_by:randomUUID(),contact_name:'Ana de prueba',contact_phone:'8682345678',
  snapshot:{items:[{id:randomUUID(),quantity:2,product:{id:randomUUID(),name:'Iced coffee caramelo',price:110,category:'Bebidas',displayExtras:[{name:'Almendra',phase:'Tipo de Leche',price:15}],note:'Sin hielo'}}],
    total:220,customer_name:'Ana de prueba',order_type:'Para Llevar',order_note:'Dos vasos',created_at:'2026-11-02T16:00:00Z'}};}

test('phone preparation is an unpaid document with its own folio on every cup, not a fabricated paid receipt',()=>{
  const phone=phoneOrder(),documents=phoneOrderDocuments(phone),before=JSON.stringify(documents);
  assert.match(documents.customer.sections.flat().join('\n'),/PEDIDO POR TELÉFONO[\s\S]*PENDIENTE DE PAGO/);
  assert.match(documents.customer.sections.flat().join('\n'),/POR COBRAR: \$220\.00 MXN/);
  assert.doesNotMatch(JSON.stringify(documents),/TICKET DE VENTA|Recibido MXN|Pago:|CONTROL:/);
  assert.equal(documents.barista.sections.length,2);
  for(const section of documents.barista.sections)assert.match(section.join('\n'),/TELÉFONO T0042 · SIN PAGAR/);
  assert.ok(documents.barista.referenceLabels?.every(label=>label.folio==='T0042 · SIN PAGAR'));
  const paid={...phone.snapshot,id:randomUUID(),ticket_number:99,status:'completed',payment_method:'efectivo',tender_mxn:250,tender_usd:0,exchange_rate:16,change_mxn:30,phone_order_id:phone.id,phone_folio:phone.folio};
  assert.match(saleDocuments(paid).customer.sections.flat().join('\n'),/Pedido por teléfono: T0042/);
  assert.equal(JSON.stringify(documents),before);
});

test('shared phone printing retains two preparations across payment, while the paid sale sends only one customer receipt',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-phone-print-')),phone=phoneOrder(),other=randomUUID(),saleId=randomUUID();
  let actor=phone.created_by,status='pending',baristaOffline=true,saleStatus='completed';
  const submitted:{id:string;audience:PrintAudience}[]=[];
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job){
    if(baristaOffline&&job.audience==='barista')throw Error('Bluetooth de prueba desconectado');
    return{async submit(){submitted.push({id:job.orderId,audience:job.audience});},dispose(){}};
  }});
  const paid={...phone.snapshot,id:saleId,ticket_number:99,status:'completed',payment_method:'efectivo',tender_mxn:250,tender_usd:0,exchange_rate:16,change_mxn:30,phone_order_id:phone.id,phone_folio:phone.folio};
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from(table:string){
    const query={select:()=>query,eq:()=>query,abortSignal:()=>query,single:async()=>({error:null,data:table==='profiles'?{role:'cashier',is_active:true}:{id:saleId,ticket_number:99,status:'completed',cashier_id:actor,receipt_snapshot:paid}})};return query;
  },async rpc(name:string,args:{p_id:string}){
    assert.equal(name,'pos_phone_print_state');assert.equal(args.p_id,phone.id);
    return{error:null,data:{...phone,status,paid_order_id:status==='paid'?saleId:null,paid_sale_status:status==='paid'?saleStatus:null}};
  }} as unknown as SupabaseClient;
  const config=printConfig({POS_PRINT_MODE:'mock',POS_PRINT_DATA_DIR:directory});
  const request=(body:unknown,endpoint='phone-printing')=>new Request(`http://127.0.0.1:3111/api/${endpoint}`,{method:'POST',headers:{'X-Pos-Print':'1'},body:JSON.stringify(body)});
  try{
    await handlePhonePrintRequest(request({phoneOrderId:phone.id}),client,journal,config);
    assert.deepEqual(submitted,[{id:`phone:${phone.id}`,audience:'customer'}]);
    actor=other;
    assert.equal(journal.listRegister(other).filter(job=>job.orderId===`phone:${phone.id}`).length,2);
    status='paid';baristaOffline=false;
    await handlePhonePrintRequest(request({phoneOrderId:phone.id,audience:'barista'}),client,journal,config);
    assert.equal(submitted.filter(job=>job.id===`phone:${phone.id}`).length,2);
    const receipt=await handlePrintRequest(request({orderId:saleId},'printing'),client,journal,config);
    assert.equal('expectedCopies' in receipt&&receipt.expectedCopies,1);assert.equal(receipt.jobs.length,1);assert.equal(receipt.jobs[0].audience,'customer');
    await handlePrintRequest(request({orderId:saleId},'printing'),client,journal,config);
    assert.equal(submitted.length,3);
    await assert.rejects(handlePrintRequest(request({orderId:saleId,audience:'barista'},'printing'),client,journal,config),/comanda/);
    saleStatus='cancelled';
    await assert.rejects(handlePhonePrintRequest(request({phoneOrderId:phone.id}),client,journal,config),/cancelado/);
    status='cancelled';
    await assert.rejects(handlePhonePrintRequest(request({phoneOrderId:phone.id}),client,journal,config),/cancelado/);
    assert.equal(submitted.length,3);
  }finally{journal.close();assert.equal(path.dirname(directory),path.resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});}
});

test('direct pickup establishes missing preparation, survives restart and never repeats an uncertain barista handoff',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-phone-pickup-')),phone=phoneOrder(),actor=randomUUID(),saleId=randomUUID();let offline=true,uncertain=false,saleStatus='completed';
  const sent:{id:string;audience:PrintAudience}[]=[];
  const adapter={async prepare(job:{orderId:string;audience:PrintAudience}){if(offline&&job.audience==='barista')throw Error('Bluetooth desconectado');return{async submit(){sent.push({id:job.orderId,audience:job.audience});if(uncertain&&job.audience==='barista')throw Error('Acuse perdido');},dispose(){}};}};
  let journal=new PrintJournal(path.join(directory,'jobs.sqlite'),adapter);
  const paid={...phone.snapshot,id:saleId,ticket_number:99,status:'completed',payment_method:'efectivo',tender_mxn:220,tender_usd:0,exchange_rate:16,change_mxn:0,phone_order_id:phone.id,phone_folio:phone.folio};
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from(table:string){const query={select:()=>query,eq:()=>query,abortSignal:()=>query,single:async()=>({data:table==='profiles'?{role:'cashier',is_active:true}:{id:saleId,ticket_number:99,status:saleStatus,cashier_id:actor,receipt_snapshot:paid},error:null})};return query;},async rpc(name:string){assert.equal(name,'pos_phone_print_state');return{data:{...phone,status:'paid',paid_order_id:saleId,paid_sale_status:saleStatus},error:null};}} as unknown as SupabaseClient;
  const config=printConfig({POS_PRINT_MODE:'mock',POS_PRINT_DATA_DIR:directory}),request=()=>new Request('http://127.0.0.1/api/printing',{method:'POST',headers:{'X-Pos-Print':'1'},body:JSON.stringify({orderId:saleId})});
  try{
    // A's saving browser never wrote an outbox. B takes payment directly.
    assert.equal(journal.get(phone.created_by,`phone:${phone.id}`).length,0);await handlePrintRequest(request(),client,journal,config);
    assert.equal(journal.get(phone.created_by,`phone:${phone.id}`).length,2);assert.equal(sent.length,2);assert.equal(journal.get(phone.created_by,`phone:${phone.id}`).find(job=>job.audience==='barista')?.state,'blocked');
    journal.close();journal=new PrintJournal(path.join(directory,'jobs.sqlite'),adapter);offline=false;uncertain=true;
    await handlePrintRequest(request(),client,journal,config);assert.equal(sent.length,3);assert.equal(journal.get(phone.created_by,`phone:${phone.id}`).find(job=>job.audience==='barista')?.state,'uncertain');
    await handlePrintRequest(request(),client,journal,config);assert.equal(sent.length,3);journal.close();journal=new PrintJournal(path.join(directory,'jobs.sqlite'),adapter);
    await handlePrintRequest(request(),client,journal,config);assert.equal(sent.length,3,'Restart and replay cannot resend accepted or uncertain copies');
    saleStatus='cancelled';await assert.rejects(handlePrintRequest(request(),client,journal,config),/completada/);assert.equal(sent.length,3);
    const phoneRequest=new Request('http://127.0.0.1/api/phone-printing',{method:'POST',headers:{'X-Pos-Print':'1'},body:JSON.stringify({phoneOrderId:phone.id})});
    await assert.rejects(handlePhonePrintRequest(phoneRequest,client,journal,config),/cancelado/);assert.equal(sent.length,3);
  }finally{journal.close();assert.equal(path.dirname(directory),path.resolve(tmpdir()));rmSync(directory,{recursive:true,force:true});}
});
