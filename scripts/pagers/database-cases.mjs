import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function requiredPagerDatabaseCases(db,connection,migration) {
  let checks=0;
  const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const deny=async(action,pattern)=>{await assert.rejects(action,pattern);checks++;};
  const actor=randomUUID(),register=randomUUID(),product=randomUUID(),customer=randomUUID();
  await db.query('insert into auth.users values($1)',[actor]);
  await db.query("insert into profiles(id,full_name,username,role) values($1,'Control obligatorio',$2,'cashier')",[actor,'pager-'+actor]);
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,100,16,'open')",[register,actor]);
  await db.query("insert into products(id,name,price,is_active,customizable,wizard_steps) values($1,'Bebida de control',50,true,false,'{}')",[product]);
  await db.query("insert into customers(id,name,points,total_spent) values($1,'Cliente de control',50,0)",[customer]);
  const cash=await connection('authenticated',actor),service=await connection('service_role');
  const rpc=(client,name,args)=>client.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args).then(r=>r.rows[0].r);
  const payload={register_id:register,items:[{product_id:product,quantity:1,extra_ids:[],note:''}],expected_total:50,
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:customer,order_type:'Para Llevar',order_note:''};
  // Save real old-version requests, rather than fabricating new historical snapshots.
  const legacy=[];
  for(const old of [payload,{...payload,pager_number:null}]) {
    const key=randomUUID(),sale=await rpc(cash,'pos_checkout',[key,old]);legacy.push({key,payload:old,sale});
  }
  const oldPayment=randomUUID(),oldPayload={...payload,pager_number:null};
  const oldPrepared=await rpc(cash,'pos_clip_prepare',[oldPayment,oldPayload]);
  await db.query(migration);
  equal(await rpc(cash,'pos_clip_prepare',[oldPayment,oldPayload]),oldPrepared);
  await deny(rpc(cash,'pos_clip_prepare',[oldPayment,{...oldPayload,pager_number:1}]),/identidad/);
  await rpc(service,'pos_clip_claim',[oldPayment,actor,'PAGER-TEST']);
  const provider='pinpad-'+randomUUID();await rpc(service,'pos_clip_attach',[oldPayment,actor,provider]);
  const evidence={reference:'pos-'+oldPayment,device:'PAGER-TEST',amount_cents:5000,paid_cents:5000,tip_cents:0,currency:'MXN',status:'COMPLETED',transaction:randomUUID()};
  const settled=await rpc(service,'pos_clip_settle',[oldPayment,actor,provider,'completed',evidence]);
  equal(settled.pager_number,null);
  equal(await rpc(service,'pos_clip_settle',[oldPayment,actor,provider,'completed',evidence]),settled);
  equal((await db.query('select count(*)::int n from orders where request_id=$1',[oldPayment])).rows[0].n,1);
  for(const old of legacy) {
    equal(await rpc(cash,'pos_checkout',[old.key,old.payload]),old.sale);
    await deny(rpc(cash,'pos_checkout',[old.key,{...old.payload,pager_number:1}]),/reutilizada/);
  }
  const fingerprint=async()=>JSON.stringify((await db.query(`select
    (select jsonb_agg(to_jsonb(o) order by id) from orders o where cashier_id=$1) orders,
    (select to_jsonb(c) from customers c where id=$2) customer,
    (select jsonb_agg(to_jsonb(p) order by request_id) from cafe_private.clip_payments p where actor_id=$1) payments,
    (select count(*) from cafe_private.inventory_reservations) reservations,
    (select count(*) from pos_inventory_movements) movements`,[actor,customer])).rows[0]);
  const before=await fingerprint();
  for(const pager of [undefined,null,0,31,1.5,'12',true]) {
    const request={...payload,...(pager===undefined?{}:{pager_number:pager})};
    await deny(rpc(cash,'pos_checkout',[randomUUID(),request]),/control/);
    await deny(rpc(cash,'pos_clip_prepare',[randomUUID(),request]),/pedido y el control/);
    equal(await fingerprint(),before);
  }
  for(const [method,pager] of [['efectivo',1],['mixto',30],['tarjeta',1],['otro',30]]) {
    const request={...payload,payment_method:method,pager_number:pager,tender_mxn:['efectivo','mixto'].includes(method)?50:0};
    const key=randomUUID(),sale=await rpc(cash,'pos_checkout',[key,request]);
    equal(sale.pager_number,pager);equal(await rpc(cash,'pos_checkout',[key,request]),sale);
  }
  for(const pager of [1,30]) {
    const key=randomUUID();equal((await rpc(cash,'pos_clip_prepare',[key,{...payload,pager_number:pager}])).state,'prepared');
    await rpc(service,'pos_clip_claim',[key,actor,'PAGER-TEST']);
    await rpc(service,'pos_clip_settle',[key,actor,null,'unavailable',{code:'ERR10_04'}]);
  }
  console.log(`PASS ${checks} required-pager assertions: new-sale validation, no rejected side effects, all payment methods, historic replay and pre-upgrade CLIP settlement`);
  return checks;
}
