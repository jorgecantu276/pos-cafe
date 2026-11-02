import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { freshLocalApi } from '../testing/local-api.mjs';
import { startApp } from '../staging/app.mjs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {browserQualityReview} from '../quality/browser-review.mjs';
import {work} from '../staging/runtime.mjs';

let local, app; const sessions = [];
const ok = result => { assert.ifError(result.error && Error(result.error.message)); return result.data; };
const pass = message => console.log('PASS ' + message);
const requestedPort=process.env.POS_ADMIN_TEST_PORT??'3111';
assert.ok(['3111','3112'].includes(requestedPort),'Only dedicated local admin test app ports 3111 and 3112 are allowed');
const port=Number(requestedPort),url=`http://127.0.0.1:${port}`,portBase=port===3112?55501:55481;
try {
  console.log('Starting a new isolated synthetic Auth/PostgREST/PostgreSQL stack…');
  local = await freshLocalApi({portBase});
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
  const teamColumns='id,full_name,username,role,avatar_url,is_active,management_revision';
  const actualTeam=ok(await admin.from('profiles').select(teamColumns));
  assert.ok(actualTeam.some(profile=>profile.id===actors.admin.id)&&actualTeam.some(profile=>profile.id===actors.cashier.id));
  assert.equal(typeof ok(await cashier.from('profiles').select(teamColumns).eq('id',actors.cashier.id).single()).management_revision,'number');
  for(const table of ['products','extras'])ok(await cashier.from(table).select('*'));
  pass('Real UI projections load through Auth/PostgREST, including the staff revision column');
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

  ok(await admin.rpc('pos_set_drawer_rate', { p_request: randomUUID(), p_payload: { rate: 16 } }));
  const register = ok(await cashier.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 100, p_rate: 16 }));
  const drawer = ok(await admin.rpc('pos_drawer_status'));
  assert.equal(drawer.active.cashier_id, actors.cashier.id); assert.equal(drawer.active.id, register.id);
  assert.equal(ok(await admin.from('cash_registers').select('id').eq('opened_by', actors.admin.id).eq('status', 'open')).length, 0);
  assert.equal(ok(await admin.rpc('pos_shift_summary', { p_register: register.id })).expected_cash, 100);
  pass('Caja: administrator reads the employee’s physical drawer, despite having no personal open shift');

  const customer = ok(await cashier.rpc('pos_enroll_customer', { p_request: randomUUID(), p_payload: { name: 'Ana de prueba', phone: '8682345678', birthday: null, promos: false } })).customer;
  assert.equal(customer.points, 50);
  const checkout = { register_id: register.id, items: [{ product_id: product.id, quantity: 2, extra_ids: [extra.id], note: 'Sin azúcar' }],
    expected_total: 140, payment_method: 'efectivo', tender_mxn: 200, tender_usd: 0, customer_id: customer.id, order_type: 'Para Llevar', order_note: 'Prueba aislada',pager_number:30 };
  assert.deepEqual(ok(await cashier.rpc('pos_inventory_state')),{enabled:false,revision:0});
  for(const client of [cashier,anonymous]) assert.ok((await client.rpc('pos_inventory_set_enabled',{p_request:randomUUID(),p_enabled:true,p_revision:0})).error);
  ok(await admin.rpc('pos_inventory_set_enabled',{p_request:randomUUID(),p_enabled:true,p_revision:0}));
  const inventoryItem=()=>admin.rpc('pos_inventory_catalog').then(ok).then(rows=>rows.find(i=>i.product_id===product.id));
  const adjustInventory=async(action,fields)=>ok(await admin.rpc('pos_inventory_write',{p_request:randomUUID(),p_changes:[{product_id:product.id,revision:(await inventoryItem()).revision,action,...fields}]}));
  await adjustInventory('configure',{mode:'counted',unit:'pieza',minimum:2});
  await adjustInventory('count',{quantity:5});
  const saleRequest = randomUUID(), sale = ok(await cashier.rpc('pos_checkout', { p_request: saleRequest, p_payload: checkout }));
  assert.equal(sale.total, 140); assert.equal(sale.change_mxn, 60);
  assert.equal(sale.pager_number,30);
  assert.equal((await inventoryItem()).quantity,3);
  assert.equal(ok(await cashier.from('orders').select('receipt_snapshot').eq('id',sale.id).single()).receipt_snapshot.pager_number,30);
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
  assert.equal((await inventoryItem()).quantity,3);
  assert.ok((await cashier.rpc('pos_checkout', { p_request: randomUUID(), p_payload: checkout })).error);
  ok(await admin.rpc('pos_cancel_sale', { p_order: sale.id }));
  assert.equal((await inventoryItem()).quantity,3);
  const returns=ok(await admin.rpc('pos_inventory_sale_lines',{p_order:sale.id}));
  assert.equal(returns[0].sold,2);
  const returnArgs={p_request:randomUUID(),p_order:sale.id,p_lines:[{id:returns[0].id,quantity:1}]};
  const returned=ok(await admin.rpc('pos_inventory_return',returnArgs));
  assert.deepEqual(ok(await admin.rpc('pos_inventory_return',returnArgs)),returned);
  assert.equal((await inventoryItem()).quantity,4);
  ok(await admin.rpc('pos_inventory_set_enabled',{p_request:randomUUID(),p_enabled:false,p_revision:1}));
  assert.deepEqual(ok(await cashier.rpc('pos_inventory_register')),{enabled:false,items:[]});
  pass('Inventory: off by default, protected activation, real counted sale/replay, cancellation without automatic restock, partial return/replay and paused register');
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

  // This preview must exercise a working print endpoint without reaching hardware.
  // Each drill owns a separate mock journal; no Windows journal is reused.
  const printDirectory=await mkdtemp(path.join(work,'admin-printing-'));
  app = await startApp(config,{port,printing:{directory:printDirectory}}); await app.ready();
  const printStatus=await fetch(url+'/api/printing',{headers:{cookie:employee.cookie(),'X-Pos-Print':'1'}});
  assert.equal(printStatus.status,200);
  assert.deepEqual(await printStatus.json(),{mode:'mock',canManage:false,jobs:[]});
  assert.equal((await fetch(url+'/api/printing',{headers:{'X-Pos-Print':'1'}})).status,401);
  pass('Preview printing: authenticated mock endpoint with an isolated journal, no false unavailable warning and no hardware output');
  for (const route of ['/admin', '/admin/ventas', '/admin/cortes', '/admin/productos', '/admin/clientes', '/admin/favoritos', '/admin/configuracion','/admin/caja','/admin/usuarios','/admin/respaldos','/admin/impresion','/admin/clip','/admin/inventario']) {
    const response = await fetch(url + route, { headers: { cookie: owner.cookie() }, redirect: 'manual' });
    assert.equal(response.status, 200, route); assert.ok((await response.text()).length > 100);
    const denied = await fetch(url + route, { headers: { cookie: employee.cookie() }, redirect: 'manual' });
    assert.equal(denied.status, 307, `cashier ${route}`);
  }
  pass('Isolated production build: all four administration routes render with real owner cookies and reject cashier cookies');
  const endpoint=url+'/api/payments/clip';
  const status=await fetch(endpoint,{headers:{cookie:owner.cookie()}});
  assert.equal(status.status,200);assert.deepEqual(await status.json(),{enabled:false,payments:[]});
  assert.equal((await fetch(endpoint,{headers:{cookie:employee.cookie()}})).status,403);
  assert.equal((await fetch(endpoint)).status,401);
  const blocked=await fetch(endpoint,{method:'POST',headers:{cookie:employee.cookie(),Origin:url,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),payload:{payment_method:'tarjeta'}})});
  assert.equal(blocked.status,503,JSON.stringify(await blocked.json()));
  assert.equal((await db.query('select count(*)::int n from cafe_private.clip_payments')).rows[0].n,0);
  pass('CLIP stays off through real cookie/API boundaries: owner status, cashier/anonymous denial and blocked dispatch with no payment journal writes');
  assert.equal((await db.query('select count(*)::int n from orders')).rows[0].n, 1);
  if(process.env.POS_BROWSER_QUALITY==='1') await browserQualityReview({url,actors,db,appDirectory:app.app});
  if(process.env.POS_KEEP_ADMIN_PREVIEW==='1') {
    const target=path.join(app.app,'inventory-preview.private.json');
    await writeFile(target,JSON.stringify({url,admin:actors.admin,cashier:actors.cashier,config},null,2));
    console.log('Synthetic inventory preview ready; private fixture login: '+target);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }
  console.log('PASS administration HTTP acceptance. Only newly created synthetic test records were written; no hardware output.');
} finally {
  await app?.stop(); for (const client of sessions) client.auth.stopAutoRefresh(); await local?.cleanup();
}
