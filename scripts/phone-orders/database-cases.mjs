import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function phoneOrderDatabaseCases(db,connection,ids,migration) {
  let checks=0;
  const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const deny=async(p,pattern)=>{await assert.rejects(p,pattern);checks++;};
  const rpc=async(c,name,args=[])=>(await c.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].result;
  const a=randomUUID(),b=randomUUID(),product=randomUUID(),extra=randomUUID(),customer=randomUUID();
  await db.query(migration);
  for(const [id,label] of [[a,'A'],[b,'B']]) {
    await db.query('insert into auth.users values($1)',[id]);
    await db.query("insert into profiles(id,full_name,username,role) values($1,$2,$3,'cashier')",[id,'Teléfono '+label,'phone-'+id]);
  }
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query('update pos_inventory_settings set enabled=false');
  await db.query("insert into products(id,name,price,is_active,customizable,wizard_steps) values($1,'Bebida teléfono',50,true,true,array['Tipo de Leche'])",[product]);
  await db.query("insert into extras(id,name,price,phase,active) values($1,'Almendra teléfono',15,'Tipo de Leche',true)",[extra]);
  await db.query("insert into customers(id,name,phone,points,total_spent) values($1,'Cliente teléfono','8681112233',50,0)",[customer]);
  const cash=await connection('authenticated',a),parallel=await connection('authenticated',a),other=await connection('authenticated',b),otherParallel=await connection('authenticated',b);
  const anon=await connection('anon'),service=await connection('service_role');
  const base={items:[{product_id:product,quantity:2,extra_ids:[extra],note:'Sin hielo'}],expected_total:130,
    customer_id:customer,contact_name:'Ana teléfono',contact_phone:'868 111 2233',order_type:'Para Llevar',order_note:'Preparar juntos'};
  const save=async(payload=base,key=randomUUID(),actor=cash)=>rpc(actor,'pos_phone_save',[key,payload]);
  const beforeOrders=Number((await db.query('select count(*) n from orders')).rows[0].n);
  await deny(save(base,randomUUID(),anon));
  const key=randomUUID(),[phone,samePhone]=await Promise.all([save(base,key),save(base,key,parallel)]);
  equal(samePhone,phone);
  equal(phone.status,'pending');equal(phone.revision,0);equal(phone.contact_phone,'8681112233');
  equal(phone.snapshot.total,130);equal(phone.snapshot.inventory_reserved,false);equal(phone.paid_order_id,null);
  equal(await save(base,key),phone);
  await deny(save({...base,order_note:'Changed'},key));
  equal(await rpc(other,'pos_phone_get',[phone.id]),phone);
  equal(await rpc(other,'pos_phone_print_state',[randomUUID()]),null);
  equal(await rpc(other,'pos_phone_print_state',[phone.id]),{...phone,paid_sale_status:null});
  await deny(rpc(anon,'pos_phone_print_state',[phone.id]));
  equal((await db.query("select provolatile,prosecdef from pg_proc where oid='pos_phone_print_state(uuid)'::regprocedure")).rows[0],{provolatile:'s',prosecdef:true});
  equal((await rpc(other,'pos_phone_list',['pending','Ana teléfono'])).some(p=>p.id===phone.id),true);
  equal(Number((await db.query('select count(*) n from orders')).rows[0].n),beforeOrders);
  equal((await db.query('select points,total_spent from customers where id=$1',[customer])).rows[0],{points:50,total_spent:'0.00'});
  equal((await db.query('select count(*)::int n from cafe_private.inventory_reservations where phone_order_id=$1',[phone.id])).rows[0].n,0);
  for(const bad of [{contact_phone:'1'},{contact_name:''},{expected_total:1},{items:[{...base.items[0],quantity:0}]},{items:[{...base.items[0],extra_ids:[randomUUID()]}]}]) await deny(save({...base,...bad}));
  const regA=randomUUID();await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,100,16,'open')",[regA,a]);
  const payment=(p,register=regA,fields={})=>({register_id:register,items:base.items,expected_total:p.snapshot.total,customer_id:p.customer_id,
    order_type:p.snapshot.order_type,order_note:p.snapshot.order_note,pager_number:null,phone_order_id:p.id,phone_order_revision:p.revision,
    payment_method:'efectivo',tender_mxn:0,tender_usd:10,...fields});
  await deny(rpc(cash,'pos_checkout',[randomUUID(),{...payment(phone),phone_order_id:null,source:'phone'}]),/control/i);
  await deny(rpc(cash,'pos_checkout',[randomUUID(),payment(phone,regA,{phone_order_id:randomUUID()})]));
  await deny(rpc(cash,'pos_checkout',[randomUUID(),payment(phone,regA,{phone_order_revision:2})]));
  await deny(rpc(cash,'pos_checkout',[randomUUID(),payment(phone,regA,{pager_number:1})]));
  await deny(rpc(cash,'pos_checkout',[randomUUID(),payment(phone,regA,{expected_total:1})]));
  await db.query('update products set price=999,is_active=false where id=$1',[product]);
  await db.query('update extras set price=999,active=false where id=$1',[extra]);
  const request=randomUUID(),payload=payment(phone),sale=await rpc(cash,'pos_checkout',[request,payload]);
  equal(sale.total,130);equal(sale.change_mxn,30);equal(sale.exchange_rate,16);equal(sale.phone_order_id,phone.id);equal(sale.phone_folio,phone.folio);equal(sale.source,'phone');equal(sale.pager_number,null);
  equal(sale.items[0].product.price,65);equal(sale.items[0].product.displayExtras[0].price,15);
  equal(await rpc(cash,'pos_checkout',[request,payload]),sale);
  const paid=await rpc(cash,'pos_phone_get',[phone.id]);equal(paid.status,'paid');equal(paid.revision,1);equal(paid.snapshot,phone.snapshot);equal(paid.paid_order_id,sale.id);
  equal((await db.query('select phone_order_id,order_source,register_id from orders where id=$1',[sale.id])).rows[0],{phone_order_id:phone.id,order_source:'phone',register_id:regA});
  equal((await db.query('select points,total_spent from customers where id=$1',[customer])).rows[0],{points:63,total_spent:'130.00'});
  await deny(rpc(cash,'pos_checkout',[randomUUID(),payment(phone)]));
  await deny(rpc(other,'pos_phone_cancel',[randomUUID(),phone.id,phone.revision,'Already paid',[]]));
  await db.query('update products set price=50,is_active=true where id=$1',[product]);await db.query('update extras set price=15,active=true where id=$1',[extra]);
  const cross=await save();
  await db.query("update cash_registers set status='closed' where id=$1",[regA]);
  const regB=randomUUID();await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,100,18,'open')",[regB,b]);
  const crossSale=await rpc(other,'pos_checkout',[randomUUID(),payment(cross,regB)]);
  equal(crossSale.exchange_rate,18);equal(crossSale.change_mxn,50);equal((await db.query('select cashier_id from orders where id=$1',[crossSale.id])).rows[0].cashier_id,b);
  const linkedBefore=await rpc(cash,'pos_phone_get',[cross.id]);
  equal(await rpc(cash,'pos_phone_print_state',[cross.id]),{...linkedBefore,paid_sale_status:'completed'});
  const owner=await connection('authenticated',ids.admin);
  await rpc(owner,'pos_cancel_sale',[crossSale.id]);
  equal(await rpc(cash,'pos_phone_print_state',[cross.id]),{...linkedBefore,paid_sale_status:'cancelled'});
  equal(await rpc(cash,'pos_phone_get',[cross.id]),linkedBefore);
  // Shared preparation lookup does not grant general sales-table visibility.
  equal((await cash.query('select count(*)::int n from orders where id=$1',[crossSale.id])).rows[0].n,0);
  const cancelled=await save(),cancelKey=randomUUID();
  const cancelArgs=[cancelKey,cancelled.id,cancelled.revision,'Cliente canceló',[]];
  const cancel=await rpc(other,'pos_phone_cancel',cancelArgs);equal(cancel.status,'cancelled');equal(cancel.snapshot,cancelled.snapshot);equal(await rpc(other,'pos_phone_cancel',cancelArgs),cancel);
  await deny(rpc(other,'pos_checkout',[randomUUID(),payment(cancelled,regB)]));
  await deny(rpc(other,'pos_phone_cancel',[randomUUID(),cancelled.id,0,'Otra cancelación',[]]));
  // Activate only with no pending orders. Counts come from this explicit fixture.
  await db.query('update pos_inventory_settings set enabled=true');
  await db.query("update pos_inventory_items set mode='counted',quantity=20 where product_id=$1",[product]);
  const reserved=await save();
  equal(reserved.snapshot.inventory_reserved,true);
  const count=async()=>Number((await db.query('select quantity from pos_inventory_items where product_id=$1',[product])).rows[0].quantity);
  const holds=async()=>Number((await db.query('select coalesce(sum(quantity),0) n from cafe_private.inventory_reservations where product_id=$1',[product])).rows[0].n);
  equal(await count(),20);equal(await holds(),2);
  equal((await rpc(other,'pos_inventory_register')).items.find(i=>i.product_id===product).quantity,18);
  await deny(db.query('update pos_inventory_settings set enabled=false'),/pedidos/i);
  const receipt=await rpc(other,'pos_checkout',[randomUUID(),payment(reserved,regB)]);
  equal(receipt.total,130);equal(await count(),18);equal(await holds(),0);
  // Cancellation requires a decision for each frozen line; no implicit restock.
  const wastePhone=await save(),wasteKey=randomUUID();
  await deny(rpc(other,'pos_phone_cancel',[randomUUID(),wastePhone.id,0,'Canceló',[]]));
  await deny(rpc(other,'pos_phone_cancel',[randomUUID(),wastePhone.id,0,'Canceló',[{line_id:wastePhone.snapshot.items[0].id,return_quantity:3}]]));
  const returns=[{line_id:wastePhone.snapshot.items[0].id,return_quantity:1}];
  const wasteArgs=[wasteKey,wastePhone.id,0,'Una unidad preparada',returns];
  const wasteCancel=await rpc(other,'pos_phone_cancel',wasteArgs);equal(await count(),17);equal(await holds(),0);equal(await rpc(other,'pos_phone_cancel',wasteArgs),wasteCancel);equal(await count(),17);
  const split=await save({...base,items:[{...base.items[0],quantity:1,note:'Primero'},{...base.items[0],quantity:1,note:'Segundo'}]});
  const splitReturns=[{line_id:split.snapshot.items[0].id,return_quantity:1},{line_id:split.snapshot.items[1].id,return_quantity:0}];
  await deny(rpc(other,'pos_phone_cancel',[randomUUID(),split.id,0,'Separados',[splitReturns[0],splitReturns[0]]]),/cada artículo/);
  await deny(rpc(other,'pos_phone_cancel',[randomUUID(),split.id,0,'Separados',[splitReturns[0],{...splitReturns[1],line_id:randomUUID()}]]),/vendible/);
  const splitStock=await count();await rpc(other,'pos_phone_cancel',[randomUUID(),split.id,0,'Una unidad preparada',splitReturns]);equal(await count(),splitStock-1);equal(await holds(),0);
  const quantityBefore=await count();
  const unknown=randomUUID();await db.query("insert into products(id,name,price,is_active) values($1,'Cantidad desconocida',30,true)",[unknown]);
  await db.query("update pos_inventory_items set mode='counted',quantity=null where product_id=$1",[unknown]);
  const unknownPhone=await save({...base,items:[{product_id:unknown,quantity:1,extra_ids:[],note:''}],expected_total:30});
  await rpc(other,'pos_phone_cancel',[randomUUID(),unknownPhone.id,0,'Preparado',[{line_id:unknownPhone.snapshot.items[0].id,return_quantity:0}]]);
  equal((await db.query('select quantity from pos_inventory_items where product_id=$1',[unknown])).rows[0].quantity,null);equal(await count(),quantityBefore);
  // CLIP owns an attempt, while the phone order owns the same original hold.
  const clipPhone=await save(),clipKey=randomUUID(),clipPayload=payment(clipPhone,regB,{payment_method:'tarjeta',tender_usd:0});
  equal((await rpc(other,'pos_clip_prepare',[clipKey,clipPayload])).state,'prepared');equal(await holds(),2);
  equal((await rpc(other,'pos_clip_prepare',[clipKey,clipPayload])).state,'prepared');equal(await holds(),2);
  await deny(rpc(cash,'pos_phone_cancel',[randomUUID(),clipPhone.id,0,'Canceló',[{line_id:clipPhone.snapshot.items[0].id,return_quantity:2}]]));
  await deny(rpc(other,'pos_checkout',[randomUUID(),clipPayload]));
  await deny(db.query("update cash_registers set status='closed' where id=$1",[regB]));
  await rpc(service,'pos_clip_claim',[clipKey,b,'PHONE-TEST']);
  await rpc(service,'pos_clip_settle',[clipKey,b,null,'unavailable',{code:'ERR10_04'}]);equal(await holds(),2);equal((await rpc(cash,'pos_phone_get',[clipPhone.id])).status,'pending');
  const approved=randomUUID();await rpc(other,'pos_clip_prepare',[approved,clipPayload]);equal(await holds(),2);
  await rpc(service,'pos_clip_claim',[approved,b,'PHONE-TEST']);const provider='pinpad-'+randomUUID();await rpc(service,'pos_clip_attach',[approved,b,provider]);
  const evidence={reference:'pos-'+approved,device:'PHONE-TEST',amount_cents:13000,currency:'MXN',status:'APPROVED',paid_cents:13000,tip_cents:0,transaction:randomUUID()};
  const clipStock=await count();
  const settled=await rpc(service,'pos_clip_settle',[approved,b,provider,'completed',evidence]);equal(settled.phone_order_id,clipPhone.id);equal(settled.phone_folio,clipPhone.folio);equal(await count(),clipStock-2);equal(await holds(),0);
  equal(await rpc(service,'pos_clip_settle',[approved,b,provider,'completed',evidence]),settled);equal(await count(),clipStock-2);equal((await rpc(cash,'pos_phone_get',[clipPhone.id])).status,'paid');
  const scarce=randomUUID();await db.query("insert into products(id,name,price,is_active) values($1,'Última pieza teléfono',30,true)",[scarce]);
  await db.query("update pos_inventory_items set mode='counted',quantity=1 where product_id=$1",[scarce]);
  const scarcePayload={...base,items:[{product_id:scarce,quantity:1,extra_ids:[],note:''}],expected_total:30};
  const last=await save(scarcePayload);
  await deny(save(scarcePayload),/Existencias insuficientes/);
  const walkIn={...payment(last,regB,{phone_order_id:null,phone_order_revision:null,pager_number:1}),items:scarcePayload.items};
  await deny(rpc(other,'pos_checkout',[randomUUID(),walkIn]),/Existencias insuficientes/);
  await deny(rpc(other,'pos_clip_prepare',[randomUUID(),{...walkIn,payment_method:'tarjeta',tender_usd:0}]),/Existencias insuficientes/);
  const admin=await connection('authenticated',ids.admin);
  const itemRevision=(await db.query('select revision from pos_inventory_items where product_id=$1',[scarce])).rows[0].revision;
  await deny(rpc(admin,'pos_inventory_write',[randomUUID(),[{product_id:scarce,revision:itemRevision,action:'count',quantity:1}],ids.admin]),/pedido o pago pendiente/);
  await rpc(other,'pos_phone_cancel',[randomUUID(),last.id,0,'Regresa vendible',[{line_id:last.snapshot.items[0].id,return_quantity:1}]]);
  equal((await db.query('select quantity from pos_inventory_items where product_id=$1',[scarce])).rows[0].quantity,1);
  // Concurrent new attempts share one phone row lock, globally, not by actor.
  const race=await save(),raceKey=randomUUID(),racePayload=payment(race,regB);
  const raceStock=await count();
  const outcomes=await Promise.allSettled([rpc(other,'pos_checkout',[raceKey,racePayload]),rpc(cash,'pos_phone_cancel',[randomUUID(),race.id,0,'Compite',[{line_id:race.snapshot.items[0].id,return_quantity:2}]])]);
  equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  const racePaid=(await rpc(cash,'pos_phone_get',[race.id])).status==='paid';
  equal((await db.query('select count(*)::int n from orders where phone_order_id=$1',[race.id])).rows[0].n,racePaid?1:0);
  equal(await count(),raceStock-(racePaid?2:0));equal(await holds(),0);
  const double=await save(),doublePayload=payment(double,regB);
  const doubleStock=await count(),doublePoints=(await db.query('select points from customers where id=$1',[customer])).rows[0].points;
  const dup=await Promise.allSettled([rpc(other,'pos_checkout',[randomUUID(),doublePayload]),rpc(otherParallel,'pos_checkout',[randomUUID(),doublePayload])]);equal(dup.filter(o=>o.status==='fulfilled').length,1);
  equal(await count(),doubleStock-2);equal(await holds(),0);equal((await db.query('select points from customers where id=$1',[customer])).rows[0].points,doublePoints+13);
  // Export and typed-table rehydration include phone state, reservations and IDs.
  const pendingBackup=await save();
  const backupAttempt=randomUUID(),backupPayload=payment(pendingBackup,regB,{payment_method:'tarjeta',tender_usd:0});
  await rpc(other,'pos_clip_prepare',[backupAttempt,backupPayload]);await rpc(service,'pos_clip_claim',[backupAttempt,b,'PHONE-TEST']);
  const raw=(await service.query('select pos_business_backup()::text snapshot')).rows[0].snapshot;
  const snapshot=JSON.parse(raw);equal(snapshot.tables['public.pos_phone_orders'].rows.some(p=>p.id===pendingBackup.id),true);
  equal(snapshot.tables['cafe_private.phone_requests'].rows.length>0,true);equal(snapshot.sequences['public.pos_phone_orders_folio_seq']!==undefined,true);
  await db.query('create temp table phone_restore (like public.pos_phone_orders)');
  await db.query("insert into phone_restore select * from jsonb_populate_recordset(null::phone_restore,$1::jsonb->'tables'->'public.pos_phone_orders'->'rows')",[raw]);
  equal((await db.query('select to_jsonb(p) p from phone_restore p where id=$1',[pendingBackup.id])).rows[0].p,await rpc(cash,'pos_phone_get',[pendingBackup.id]));
  await db.query('drop table phone_restore');
  for(const relation of ['cafe_private.phone_requests','cafe_private.inventory_reservations','cafe_private.clip_payments']) {
    await db.query(`create temp table phone_related_restore (like ${relation})`);
    await db.query("insert into phone_related_restore select * from jsonb_populate_recordset(null::phone_related_restore,$1::jsonb #> array['tables',$2,'rows'])",[raw,relation]);
    equal((await db.query(`with restored as (select to_jsonb(r) value from phone_related_restore r), original as (select to_jsonb(o) value from ${relation} o)
      select count(*)::int n from ((select value from restored except all select value from original) union all (select value from original except all select value from restored)) changes`)).rows[0].n,0);
    await db.query('drop table phone_related_restore');
  }
  await rpc(service,'pos_clip_settle',[backupAttempt,b,null,'unavailable',{code:'ERR10_04'}]);
  await rpc(other,'pos_phone_cancel',[randomUUID(),pendingBackup.id,0,'Fin de prueba',[{line_id:pendingBackup.snapshot.items[0].id,return_quantity:2}]]);
  const prefix='Paginación '+randomUUID();
  const pages=(await db.query(`insert into pos_phone_orders(contact_name,contact_phone,snapshot,created_by)
    select $1,'8681112233',$2,$3 from generate_series(1,201) returning id`,[prefix,{...phone.snapshot,inventory_reserved:false},a])).rows;
  const firstPage=await rpc(cash,'pos_phone_list',['pending',prefix,null]);equal(firstPage.length,200);
  equal(firstPage[0].folio>firstPage.at(-1).folio,true);
  const nextPage=await rpc(cash,'pos_phone_list',['pending',prefix,firstPage.at(-1).folio]);equal(nextPage.length,1);
  equal(firstPage.some(p=>p.id===nextPage[0].id),false);
  await db.query('delete from pos_phone_orders where id=any($1::uuid[])',[pages.map(p=>p.id)]);
  equal((await db.query("select count(*)::int n from orders where order_source='phone' and phone_order_id is null")).rows[0].n,0);
  console.log(`PASS ${checks} phone-order assertions: separate pending state, frozen prices, pickup checkout, current shift/rate, concurrent payment/cancellation, stock reservations/waste, CLIP recovery and backup roundtrip`);
  return checks;
}
