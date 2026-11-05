import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SavedOrder} from '../lib/checkout';
import {saleDocuments,phoneOrderDocuments,type PrintAudience,type SalePrintDocument} from '../lib/sale-printing';
import {PrintJournal} from '../lib/print-journal-server';
import {handlePrintRequest} from '../lib/print-dispatch-server';
import {handlePhonePrintRequest} from '../lib/phone-print-dispatch-server';
import {printConfig} from '../lib/windows-print-server';

const queues={customer:'POS80 Printer',barista:'Y813BT Sticker'};
const pastryNames=['Brownie tradicional','Galleta de pistache','Crookie nutella','Muffin de plátano','Cheesecake Oreo','Pastel de zanahoria'];
function order(drinks=0):SavedOrder {
  const items=pastryNames.map((name,index)=>({id:randomUUID(),quantity:index===0?2:1,
    product:{id:randomUUID(),name,category:'Postres',price:50,displayExtras:index===1?[{name:'Sin nuez',price:0}]:[],note:index===2?'Calentar por separado':''}}));
  if(drinks)items.push({id:randomUUID(),quantity:drinks,product:{id:randomUUID(),name:'Iced coffee caramelo 20 oz',category:'Bebidas',price:125,displayExtras:[],note:'Sin hielo'}});
  return {id:randomUUID(),ticket_number:123,status:'completed',total:350+drinks*125,items,customer_name:'Ana de prueba',
    order_type:'Para Llevar',order_note:'Entregar juntos',created_at:'2026-11-05T18:00:00Z',pager_number:12,
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:16,change_mxn:0};
}

test('six different desserts produce one grouped preparation, retaining quantities and notes without cup labels or prices',()=>{
  const sale=order(),before=JSON.stringify(sale),docs=saleDocuments(sale),desserts=docs.desserts!;
  assert.equal(docs.barista.sections.length,0);assert.equal(desserts.sections.length,1);
  const preparation=desserts.sections[0].join('\n');
  for(const value of ['COMANDA DE POSTRES','2 × Brownie tradicional','1 × Crookie nutella','Calentar por separado','Sin nuez','CONTROL: 12','Ana de prueba','Entregar juntos'])assert.ok(preparation.includes(value),value);
  assert.doesNotMatch(preparation,/\$|TOTAL|Recibido|Cambio|Pago:/);
  const receipt=docs.customer.sections[0];
  for(const item of sale.items)assert.ok(receipt.includes(item.product.name));
  assert.ok(receipt.includes('TOTAL: $350.00 MXN'));assert.equal(JSON.stringify(sale),before);
});

test('mixed orders number only drink cups and retain other categories on their original label path',()=>{
  const sale=order(2),docs=saleDocuments(sale);
  assert.equal(docs.barista.sections.length,2);assert.equal(docs.desserts?.sections.length,1);
  assert.deepEqual(docs.barista.referenceLabels?.map(label=>label.cup),['1/2','2/2']);
  assert.ok(docs.barista.sections.every(section=>section[1]==='Iced coffee caramelo 20 oz'));
  const unknown=order();unknown.items=[{...unknown.items[0],product:{...unknown.items[0].product,category:'Xile Chile'}}];
  assert.equal(saleDocuments(unknown).barista.sections.length,2);
  assert.equal(saleDocuments(unknown).desserts,undefined);
});

test('dessert-only journal creates exactly two receipt-printer jobs and never prepares a Bluetooth label',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-desserts-only-')),sale=order(),prepared:{audience:PrintAudience;queue:string}[]=[];
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job){
    assert.notEqual(job.audience,'barista');prepared.push({audience:job.audience,queue:job.queue});return{async submit(){},dispose(){}};
  }});
  try{
    journal.ensure('cashier',sale,queues);const jobs=await journal.dispatch('cashier',sale.id);
    assert.deepEqual(jobs.map(job=>job.audience),['customer','desserts']);
    assert.deepEqual(prepared,[{audience:'customer',queue:'POS80 Printer'},{audience:'desserts',queue:'POS80 Printer'}]);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('a grouped dessert handoff retries independently and an uncertain result cannot resend after restart',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-desserts-')),sale=order(2),sent:PrintAudience[]=[];
  let offline=true,uncertain=false;
  const adapter={async prepare(job:{audience:PrintAudience}){
    if(job.audience==='desserts'&&offline)throw Error('POS80 sin papel');
    return{async submit(){sent.push(job.audience);if(job.audience==='desserts'&&uncertain)throw Error('Acuse perdido');},dispose(){}};
  }};
  let journal=new PrintJournal(path.join(directory,'jobs.sqlite'),adapter);
  try{
    journal.ensure('cashier',sale,queues);let jobs=await journal.dispatch('cashier',sale.id);
    assert.equal(jobs.length,3);assert.deepEqual(sent,['customer','barista']);
    assert.equal(jobs.find(job=>job.audience==='desserts')?.queue,'POS80 Printer');
    assert.equal(jobs.find(job=>job.audience==='desserts')?.state,'blocked');
    journal.close();journal=new PrintJournal(path.join(directory,'jobs.sqlite'),adapter);offline=false;uncertain=true;
    await journal.dispatch('cashier',sale.id,'desserts');assert.deepEqual(sent,['customer','barista','desserts']);
    journal.close();journal=new PrintJournal(path.join(directory,'jobs.sqlite'),adapter);
    journal.ensure('cashier',sale,queues);jobs=await journal.dispatch('cashier',sale.id);
    assert.equal(jobs.find(job=>job.audience==='desserts')?.state,'uncertain');assert.equal(sent.length,3);
    journal.authorizeRecovery({requestId:randomUUID(),actor:'manager',owner:'cashier',orderId:sale.id,audience:'desserts',action:'confirm_printed',reason:'Comprobé la comanda de postres en papel.'});
    await journal.dispatch('cashier',sale.id);assert.equal(sent.length,3);assert.equal(journal.recoveryHistory()[0].audience,'desserts');
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('an existing source keeps its original dessert stickers and never gains a new grouped handoff',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-desserts-legacy-')),sale=order(),seen:{audience:PrintAudience;document:SalePrintDocument}[]=[];
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job,document){return{async submit(){seen.push({audience:job.audience,document});},dispose(){}};}});
  try{
    const old={title:'CM #0123 BARRA',sections:sale.items.flatMap(item=>Array.from({length:item.quantity},()=>[sale.customer_name,item.product.name]))};
    journal.ensureDocuments('cashier',sale,queues,{customer:saleDocuments(sale).customer,barista:old});
    await journal.dispatch('cashier',sale.id);const before=JSON.stringify(journal.get('cashier',sale.id));
    journal.ensure('cashier',sale,{customer:'Otra cola',barista:'Otra etiqueta'});await journal.dispatch('cashier',sale.id);
    assert.equal(JSON.stringify(journal.get('cashier',sale.id)),before);assert.equal(seen.length,2);
    assert.deepEqual(seen.find(copy=>copy.audience==='barista')?.document,old);
    assert.equal(journal.get('cashier',sale.id).some(job=>job.audience==='desserts'),false);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

for(const legacyState of ['blocked','uncertain'])test(`legacy ${legacyState} dessert labels preserve their original handoff identity without adding a grouped copy`,async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-desserts-legacy-state-')),sale=order();let submissions=0;
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job){
    if(job.audience==='barista'&&legacyState==='blocked')throw Error('Legacy offline');
    return{async submit(){submissions++;if(job.audience==='barista')throw Error('Legacy acknowledgment lost');},dispose(){}};
  }});
  try{
    journal.ensureDocuments('cashier',sale,queues,{customer:saleDocuments(sale).customer,barista:{title:'Old dessert label',sections:[['Old per-item dessert']]}});
    await journal.dispatch('cashier',sale.id);
    const before=JSON.stringify(journal.get('cashier',sale.id));
    journal.ensure('cashier',sale,queues);
    assert.equal(JSON.stringify(journal.get('cashier',sale.id)),before);
    assert.equal(journal.get('cashier',sale.id).find(job=>job.audience==='barista')?.state,legacyState);
    assert.equal(journal.get('cashier',sale.id).some(job=>job.audience==='desserts'),false);
    if(legacyState==='uncertain'){await journal.dispatch('cashier',sale.id);assert.equal(submissions,2);}
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('sale and phone APIs expose the grouped audience and pickup payment never repeats preparation',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-desserts-api-')),sale=order(1),actor=randomUUID(),phoneId=randomUUID(),sent:{id:string;audience:PrintAudience}[]=[];
  let paid=false;
  const phone={id:phoneId,folio:42,created_by:actor,contact_name:'Ana de prueba',contact_phone:'8682345678',
    snapshot:{items:sale.items,total:sale.total,customer_name:sale.customer_name,order_type:sale.order_type,order_note:sale.order_note,created_at:sale.created_at}};
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from(table:string){
    const query={select:()=>query,eq:()=>query,abortSignal:()=>query,single:async()=>({error:null,data:table==='profiles'?{role:'cashier',is_active:true}:{id:sale.id,ticket_number:sale.ticket_number,status:'completed',cashier_id:actor,receipt_snapshot:paid?{...sale,phone_order_id:phoneId,phone_folio:42}:sale}})};return query;
  },async rpc(){return{error:null,data:{...phone,status:paid?'paid':'pending',paid_order_id:paid?sale.id:null,paid_sale_status:paid?'completed':null}};}} as unknown as SupabaseClient;
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job){return{async submit(){sent.push({id:job.orderId,audience:job.audience});},dispose(){}};}});
  const config=printConfig({POS_PRINT_MODE:'mock',POS_PRINT_DATA_DIR:directory});
  const request=(endpoint:string,body:unknown)=>new Request('http://127.0.0.1/api/'+endpoint,{method:'POST',headers:{'X-Pos-Print':'1'},body:JSON.stringify(body)});
  try{
    const unpaid=phoneOrderDocuments(phone).desserts!.sections[0].join('\n');assert.match(unpaid,/TELÉFONO T0042 · SIN PAGAR/);assert.doesNotMatch(unpaid,/CONTROL:|\$/);
    const preparation=await handlePhonePrintRequest(request('phone-printing',{phoneOrderId:phoneId}),client,journal,config);
    assert.equal(preparation.expectedCopies,3);assert.equal(preparation.jobs.length,3);
    paid=true;
    const receipt=await handlePrintRequest(request('printing',{orderId:sale.id}),client,journal,config);
    assert.equal(receipt.expectedCopies,1);assert.equal(receipt.jobs.length,1);
    await handlePrintRequest(request('printing',{orderId:sale.id}),client,journal,config);
    assert.equal(sent.filter(job=>job.id===`phone:${phoneId}`).length,3);assert.equal(sent.filter(job=>job.id===sale.id).length,1);
    await assert.rejects(handlePrintRequest(request('printing',{orderId:sale.id,audience:'desserts'}),client,journal,config),/comanda/);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});

test('mixed-sale API counts all three copies and an explicit dessert retry leaves the ticket and drink label untouched',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-desserts-retry-')),sale=order(1),actor=randomUUID(),sent:PrintAudience[]=[];
  let offline=true;
  const client={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from(table:string){
    const query={select:()=>query,eq:()=>query,abortSignal:()=>query,single:async()=>({error:null,data:table==='profiles'?{role:'cashier',is_active:true}:{id:sale.id,ticket_number:sale.ticket_number,status:'completed',cashier_id:actor,receipt_snapshot:sale}})};return query;
  }} as unknown as SupabaseClient;
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job){if(job.audience==='desserts'&&offline)throw Error('Impresora no disponible');return{async submit(){sent.push(job.audience);},dispose(){}};}});
  const config=printConfig({POS_PRINT_MODE:'mock',POS_PRINT_DATA_DIR:directory});
  const request=(audience?:PrintAudience)=>new Request('http://127.0.0.1/api/printing',{method:'POST',headers:{'X-Pos-Print':'1'},body:JSON.stringify({orderId:sale.id,...(audience?{audience}:{})})});
  try{
    const result=await handlePrintRequest(request(),client,journal,config);assert.equal(result.expectedCopies,3);assert.deepEqual(sent,['customer','barista']);
    offline=false;await handlePrintRequest(request('desserts'),client,journal,config);await handlePrintRequest(request(),client,journal,config);
    assert.deepEqual(sent,['customer','barista','desserts']);
  }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
