import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function clipDatabaseCases(db,connection,ids) {
  let checks=0;
  const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const deny=async(fn)=>{await assert.rejects(fn);checks++;};
  const cashier=await connection('authenticated',ids.cashier), parallel=await connection('authenticated',ids.cashier);
  const admin=await connection('authenticated',ids.admin), anon=await connection('anon'), service=await connection('service_role');
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query("update profiles set is_active=true where id=any($1)",[[ids.admin,ids.cashier]]);
  const product=randomUUID(),customer=randomUUID(),register=randomUUID();
  await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,'Café control',50,'Bebidas',true,false,'{}')",[product]);
  await db.query("insert into customers(id,name,points,total_spent) values($1,'Cliente control',50,0)",[customer]);
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,100,20,'open')",[register,ids.cashier]);
  const payload={register_id:register,items:[{product_id:product,quantity:1,extra_ids:[],note:'Sin azúcar'}],expected_total:50,payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:customer,order_type:'En Local',order_note:'Juntos',pager_number:30};
  const rpc=(client,name,args)=>client.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args).then(r=>r.rows[0].r);
  for (const value of [0,31,1.5,'12',true]) await deny(rpc(cashier,'pos_checkout',[randomUUID(),{...payload,pager_number:value}]));
  const ordinary=await rpc(cashier,'pos_checkout',[randomUUID(),payload]);
  equal(ordinary.pager_number,30);equal(ordinary.items[0].product.note,'Sin azúcar');
  const before=(await db.query('select points,total_spent::text from customers where id=$1',[customer])).rows[0];
  const request=randomUUID();
  await deny(rpc(cashier,'pos_clip_prepare',[randomUUID(),{...payload,expected_total:51}]));
  await deny(rpc(anon,'pos_clip_prepare',[request,payload]));
  const [first,replayed]=await Promise.all([rpc(cashier,'pos_clip_prepare',[request,payload]),rpc(parallel,'pos_clip_prepare',[request,payload])]);
  equal(first,replayed);equal(first.state,'prepared');
  equal((await db.query('select points,total_spent::text from customers where id=$1',[customer])).rows[0],before);
  equal((await db.query('select count(*)::int n from orders where request_id=$1',[request])).rows[0].n,0);
  await deny(rpc(cashier,'pos_clip_prepare',[request,{...payload,pager_number:1}]));
  await deny(rpc(admin,'pos_clip_prepare',[request,payload]));
  await deny(rpc(cashier,'pos_clip_prepare',[randomUUID(),payload]));
  await deny(rpc(cashier,'pos_checkout',[request,payload]));
  await deny(rpc(cashier,'pos_checkout',[randomUUID(),payload]));
  await deny(rpc(cashier,'pos_abandon_checkout',[request]));
  await deny(db.query("update cash_registers set status='closed' where id=$1",[register]));
  for(const client of [cashier,admin,anon]) {
    await deny(rpc(client,'pos_clip_get',[request,ids.cashier]));
    await deny(rpc(client,'pos_clip_claim',[request,ids.cashier,'TESTSERIAL']));
    await deny(client.query('select * from cafe_private.clip_payments'));
  }
  await deny(rpc(cashier,'pos_clip_pending',[]));equal((await rpc(admin,'pos_clip_pending',[]))[0].request_id,request);
  equal(await rpc(service,'pos_clip_get',[request,ids.admin]),null);
  equal(await rpc(service,'pos_clip_claim',[request,ids.cashier,'TESTSERIAL']),{claimed:true});
  equal(await rpc(service,'pos_clip_claim',[request,ids.cashier,'TESTSERIAL']),{claimed:false});
  const row=await rpc(service,'pos_clip_get',[request,ids.cashier]),provider='pinpad-'+randomUUID();
  await rpc(service,'pos_clip_notify',[request,randomUUID(),provider]);
  equal((await rpc(service,'pos_clip_get',[request,ids.cashier])).hints,[]);
  await rpc(service,'pos_clip_notify',[request,row.webhook_key,provider]);
  equal((await rpc(service,'pos_clip_get',[request,ids.cashier])).hints,[provider]);
  await rpc(service,'pos_clip_attach',[request,ids.cashier,provider]);
  await deny(rpc(service,'pos_clip_attach',[request,ids.cashier,'pinpad-'+randomUUID()]));
  // Paid sale uses frozen catalog, customer name, preparation and pager.
  await db.query("update products set price=999,name='Nuevo nombre',is_active=false where id=$1",[product]);
  const evidence={reference:'pos-'+request,device:'TESTSERIAL',amount_cents:5000,paid_cents:5000,tip_cents:0,currency:'MXN',status:'COMPLETED',transaction:randomUUID()};
  for(const change of [{paid_cents:4000},{reference:'other'},{device:'other'},{currency:'USD'},{amount_cents:9900},{tip_cents:100},{status:null},{transaction:null}])
    await deny(rpc(service,'pos_clip_settle',[request,ids.cashier,provider,'completed',{...evidence,...change}]));
  const service2=await connection('service_role');
  const [sale,duplicate]=await Promise.all([rpc(service,'pos_clip_settle',[request,ids.cashier,provider,'completed',evidence]),rpc(service2,'pos_clip_settle',[request,ids.cashier,provider,'completed',evidence])]);
  equal(sale,duplicate);equal(sale.total,50);equal(sale.pager_number,30);equal(sale.items[0].product.name,'Café control');
  equal((await db.query('select count(*)::int n from orders where request_id=$1',[request])).rows[0].n,1);
  equal((await db.query('select points from customers where id=$1',[customer])).rows[0].points,before.points+5);
  equal((await rpc(admin,'pos_clip_pending',[])).length,0);
  await deny(rpc(cashier,'pos_abandon_checkout',[request]));
  // A documented unavailable terminal can release its fence, never a timeout.
  await db.query('update products set price=50,is_active=true where id=$1',[product]);
  const failed=randomUUID();await rpc(cashier,'pos_clip_prepare',[failed,payload]);await rpc(service,'pos_clip_claim',[failed,ids.cashier,'TESTSERIAL']);
  await rpc(service,'pos_clip_settle',[failed,ids.cashier,null,'unavailable',{code:'ERR10_04'}]);
  equal((await rpc(service,'pos_clip_get',[failed,ids.cashier])).state,'failed');
  await rpc(cashier,'pos_abandon_checkout',[failed]);
  // Actual gateway + real database RPCs, simulated CLIP only: lost POST response,
  // public webhook delivery, authenticated GET, frozen-price settlement and replay.
  const {ClipGateway}=await import('../../lib/clip-server.ts');
  const {handleClipWebhook}=await import('../../supabase/functions/clip-webhook/index.ts');
  const integration=randomUUID(),integrationProvider='pinpad-'+randomUUID(),transaction=randomUUID();let posts=0;
  await rpc(cashier,'pos_clip_prepare',[integration,{...payload,pager_number:12}]);
  const database={rpc:async(name,args)=>{
    assert.ok(['pos_clip_get','pos_clip_claim','pos_clip_attach','pos_clip_settle','pos_clip_notify'].includes(name));
    const keys=Object.keys(args);assert.ok(keys.every(key=>/^p_[a-z_]+$/.test(key)));
    try {const result=await service.query(`select ${name}(${keys.map((key,index)=>key+'=> $'+(index+1)).join(',')}) result`,Object.values(args));return {data:result.rows[0].result,error:null};}
    catch(error){return {data:null,error:{message:error.message,code:error.code}};}
  }};
  const providerFetch=async(_url,init)=>{
    if(init.method==='POST'){posts++;throw Error('Simulated lost CLIP response');}
    return Response.json({pinpad_request_id:integrationProvider,reference:'pos-'+integration,amount:'50.00',amount_paid:'50.00',tip_amount:'0.00',status:'COMPLETED',
      detail:{pages:{total:1,total_results:1},results:[{transaction_id:transaction,status:'approved',currency:'MXN',amount:50,paid_amount:50,tip_amount:0,amount_refunded:0,device:{id:'TESTSERIAL'}}]}});
  };
  const gateway=new ClipGateway(database,{enabled:true,tokenReady:true,token:'TEST_ONLY_NOT_A_REAL_TOKEN',serial:'TESTSERIAL',webhook:'https://test.invalid/hook'},providerFetch);
  equal((await gateway.start(integration,ids.cashier)).state,'dispatching');
  await gateway.start(integration,ids.cashier);equal(posts,1);
  const stored=await rpc(service,'pos_clip_get',[integration,ids.cashier]);
  const callback=new Request(`https://test.invalid/hook?request=${integration}&key=${stored.webhook_key}`,{method:'POST',body:JSON.stringify({id:integrationProvider,origin:'pinpad-payments-api',event_type:'PINPAD_INTENT_STATUS_CHANGED'})});
  const notification=await handleClipWebhook(callback,key=>key==='SUPABASE_URL'?'https://test.invalid':'test-only-service',async(_url,init)=>{
    const args=JSON.parse(init.body);await database.rpc('pos_clip_notify',args);return new Response(null,{status:204});
  });equal(notification.status,200);
  await db.query('update products set price=150 where id=$1',[product]);
  const verified=await gateway.status(integration,ids.cashier);equal(verified.state,'completed');equal(verified.order.total,50);equal(verified.order.pager_number,12);
  equal((await gateway.status(integration,ids.cashier)).order.id,verified.order.id);equal(posts,1);
  equal((await db.query('select count(*)::int n from orders where request_id=$1',[integration])).rows[0].n,1);
  const backup=JSON.parse(await rpc(service,'pos_business_backup',[]));
  equal(backup.tables['cafe_private.clip_payments'].rows.some(row=>row.request_id===integration&&row.state==='completed'),true);
  equal(backup.tables['cafe_private.clip_webhook_hints'].rows.some(row=>row.request_id===integration),true);
  await db.query("update cash_registers set status='closed' where id=$1",[register]);checks++;
  console.log(`PASS ${checks} CLIP/pager database assertions: permissions, frozen quote, at-most-once dispatch, replay, payment/close fences, verified settlement and loyalty`);
  return checks;
}
