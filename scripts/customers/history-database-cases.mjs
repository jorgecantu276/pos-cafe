import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function customerHistoryDatabaseCases(db, connection, ids) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const admin = await connection('authenticated', ids.admin), cashier = await connection('authenticated', ids.cashier), anon = await connection('anon');
  const customer = randomUUID(), other = randomUUID();
  await db.query("insert into customers(id,name,points,total_spent) values($1,'Historial',77,9999),($2,'Otro',0,0)", [customer, other]);
  const fixtures = Array.from({ length: 57 }, (_, i) => ({ id: randomUUID(), ticket: 910000 + i, total: 0.10, status: i < 55 ? 'completed' : i === 55 ? 'cancelled' : 'pending' }));
  await db.query(`insert into orders(id,customer_id,ticket_number,total,subtotal,status,created_at)
    select (x->>'id')::uuid,$1,(x->>'ticket')::int,(x->>'total')::numeric,(x->>'total')::numeric,x->>'status','2025-11-02T12:00:00Z'
    from jsonb_array_elements($2) x`, [customer, JSON.stringify(fixtures)]);
  await db.query(`insert into order_items(order_id,quantity,unit_price,total_price,notes,product_snapshot)
    select (x->>'id')::uuid,1,0.10,0.10,'Sin azúcar','{"name":"Nombre histórico","price":0.10}'::jsonb from jsonb_array_elements($1) x`, [JSON.stringify(fixtures)]);
  await db.query("insert into orders(customer_id,subtotal,total,status) values($1,9999,9999,'completed')", [other]);
  const read = async (page = 0, asOf = null) => (await admin.query('select pos_customer_history($1,$2,$3) r', [customer, page, asOf])).rows[0].r;
  for (const client of [cashier, anon]) { await assert.rejects(client.query('select pos_customer_history($1)', [customer])); checks++; }
  for (const args of [[null, 0, null], [randomUUID(), 0, null], [customer, -1, null], [customer, 0, 'infinity']]) {
    await assert.rejects(admin.query('select pos_customer_history($1,$2,$3)', args)); checks++;
  }
  const first = await read(); equal(first.summary, { rows: 57, sales: 5.5 }); equal(first.orders.length, 50);
  equal(first.orders[0].order_items[0].product_snapshot.name, 'Nombre histórico');
  const second = await read(1, first.as_of); equal(second.orders.length, 7);
  equal(new Set([...first.orders, ...second.orders].map(o => o.id)).size, 57);
  await db.query("insert into orders(customer_id,subtotal,total,status,created_at) values($1,100,100,'completed',$2::timestamptz+interval '1 second')", [customer, first.as_of]);
  equal((await read(1, first.as_of)).summary, first.summary);
  equal((await db.query('select points,total_spent::text from customers where id=$1', [customer])).rows[0], { points: 77, total_spent: '9999.00' });
  console.log(`PASS ${checks} customer history assertions: admin scope, isolated customers, saved names, cents/statuses, pagination/cutoff and read-only loyalty`);
  return checks;
}
