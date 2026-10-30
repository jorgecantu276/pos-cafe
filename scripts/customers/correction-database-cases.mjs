import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The owned embedded PostgreSQL runner supplies these connections; no hosted URL.
export async function customerCorrectionDatabaseCases(db, connection, ids) {
  let checks=0;const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const deny=async(client,sql,args=[])=>{await assert.rejects(client.query(sql,args));checks++;};
  const admin=await connection('authenticated',ids.admin),otherAdmin=await connection('authenticated',ids.admin);
  const cashier=await connection('authenticated',ids.cashier),anon=await connection('anon');
  const customerId=randomUUID(),orderId=randomUUID();
  await db.query("insert into customers(id,name,phone,birth_date,points,total_spent,accept_promos,customer_code) values($1,'Nombre anterior','777','1990-01-02',173,345.25,true,$2)",[customerId,`OLD-${customerId}`]);
  await db.query("insert into orders(id,customer_id,cashier_id,subtotal,total,status) values($1,$2,$3,50,50,'completed')",[orderId,customerId,ids.cashier]);
  const state=async id=>(await db.query('select to_jsonb(c) r from customers c where id=$1',[id])).rows[0].r;
  const before=await state(customerId),orderBefore=(await db.query('select to_jsonb(o) r from orders o where id=$1',[orderId])).rows[0].r;
  const rpc=async(client,key,payload)=>(await client.query('select pos_edit_customer($1,$2) r',[key,payload])).rows[0].r;
  const payload={actor_id:ids.admin,customer_id:customerId,name:'Nombre corregido',phone:'+52 (868) 765-4321'};
  await deny(anon,'select pos_edit_customer($1,$2)',[randomUUID(),payload]);
  await deny(cashier,'select pos_edit_customer($1,$2)',[randomUUID(),{...payload,actor_id:ids.cashier}]);
  await deny(admin,'select pos_edit_customer($1,$2)',[randomUUID(),{...payload,actor_id:ids.cashier}]);
  const missingActor={...payload};delete missingActor.actor_id;
  await deny(admin,'select pos_edit_customer($1,$2)',[randomUUID(),missingActor]);
  await deny(admin,'update customers set name=$1 where id=$2',['Bypass',customerId]);
  await deny(admin,'select * from cafe_private.drawer_requests');
  for(const change of [{name:' '},{name:'x'.repeat(151)},{phone:null},{phone:''},{phone:'555'},{phone:'1234567890123456'},{phone:'call 8687654321'},{customer_id:randomUUID()}]) {
    await deny(admin,'select pos_edit_customer($1,$2)',[randomUUID(),{...payload,...change}]);
    equal(await state(customerId),before);
  }
  const request=randomUUID();
  const repeats=await Promise.all([rpc(admin,request,payload),rpc(otherAdmin,request,payload)]);
  equal(repeats[0],repeats[1]);equal(repeats[0].customer,{...before,name:'Nombre corregido',phone:'528687654321'});
  equal(await state(customerId),repeats[0].customer);
  equal((await db.query('select to_jsonb(o) r from orders o where id=$1',[orderId])).rows[0].r,orderBefore);
  const journal=(await db.query('select actor_id,operation,payload,result from cafe_private.drawer_requests where request_id=$1',[request])).rows;
  equal(journal,[{actor_id:ids.admin,operation:'customer_edit',payload,result:repeats[0]}]);
  equal(repeats[0].previous,{name:before.name,phone:before.phone});
  await deny(admin,'select pos_edit_customer($1,$2)',[request,{...payload,name:'Otro nombre'}]);
  const secondAdminId=randomUUID();
  await db.query('insert into auth.users values($1)',[secondAdminId]);
  await db.query("insert into profiles(id,full_name,username,role) values($1,'Otro responsable',$2,'admin')",[secondAdminId,`admin-${secondAdminId}`]);
  const secondAdmin=await connection('authenticated',secondAdminId);
  await deny(secondAdmin,'select pos_edit_customer($1,$2)',[request,{...payload,actor_id:secondAdminId}]);
  const second=await rpc(admin,randomUUID(),{...payload,name:'Nombre final',phone:'8687654322',points:999999,total_spent:0});
  equal(second.customer.points,before.points);equal(second.customer.total_spent,before.total_spent);
  equal(await rpc(admin,request,payload),repeats[0]);equal(await state(customerId),second.customer);
  const duplicate=randomUUID();
  await db.query("insert into customers(id,name,phone) values($1,'Teléfono existente','+52 (868) 765-4323')",[duplicate]);
  await deny(admin,'select pos_edit_customer($1,$2)',[randomUUID(),{...payload,phone:'8687654323'}]);
  equal(await state(customerId),second.customer);
  // Both durable enrollment and its older entry point share the canonical lock.
  for(const [phone,legacy] of [['8687654324',false],['8687654325',true]]) {
    const race=await Promise.allSettled([
      rpc(admin,randomUUID(),{...payload,phone}),
      legacy ? cashier.query('select pos_register_customer($1,$2,null,false)',['Alta concurrente',`+52 ${phone}`])
        : cashier.query('select pos_enroll_customer($1,$2)',[randomUUID(),{actor_id:ids.cashier,name:'Alta concurrente',phone:`+52 ${phone}`,birthday:null,promos:false}]),
    ]);
    equal(race.filter(value=>value.status==='fulfilled').length,1);
    equal((await db.query('select count(*)::int n from customers where cafe_private.loyalty_phone_key(phone)=$1',[`52${phone}`])).rows[0].n,1);
  }
  // Null-phone legacy customers can be corrected without receiving welcome points again.
  const noPhone=randomUUID();await db.query("insert into customers(id,name,phone,points,total_spent) values($1,'Sin teléfono',null,207,999)",[noPhone]);
  const fixed=await rpc(admin,randomUUID(),{actor_id:ids.admin,customer_id:noPhone,name:'Cliente recuperado',phone:'8687654326'});
  equal(fixed.customer.id,noPhone);equal(fixed.customer.points,207);equal(Number(fixed.customer.total_spent),999);
  equal((await cashier.query('select pos_search_customers($1) r',['8687654326'])).rows[0].r[0].id,noPhone);
  console.log(`PASS ${checks} customer correction assertions: admin access, exact replay/audit, legacy data, preserved loyalty/history and concurrent canonical phone uniqueness`);
  return checks;
}
