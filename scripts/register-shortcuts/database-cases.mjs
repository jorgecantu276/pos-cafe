import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Isolated embedded PostgreSQL only; the release runner owns all connections.
export async function registerShortcutsDatabaseCases(db, connection, ids) {
  let checks=0;
  const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const deny=async(client,sql,args=[])=>{await assert.rejects(client.query(sql,args));checks++;};
  const admin=await connection('authenticated',ids.admin),parallel=await connection('authenticated',ids.admin);
  const cash=await connection('authenticated',ids.cashier),bar=await connection('authenticated',ids.barista),anon=await connection('anon'),outsider=await connection('authenticated',ids.outsider);
  const read=async client=>(await client.query('select get_register_shortcuts() r')).rows[0].r;
  const rpc=async(client,request,payload)=>(await client.query('select pos_set_register_shortcuts($1,$2) r',[request,payload])).rows[0].r;
  equal(await read(cash),{product_ids:[],revision:0});equal(await read(bar),await read(admin));
  await deny(anon,'select get_register_shortcuts()');await deny(outsider,'select get_register_shortcuts()');
  await deny(cash,'select * from cafe_private.register_shortcuts');await deny(admin,'select * from cafe_private.register_shortcut_requests');
  const products=Array.from({length:9},()=>randomUUID()),inactive=randomUUID();
  for(const [index,id] of products.entries())await db.query('insert into products(id,name,price,is_active) values($1,$2,50,true)',[id,`Favorito ${index}`]);
  await db.query("insert into products(id,name,price,is_active) values($1,'Inactivo',30,false)",[inactive]);
  const payload={actor_id:ids.admin,product_ids:[products[4],products[1],products[7]],revision:0};
  await deny(cash,'select pos_set_register_shortcuts($1,$2)',[randomUUID(),{...payload,actor_id:ids.cashier}]);
  await deny(anon,'select pos_set_register_shortcuts($1,$2)',[randomUUID(),payload]);
  for(const change of [{actor_id:ids.cashier},{actor_id:null},{product_ids:null},{product_ids:products},{product_ids:[products[0],products[0]]},{product_ids:[inactive]},{product_ids:[randomUUID()]},{product_ids:[null]},{product_ids:['invalid']},{revision:-1},{revision:0.5},{revision:null}]) {
    await deny(admin,'select pos_set_register_shortcuts($1,$2)',[randomUUID(),{...payload,...change}]);equal(await read(cash),{product_ids:[],revision:0});
  }
  const request=randomUUID();
  const replay=await Promise.all([rpc(admin,request,payload),rpc(parallel,request,payload)]);
  equal(replay[0],replay[1]);equal(replay[0],{request_id:request,product_ids:payload.product_ids,revision:1});
  equal(await read(cash),{product_ids:payload.product_ids,revision:1});
  equal((await db.query('select count(*)::int n from cafe_private.register_shortcut_requests where request_id=$1',[request])).rows[0].n,1);
  await deny(admin,'select pos_set_register_shortcuts($1,$2)',[request,{...payload,product_ids:[] }]);
  await deny(admin,'select pos_set_register_shortcuts($1,$2)',[randomUUID(),{...payload,product_ids:[products[2]]}]);
  equal(await read(cash),{product_ids:payload.product_ids,revision:1});
  const next={...payload,product_ids:products.slice(0,8),revision:1};
  const race=await Promise.allSettled([rpc(admin,randomUUID(),next),rpc(parallel,randomUUID(),{...next,product_ids:[products[8]]})]);
  equal(race.filter(value=>value.status==='fulfilled').length,1);equal((await read(cash)).revision,2);
  const final=await read(cash);equal(await rpc(admin,request,payload),replay[0]);equal(await read(cash),final);
  // Catalog deactivation never silently reshuffles or replaces owner choices.
  await db.query('update products set is_active=false where id=$1',[final.product_ids[0]]);equal(await read(cash),final);
  const empty=await rpc(admin,randomUUID(),{...payload,product_ids:[],revision:2});equal(empty.product_ids,[]);equal((await read(bar)).revision,3);
  console.log(`PASS ${checks} register shortcut assertions: explicit empty defaults, staff reads, owner access, atomic validation, order, stale-save protection and exact replay`);
  return checks;
}
