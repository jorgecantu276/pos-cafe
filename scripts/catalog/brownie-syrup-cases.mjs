import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { planBrownieSyrup, applyBrownieSyrup, rollbackBrownieSyrup, syrupNames, syrupPhase } from './brownie-syrup.mjs';

export async function brownieSyrupCases(db, connection) {
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const actor = randomUUID(), register = randomUUID(), brownie = randomUUID(), other = randomUUID();
  await db.query('insert into auth.users values($1)', [actor]);
  await db.query("insert into profiles(id,full_name,username,role) values($1,'Prueba jarabes',$2,'cashier')", [actor, actor]);
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query('update pos_inventory_settings set enabled=false');
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,0,16,'open')", [register, actor]);
  await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,'Brownie oreo con nieve',110,'Postres',true,false,null),($2,'Brownie tradicional',30,'Postres',true,false,null)", [brownie, other]);
  const staff = await connection('authenticated', actor);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  const payload = (id, extra_ids, total = 110) => ({ register_id: register, items: [{ product_id: id, quantity: 1, extra_ids, note: 'Nieve aparte' }],
    expected_total: total, payment_method: 'tarjeta', tender_mxn: 0, tender_usd: 0, customer_id: null, order_type: 'Para Llevar', order_note: '', pager_number: 1 });
  const request = randomUUID(), oldPayload = payload(brownie, []);
  const old = (await staff.query('select pos_checkout($1,$2) result', [request, oldPayload])).rows[0].result;
  const untouched = (await db.query('select to_jsonb(p) p from products p where id=$1', [other])).rows[0].p;
  await db.query('begin');
  await db.query("update products set wizard_steps=array['Grupo desactivado'] where id=$1", [brownie]);
  await assert.rejects(planBrownieSyrup(db), /grupos desactivados/); checks++;
  await db.query('rollback');
  let plan = await planBrownieSyrup(db);
  await db.query('begin');
  await db.query('update products set price=111 where id=$1', [brownie]);
  await assert.rejects(applyBrownieSyrup(db, plan), /cambiaron/); checks++;
  await db.query('rollback');
  await db.query('begin');
  await assert.rejects(applyBrownieSyrup(db, plan), /Falta la migración/); checks++;
  await db.query('rollback');
  const migration = await readFile(new URL('../../supabase/migrations/202611270026_brownie_syrup_choice.sql', import.meta.url), 'utf8');
  await db.query(migration);
  await db.query(migration); // Safe maintenance retry does not stack validation.
  // Private receipt saved, transaction rolled back: reconcile the original plan.
  await db.query('begin');
  const uncertain = JSON.parse(JSON.stringify(await applyBrownieSyrup(db, plan)));
  await db.query('rollback');
  await db.query('begin');
  plan = JSON.parse(JSON.stringify(await applyBrownieSyrup(db, uncertain)));
  await db.query('commit');
  equal(plan.after.products.find(p => p.id === brownie).price, '110.00');
  equal(plan.after.extras.map(e => e.name).sort(), [...syrupNames].sort());
  await db.query('begin'); await applyBrownieSyrup(db, plan); await db.query('commit'); checks++;
  equal((await db.query('select to_jsonb(p) p from products p where id=$1', [other])).rows[0].p, untouched);
  for (const fn of ['pos_checkout', 'cafe_private.clip_quote', 'cafe_private.phone_catalog_quote']) {
    const client = fn === 'pos_checkout' ? staff : db;
    for (const extra of plan.extras) {
      const result = (await client.query(`select ${fn}($1,$2) result`, [randomUUID(), payload(brownie, [extra.id])])).rows[0].result;
      equal(Number(result.total), 110);
      equal(result.items[0].product.displayExtras.map(e => [e.name, Number(e.price)]), [[extra.name, 0]]);
    }
    for (const extras of [[], plan.extras.slice(0, 2).map(e => e.id), [plan.extras[0].id, plan.extras[0].id], [randomUUID()]]) {
      await assert.rejects(client.query(`select ${fn}($1,$2)`, [randomUUID(), payload(brownie, extras)])); checks++;
    }
    await assert.rejects(client.query(`select ${fn}($1,$2)`, [randomUUID(), payload(other, [plan.extras[0].id], 30)])); checks++;
  }
  equal((await staff.query('select pos_checkout($1,$2) result', [request, oldPayload])).rows[0].result, old);
  // A concurrent edit refuses the whole change, including an undo.
  await db.query('begin');
  await db.query('update products set price=111 where id=$1', [brownie]);
  await assert.rejects(rollbackBrownieSyrup(db, plan), /cambios posteriores/); checks++;
  await db.query('rollback');
  await db.query('begin'); const uncertainRollback = await rollbackBrownieSyrup(db, plan); await db.query('rollback');
  await db.query('begin'); plan = await rollbackBrownieSyrup(db, uncertainRollback); await db.query('commit');
  equal((await db.query('select customizable,wizard_steps,price from products where id=$1', [brownie])).rows[0], { customizable: false, wizard_steps: null, price: '110.00' });
  equal((await db.query('select count(*)::int n from extras where phase=$1 and active', [syrupPhase])).rows[0].n, 0);
  await db.query('begin'); await rollbackBrownieSyrup(db, plan); await db.query('commit'); checks++;
  equal((await staff.query('select pos_checkout($1,$2) result', [request, oldPayload])).rows[0].result, old);
  console.log(`PASS ${checks} brownie syrup checks: all three quote paths, one included choice, refusal, replay, unchanged history and guarded rollback`);
  return checks;
}
