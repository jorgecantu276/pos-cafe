import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function catalogDatabaseCases(db, connection, ids) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const deny = async (client, payload, request = randomUUID()) => { await assert.rejects(rpc(client, request, payload)); checks++; };
  const admin = await connection('authenticated', ids.admin), parallel = await connection('authenticated', ids.admin);
  const cashier = await connection('authenticated', ids.cashier), anonymous = await connection('anon');
  const rpc = async (client, request, payload) => (await client.query('select pos_save_catalog($1,$2) result', [request, payload])).rows[0].result;
  const fields = { name: 'Café de prueba', price: 55.5, category: 'Bebidas', customizable: true, image_url: '', wizard_steps: ['Leche'] };
  const payload = { actor_id: ids.admin, kind: 'product', action: 'save', id: null, fields };
  await deny(cashier, { ...payload, actor_id: ids.cashier }); await deny(anonymous, payload);
  await deny(admin, { ...payload, actor_id: ids.cashier });
  const before = (await db.query('select count(*)::int n from products')).rows[0].n;
  for (const change of [{ name: '' }, { price: -1 }, { price: 1.001 }, { price: null }, { category: '' }, { customizable: null }, { wizard_steps: [null] }]) {
    await deny(admin, { ...payload, fields: { ...fields, ...change } });
  }
  equal((await db.query('select count(*)::int n from products')).rows[0].n, before);
  const request = randomUUID();
  const [created, repeated] = await Promise.all([rpc(admin, request, payload), rpc(parallel, request, payload)]);
  equal(created, repeated); equal(created.request_id, request);
  equal((await db.query('select count(*)::int n from products')).rows[0].n, before + 1);
  await deny(admin, { ...payload, fields: { ...fields, price: 90 } }, request);
  await db.query('update products set stock=17 where id=$1', [created.id]);
  const history = (await db.query('select id,product_snapshot,unit_price,total_price from order_items order by id')).rows;
  await rpc(admin, randomUUID(), { ...payload, id: created.id, fields: { ...fields, price: 60, stock: 0 } });
  equal((await db.query('select stock,price::float8 price from products where id=$1', [created.id])).rows[0], { stock: 17, price: 60 });
  // Old create retries cannot revert a later edit or reactivate a deactivated item.
  equal(await rpc(admin, request, payload), created);
  const deactivate = { actor_id: ids.admin, kind: 'product', action: 'deactivate', id: created.id };
  const deactivation = randomUUID();
  equal(await rpc(admin, deactivation, deactivate), await rpc(parallel, deactivation, deactivate));
  equal(await rpc(admin, request, payload), created);
  equal((await db.query('select is_active,stock,price::float8 price from products where id=$1', [created.id])).rows[0], { is_active: false, stock: 17, price: 60 });
  const extraPayload = { actor_id: ids.admin, kind: 'extra', action: 'save', id: null, fields: { name: 'Leche de prueba', price: 12, phase: 'Leche' } };
  const extraRequest = randomUUID(), extra = await rpc(admin, extraRequest, extraPayload);
  equal(await rpc(parallel, extraRequest, extraPayload), extra);
  await rpc(admin, randomUUID(), { ...extraPayload, id: extra.id, fields: { ...extraPayload.fields, price: 15 } });
  await rpc(admin, randomUUID(), { actor_id: ids.admin, kind: 'extra', action: 'deactivate', id: extra.id });
  equal((await db.query('select active,price::float8 price from extras where id=$1', [extra.id])).rows[0], { active: false, price: 15 });
  equal((await db.query('select id,product_snapshot,unit_price,total_price from order_items order by id')).rows, history);
  await deny(admin, { ...deactivate, id: randomUUID() });
  await assert.rejects(admin.query('select * from cafe_private.catalog_requests')); checks++;
  console.log(`PASS ${checks} catalog assertions: admin permissions, atomic validation, concurrent replay, safe edits/deactivation and preserved history`);
  return checks;
}
