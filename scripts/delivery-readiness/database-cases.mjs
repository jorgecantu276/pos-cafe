import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function deliveryReadinessDatabaseCases(db,connection,ids,migration) {
  let checks=0;
  const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const deny=async(p,pattern)=>{await assert.rejects(p,pattern);checks++;};
  const rpc=async(c,name,args=[])=>(await c.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].result;
  await db.query(migration);
  const actor=randomUUID(),secondAdmin=randomUUID(),profile=randomUUID(),product=randomUUID();
  for(const [id,role] of [[actor,'cashier'],[secondAdmin,'admin'],[profile,'cashier']]) {
    await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into profiles(id,full_name,username,role) values($1,$2,$3,$4)',[id,'Entrega '+role,'delivery-'+id,role]);
  }
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query('update pos_inventory_settings set enabled=false');
  await db.query("insert into products(id,name,price,is_active,customizable,wizard_steps) values($1,'Venta recuperación 020',50,true,false,'{}')",[product]);
  const owner=await connection('authenticated',ids.admin),owner2=await connection('authenticated',secondAdmin),cash=await connection('authenticated',actor),anon=await connection('anon'),service=await connection('service_role');
  const register=randomUUID();await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,0,16,'open')",[register,actor]);
  const payload={register_id:register,items:[{product_id:product,quantity:1,extra_ids:[],note:''}],expected_total:50,payment_method:'efectivo',tender_mxn:50,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'Recuperación 020',pager_number:1};
  const key=randomUUID(),sale=await rpc(cash,'pos_checkout',[key,payload]);
  await rpc(owner,'pos_cancel_sale',[sale.id]);
  const summary=await rpc(cash,'pos_shift_summary',[register]);await rpc(cash,'pos_close_shift',[register,0,[],summary]);
  await rpc(owner,'pos_cancel_sale',[sale.id]);checks++;
  equal((await db.query('select status from orders where id=$1',[sale.id])).rows[0].status,'cancelled');
  equal(await rpc(cash,'pos_checkout',[key,payload]),{...sale,status:'cancelled'});
  // A fresh cancellation of a completed closed-shift sale remains forbidden.
  const historical=randomUUID();await db.query("insert into orders(id,register_id,cashier_id,subtotal,total,payment_method,status) values($1,$2,$3,50,50,'efectivo','completed')",[historical,register,actor]);
  await deny(rpc(owner,'pos_cancel_sale',[historical]),/turno está cerrado/);
  const active=randomUUID();await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,0,16,'open')",[active,actor]);
  const manual={...payload,register_id:active},manualKey=randomUUID(),receipt=await rpc(cash,'pos_checkout',[manualKey,manual]);
  const clipKey=randomUUID(),clipPayload={...manual,payment_method:'tarjeta',tender_mxn:0};
  await rpc(cash,'pos_clip_prepare',[clipKey,clipPayload]);
  equal(await rpc(cash,'pos_checkout',[manualKey,manual]),receipt);
  await deny(rpc(cash,'pos_checkout',[manualKey,{...manual,order_note:'Changed'}]),/otra venta/);
  await deny(rpc(cash,'pos_checkout',[randomUUID(),manual]),/CLIP/);
  await deny(rpc(cash,'pos_checkout',[clipKey,clipPayload]),/CLIP/);
  equal((await db.query('select count(*)::int n from orders where cashier_id=$1 and register_id=$2',[actor,active])).rows[0].n,1);
  await rpc(service,'pos_clip_claim',[clipKey,actor,'DELIVERY-TEST']);
  await rpc(service,'pos_clip_settle',[clipKey,actor,null,'unavailable',{code:'ERR10_04'}]);
  // The same CLIP identity remains forbidden after provider failure/completion.
  await deny(rpc(cash,'pos_checkout',[clipKey,clipPayload]),/CLIP/);
  equal((await db.query('select count(*)::int n from orders where cashier_id=$1 and register_id=$2',[actor,active])).rows[0].n,1);

  const fields={name:'Producto reversible',price:80,category:'Bebidas',customizable:false,image_url:'',wizard_steps:[]};
  const create={actor_id:ids.admin,kind:'product',action:'save',id:null,fields};
  const catalogKey=randomUUID(),created=await rpc(owner,'pos_save_catalog',[catalogKey,create]);
  equal(created.revision,0);equal(await rpc(owner,'pos_save_catalog',[catalogKey,create]),created);
  const target=created.id;
  const historicalSale=await rpc(cash,'pos_checkout',[randomUUID(),{...manual,items:[{product_id:target,quantity:1,extra_ids:[],note:''}],expected_total:80,tender_mxn:80}]);
  const disabled={actor_id:ids.admin,kind:'product',action:'deactivate',id:target,revision:0};
  const deactivated=await rpc(owner,'pos_save_catalog',[randomUUID(),disabled]);equal(deactivated.revision,1);
  const activate={actor_id:ids.admin,kind:'product',action:'reactivate',id:target,revision:1};
  for(const client of [cash,anon]) await deny(rpc(client,'pos_save_catalog',[randomUUID(),activate]));
  await deny(rpc(owner,'pos_save_catalog',[randomUUID(),{...activate,revision:0}]),/catálogo cambió/);
  const missingRevision={...activate};delete missingRevision.revision;
  await deny(rpc(owner,'pos_save_catalog',[randomUUID(),missingRevision]),/catálogo cambió/);
  const activateKey=randomUUID(),activated=await rpc(owner,'pos_save_catalog',[activateKey,activate]);
  equal(activated.revision,2);equal(activated.id,target);equal(await rpc(owner,'pos_save_catalog',[activateKey,activate]),activated);
  equal((await db.query('select is_active,catalog_revision from products where id=$1',[target])).rows[0],{is_active:true,catalog_revision:'2'});
  await deny(rpc(owner,'pos_save_catalog',[activateKey,{...activate,revision:2}]),/otros datos/);
  await deny(rpc(owner2,'pos_save_catalog',[activateKey,{...activate,actor_id:secondAdmin}]),/otro responsable/);
  await deny(rpc(owner,'pos_save_catalog',[randomUUID(),{...create,id:target,revision:1,fields:{...fields,price:90}}]),/catálogo cambió/);
  const saveKey=randomUUID(),saved=await rpc(owner,'pos_save_catalog',[saveKey,{...create,id:target,revision:2,fields:{...fields,price:90}}]);
  equal(saved.revision,3);equal((await db.query('select price from products where id=$1',[target])).rows[0].price,'90.00');
  equal(await rpc(owner,'pos_save_catalog',[saveKey,{...create,id:target,revision:2,fields:{...fields,price:90}}]),saved);
  equal((await db.query('select receipt_snapshot from orders where id=$1',[historicalSale.id])).rows[0].receipt_snapshot.total,80);
  const extraCreate={actor_id:ids.admin,kind:'extra',action:'save',id:null,fields:{name:'Extra reversible',price:15,phase:'Tipo de Leche'}};
  const extra=await rpc(owner,'pos_save_catalog',[randomUUID(),extraCreate]);equal(extra.revision,0);
  await rpc(owner,'pos_save_catalog',[randomUUID(),{actor_id:ids.admin,kind:'extra',action:'deactivate',id:extra.id,revision:0}]);
  const extraActive=await rpc(owner,'pos_save_catalog',[randomUUID(),{actor_id:ids.admin,kind:'extra',action:'reactivate',id:extra.id,revision:1}]);equal(extraActive.id,extra.id);equal(extraActive.revision,2);
  // A direct legacy catalog update still invalidates a current editor's version.
  await owner.query('update products set price=91 where id=$1',[target]);
  await deny(rpc(owner,'pos_save_catalog',[randomUUID(),{...create,id:target,revision:3}]),/catálogo cambió/);

  const status=async()=> (await db.query('select id,username,role,is_active,management_revision from profiles where id=$1',[profile])).rows[0];
  const original=await status();equal(original.management_revision,'0');
  for(const client of [cash,anon]) await deny(rpc(client,'pos_set_staff_active',[randomUUID(),profile,0,false]));
  const deactivateStaffKey=randomUUID(),staffOff=await rpc(owner,'pos_set_staff_active',[deactivateStaffKey,profile,0,false]);
  equal(staffOff.is_active,false);equal(staffOff.management_revision,1);equal(await rpc(owner,'pos_set_staff_active',[deactivateStaffKey,profile,0,false]),staffOff);
  await deny(rpc(owner,'pos_set_staff_active',[randomUUID(),profile,0,true]),/equipo cambió/);
  const staffOnKey=randomUUID(),staffOn=await rpc(owner,'pos_set_staff_active',[staffOnKey,profile,1,true]);
  equal(staffOn.is_active,true);equal(staffOn.management_revision,2);equal(await rpc(owner,'pos_set_staff_active',[staffOnKey,profile,1,true]),staffOn);
  equal((await status()).id,original.id);equal((await status()).username,original.username);equal((await status()).role,original.role);
  await deny(rpc(owner2,'pos_set_staff_active',[staffOnKey,profile,1,true]),/otro responsable/);
  await deny(rpc(owner,'pos_set_staff_active',[staffOnKey,profile,2,false]),/otros datos/);
  await deny(rpc(owner,'pos_set_staff_active',[randomUUID(),actor,0,false]),/Cierra o entrega/);
  // Global table locking serializes two managers editing the same revision.
  const races=await Promise.allSettled([rpc(owner,'pos_set_staff_active',[randomUUID(),profile,2,false]),rpc(owner2,'pos_set_staff_active',[randomUUID(),profile,2,false])]);
  equal(races.filter(r=>r.status==='fulfilled').length,1);equal((await status()).management_revision,'3');
  for(const client of [cash,anon])await deny(rpc(client,'pos_edit_staff_profile',[profile,'Entrega editada',original.username,'cashier',null,3]));
  await deny(rpc(owner,'pos_edit_staff_profile',[profile,'Entrega editada',original.username,'cashier',null,2]),/equipo cambió/);
  const edited=await rpc(owner,'pos_edit_staff_profile',[profile,'Entrega editada',original.username,'cashier',null,3]);
  equal(edited.is_active,false);equal(edited.management_revision,4);equal((await status()).is_active,false);
  // A stale exact activation replay reports its original result, without applying it again.
  equal(await rpc(owner,'pos_set_staff_active',[staffOnKey,profile,1,true]),staffOn);equal((await status()).is_active,false);
  await db.query('begin');
  try {
    await db.query("update profiles set is_active=false where role='admin' and id<>$1",[ids.admin]);
    const adminRevision=(await db.query('select management_revision from profiles where id=$1',[ids.admin])).rows[0].management_revision;
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.admin]);await db.query('set local role authenticated');
    await deny(rpc(db,'pos_set_staff_active',[randomUUID(),ids.admin,adminRevision,false]),/último administrador/);
  } finally {await db.query('rollback');}
  equal((await db.query('select is_active from profiles where id=$1',[ids.admin])).rows[0].is_active,true);
  // Computed status is available to the paid-order list and detail without changing its snapshot.
  const phone=await rpc(cash,'pos_phone_save',[randomUUID(),{items:payload.items,expected_total:50,customer_id:null,contact_name:'Pedido 020',contact_phone:'8681112233',order_type:'Para Llevar',order_note:''}]);
  equal((await rpc(cash,'pos_phone_get',[phone.id])).paid_sale_status,null);
  const phoneSale=await rpc(cash,'pos_checkout',[randomUUID(),{...manual,phone_order_id:phone.id,phone_order_revision:0,pager_number:null}]);
  equal((await rpc(cash,'pos_phone_get',[phone.id])).paid_sale_status,'completed');
  await rpc(owner,'pos_cancel_sale',[phoneSale.id]);
  equal((await rpc(cash,'pos_phone_get',[phone.id])).paid_sale_status,'cancelled');
  equal((await rpc(cash,'pos_phone_list',['paid','Pedido 020'])).find(p=>p.id===phone.id).paid_sale_status,'cancelled');
  equal((await rpc(cash,'pos_phone_get',[phone.id])).snapshot,phone.snapshot);
  console.log(`PASS ${checks} delivery-readiness assertions: exact recovery after close or unrelated CLIP, forbidden CLIP identity reuse, revisioned catalog/staff reactivation, stale writes, concurrent managers and paid preparation status`);
  return checks;
}
