import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClipGateway } from '../../lib/clip-server.ts';

// This runner owns a disposable PostgreSQL instance. Providers and printing are simulated.
export async function splitPaymentDatabaseCases(db, connection) {
  let checks = 0;
  const equal = (a,b) => { assert.deepEqual(a,b); checks++; };
  const deny = async action => { await assert.rejects(action); checks++; };
  const owner=randomUUID(), manager=randomUUID(), product=randomUUID();
  for (const [id,role] of [[owner,'cashier'],[manager,'admin']]) {
    await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into profiles(id,full_name,username,role) values($1,$2,$2,$3)',[id,'split-'+id,role]);
  }
  const cashier=await connection('authenticated',owner), parallel=await connection('authenticated',owner),admin=await connection('authenticated',manager),service=await connection('service_role');
  const rpc=async (client,name,args=[]) => (await client.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,'Mixed payment synthetic',100,'Bebidas',true,false,'{}')",[product]);
  const register=randomUUID();
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,100,20,'open')",[register,owner]);
  const payload={register_id:register,items:[{product_id:product,quantity:1,extra_ids:[],note:''}],expected_total:100,
    payment_method:'efectivo_tarjeta',card_amount_mxn:60,tender_mxn:50,tender_usd:0,customer_id:null,order_type:'En Local',order_note:'',pager_number:3};
  for (const patch of [{card_amount_mxn:0},{card_amount_mxn:-1},{card_amount_mxn:100},{card_amount_mxn:101},{card_amount_mxn:null},
    {card_amount_mxn:0.001},{card_amount_mxn:'NaN'},{card_amount_mxn:'Infinity'},{tender_usd:1},{tender_mxn:39.99},
    {tender_mxn:40.001},{tender_mxn:'NaN'},{payment_method:'tarjeta'},{payment_method:'efectivo'}]) {
    await deny(rpc(cashier,'pos_checkout',[randomUUID(),{...payload,...patch}]));
    await deny(rpc(cashier,'pos_clip_prepare',[randomUUID(),{...payload,...patch}]));
  }
  const key=randomUUID();
  const [sale,replay]=await Promise.all([rpc(cashier,'pos_checkout',[key,payload]),rpc(parallel,'pos_checkout',[key,payload])]);
  equal(replay,sale);equal(sale.total,100);equal(sale.card_amount_mxn,60);equal(sale.tender_mxn,50);equal(sale.change_mxn,10);equal(sale.payment_method,'efectivo_tarjeta');
  equal((await db.query('select count(*)::int n from orders where request_id=$1',[key])).rows[0].n,1);
  const saved=(await db.query('select card_amount_mxn,tender_mxn,change_mxn,receipt_snapshot from orders where id=$1',[sale.id])).rows[0];
  equal(Number(saved.card_amount_mxn),60);equal(Number(saved.tender_mxn)-Number(saved.change_mxn),40);equal(saved.receipt_snapshot.card_amount_mxn,60);
  await deny(rpc(cashier,'pos_checkout',[key,{...payload,card_amount_mxn:61}]));
  const summary=await rpc(cashier,'pos_shift_summary',[register]);
  equal(summary.total_sales,100);equal(summary.cash_sales,40);equal(summary.expected_cash,140);equal(summary.payments,{efectivo:40,tarjeta:60});
  const report=await rpc(admin,'pos_sales_report',['all',null,null,sale.id]);
  equal(report.payments,[{name:'Tarjeta',total:60},{name:'Efectivo',total:40}]);equal(report.orders[0].card_amount_mxn,60);
  // Cancellation removes both portions. No stored receipt is rewritten.
  await rpc(admin,'pos_cancel_sale',[sale.id]);
  const canceled=await rpc(cashier,'pos_shift_summary',[register]);equal(canceled.total_sales,0);equal(canceled.cash_sales,0);equal(canceled.expected_cash,100);equal(canceled.payments,{});
  equal((await db.query('select receipt_snapshot from orders where id=$1',[sale.id])).rows[0].receipt_snapshot,saved.receipt_snapshot);
  // Exact cents and cash overpayment both use net cash, never the full order total.
  const cent=await rpc(cashier,'pos_checkout',[randomUUID(),{...payload,card_amount_mxn:60.01,tender_mxn:39.99}]);equal(cent.change_mxn,0);
  // Historical `mixto` is still two cash currencies with no card component.
  const legacy=await rpc(cashier,'pos_checkout',[randomUUID(),{...payload,payment_method:'mixto',card_amount_mxn:0,tender_mxn:0,tender_usd:5}]);equal(legacy.total,100);equal(legacy.card_amount_mxn,0);
  const prior=await rpc(cashier,'pos_shift_summary',[register]);equal(prior.cash_sales,139.99);equal(prior.payments,{efectivo:39.99,mixto:100,tarjeta:60.01});
  // CLIP persists the whole sale and charges only the card portion once, including lost response recovery.
  const request=randomUUID(), provider='pinpad-'+randomUUID(),transaction=randomUUID();let posts=0;let providerAmount;
  await rpc(cashier,'pos_clip_prepare',[request,payload]);
  await deny(rpc(cashier,'pos_clip_prepare',[request,{...payload,card_amount_mxn:70}]));
  const quote=(await rpc(service,'pos_clip_get',[request,owner])).quote;
  equal(quote.total,100);equal(quote.card_amount_mxn,60);equal(quote.change_mxn,10);equal(quote.payment_method,'efectivo_tarjeta');
  await deny(rpc(cashier,'pos_close_shift',[register,239.99,'[]',prior]));
  await deny(rpc(cashier,'pos_abandon_checkout',[request]));
  const database={rpc:async(name,args)=>{
    try {return {data:await rpc(service,name,Object.values(args)),error:null};}
    catch(error) {return {data:null,error:{message:error.message,code:error.code}};}
  }};
  const gateway=new ClipGateway(database,{enabled:true,tokenReady:true,token:'TEST_ONLY',serial:'SPLITTEST',webhook:'https://test.invalid/hook'},async(_url,init)=>{
    if (init.method==='POST') {posts++;providerAmount=JSON.parse(init.body).amount;throw Error('Lost simulated response');}
    return Response.json({pinpad_request_id:provider,reference:'pos-'+request,amount:'60.00',amount_paid:'60.00',tip_amount:'0.00',status:'COMPLETED',
      detail:{pages:{total:1,total_results:1},results:[{transaction_id:transaction,status:'approved',currency:'MXN',amount:60,paid_amount:60,tip_amount:0,amount_refunded:0,device:{id:'SPLITTEST'}}]}});
  });
  equal((await gateway.start(request,owner)).state,'dispatching');equal(providerAmount,'60.00');equal(posts,1);
  await gateway.start(request,owner);equal(posts,1);
  await rpc(service,'pos_clip_attach',[request,owner,provider]);
  await db.query('update products set price=999 where id=$1',[product]);
  const completed=await gateway.status(request,owner);equal(completed.state,'completed');equal(completed.order.total,100);equal(completed.order.card_amount_mxn,60);equal(completed.order.change_mxn,10);
  equal((await gateway.status(request,owner)).order,completed.order);equal(posts,1);
  equal((await db.query('select count(*)::int n from orders where request_id=$1',[request])).rows[0].n,1);
  equal((await rpc(cashier,'pos_shift_summary',[register])).cash_sales,179.99);
  await deny(rpc(cashier,'pos_checkout',[request,payload]));
  // Phone pickup keeps the agreed quote even after catalog changes, for manual and automatic card portions.
  await db.query('update products set price=100 where id=$1',[product]);
  for (const automatic of [false,true]) {
    const phone=await rpc(cashier,'pos_phone_save',[randomUUID(),{items:payload.items,expected_total:100,customer_id:null,contact_name:'Cliente mixto',contact_phone:'8682345678',order_type:'Para Llevar',order_note:''}]);
    const phonePayload={...payload,phone_order_id:phone.id,phone_order_revision:phone.revision,pager_number:null};
    await db.query('update products set price=999 where id=$1',[product]);
    const phoneRequest=randomUUID();let receipt;
    if (!automatic) receipt=await rpc(cashier,'pos_checkout',[phoneRequest,phonePayload]);
    else {
      await rpc(cashier,'pos_clip_prepare',[phoneRequest,phonePayload]);await rpc(service,'pos_clip_claim',[phoneRequest,owner,'SPLITTEST']);
      const phoneProvider='pinpad-'+randomUUID();await rpc(service,'pos_clip_attach',[phoneRequest,owner,phoneProvider]);
      await deny(rpc(service,'pos_clip_settle',[phoneRequest,owner,phoneProvider,'completed',{reference:'pos-'+phoneRequest,device:'SPLITTEST',amount_cents:10000,paid_cents:10000,tip_cents:0,currency:'MXN',status:'COMPLETED',transaction:randomUUID()}]));
      receipt=await rpc(service,'pos_clip_settle',[phoneRequest,owner,phoneProvider,'completed',{reference:'pos-'+phoneRequest,device:'SPLITTEST',amount_cents:6000,paid_cents:6000,tip_cents:0,currency:'MXN',status:'COMPLETED',transaction:randomUUID()}]);
    }
    equal(receipt.total,100);equal(receipt.phone_order_id,phone.id);equal(receipt.card_amount_mxn,60);equal(receipt.change_mxn,10);equal(receipt.payment_method,'efectivo_tarjeta');
    equal((await rpc(cashier,'pos_phone_get',[phone.id])).status,'paid');
    await db.query('update products set price=100 where id=$1',[product]);
  }
  const finalSummary=await rpc(cashier,'pos_shift_summary',[register]);equal(finalSummary.total_sales,500);equal(finalSummary.cash_sales,259.99);equal(finalSummary.expected_cash,359.99);
  const closed=await rpc(cashier,'pos_close_shift',[register,359.99,'[]',finalSummary]);equal(closed.expected_cash,359.99);equal(closed.difference,0);equal(closed.payments,finalSummary.payments);
  equal((await rpc(cashier,'pos_closed_shift',[closed.id])).payments,finalSummary.payments);
  equal(await rpc(cashier,'pos_checkout',[key,payload]),{...sale,status:'cancelled'});
  // Manager closure stores the same immutable payment amounts as an ordinary cut.
  const managerRegister=randomUUID();
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,10,20,'open')",[managerRegister,owner]);
  await rpc(cashier,'pos_checkout',[randomUUID(),{...payload,register_id:managerRegister}]);
  const managerSummary=await rpc(admin,'pos_shift_summary',[managerRegister]);
  const managed=await rpc(admin,'pos_manager_close_drawer',[randomUUID(),{register:managerRegister,counted:50,count_confirmed:true,reason:'Cierre supervisado sintético',preview:managerSummary}]);
  equal(managed.report.payments,{efectivo:40,tarjeta:60});equal(managed.report.expected_cash,50);equal(managed.report.difference,0);
  const backup=JSON.parse(await rpc(service,'pos_business_backup'));
  const backupSale=backup.tables['public.orders'].rows.find(row=>row.id===completed.order.id);
  const backupCut=backup.tables['public.shifts'].rows.find(row=>row.id===closed.id);
  equal(backupSale.card_amount_mxn,60);equal(backupSale.receipt_snapshot.card_amount_mxn,60);equal(backupCut.payments,finalSummary.payments);
  equal(Number((await db.query('select (jsonb_populate_record(null::public.orders,$1)).card_amount_mxn card',[backupSale])).rows[0].card),60);
  equal((await db.query('select (jsonb_populate_record(null::public.shifts,$1)).payments payments',[backupCut])).rows[0].payments,finalSummary.payments);
  console.log(`PASS ${checks} mixed cash/card database and gateway checks: precision, drawer, frozen cuts, reports, cancellation, replay, single partial charge and phone pickup`);
  return checks;
}
