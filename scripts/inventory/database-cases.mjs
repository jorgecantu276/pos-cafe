import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// All fixtures are synthetic. Menu names/prices are the client's reference;
// quantities and recipes here demonstrate mechanics, not real opening stock.
export async function inventoryDatabaseCases(db, connection, ids) {
  let checks=0;
  const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const deny=async(c,sql,args=[])=>{await assert.rejects(c.query(sql,args));checks++;};
  const admin=await connection('authenticated',ids.admin), staff=await connection('authenticated',ids.cashier), anon=await connection('anon');
  const admin2=await connection('authenticated',ids.admin), staff2=await connection('authenticated',ids.barista);
  const rpc=async(c,fn,request,payload)=>(await c.query(`select ${fn}($1,$2) result`,[request,fn==='pos_checkout'?payload:{actor_id:ids.admin,...payload}])).rows[0].result;
  const product=async(name,price,stock=0,mode='product')=>{
    const id=randomUUID();await db.query('insert into products(id,name,price,stock,inventory_mode,is_active,customizable,wizard_steps) values($1,$2,$3,$4,$5,true,true,$6)',[id,name,price,stock,mode,['Tipo de Leche','Sabor']]);return id;
  };
  const supply=async(name,stock,unit='ml')=>{const id=randomUUID();await db.query('insert into supplies(id,name,unit,current_stock) values($1,$2,$3,$4)',[id,name,unit,stock]);return id;};
  const state=async(kind,id)=>{
    const row=(await db.query(kind==='product'?'select stock quantity,inventory_revision revision from products where id=$1':'select current_stock quantity,inventory_revision revision from supplies where id=$1',[id])).rows[0];
    return {quantity:Number(row.quantity),revision:Number(row.revision)};
  };
  const adjust=async(kind,id,operation,quantity,extra={})=>rpc(admin,'pos_adjust_inventory',randomUUID(),{kind,id,operation,quantity,reason:'Prueba sintética de inventario',unit:'ml',...extra});
  const open=async(c,id)=>(await db.query("select * from cash_registers where opened_by=$1 and status='open'",[id])).rows[0]
    ??(await c.query('select pos_open_shift($1,0,20) result',[randomUUID()])).rows[0].result;
  const opening=await open(staff,ids.cashier),opening2=await open(staff2,ids.barista);
  const salePayload=(items,total,register_id=opening.id)=>({register_id,items,expected_total:total,payment_method:'efectivo',tender_mxn:total,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'Datos sintéticos'});
  const line=(id,quantity=1,extras=[])=>({product_id:id,quantity,extra_ids:extras,note:''});
  const sale=(items,total,request=randomUUID())=>rpc(staff,'pos_checkout',request,salePayload(items,total));
  const piece=await product('Tortuguitas',15,10),pack=await product('Tortuguitas 5pz',65);
  const movement={kind:'product',id:piece,operation:'entrada',quantity:5,reason:'Producción sintética'};
  for(const c of [anon,staff])for(const fn of ['pos_adjust_inventory','pos_configure_inventory','pos_save_inventory_recipe'])await deny(c,`select ${fn}($1,$2)`,[randomUUID(),movement]);
  await deny(admin,'update products set stock=999 where id=$1',[piece]);
  await deny(admin,'update products set inventory_mode=\'untracked\' where id=$1',[piece]);
  await deny(admin,"insert into products(name,price,stock) values('Prohibido',1,999)");
  await admin.query("insert into products(name,price) values('Creado sin stock',1)");
  equal((await db.query("select stock from products where name='Creado sin stock'")).rows[0].stock,0);
  await deny(admin,'delete from products where id=$1',[piece]);
  await deny(admin,'delete from inventory_movements');
  await deny(admin,'select * from cafe_private.inventory_requests');
  equal((await staff.query('select * from inventory_movements')).rowCount,0);
  await deny(anon,'select * from inventory_movements');
  const key=randomUUID();const first=await rpc(admin,'pos_adjust_inventory',key,movement);
  equal(first.quantity,15);equal(await rpc(admin,'pos_adjust_inventory',key,movement),first);
  equal((await state('product',piece)).quantity,15);
  equal(Number((await db.query('select count(*) from inventory_movements where request_id=$1',[key])).rows[0].count),1);
  await deny(admin,'select pos_adjust_inventory($1,$2)',[key,{...movement,quantity:6}]);
  await deny(admin,'select pos_configure_inventory($1,$2)',[key,movement]);
  for(const quantity of [0,-1,1.5,'NaN','Infinity',100000000])await deny(admin,'select pos_adjust_inventory($1,$2)',[randomUUID(),{...movement,quantity}]);
  const stale=await state('product',piece);
  await adjust('product',piece,'merma',2);
  equal((await state('product',piece)).quantity,13);
  await deny(admin,'select pos_adjust_inventory($1,$2)',[randomUUID(),{...movement,operation:'conteo',quantity:13,revision:stale.revision}]);
  await deny(admin,'select pos_adjust_inventory($1,$2)',[randomUUID(),{...movement,operation:'merma',quantity:14}]);
  await adjust('product',piece,'conteo',12,{revision:(await state('product',piece)).revision});
  const pkey=randomUUID(),pconfig={id:pack,mode:'product',source_id:piece,units:5,revision:0,reason:'Cinco piezas por paquete, prueba'};
  const configured=await rpc(admin,'pos_configure_inventory',pkey,pconfig);
  equal(await rpc(admin,'pos_configure_inventory',pkey,pconfig),configured);
  const request=randomUUID();const receipt=await sale([line(piece,2),line(pack,2)],160,request);
  equal(receipt.total,160);equal((await state('product',piece)).quantity,0);equal((await state('product',pack)).quantity,0);
  equal((await sale([line(piece,2),line(pack,2)],160,request)).id,receipt.id);
  equal(Number((await db.query("select count(*) from inventory_movements where request_id=$1 and operation='venta'",[request])).rows[0].count),1);
  equal((await db.query('select order_id from inventory_movements where request_id=$1',[request])).rows[0].order_id,receipt.id);
  await deny(staff,'select pos_checkout($1,$2)',[randomUUID(),salePayload([line(pack)],65)]);
  await adjust('product',piece,'entrada',5);equal((await sale([line(pack)],65)).total,65);equal((await state('product',piece)).quantity,0);
  await deny(admin,'select pos_adjust_inventory($1,$2)',[randomUUID(),{...movement,id:pack}]);
  await deny(admin,'select pos_configure_inventory($1,$2)',[randomUUID(),{...pconfig,id:piece,source_id:pack,revision:(await state('product',piece)).revision}]);
  await deny(admin,'select pos_configure_inventory($1,$2)',[randomUUID(),{...pconfig,id:piece,source_id:null,mode:'untracked',units:1,revision:(await state('product',piece)).revision}]);
  const other=await product('Paquete con piezas propias',100,1);
  await deny(admin,'select pos_configure_inventory($1,$2)',[randomUUID(),{...pconfig,id:other,revision:0}]);
  await adjust('product',piece,'entrada',5);
  const races=await Promise.allSettled([
    rpc(staff,'pos_checkout',randomUUID(),salePayload([line(pack)],65)),
    rpc(staff2,'pos_checkout',randomUUID(),salePayload([line(pack)],65,opening2.id)),
  ]);
  equal(races.filter(r=>r.status==='fulfilled').length,1);equal((await state('product',piece)).quantity,0);
  const cc=await state('product',piece);const count={...movement,operation:'conteo',quantity:10,revision:cc.revision};
  const counts=await Promise.allSettled([rpc(admin,'pos_adjust_inventory',randomUUID(),count),rpc(admin2,'pos_adjust_inventory',randomUUID(),{...count,quantity:20})]);
  equal(counts.filter(r=>r.status==='fulfilled').length,1);
  const current=(await state('product',piece)).quantity;
  await Promise.all([sale([line(piece)],15),adjust('product',piece,'entrada',3)]);
  equal((await state('product',piece)).quantity,current+2);
  const nubes=await product('Nuebesitas',20,8),nubesPack=await product('Nubesitas 6pz',100);
  await rpc(admin,'pos_configure_inventory',randomUUID(),{id:nubesPack,mode:'product',source_id:nubes,units:6,revision:0,reason:'Paquete de seis piezas, prueba sintética'});
  equal((await sale([line(nubes,2),line(nubesPack)],140)).total,140);equal((await state('product',nubes)).quantity,0);
  const dairy=await supply('Leche entera — receta sintética',1000),almond=await supply('Almendra — receta sintética',600),coffee=await supply('Café — receta sintética',100,'gr');
  await deny(admin,'update supplies set current_stock=99999 where id=$1',[dairy]);
  await deny(admin,"update supplies set unit='gr' where id=$1",[dairy]);
  const milk=randomUUID();await db.query("insert into extras(id,name,price,phase,active) values($1,'Almendra',15,'Tipo de Leche',true)",[milk]);
  const cappuccino=await product('Cappuccino',80,0,'recipe');
  const saveRecipe=async(extra_ids,ingredients)=>{
    const payload={id:cappuccino,revision:(await state('product',cappuccino)).revision,extra_ids,ingredients,reason:'Cantidades sintéticas; no receta del café'};
    const request=randomUUID();const saved=await rpc(admin,'pos_save_inventory_recipe',request,payload);equal(await rpc(admin,'pos_save_inventory_recipe',request,payload),saved);return saved;
  };
  await saveRecipe([],[{supply_id:dairy,quantity:200},{supply_id:coffee,quantity:18}]);
  await deny(staff,'select pos_checkout($1,$2)',[randomUUID(),salePayload([line(cappuccino,1,[milk])],95)]);
  equal((await state('supply',dairy)).quantity,1000);
  await saveRecipe([milk],[{supply_id:almond,quantity:200},{supply_id:coffee,quantity:18}]);
  equal((await db.query('select supply_id from product_recipes where product_id=$1 and supply_id=$2',[cappuccino,dairy])).rowCount,1);
  await sale([line(cappuccino,2,[milk])],190);
  equal((await state('product',cappuccino)).quantity,0);equal((await state('supply',dairy)).quantity,1000);equal((await state('supply',almond)).quantity,200);equal((await state('supply',coffee)).quantity,64);
  const beforeFail=await state('supply',coffee);
  await deny(staff,'select pos_checkout($1,$2)',[randomUUID(),salePayload([line(cappuccino,2,[milk])],190)]);
  equal(await state('supply',coffee),beforeFail);equal((await state('supply',almond)).quantity,200);
  await sale([line(cappuccino)],80);equal((await state('supply',dairy)).quantity,800);
  const snapshot=await state('supply',almond);
  await deny(admin,'select pos_adjust_inventory($1,$2)',[randomUUID(),{kind:'supply',id:almond,operation:'entrada',quantity:1,unit:'lt',reason:'Unidad incorrecta'}]);
  await adjust('supply',almond,'entrada',1000);equal((await state('supply',almond)).quantity,1200);
  await deny(admin,'select pos_adjust_inventory($1,$2)',[randomUUID(),{kind:'supply',id:almond,operation:'conteo',quantity:1200,unit:'ml',revision:snapshot.revision,reason:'Conteo obsoleto'}]);
  await deny(admin,'select pos_save_inventory_recipe($1,$2)',[randomUUID(),{id:cappuccino,revision:(await state('product',cappuccino)).revision,extra_ids:[milk],ingredients:[{supply_id:almond,quantity:-1}],reason:'Receta inválida'}]);
  await deny(admin,'insert into product_inventory_recipes(product_id,ingredients) values($1,$2)',[cappuccino,'[]']);
  const untracked=await product('Iced coffee nevado',140,0,'untracked');
  await sale([line(untracked,20)],2800);equal((await state('product',untracked)).quantity,0);
  // Every actual menu presentation can sell and, when counted, replenish.
  const menu=JSON.parse(await readFile(new URL('../../tests/fixtures/real-menu.json',import.meta.url),'utf8'));
  for(const entry of menu.products){
    const counted=entry.category!=='Bebidas';const id=await product(entry.name,entry.price_mxn,0,counted?'product':'untracked');
    if(counted)await adjust('product',id,'entrada',2);
    equal((await sale([line(id)],entry.price_mxn)).total,entry.price_mxn);
    if(counted){equal((await state('product',id)).quantity,1);await adjust('product',id,'entrada',1);equal((await state('product',id)).quantity,2);}
    else equal((await state('product',id)).quantity,0);
  }
  // Ledger continuity for every affected balance: each sale/movement has a
  // revision and cannot erase the previous balance, even when quantities repeat.
  equal(Number((await db.query(`select count(*) from (select *,lag(quantity_after) over(partition by target_kind,target_id order by revision) previous
    from inventory_movements) m where previous is not null and previous<>quantity_before`)).rows[0].count),0);
  equal(Number((await db.query("select count(*) from inventory_movements where operation='venta' and order_id is null")).rows[0].count),0);
  console.log(`PASS ${checks} inventory assertions, ${menu.products.length} real-menu presentations; balances and recipes are synthetic`);
  return checks;
}
