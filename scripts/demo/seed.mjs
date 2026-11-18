import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { menu, fixtureVersion, id } from './menu.mjs';

// No CLI accepting a connection URL. The caller must own a newly created local
// stack, install the baseline schema, then explicitly claim its empty database.
export async function claimDemo(db) {
  assert.equal(db.host, '127.0.0.1', 'Demo database must be loopback');
  assert.equal((await db.query('select count(*)::int n from products')).rows[0].n, 0, 'Demo requires an empty catalog');
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n, 0, 'Demo requires no existing sales');
  await db.query('create table cafe_private.generic_demo_identity(version text primary key, ready boolean not null, result jsonb)');
  await db.query('revoke all on cafe_private.generic_demo_identity from public,anon,authenticated');
  await db.query('insert into cafe_private.generic_demo_identity values($1,false,null)', [fixtureVersion]);
}

export function actorRpc(db) {
  return async (actor, name, args = []) => {
    assert.match(name, /^pos_[a-z_]+$/);
    // SET LOCAL + reset on commit/rollback prevents leaked impersonation.
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      await db.query('set local role authenticated');
      const result = (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,
        args.map(v => Array.isArray(v) ? JSON.stringify(v) : v))).rows[0].result;
      await db.query('commit');
      return result;
    } catch (error) { await db.query('rollback'); throw error; }
  };
}

export async function seedDemo(db, actors) {
  assert.equal(db.host, '127.0.0.1');
  const identity = (await db.query('select * from cafe_private.generic_demo_identity')).rows;
  assert.equal(identity.length, 1); assert.equal(identity[0].version, fixtureVersion);
  if (identity[0].ready) return identity[0].result; // Repeated seed never rewinds interactive sales.
  assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,0,'Incomplete seed: start a fresh demo');
  const rpc = actorRpc(db), admin = actors.admin.id, cashier = actors.cashier.id;
  await db.query('begin');
  try {
    for (const p of menu.products) await db.query(`insert into products(id,name,price,category,is_active,customizable,wizard_steps,image_url,stock)
      values($1,$2,$3,$4,$5,$6,$7,$8,null)`, [p.id,p.name,p.price,p.category,p.is_active,p.customizable,p.wizard_steps,p.image_url]);
    for (const e of menu.extras) await db.query('insert into extras(id,name,price,phase,active,orden_opcion) values($1,$2,$3,$4,$5,$6)',[e.id,e.name,e.price,e.phase,e.active,e.orden_opcion]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  await rpc(admin,'pos_set_drawer_rate',[randomUUID(),{rate:17.25}]);
  await rpc(admin,'pos_set_register_shortcuts',[randomUUID(),{actor_id:admin,product_ids:menu.favorites,revision:0}]);
  const setting = await rpc(admin,'pos_inventory_state');
  await rpc(admin,'pos_inventory_set_enabled',[randomUUID(),true,setting.revision]);
  async function inventory(key,action,fields) {
    const product = id(key), revision = (await db.query('select revision from pos_inventory_items where product_id=$1',[product])).rows[0].revision;
    return rpc(admin,'pos_inventory_write',[randomUUID(),[{product_id:product,revision,action,...fields}]]);
  }
  for (const p of menu.products) {
    const i = p.inventory;
    if (i.mode === 'counted') {
      await inventory(p.key,'configure',{mode:i.mode,unit:i.unit || 'pieza',minimum:i.minimum ?? null});
      if (i.quantity !== null) await inventory(p.key,'count',{quantity:i.quantity});
    } else if (!i.available) await inventory(p.key,'availability',{available:false});
  }
  await inventory('cookie','receive',{quantity:6});
  await inventory('cookie','waste',{quantity:1,reason:'Pieza dañada durante preparación de la demo'});
  await inventory('beans','import',{mode:'counted',unit:'paquete',quantity:9,minimum:3,available:true});
  await inventory('beans','import',{mode:'counted',unit:'paquete',quantity:10,minimum:3,available:true});
  const customers = [];
  for (const [n,name] of ['Alex Demo','Sam Ejemplo','Noa Ficticio','Río Muestra'].entries()) {
    const enrolled = await rpc(cashier,'pos_enroll_customer',[randomUUID(),{name,phone:`20255501${String(10+n).padStart(2,'0')}`,birthday:n === 0?'1994-04-18':null,promos:n % 2 === 0}]);
    customers.push(enrolled.customer);
  }
  const makeItems = rows => rows.map(([key,quantity,extras=[],note=''])=>({product_id:id(key),quantity,extra_ids:extras.map(id),note}));
  function total(items) { return items.reduce((sum,i)=>sum + i.quantity * (menu.products.find(p=>p.id===i.product_id).price + i.extra_ids.reduce((s,e)=>s+menu.extras.find(x=>x.id===e).price,0)),0); }
  let shift = await rpc(cashier,'pos_open_shift',[randomUUID(),650,17.25]);
  const sales = [];
  async function sell(rows, payment='tarjeta', customer=null, pager=1) {
    const items=makeItems(rows), amount=total(items);
    const payload={register_id:shift.id,items,expected_total:amount,payment_method:payment,
      tender_mxn:payment === 'efectivo'?Math.ceil(amount/100)*100:payment === 'mixto'?Math.max(0,amount-86.25):0,
      tender_usd:payment === 'mixto'?5:0,customer_id:customer,order_type:pager%2?'Para Llevar':'En Local',order_note:'Demostración con datos ficticios',pager_number:pager};
    const request=randomUUID(), sale=await rpc(cashier,'pos_checkout',[request,payload]);
    assert.deepEqual(await rpc(cashier,'pos_checkout',[request,payload]),sale);
    sales.push(sale);return sale;
  }
  await sell([['iced-miel de maple-16',2,['milk-oat','syrup-vanilla'],'Poco hielo'],['cookie',2,['finish-warm']]],'efectivo',customers[0].id,1);
  await sell([['matcha-20',1,['alt-oat','foam-citrus']],['cake',1]],'tarjeta',customers[1].id,2);
  await sell([['filter',1,['size-large','sugar-honey']],['toast',1,['prep-no-salt']]],'mixto',null,3);
  const summary=await rpc(cashier,'pos_shift_summary',[shift.id]);
  await rpc(cashier,'pos_close_shift',[shift.id,summary.expected_cash,summary.expenses,summary]);
  shift=await rpc(cashier,'pos_open_shift',[randomUUID(),500,17.25]);
  // Make current register/history useful immediately. Use real checkout snapshots.
  for (let n=0;n<14;n++) {
    const choices = [
      [['iced-cacao tostado-20',1,['milk-almond','syrup-vanilla','syrup-cocoa']]],
      [['chai-hot',1,['milk-whole','sugar-none']],['tart',1]],
      [['affogato',1,['ice-coffee']],['cookie',1]],
      [['chocolate',1,['temp-hot']],['sandwich',1,['prep-toast']]],
      [['water',2],['espresso',1]],
      [['nevado-a',1,['cream-coconut']],['frappe-a',1,['milk-oat']]],
      [['beans',1],['tea',1]],
    ];
    await sell(choices[n%choices.length],['efectivo','tarjeta','mixto'][n%3],customers[n%4].id,4+n);
  }
  const cancelled=await sell([['cookie',2]],'efectivo',null,20);
  await rpc(admin,'pos_cancel_sale',[cancelled.id]);
  const lines=await rpc(admin,'pos_inventory_sale_lines',[cancelled.id]);
  await rpc(admin,'pos_inventory_return',[randomUUID(),cancelled.id,[{id:lines[0].id,quantity:1}]]);
  const phones=[];
  const paidItems=makeItems([['espresso',1],['water',1]]);
  const paid=await rpc(cashier,'pos_phone_save',[randomUUID(),{items:paidItems,expected_total:total(paidItems),customer_id:null,
    contact_name:'Pedido Demo Recogido',contact_phone:'2025550199',order_type:'Para Llevar',order_note:'Pedido ficticio recogido y pagado'}]);
  const paidSale=await rpc(cashier,'pos_checkout',[randomUUID(),{register_id:shift.id,items:paidItems,expected_total:paid.snapshot.total,customer_id:null,
    order_type:paid.snapshot.order_type,order_note:paid.snapshot.order_note,pager_number:null,phone_order_id:paid.id,phone_order_revision:paid.revision,
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0}]);
  sales.push(paidSale);
  for (const [n,rows] of [[['matcha-16',2,['alt-almond'],'Sin endulzante']], [['cookie',3],['chai-cold',1,['milk-oat']]], [['sandwich',2,['prep-toast']]]].entries()) {
    const items=makeItems(rows);
    phones.push(await rpc(cashier,'pos_phone_save',[randomUUID(),{items,expected_total:total(items),customer_id:null,
      contact_name:['Pedido Demo Uno','Pedido Demo Dos','Pedido Demo Tres'][n],contact_phone:`202555019${n}`,
      order_type:'Para Llevar',order_note:'Recoger en 20 minutos · contacto ficticio'}]));
  }
  // A cancelled phone order records an explicit sellable-return decision.
  const phone=phones[2];
  await rpc(cashier,'pos_phone_cancel',[randomUUID(),phone.id,phone.revision,'Cliente ficticio canceló',phone.snapshot.items.map(i=>({line_id:i.id,return_quantity:i.quantity}))]);
  const result={version:fixtureVersion,products:menu.products.length,extras:menu.extras.length,customers:customers.map(c=>c.id),
    openShift:shift.id,sales:sales.map(s=>s.id),paidPhone:paid.id,cancelledSale:cancelled.id,pendingPhones:phones.slice(0,2).map(p=>p.id),cancelledPhone:phone.id};
  await db.query('update cafe_private.generic_demo_identity set ready=true,result=$1',[result]);
  return result;
}
