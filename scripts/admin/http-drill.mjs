import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { freshLocalApi } from '../testing/local-api.mjs';
import { startApp } from '../staging/app.mjs';

let local, app; const sessions = [];
const ok = result => { assert.ifError(result.error && Error(result.error.message)); return result.data; };
const pass = message => console.log('PASS ' + message);
try {
  console.log('Starting a new isolated synthetic Auth/PostgREST/PostgreSQL stack…');
  local = await freshLocalApi();
  const { config, db, service } = local;
  const actors = {};
  for (const role of ['admin', 'cashier']) {
    const username = `admincheck_${role}`, password = randomUUID() + '!';
    const user = ok(await service.auth.admin.createUser({ email: `${username}@carinitomio.local`, password, email_confirm: true })).user;
    await db.query('insert into profiles(id,username,full_name,role) values($1,$2,$3,$4)', [user.id, username, `Prueba ${role}`, role]);
    actors[role] = { id: user.id, username, password };
  }
  await local.install();
  async function login(actor) {
    const jar = new Map();
    const client = createServerClient(config.api, config.anon, { cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
    }, auth: { autoRefreshToken: false } });
    sessions.push(client);
    ok(await client.auth.signInWithPassword({ email: `${actor.username}@carinitomio.local`, password: actor.password }));
    return { client, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
  }
  const owner = await login(actors.admin), employee = await login(actors.cashier);
  const admin = owner.client, cashier = employee.client;
  for (let attempt = 0; attempt < 40; attempt++) {
    const ready = await admin.rpc('pos_drawer_status');
    if (!ready.error) break;
    if (attempt === 39) ok(ready);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const anonymous = createClient(config.api, config.anon, { auth: { persistSession: false, autoRefreshToken: false } }); sessions.push(anonymous);
  const payload = { actor_id: actors.admin.id, kind: 'product', action: 'save', id: null,
    fields: { name: 'Café de aceptación', price: 55, category: 'Bebidas', customizable: true, image_url: '', wizard_steps: ['Leche'] } };
  for (const client of [cashier, anonymous]) assert.ok((await client.rpc('pos_save_catalog', { p_request: randomUUID(), p_payload: payload })).error);
  const request = randomUUID();
  const product = ok(await admin.rpc('pos_save_catalog', { p_request: request, p_payload: payload }));
  assert.deepEqual(ok(await admin.rpc('pos_save_catalog', { p_request: request, p_payload: payload })), product);
  assert.equal(ok(await admin.from('products').select('id')).length, 1);
  const extra = ok(await admin.rpc('pos_save_catalog', { p_request: randomUUID(), p_payload: {
    actor_id: actors.admin.id, kind: 'extra', action: 'save', id: null, fields: { name: 'Almendra', price: 10, phase: 'Leche' },
  } }));
  const changed = { ...payload, id: product.id, fields: { ...payload.fields, price: 60 } };
  ok(await admin.rpc('pos_save_catalog', { p_request: randomUUID(), p_payload: changed }));
  ok(await admin.rpc('pos_set_register_shortcuts', { p_request: randomUUID(), p_payload: { actor_id: actors.admin.id, product_ids: [product.id], revision: 0 } }));
  assert.deepEqual(ok(await cashier.rpc('get_register_shortcuts')).product_ids, [product.id]);
  assert.equal(ok(await cashier.from('products').select('price').eq('id', product.id).single()).price, 60);
  pass('Catálogo: real saves/edits, exact create replay, staff denial and cashier-visible price/favorites');

  ok(await admin.rpc('pos_set_drawer_rate', { p_request: randomUUID(), p_payload: { rate: 20 } }));
  const register = ok(await cashier.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 100, p_rate: 20 }));
  const drawer = ok(await admin.rpc('pos_drawer_status'));
  assert.equal(drawer.active.cashier_id, actors.cashier.id); assert.equal(drawer.active.id, register.id);
  assert.equal(ok(await admin.from('cash_registers').select('id').eq('opened_by', actors.admin.id).eq('status', 'open')).length, 0);
  assert.equal(ok(await admin.rpc('pos_shift_summary', { p_register: register.id })).expected_cash, 100);
  pass('Caja: administrator reads the employee’s physical drawer, despite having no personal open shift');

  const customer = ok(await cashier.rpc('pos_enroll_customer', { p_request: randomUUID(), p_payload: { name: 'Ana de prueba', phone: '8682345678', birthday: null, promos: false } })).customer;
  assert.equal(customer.points, 50);
  const checkout = { register_id: register.id, items: [{ product_id: product.id, quantity: 2, extra_ids: [extra.id], note: 'Sin azúcar' }],
    expected_total: 140, payment_method: 'efectivo', tender_mxn: 200, tender_usd: 0, customer_id: customer.id, order_type: 'Para Llevar', order_note: 'Prueba aislada' };
  const saleRequest = randomUUID(), sale = ok(await cashier.rpc('pos_checkout', { p_request: saleRequest, p_payload: checkout }));
  assert.equal(sale.total, 140); assert.equal(sale.change_mxn, 60);
  let sales = ok(await admin.rpc('pos_sales_report', { p_period: 'all' }));
  assert.equal(sales.summary.sales, 140); assert.equal(sales.orders[0].id, sale.id);
  let purchases = ok(await admin.rpc('pos_customer_history', { p_customer: customer.id }));
  assert.equal(purchases.summary.sales, 140); assert.equal(purchases.orders[0].order_items[0].quantity, 2);
  assert.equal(purchases.orders[0].order_items[0].product_snapshot.name, payload.fields.name);
  assert.equal(ok(await admin.rpc('pos_customer_report')).customers[0].points, 64);
  for (const client of [cashier, anonymous]) assert.ok((await client.rpc('pos_customer_history', { p_customer: customer.id })).error);
  const editPayload = { actor_id: actors.admin.id, customer_id: customer.id, name: 'Ana corregida', phone: '528682345679' };
  ok(await admin.rpc('pos_edit_customer', { p_request: randomUUID(), p_payload: editPayload }));
  assert.equal(ok(await admin.rpc('pos_customer_report')).customers[0].completed_spent, 140);
  pass('Ventas/Clientes: checkout, change, saved items, welcome/earned points, customer correction and protected purchase history agree');

  for (const [kind, id] of [['product', product.id], ['extra', extra.id]]) ok(await admin.rpc('pos_save_catalog', {
    p_request: randomUUID(), p_payload: { actor_id: actors.admin.id, action: 'deactivate', kind, id },
  }));
  assert.equal(ok(await admin.rpc('pos_customer_history', { p_customer: customer.id })).orders[0].order_items[0].product_snapshot.name, payload.fields.name);
  assert.deepEqual(ok(await cashier.rpc('pos_checkout', { p_request: saleRequest, p_payload: checkout })), sale);
  assert.ok((await cashier.rpc('pos_checkout', { p_request: randomUUID(), p_payload: checkout })).error);
  ok(await admin.rpc('pos_cancel_sale', { p_order: sale.id }));
  sales = ok(await admin.rpc('pos_sales_report', { p_period: 'all' })); assert.equal(sales.summary.sales, 0);
  purchases = ok(await admin.rpc('pos_customer_history', { p_customer: customer.id }));
  assert.equal(purchases.summary.sales, 0); assert.equal(purchases.orders[0].status, 'cancelled');
  assert.equal(ok(await admin.rpc('pos_customer_report')).customers[0].points, 50);
  const summary = ok(await admin.rpc('pos_shift_summary', { p_register: register.id }));
  const closed = ok(await cashier.rpc('pos_close_shift', { p_register: register.id, p_counted: 100, p_expenses: [],
    p_preview: { cash_sales: summary.cash_sales, total_sales: summary.total_sales, expenses_revision: summary.expenses_revision } }));
  assert.equal(Number(closed.expected_cash), 100);
  assert.equal(ok(await admin.rpc('pos_drawer_status')).active, null);
  assert.equal(ok(await admin.rpc('pos_shift_history')).summary.rows, 1);
  const backup = JSON.parse(ok(await service.rpc('pos_business_backup')));
  assert.ok(backup.tables['cafe_private.catalog_requests'].rows.length >= 4);
  pass('Cross-module cancellation, immutable snapshots/replay, deactivation, loyalty reversal, closing and backup of request journal');

  app = await startApp(config); await app.ready();
  for (const route of ['/admin', '/admin/ventas', '/admin/cortes', '/admin/productos', '/admin/clientes', '/admin/favoritos', '/admin/configuracion']) {
    const response = await fetch('http://127.0.0.1:3101' + route, { headers: { cookie: owner.cookie() }, redirect: 'manual' });
    assert.equal(response.status, 200, route); assert.ok((await response.text()).length > 100);
    const denied = await fetch('http://127.0.0.1:3101' + route, { headers: { cookie: employee.cookie() }, redirect: 'manual' });
    assert.equal(denied.status, 307, `cashier ${route}`);
  }
  pass('Isolated production build: all four administration routes render with real owner cookies and reject cashier cookies');
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n, 1);
  console.log('PASS administration HTTP acceptance. Only newly created synthetic test records were written; no hardware output.');
} finally {
  await app?.stop(); for (const client of sessions) client.auth.stopAutoRefresh(); await local?.cleanup();
}
