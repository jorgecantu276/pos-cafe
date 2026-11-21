import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {usdCashQuote,receivedCashMXN} from '../../lib/usd-cash.ts';
import {saleDocuments} from '../../lib/sale-printing.ts';

// Only called by the owned disposable PostgreSQL runner. Never a hosted target.
export async function wholeUsdDatabaseCases(db,connection){
  let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const owner=randomUUID(),product=randomUUID();
  await db.query('insert into auth.users values($1)',[owner]);
  await db.query("insert into profiles(id,full_name,username,role) values($1,'USD sintético',$2,'cashier')",[owner,'usd-'+owner]);
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,'Rebanada cheesecake',130,'Postres',true,false,'{}')",[product]);
  const cashier=await connection('authenticated',owner),parallel=await connection('authenticated',owner);
  const rpc=async(client,key,payload)=>(await client.query('select pos_checkout($1,$2) r',[key,payload])).rows[0].r;
  const scenarios=[
    {total:130,rate:16,usd:9,mxn:0,change:14},
    {total:128.16,rate:16,usd:9,mxn:0,change:15.84},
    {total:128,rate:16,usd:8,mxn:0,change:0},
    {total:130,rate:16,usd:20,mxn:0,change:190},
    {total:130,rate:16,usd:5,mxn:50,change:0},
    {total:30.60,rate:10.20,usd:3,mxn:0,change:0},
    {total:130,rate:15.075,usd:9,mxn:0,change:5.68},
  ];
  for(const scenario of scenarios){
    const {total,rate,usd,mxn,change}=scenario,register=randomUUID(),key=randomUUID();
    await db.query('update products set price=$2 where id=$1',[product,total]);
    await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,1000,$3,'open')",[register,owner,rate]);
    const payload={register_id:register,items:[{product_id:product,quantity:1,extra_ids:[],note:''}],expected_total:total,
      payment_method:'mixto',tender_mxn:mxn,tender_usd:usd,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:12};
    const [receipt,duplicate]=await Promise.all([rpc(cashier,key,payload),rpc(parallel,key,payload)]);
    equal(duplicate,receipt);equal(receipt.total,total);equal(receipt.tender_mxn,mxn);equal(receipt.tender_usd,usd);
    equal(receipt.exchange_rate,rate);equal(receipt.change_mxn,change);
    equal(Math.round((receivedCashMXN(mxn,usd,rate)-total)*100)/100,change);
    const row=(await db.query('select total,subtotal,discount,tender_mxn,tender_usd,change_mxn,round(tender_mxn+tender_usd*exchange_rate-change_mxn,2) net,receipt_snapshot from orders where id=$1',[receipt.id])).rows[0];
    equal(Number(row.total),total);equal(Number(row.subtotal),total);equal(Number(row.discount),0);equal(Number(row.net),total);
    equal(row.receipt_snapshot.total,total);equal(row.receipt_snapshot.change_mxn,change);
    equal(Number((await db.query('select sum(total_price) total from order_items where order_id=$1',[receipt.id])).rows[0].total),total);
    equal((await db.query('select count(*)::int n from orders where register_id=$1',[register])).rows[0].n,1);
    const text=saleDocuments(receipt).customer.sections[0];
    equal(text.includes(`TOTAL: $${total.toFixed(2)} MXN`),true);
    equal(text.includes(`Recibido USD: $${usd.toFixed(2)} · TC ${rate.toFixed(4)}`),true);
    equal(text.includes(`Cambio: $${change.toFixed(2)}`),true);
    const summary=(await cashier.query('select pos_shift_summary($1) r',[register])).rows[0].r;
    equal(summary.total_sales,total);equal(summary.cash_sales,total);equal(summary.payments.mixto,total);equal(summary.expected_cash,1000+total);
    await assert.rejects(rpc(cashier,randomUUID(),{...payload,expected_total:total+1}));checks++;
    equal((await cashier.query('select pos_shift_summary($1) r',[register])).rows[0].r,summary);
    const closed=(await cashier.query('select pos_close_shift($1,$2,$3,$4) r',[register,1000+total,'[]',summary])).rows[0].r;
    equal(closed.total_sales,total);equal(closed.expected_cash,1000+total);equal(closed.difference,0);
    equal(await rpc(cashier,key,payload),receipt);
  }
  // The accepted MXN phone quote survives a later shift/rate and catalog edits.
  await db.query('update products set price=130 where id=$1',[product]);
  const items=[{product_id:product,quantity:1,extra_ids:[],note:'Salsa aparte'}];
  const phone=(await cashier.query('select pos_phone_save($1,$2) r',[randomUUID(),{items,expected_total:130,customer_id:null,contact_name:'Ana USD',contact_phone:'8682345678',order_type:'Para Llevar',order_note:''}])).rows[0].r;
  equal(usdCashQuote(phone.snapshot.total,16),{usd:9,changeMXN:14});
  const register=randomUUID();await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,1000,20,'open')",[register,owner]);
  await db.query('update products set price=999 where id=$1',[product]);
  const quote=usdCashQuote(phone.snapshot.total,20);equal(quote,{usd:7,changeMXN:10});
  const key=randomUUID(),payload={register_id:register,items,expected_total:130,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:null,
    phone_order_id:phone.id,phone_order_revision:phone.revision,payment_method:'mixto',tender_mxn:0,tender_usd:quote.usd};
  const paid=await rpc(cashier,key,payload);equal(paid.total,130);equal(paid.tender_usd,7);equal(paid.exchange_rate,20);equal(paid.change_mxn,10);
  equal(paid.phone_order_id,phone.id);equal(await rpc(cashier,key,payload),paid);
  const summary=(await cashier.query('select pos_shift_summary($1) r',[register])).rows[0].r;equal(summary.total_sales,130);equal(summary.expected_cash,1130);
  await cashier.query('select pos_close_shift($1,1130,$2,$3)',[register,'[]',summary]);
  console.log(`PASS ${checks} whole-USD accounting checks: original MXN revenue, actual tenders, peso change, decimal rates, concurrent replay, receipts, shift close and phone pickup`);
  return checks;
}
