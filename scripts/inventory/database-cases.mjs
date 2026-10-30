import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function inventoryDatabaseCases(db, connection, ids) {
  let checks=0;
  const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const denied=async(client,sql,args=[])=>{await assert.rejects(client.query(sql,args));checks++;};
  const admin=await connection('authenticated',ids.admin),cash=await connection('authenticated',ids.cashier),bar=await connection('authenticated',ids.barista),anon=await connection('anon'),outsider=await connection('authenticated',ids.outsider);
  const created=await admin.query("insert into products(name,price,category,is_active) values('Brownie tradicional',30,'Postres',true),('Iced coffee',95,'Bebidas',true),('Crookie nutella',75,'Postres',true) returning id,name");
  const product=created.rows.find(r=>r.name==='Brownie tradicional').id,drink=created.rows.find(r=>r.name==='Iced coffee').id,other=created.rows.find(r=>r.name==='Crookie nutella').id;
  const item=async(id=product)=>(await admin.query('select * from pos_inventory_items where product_id=$1',[id])).rows[0];
  const write=async(changes,key=randomUUID(),client=admin)=>(await client.query('select pos_inventory_write($1,$2) r',[key,JSON.stringify(changes)])).rows[0].r;
  const change=async(action,fields={},id=product)=>({product_id:id,revision:(await item(id)).revision,action,...fields});
  eq((await item()).quantity,null);eq((await item()).mode,'availability');eq((await item()).available,true);
  const code=(await item()).code;assert.match(code,/^CM-\d{6,}$/);checks++;
  for(const client of [anon,cash,outsider]){
    await denied(client,'select pos_inventory_catalog()');
    await denied(client,'select pos_inventory_history()');
    await denied(client,'select pos_inventory_write($1,$2)',[randomUUID(),'[]']);
    await denied(client,'select pos_inventory_return($1,$2,$3)',[randomUUID(),randomUUID(),'[]']);
  }
  await denied(cash,'update pos_inventory_items set quantity=999 where product_id=$1',[product]);
  await denied(admin,'update pos_inventory_items set quantity=999 where product_id=$1',[product]);
  await denied(admin,'delete from pos_inventory_movements');await denied(cash,'select * from pos_inventory_movements');
  await denied(admin,'select pos_inventory_write($1,$2,$3)',[randomUUID(),JSON.stringify([{product_id:product,revision:0,action:'count',quantity:1}]),ids.cashier]);
  eq((await outsider.query('select * from pos_inventory_items')).rowCount,0);
  await write([await change('configure',{mode:'counted',unit:'pieza',minimum:3})]);
  eq((await item()).quantity,null);
  const open=async(client,id)=>(await db.query("select id from cash_registers where opened_by=$1 and status='open'",[id])).rows[0]
    ??(await client.query('select pos_open_shift($1,0,20) r',[randomUUID()])).rows[0].r;
  const shift=await open(cash,ids.cashier),barShift=await open(bar,ids.barista);
  const payload=(qty=1,id=product,register=shift.id)=>({register_id:register,items:[{product_id:id,quantity:qty,extra_ids:[],note:''}],expected_total:qty*(id===drink?95:id===other?75:30),payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:''});
  const sale=async(p,key=randomUUID(),client=cash)=>(await client.query('select pos_checkout($1,$2) r',[key,p])).rows[0].r;
  // Unknown counts do not silently become zero or change from an untracked sale.
  const uncounted=await sale(payload());eq((await item()).quantity,null);
  eq((await db.query('select count(*)::int n from pos_inventory_movements where order_id=$1',[uncounted.id])).rows[0].n,0);
  const count=await change('count',{quantity:6}),countKey=randomUUID();
  const first=await write([count],countKey);eq(await write([count],countKey),first);eq((await item()).quantity,6);
  await denied(admin,'select pos_inventory_write($1,$2)',[countKey,JSON.stringify([{...count,quantity:99}])]);
  await denied(admin,'select pos_inventory_write($1,$2)',[randomUUID(),JSON.stringify([count])]); // stale physical count
  const receive=await change('receive',{quantity:2}),receiveKey=randomUUID();
  await Promise.all([write([receive],receiveKey),write([receive],receiveKey,await connection('authenticated',ids.admin))]);eq((await item()).quantity,8);
  const request=randomUUID(),p=payload(2);const receipt=await sale(p,request);
  eq((await item()).quantity,6);eq(await sale(p,request),receipt);eq((await item()).quantity,6);
  const staleImport=await change('import',{mode:'counted',unit:'pieza',quantity:100,minimum:2,available:true});
  const duplicate={...payload(2),items:[{...p.items[0],quantity:1,note:'Una'},{...p.items[0],quantity:1,note:'Otra'}]};
  await sale(duplicate);eq((await item()).quantity,4);
  await denied(admin,'select pos_inventory_write($1,$2)',[randomUUID(),JSON.stringify([staleImport])]);eq((await item()).quantity,4);
  await write([await change('waste',{quantity:1,reason:'Dañado'})]);eq((await item()).quantity,3);
  for(const bad of [{quantity:-1},{quantity:1.5},{quantity:4},{quantity:1,reason:''}]){
    await denied(admin,'select pos_inventory_write($1,$2)',[randomUUID(),JSON.stringify([await change('waste',{reason:'Prueba',...bad})])]);eq((await item()).quantity,3);
  }
  // If a later line fails, neither the order, earlier decrements nor audit rows survive.
  await write([await change('availability',{available:false},drink)]);
  const before=(await item()).quantity;
  const badRequest=randomUUID();await denied(cash,'select pos_checkout($1,$2)',[badRequest,{...payload(),items:[payload().items[0],payload(1,drink).items[0]],expected_total:125}]);
  eq((await item()).quantity,before);eq((await db.query('select count(*)::int n from orders where request_id=$1',[badRequest])).rows[0].n,0);
  await denied(cash,'select pos_checkout($1,$2)',[randomUUID(),payload(4)]);eq((await item()).quantity,3);
  // All-or-nothing CSV batch, preserving existing count on blank quantity.
  const valid=await change('import',{mode:'counted',unit:'pieza',quantity:99,minimum:1,available:true});
  const invalid=await change('import',{mode:'counted',unit:'pieza',quantity:-1,minimum:1,available:true},other);
  await denied(admin,'select pos_inventory_write($1,$2)',[randomUUID(),JSON.stringify([valid,invalid])]);eq((await item()).quantity,3);
  await write([{...valid,quantity:null}]);eq((await item()).quantity,3);
  await write([await change('count',{quantity:1})]);
  const race=await Promise.allSettled([sale(payload()),sale(payload(1,product,barShift.id),randomUUID(),bar)]);
  eq(race.filter(r=>r.status==='fulfilled').length,1);eq(race.filter(r=>r.status==='rejected').length,1);eq((await item()).quantity,0);
  // Financial cancellation never guesses whether food can be resold.
  await admin.query('select pos_cancel_sale($1)',[receipt.id]);eq((await item()).quantity,0);
  const lines=(await admin.query('select pos_inventory_sale_lines($1) r',[receipt.id])).rows[0].r;eq(lines.length,1);eq(lines[0].sold,2);
  const returnKey=randomUUID(),returnLines=[{id:lines[0].id,quantity:1}];
  const returned=(await admin.query('select pos_inventory_return($1,$2,$3) r',[returnKey,receipt.id,JSON.stringify(returnLines)])).rows[0].r;
  eq((await item()).quantity,1);
  eq((await admin.query('select pos_inventory_return($1,$2,$3) r',[returnKey,receipt.id,JSON.stringify(returnLines)])).rows[0].r,returned);eq((await item()).quantity,1);
  await denied(admin,'select pos_inventory_return($1,$2,$3)',[randomUUID(),receipt.id,JSON.stringify([{id:lines[0].id,quantity:2}])]);eq((await item()).quantity,1);
  await admin.query('select pos_inventory_return($1,$2,$3)',[randomUUID(),receipt.id,JSON.stringify(returnLines)]);eq((await item()).quantity,2);
  await denied(admin,'select pos_inventory_return($1,$2,$3)',[randomUUID(),receipt.id,JSON.stringify(returnLines)]);
  eq((await admin.query('select pos_inventory_sale_lines($1) r',[receipt.id])).rows[0].r[0].returned,2);
  await write([await change('configure',{mode:'counted',unit:'rebanada',minimum:null})]);eq((await item()).quantity,null);eq((await item()).last_counted_at,null);
  eq((await item()).code,code);
  const history=(await admin.query('select pos_inventory_history($1) r',[product])).rows[0].r;
  assert.ok(history.some(m=>m.kind==='sale'&&m.actor_name==='cashier'));checks++;
  assert.ok(history.some(m=>m.kind==='waste'&&m.reason==='Dañado'));checks++;
  assert.ok(history.some(m=>m.kind==='return'&&m.order_id===receipt.id));checks++;
  const next=(await admin.query('select pos_inventory_history($1,$2) r',[product,history.at(-1).id])).rows[0].r;eq(next.length,0);
  const catalog=(await admin.query('select pos_inventory_catalog() r')).rows[0].r;
  assert.ok(catalog.find(i=>i.product_id===product&&i.name==='Brownie tradicional'));checks++;
  return checks;
}
