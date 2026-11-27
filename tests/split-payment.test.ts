import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckoutReview, SavedOrder } from '../lib/checkout';
import { checkoutPayload, executeCheckout } from '../lib/checkout';
import { splitPayment } from '../lib/split-payment';
import { shiftSales } from '../lib/shift';
import { saleDocuments } from '../lib/sale-printing';
import { savedShiftHtml } from '../lib/shift-printing';

test('cash plus card uses cents, preserves overpaid cash as change and rejects invalid portions',()=>{
  assert.deepEqual(splitPayment(130,'80','100'),{cardAmount:80,cashDue:50,change:50,valid:true});
  assert.deepEqual(splitPayment(10.01,'7,72','2.29'),{cardAmount:7.72,cashDue:2.29,change:0,valid:true});
  for(const card of [0,130,-1,NaN,Infinity,80.001])assert.equal(splitPayment(130,card,100).valid,false);
  for(const cash of [49.99,-1,NaN,Infinity,50.001])assert.equal(splitPayment(130,80,cash).valid,false);
});

test('checkout payload persists split and refuses hidden USD or insufficient cash',()=>{
  const fields={register_id:'r',expected_total:130,payment_method:'efectivo_tarjeta',card_amount_mxn:80,
    tender_mxn:100,tender_usd:0,customer_id:null,order_type:'En Local',order_note:'',pager_number:1};
  const items=[{id:'line',quantity:1,product:{id:'coffee',name:'Café',price:130,category:'Bebidas'}}];
  assert.equal(checkoutPayload(items,fields).card_amount_mxn,80);
  assert.throws(()=>checkoutPayload(items,{...fields,tender_usd:1}),/importe/);
  assert.throws(()=>checkoutPayload(items,{...fields,tender_mxn:49}),/importe/);
});

test('split receipts and saved cortes show both portions while drawer excludes card and returned cash',()=>{
  const order:SavedOrder={id:'sale',ticket_number:1,status:'completed',items:[{id:'line',quantity:1,product:{id:'c',name:'Café',price:130,category:'Bebidas'}}],
    total:130,customer_name:'Prueba',order_type:'En Local',order_note:'',created_at:'2026-11-27T15:00:00Z',
    payment_method:'efectivo_tarjeta',card_amount_mxn:80,tender_mxn:100,tender_usd:0,exchange_rate:16,change_mxn:50};
  const receipt=saleDocuments(order).customer.sections[0].join('\n');
  for(const line of ['Efectivo aplicado: $50.00','Tarjeta MXN: $80.00','Recibido MXN: $100.00','Cambio: $50.00'])assert.ok(receipt.includes(line));
  assert.deepEqual(shiftSales([order,{...order,status:'cancelled'}]),{totalSales:130,cashSales:50});
  const report={id:'cut',starting_cash:100,total_sales:130,total_expenses:10,expected_cash:140,counted_cash:140,difference:0,expenses_detail:[],payments:{efectivo:50,tarjeta:80}};
  const cut=savedShiftHtml(report,true);assert.match(cut,/Efectivo: \$50.00/);assert.match(cut,/Tarjeta: \$80.00/);
  assert.doesNotMatch(savedShiftHtml({...report,payments:null},true),/Ingresos por método/);
});

test('lost split CLIP response recovers original request and requires the saved split amounts',async()=>{
  const previous=globalThis.fetch;
  const pending:CheckoutReview={provider:'clip',requestId:'original',startedAt:'today',total:130,payload:{register_id:'r',items:[],expected_total:130,
    payment_method:'efectivo_tarjeta',card_amount_mxn:80,tender_mxn:100,tender_usd:0,customer_id:null,order_type:'En Local',order_note:'',pager_number:1}};
  const order={id:'sale',ticket_number:1,items:[],total:130,payment_method:'efectivo_tarjeta',card_amount_mxn:80,tender_mxn:100,tender_usd:0,pager_number:1};
  const paths:string[]=[];
  try{
    globalThis.fetch=async(url,options)=>{paths.push(String(url));assert.notEqual(options?.method,'POST');return Response.json({state:'completed',requestId:'original',order});};
    const client={rpc:()=>assert.fail('CLIP cannot use manual checkout')} as never;
    assert.equal((await executeCheckout(client,pending)).card_amount_mxn,80);
    assert.deepEqual(paths,['/api/payments/clip?request=original']);
    globalThis.fetch=async()=>Response.json({state:'completed',requestId:'original',order:{...order,card_amount_mxn:130}});
    await assert.rejects(executeCheckout(client,pending),/desglose/);
  }finally{globalThis.fetch=previous;}
});
