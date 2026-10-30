import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Runs only inside the disposable local database established by test-database.
// No hosted service, real register, actual customer or printer is accessed.
export async function multiItemDatabaseCases(db,connection,ids) {
  const fixture=JSON.parse(await readFile(new URL('../../tests/fixtures/multi-item-order.json',import.meta.url),'utf8'));
  let checks=0;
  const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const staff=await connection('authenticated',ids.cashier),parallel=await connection('authenticated',ids.cashier);
  const open=(await db.query("select id from cash_registers where opened_by=$1 and status='open'",[ids.cashier])).rows[0]
    ??(await staff.query('select pos_open_shift($1,0,20) result',[randomUUID()])).rows[0].result;
  for(const product of fixture.products)await db.query(
    'insert into products(id,name,price,stock,category,is_active,customizable,wizard_steps,inventory_mode) values($1,$2,$3,$4,$5,true,true,$6,\'product\')',
    [product.id,product.name,product.price,product.stock,product.category,product.wizard_steps]);
  for(const extra of fixture.extras)await db.query('insert into extras(id,name,price,phase,active) values($1,$2,$3,$4,true)',[extra.id,extra.name,extra.price,extra.phase]);
  const captured=process.env.POS_MULTI_ITEM_EVIDENCE?JSON.parse(await readFile(process.env.POS_MULTI_ITEM_EVIDENCE,'utf8')):null;
  const payload={...(captured?.payload??{items:fixture.expectedLines,expected_total:425,payment_method:'tarjeta',tender_mxn:0,tender_usd:0,
    customer_id:null,order_type:'Para Llevar',order_note:'entregar juntos'}),register_id:open.id};
  equal(payload.items,fixture.expectedLines);equal(payload.expected_total,425);
  const request=randomUUID();
  const rpc=async(client,key,value)=>(await client.query('select pos_checkout($1,$2) result',[key,value])).rows[0].result;
  const receipt=await rpc(staff,request,payload);
  equal(receipt.total,425);equal(receipt.items.length,3);equal(receipt.items.map(item=>item.quantity),[2,1,1]);
  equal(receipt.items.map(item=>item.product.price),[110,95,110]);
  equal(receipt.items.map(item=>item.product.note),fixture.expectedLines.map(line=>line.note));
  equal(receipt.items.map(item=>item.product.displayExtras.map(extra=>extra.id)),fixture.expectedLines.map(line=>line.extra_ids));
  equal(receipt.order_note,payload.order_note);equal(receipt.order_type,payload.order_type);
  equal((await db.query('select stock from products where id=any($1::uuid[]) order by id',[fixture.products.map(p=>p.id)])).rows.map(row=>row.stock),[17,19]);
  equal((await db.query('select quantity,unit_price::float8 price from order_items where order_id=$1 order by product_snapshot->>\'note\'',[receipt.id])).rows,
    [{quantity:1,price:95},{quantity:2,price:110},{quantity:1,price:110}]);
  const stock=async()=>JSON.stringify((await db.query('select id,stock from products where id=any($1::uuid[]) order by id',[fixture.products.map(p=>p.id)])).rows);
  const beforeRetry=await stock();
  for(const retry of await Promise.all([rpc(staff,request,payload),rpc(parallel,request,payload)]))equal(retry,receipt);
  equal(await stock(),beforeRetry);
  equal((await db.query('select count(*)::int count from orders where cashier_id=$1 and request_id=$2',[ids.cashier,request])).rows[0].count,1);
  equal((await db.query('select count(*)::int count from order_items where order_id=$1',[receipt.id])).rows[0].count,3);
  const beforeBad=await stock();
  await assert.rejects(rpc(staff,randomUUID(),{...payload,items:[payload.items[0],{...payload.items[1],extra_ids:[randomUUID()]},payload.items[2]]}));checks++;
  equal(await stock(),beforeBad);
  await assert.rejects(rpc(staff,request,{...payload,order_note:'changed after confirmation'}));checks++;
  // The catalog can change tomorrow; replay and print must retain today's sale.
  await db.query('update products set price=999 where id=any($1::uuid[])',[fixture.products.map(p=>p.id)]);
  equal(await rpc(staff,request,payload),receipt);
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../../lib/sale-printing.ts',import.meta.url))],bundle:true,
    platform:'node',format:'esm',write:false});
  const {saleDocuments}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const documents=saleDocuments(receipt,{testOnly:true});
  equal(documents.customer.sections.length,1);equal(documents.barista.sections.length,4);
  equal(documents.barista.sections.map(lines=>lines[1]),['Iced coffee caramelo','Iced coffee caramelo','Iced coffee caramelo','Iced coffee vainilla']);
  equal(documents.barista.sections.map(lines=>lines.find(line=>['sin hielo','extra hielo','sin tapa'].includes(line))),['sin hielo','sin hielo','extra hielo','sin tapa']);
  equal(documents.barista.sections.map(lines=>lines.find(line=>['Leche de avena','Entera','Almendra'].includes(line))),['Leche de avena','Leche de avena','Entera','Almendra']);
  equal(documents.barista.sections.map(lines=>lines.at(-1).match(/(\d\/4)/)[1]),['1/4','2/4','3/4','4/4']);
  if(process.env.POS_MULTI_ITEM_DB_EVIDENCE)await writeFile(process.env.POS_MULTI_ITEM_DB_EVIDENCE,JSON.stringify({scope:'Actual UI payload through actual pos_checkout SQL in disposable local PostgreSQL',
    exactUiPayloadUsed:Boolean(captured),checks,receipt,documents,ordersCreated:1,orderLines:3,cups:4,total:425,retryCreatedDuplicates:false,physicalPrints:0,liveDataAccess:false},null,2));
  console.log(`PASS ${checks} mixed-item database/print-contract checks; one ticket, three lines, four cups, MXN425; no live data`);
  return checks;
}
