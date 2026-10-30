import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function reportDatabaseCases(db, connection, ids) {
  let assertions=0;
  const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
  const admin=await connection('authenticated',ids.admin),cashier=await connection('authenticated',ids.cashier),anon=await connection('anon');
  for(const client of [cashier,anon])for(const sql of ['select pos_sales_report()','select pos_shift_history()','select pos_customer_report()']){
    await assert.rejects(client.query(sql));assertions++;
  }
  const report=async(params={})=>(await admin.query('select pos_sales_report($1,$2,$3,$4,$5,$6) r',
    [params.period??'range',params.from??'2025-02-12',params.to??'2025-02-12',params.search??'',params.page??0,params.asOf??null])).rows[0].r;
  const menu=JSON.parse(await readFile(new URL('../../tests/fixtures/real-menu.json',import.meta.url),'utf8'));
  const fixtures=Array.from({length:1207},(_,i)=>{
    const p=menu.products[i%menu.products.length];
    return {id:randomUUID(),name:p.name,price:p.price_mxn,total:p.price_mxn-(i===0?1.23:0),ticket:990000+i};
  });
  await db.query(`insert into orders(id,cashier_id,subtotal,discount,total,status,payment_method,created_at,ticket_number)
    select (x->>'id')::uuid,$2,(x->>'price')::numeric,case when x->>'ticket'='990000' then 1.23 else 0 end,
      (x->>'total')::numeric,'completed',case when (x->>'ticket')::int%2=0 then 'tarjeta' else 'efectivo' end,
      '2025-02-12T18:00:00Z',(x->>'ticket')::int from jsonb_array_elements($1) x`,[JSON.stringify(fixtures),ids.cashier]);
  await db.query(`insert into order_items(order_id,quantity,unit_price,total_price,product_snapshot)
    select (x->>'id')::uuid,1,(x->>'price')::numeric,(x->>'price')::numeric,jsonb_build_object('name',x->>'name','price',(x->>'price')::numeric)
    from jsonb_array_elements($1) x`,[JSON.stringify(fixtures)]);
  for(const [at,status,total] of [
    ['2025-02-12T05:59:59.999Z','completed',9000],['2025-02-12T06:00:00Z','completed',0.10],
    ['2025-02-13T05:59:59.999Z','completed',0.20],['2025-02-13T06:00:00Z','completed',9000],
    ['2025-02-12T18:00:00Z','pending',9999],['2025-02-12T18:00:00Z','cancelled',9999],
    ['2099-02-12T18:00:00Z','completed',9999],
  ])await db.query('insert into orders(subtotal,total,status,created_at) values($1,$1,$2,$3)',[total,status,at]);
  let r=await report();
  const cents=fixtures.reduce((sum,f)=>sum+Math.round(f.total*100),30);
  eq(r.summary,{rows:1211,completed:1209,pending:1,cancelled:1,sales:cents/100,average:Math.round(cents/1209)/100});
  eq(r.orders.length,50);eq(Date.parse(r.start_at),Date.parse('2025-02-12T06:00:00Z'));eq(Date.parse(r.end_at),Date.parse('2025-02-13T06:00:00Z'));
  eq(Math.round(r.payments.reduce((n,p)=>n+p.total,0)*100),cents);
  const names=new Map();for(const f of fixtures)names.set(f.name,(names.get(f.name)??0)+1);
  const max=Math.max(...names.values());eq(r.top_products[0].quantity,max);
  // Tied timestamps must page by UUID as well; the scalar JSON is never capped.
  const seen=new Set();
  for(let page=0;page<25;page++){
    const p=await report({page,asOf:r.as_of});eq(p.summary,r.summary);
    for(const o of p.orders){assert.ok(!seen.has(o.id));assertions++;seen.add(o.id);}
  }
  eq(seen.size,1211);eq((await report({page:25})).orders,[]);
  const target=fixtures[1100];
  const byTicket=await report({search:'#'+target.ticket});eq(byTicket.summary.completed,1);eq(byTicket.orders[0].id,target.id);
  eq((await report({search:target.id})).summary.completed,1);
  eq((await report({search:'#'})).summary.completed,0);
  eq((await report({search:'%_'})).summary.completed,0);
  const byName=await report({search:target.name.toUpperCase()});
  const matching=fixtures.filter(f=>f.name.toLowerCase().includes(target.name.toLowerCase()));
  eq(byName.summary.completed,matching.length);eq(byName.summary.sales,matching.reduce((s,f)=>s+Math.round(f.total*100),0)/100);
  eq((await report({from:'2024-02-29',to:'2024-02-29'})).summary.sales,0);
  for(const [day,hours] of [['2025-03-09',23],['2025-11-02',25]]){
    const dst=await report({from:day,to:day});eq((Date.parse(dst.end_at)-Date.parse(dst.start_at))/3600000,hours);
  }
  for(const params of [ ['range','2025-02-13','2025-02-12','',0,null],['range',null,null,'',0,null],
    ['all','2025-02-12',null,'',0,null],['bad',null,null,'',0,null],['all',null,null,'',-1,null],
    ['all',null,null,'x'.repeat(101),0,null],['all',null,null,'',0,'2099-01-01'],['all',null,null,null,0,null] ]){
    await assert.rejects(admin.query('select pos_sales_report($1,$2,$3,$4,$5,$6)',params));assertions++;
  }
  // The server clock, not the requesting PC, owns Today. Future rows cannot leak.
  const today=(await admin.query("select pos_sales_report('today') r")).rows[0].r;
  const expected=(await db.query("select coalesce(sum(total),0) total,count(*)::int n from orders where status='completed' and created_at>=$1 and created_at<$2 and created_at<=$3",[today.start_at,today.end_at,today.as_of])).rows[0];
  eq(today.summary.sales,Number(expected.total));eq(today.summary.completed,expected.n);
  eq((await admin.query("select pos_sales_report('all') r")).rows[0].r.orders.some(o=>o.created_at.startsWith('2099')),false);
  // Preserve the creation ceiling across pages: a later sale arrives only after refresh.
  const newId=randomUUID();await db.query("insert into orders(id,subtotal,total,status,created_at) values($1,35,35,'completed',now())",[newId]);
  const stable=(await admin.query("select pos_sales_report('all',null,null,'',0,$1) r",[r.as_of])).rows[0].r;
  eq(stable.orders.some(o=>o.id===newId),false);
  const fresh=(await admin.query("select pos_sales_report('all') r")).rows[0].r;eq(fresh.orders.some(o=>o.id===newId),true);
  // Shift history totals include all pages and use the closing date, not opening.
  await db.query(`insert into shifts(created_at,opened_at,total_sales,total_expenses,difference,user_name)
    select '2025-02-12T18:00:00Z','2025-02-11T18:00:00Z',35,1.25,-0.10,'Prueba sintética' from generate_series(1,1103)`);
  const sh=(await admin.query("select pos_shift_history('range','2025-02-12','2025-02-12') r")).rows[0].r;
  eq(sh.summary,{rows:1103,sales:38605,expenses:1378.75,difference:-110.3});eq(sh.shifts.length,50);
  await db.query('update profiles set is_active=false where id=$1',[ids.admin]);
  await assert.rejects(admin.query('select pos_sales_report()'));assertions++;
  await db.query('update profiles set is_active=true where id=$1',[ids.admin]);
  const members=Array.from({length:1103},()=>randomUUID());
  await db.query("insert into customers(id,name,points,total_spent) select unnest($1::uuid[]),'Reporte sintético',42,9999",[members]);
  for(const [status,total] of [['completed',35.10],['completed',0.20],['cancelled',9999],['pending',9999]]){
    await db.query("insert into orders(customer_id,subtotal,total,status,created_at) values($1,$2,$2,$3,'2025-02-14T18:00:00Z')",[members[0],total,status]);
  }
  const customer=(await admin.query("select pos_customer_report('Reporte sintético') r")).rows[0].r;
  eq(customer.summary,{rows:1103,sales:35.3});eq(customer.customers.length,50);eq(customer.customers[0].completed_spent,35.3);eq(customer.customers[0].points,42);
  eq((await admin.query("select pos_customer_report('Reporte sintético',22) r")).rows[0].r.customers.length,3);
  console.log(`PASS ${assertions} report assertions: 1,207 real-menu sales, complete snapshots, cents/discounts/statuses, pagination, search, Matamoros midnight/DST, closed shifts, access denial.`);
  return assertions;
}
