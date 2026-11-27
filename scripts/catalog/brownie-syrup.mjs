import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const syrupPhase = 'Jarabe Brownie';
export const syrupNames = ['Caramelo', 'Caramelo salado', 'Chocolate', 'Sin jarabe'];
const targets = `category='Postres' and is_active is true and lower(name) ~ '^brownie\\M.*\\mnieve\\M'`;
const rows = async (db, sql, args = []) => JSON.parse(JSON.stringify((await db.query(sql, args)).rows));
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);

// Caller owns the transaction and saves the returned snapshots privately before COMMIT.
export async function planBrownieSyrup(db) {
  const products = await rows(db, `select * from public.products where ${targets} order by id`);
  assert.ok(products.length, 'No hay brownies con nieve activos; revisa el catálogo.');
  assert.ok(products.every(p => Number(p.price) > 0 && !(p.wizard_steps ?? []).includes(syrupPhase)), 'Revisa los precios/grupos actuales.');
  assert.ok(products.every(p => p.customizable === true || !(p.wizard_steps ?? []).length), 'Hay grupos desactivados en un brownie; revisa su preparación antes del ajuste.');
  same(await rows(db, 'select id from public.extras where phase=$1', [syrupPhase]), [], 'Ya existe el grupo de jarabes.');
  same(await rows(db, 'select id from public.products where $1=any(wizard_steps)', [syrupPhase]), [], 'Otro producto usa el grupo de jarabes.');
  return { format: 'cafe-brownie-syrup-v1', before: products,
    extras: syrupNames.map((name, i) => ({ id: randomUUID(), name, price: '0.00', phase: syrupPhase, active: true, orden_opcion: i + 1 })) };
}

async function lock(db) {
  await db.query("set local lock_timeout='5s'");
  await db.query('select pg_advisory_xact_lock(60281102013)');
  await db.query('lock table public.products,public.extras in share row exclusive mode');
}

async function snapshot(db, plan) {
  return { products: await rows(db, 'select * from public.products where id=any($1::uuid[]) order by id', [plan.before.map(p => p.id)]),
    extras: await rows(db, 'select * from public.extras where phase=$1 order by id', [syrupPhase]) };
}

export async function applyBrownieSyrup(db, plan) {
  assert.equal(plan.format, 'cafe-brownie-syrup-v1');
  await lock(db);
  if (plan.after) {
    const current = await snapshot(db, plan);
    if (JSON.stringify(current) === JSON.stringify(plan.after)) return plan;
    // The private receipt was saved, but COMMIT may never have happened.
    same(current, { products: plan.before, extras: [] }, 'El catálogo cambió después del ajuste.');
  }
  same(await rows(db, `select * from public.products where ${targets} order by id`), plan.before, 'Los brownies cambiaron; prepara un nuevo plan.');
  same(await rows(db, 'select id from public.extras where phase=$1', [syrupPhase]), []);
  same(await rows(db, 'select id from public.products where $1=any(wizard_steps)', [syrupPhase]), []);
  for (const signature of ['cafe_private.manual_checkout(uuid,jsonb)', 'cafe_private.clip_quote(uuid,jsonb)', 'cafe_private.phone_catalog_quote(uuid,jsonb)']) {
    const [{ definition }] = await rows(db, 'select pg_get_functiondef($1::regprocedure) definition', [signature]);
    assert.ok(definition.includes('-- brownie-syrup-v1:'), 'Falta la migración revisada de jarabes; no se modifica el catálogo.');
  }
  same(plan.extras.map(({ name, price, phase, active, orden_opcion }) => ({ name, price, phase, active, orden_opcion })),
    syrupNames.map((name, i) => ({ name, price: '0.00', phase: syrupPhase, active: true, orden_opcion: i + 1 })));
  for (const extra of plan.extras) await db.query('insert into public.extras(id,name,price,phase,active,orden_opcion) values($1,$2,$3,$4,$5,$6)', [extra.id, extra.name, extra.price, extra.phase, extra.active, extra.orden_opcion]);
  await db.query('update public.products set customizable=true,wizard_steps=array_append(coalesce(wizard_steps,array[]::text[]),$1) where id=any($2::uuid[])', [syrupPhase, plan.before.map(p => p.id)]);
  return { ...plan, after: await snapshot(db, plan) };
}

export async function rollbackBrownieSyrup(db, plan) {
  assert.equal(plan.format, 'cafe-brownie-syrup-v1');
  assert.ok(plan.after, 'Falta la evidencia del ajuste aplicado.');
  await lock(db);
  if (plan.rolledBack) {
    const current = await snapshot(db, plan);
    if (JSON.stringify(current) === JSON.stringify(plan.rolledBack)) return plan;
    same(current, plan.after, 'Hay cambios posteriores; no se revierte el catálogo.');
  }
  same(await snapshot(db, plan), plan.after, 'Hay cambios posteriores; no se revierte el catálogo.');
  same(await rows(db, 'select id from public.products where $1=any(wizard_steps) order by id', [syrupPhase]), plan.before.map(({ id }) => ({ id })), 'Otro producto usa los jarabes.');
  for (const product of plan.before) await db.query('update public.products set customizable=$2,wizard_steps=$3 where id=$1', [product.id, product.customizable, product.wizard_steps]);
  // Keep extra IDs for historical references; never alter saved sales or documents.
  await db.query('update public.extras set active=false where id=any($1::uuid[])', [plan.extras.map(e => e.id)]);
  return { ...plan, rolledBack: await snapshot(db, plan) };
}
