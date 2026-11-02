import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// All writes target the owned synthetic restore supplied by reportClone.
export async function reportHttpCases({db,admin,cashier,anonymous,menu,ids,register,pass}) {
  const ok=r=>{assert.ifError(r.error&&Error(r.error.message));return r.data;};
  for(const client of [cashier,anonymous])for(const fn of ['pos_sales_report','pos_shift_history','pos_customer_report'])assert.ok((await client.rpc(fn)).error);
  pass('All three report RPCs deny anonymous and cashier access over real local Auth/PostgREST');
  const total=menu.products.reduce((sum,p)=>sum+Math.round(p.price_mxn*100),0)/100;
  const payload={register_id:register.id,items:menu.products.map(p=>({product_id:ids[p.name],quantity:1,extra_ids:[],note:''})),
    expected_total:total,payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'Prueba local de reportes: menú real completo',pager_number:1};
  const receipt=ok(await cashier.rpc('pos_checkout',{p_request:randomUUID(),p_payload:payload}));assert.equal(receipt.total,total);assert.equal(receipt.items.length,82);
  const today=ok(await admin.rpc('pos_sales_report',{p_period:'today'}));
  const expected=(await db.query("select count(*)::int n,sum(total)::numeric total from orders where status='completed' and created_at>=$1 and created_at<$2 and created_at<=$3",[today.start_at,today.end_at,today.as_of])).rows[0];
  assert.equal(today.summary.completed,expected.n);assert.equal(today.summary.sales,Number(expected.total));
  assert.ok(today.orders.some(o=>o.id===receipt.id));
  pass('Real HTTP checkout sells all 82 menu presentations at confirmed prices; Today includes the full receipt exactly once');
  const fixtures=Array.from({length:1207},(_,i)=>({id:randomUUID(),name:menu.products[i%82].name,price:menu.products[i%82].price_mxn,ticket:990000+i}));
  await db.query(`insert into orders(id,subtotal,total,status,payment_method,created_at,ticket_number)
    select (x->>'id')::uuid,(x->>'price')::numeric,(x->>'price')::numeric,'completed','tarjeta','2025-02-12T18:00:00Z',(x->>'ticket')::int from jsonb_array_elements($1) x`,[JSON.stringify(fixtures)]);
  await db.query(`insert into order_items(order_id,quantity,unit_price,total_price,product_snapshot)
    select (x->>'id')::uuid,1,(x->>'price')::numeric,(x->>'price')::numeric,jsonb_build_object('name',x->>'name','price',(x->>'price')::numeric) from jsonb_array_elements($1) x`,[JSON.stringify(fixtures)]);
  for(const [at,status,total] of [['2025-02-12T05:59:59.999Z','completed',9000],['2025-02-12T06:00:00Z','completed',0.1],['2025-02-13T05:59:59.999Z','completed',0.2],['2025-02-13T06:00:00Z','completed',9000],['2025-02-12T18:00:00Z','pending',9999],['2025-02-12T18:00:00Z','cancelled',9999]]){
    await db.query('insert into orders(subtotal,total,status,created_at) values($1,$1,$2,$3)',[total,status,at]);
  }
  const params={p_period:'range',p_from:'2025-02-12',p_to:'2025-02-12'};
  const report=ok(await admin.rpc('pos_sales_report',params));
  const cents=fixtures.reduce((s,f)=>s+Math.round(f.price*100),30);
  assert.equal(report.summary.completed,1209);assert.equal(report.summary.rows,1211);assert.equal(report.summary.sales,cents/100);assert.equal(report.orders.length,50);
  const raw=ok(await admin.from('orders').select('id').gte('created_at',report.start_at).lt('created_at',report.end_at));assert.equal(raw.length,1000);
  const seen=new Set();for(let page=0;page<25;page++){
    const next=ok(await admin.rpc('pos_sales_report',{...params,p_page:page,p_as_of:report.as_of}));
    assert.deepEqual(next.summary,report.summary);for(const order of next.orders){assert.ok(!seen.has(order.id));seen.add(order.id);}
  }
  assert.equal(seen.size,1211);
  pass('Configured 1,000-row API cap reproduced; report returns all 1,209 completed sales and pages all 1,211 records without duplicate UUIDs');
  const found=ok(await admin.rpc('pos_sales_report',{...params,p_search:'#991100'}));assert.equal(found.orders[0].id,fixtures[1100].id);assert.equal(found.summary.completed,1);
  const search=fixtures[1100].name,matching=fixtures.filter(f=>f.name.toLowerCase().includes(search.toLowerCase()));
  const nameReport=ok(await admin.rpc('pos_sales_report',{...params,p_search:search}));assert.equal(nameReport.summary.completed,matching.length);assert.equal(nameReport.summary.sales,matching.reduce((s,f)=>s+f.price,0));
  assert.equal(ok(await admin.rpc('pos_sales_report',{...params,p_search:'%_'})).summary.rows,0);
  assert.ok((await admin.rpc('pos_sales_report',{...params,p_from:'2025-02-13'})).error);
  pass('Ticket/product search covers records past row 1,000 and applies to totals; literal wildcard and invalid-range cases verified');
  for(const [day,hours] of [['2025-03-09',23],['2025-11-02',25]]){
    const dst=ok(await admin.rpc('pos_sales_report',{p_period:'range',p_from:day,p_to:day}));assert.equal((Date.parse(dst.end_at)-Date.parse(dst.start_at))/3600000,hours);
  }
  assert.equal(report.summary.pending,1);assert.equal(report.summary.cancelled,1);assert.equal(Math.round(report.payments.reduce((s,p)=>s+p.total,0)*100),cents);
  pass('Inclusive Matamoros dates, exclusive next midnight, 23/25-hour DST days, cents and status/payment reconciliation verified over HTTP');
  await db.query("insert into shifts(created_at,opened_at,total_sales,total_expenses,difference,user_name) select '2025-02-12T18:00:00Z','2025-02-11T18:00:00Z',35,1.25,-0.10,'Prueba sintética de reportes' from generate_series(1,1103)");
  const shifts=ok(await admin.rpc('pos_shift_history',params));assert.deepEqual(shifts.summary,{rows:1103,sales:38605,expenses:1378.75,difference:-110.3});assert.equal(shifts.shifts.length,50);
  pass('Shift history reports 1,103 closings with complete sales/expense/difference totals by closing date');
  const members=Array.from({length:1103},()=>randomUUID());
  await db.query("insert into customers(id,name,points,total_spent) select unnest($1::uuid[]),'Cliente sintético de reportes',42,9999",[members]);
  for(const [status,total] of [['completed',35.10],['completed',0.20],['cancelled',9999],['pending',9999]])await db.query("insert into orders(customer_id,subtotal,total,status,created_at) values($1,$2,$2,$3,'2025-02-14T18:00:00Z')",[members[0],total,status]);
  const customers=ok(await admin.rpc('pos_customer_report',{p_search:'Cliente sintético de reportes'}));
  assert.deepEqual(customers.summary,{rows:1103,sales:35.3});assert.equal(customers.customers.length,50);assert.equal(customers.customers[0].completed_spent,35.3);assert.equal(customers.customers[0].points,42);
  assert.equal(ok(await admin.rpc('pos_customer_report',{p_search:'Cliente sintético de reportes',p_page:22})).customers.length,3);
  pass('Customer ranking covers 1,103 members and sums completed orders, excluding canceled/pending spend without rewriting loyalty balances');
  return {range:'2025-02-12',completed:report.summary.completed,records:report.summary.rows,sales:report.summary.sales,
    customers:customers.summary,allMenuReceipt:{id:receipt.id,total:receipt.total,presentations:82},shifts:shifts.summary,searchFixture:{ticket:991100,product:search}};
}
