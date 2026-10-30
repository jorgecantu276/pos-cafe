import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { verifyIdentity } from './bootstrap.mjs';
import { startApp } from './app.mjs';
import { work } from './runtime.mjs';

export async function stagingTests(config) {
  const db = new Client({ connectionString: config.database });
  await db.connect();
  const checks = [];
  const runId = randomUUID();
  let app;
  const sessions = [];
  const client = key => {
    const result = createClient(config.api, key, { auth: { persistSession: false, autoRefreshToken: false } });
    sessions.push(result); return result;
  };
  const ok = (result, label) => { assert.ifError(result.error && new Error(`${label}: ${result.error.code} ${result.error.message}`)); return result.data; };
  const denied = (result, label) => {
    assert.ok(result.error, `${label} must return an authorization/validation error`);
    assert.match(result.error.code, /^(42501|P0001)$/, `${label} must reach the actual SQL permission/validation boundary`);
    checks.push(label);
  };
  const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
  try {
    await verifyIdentity(db); // Before any test writes or Auth administration.
    const anon = client(config.anon);
    const signupEmail = `public_${runId.slice(0, 8)}@carinitomio.local`;
    const signup = await anon.auth.signUp({ email: signupEmail, password: randomBytes(24).toString('base64url') });
    assert.equal(signup.error?.code, 'signup_disabled', 'Email provider must not enable public registration');
    assert.equal(Number((await db.query('select count(*) n from auth.users where email=$1', [signupEmail])).rows[0].n), 0);
    pass('Email/password provider enabled while public registration remains disabled');
    const { admin: bootstrapAdmin } = JSON.parse(await readFile(path.join(work, 'credentials.json'), 'utf8'));
    async function cookieLogin(username, password) {
      const jar = new Map();
      const supabase = createServerClient(config.api, config.anon, { cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: values => values.forEach(({ name, value }) => { if (value) jar.set(name, value); else jar.delete(name); }),
      }, auth: { autoRefreshToken: false } });
      sessions.push(supabase);
      ok(await supabase.auth.signInWithPassword({ email: `${username}@carinitomio.local`, password }), 'Real GoTrue sign-in');
      return { supabase, jar, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
    }
    const administrator = await cookieLogin(bootstrapAdmin.username, bootstrapAdmin.password);
    const admin = administrator.supabase;
    assert.equal(ok(await admin.auth.getUser(), 'Admin token verification').user.id, bootstrapAdmin.id);
    assert.ok(administrator.jar.size > 0, 'SSR cookies must actually be written');
    pass('GoTrue password login and Supabase SSR cookie persistence');

    const snapshot = JSON.parse((await verifyIdentity(db)).snapshot);
    for (const table of snapshot.tables) denied(await anon.from(table.name).select('*').limit(1), `anonymous table ${table.name} denied`);
    const directory = ok(await anon.rpc('pos_login_profiles'), 'Anonymous projected directory');
    assert.ok(Array.isArray(directory) && directory.some(row => row.id === bootstrapAdmin.id));
    assert.deepEqual(Object.keys(directory[0]).sort(), ['avatar_url', 'full_name', 'id', 'username']);
    pass('PostgREST anonymous directory exposes only approved fields');

    // Provision through the actual Next.js route with actual cookie verification.
    app = await startApp(config); await app.ready();
    const worker = await fetch('http://127.0.0.1:3101/sw.js');
    assert.equal(worker.status, 200); assert.match(worker.headers.get('cache-control'), /no-store/);
    assert.ok(!(await worker.text()).includes("addEventListener('fetch'"));
    pass('Production app serves the uncached, network-transparent service worker');
    const http = async (method, body, cookie = '') => fetch('http://127.0.0.1:3101/api/users', {
      method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    });
    assert.equal((await http('POST', {})).status, 401);
    const actors = {};
    const prefix = `stg_${runId.slice(0, 8)}`;
    for (const role of ['cashier', 'barista', 'admin']) {
      const username = `${prefix}_${role}`, password = randomBytes(24).toString('base64url');
      const response = await http('POST', { username, password, full_name: `Prueba ${role}`, role }, administrator.cookie());
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
      assert.ok(result.user?.id);
      actors[role] = { id: result.user.id, username, password, ...await cookieLogin(username, password) };
    }
    pass('Next.js user route: anonymous rejection and administrator Auth/profile provisioning');
    const cash = actors.cashier.supabase, bar = actors.barista.supabase;
    assert.equal((await http('POST', {}, actors.cashier.cookie())).status, 403);
    assert.equal((await http('PATCH', {}, actors.barista.cookie())).status, 403);
    const dashboard = await fetch('http://127.0.0.1:3101/admin', { redirect: 'manual', headers: { cookie: actors.cashier.cookie() } });
    assert.equal(dashboard.status, 307); assert.equal(new URL(dashboard.headers.get('location'), 'http://127.0.0.1:3101').pathname, '/');
    const adminPage = await fetch('http://127.0.0.1:3101/admin', { redirect: 'manual', headers: { cookie: administrator.cookie() } });
    assert.equal(adminPage.status, 200);
    pass('Actual staff/admin cookie authorization through middleware and server layout');
    ok(await cash.auth.refreshSession(), 'Real refresh-token rotation');
    const refreshed = await fetch('http://127.0.0.1:3101/', { redirect: 'manual', headers: { cookie: actors.cashier.cookie() } });
    assert.equal(refreshed.status, 200);
    pass('Refreshed Auth session remains accepted by the local app');

    denied(await cash.from('profiles').select('pin_code'), 'PIN column read denied');
    denied(await cash.from('profiles').update({ role: 'admin' }).eq('id', actors.cashier.id), 'Profile self-escalation denied');
    denied(await cash.from('orders').insert({ total: 1, subtotal: 1 }), 'Direct sale insertion denied');
    denied(await cash.rpc('decrement_stock', { row_id: randomUUID(), amount: -5 }), 'Legacy stock RPC denied');
    denied(await anon.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 0, p_rate: 20 }), 'Anonymous shift RPC denied');

    const product = randomUUID(), supply = randomUUID(), extra = randomUUID();
    ok(await admin.from('products').insert({ id: product, name: `Café ${prefix}`, price: 50, stock: 10, is_active: true, customizable: true, wizard_steps: ['Tamaño'] }), 'Admin product insert');
    ok(await admin.from('supplies').insert({ id: supply, name: `Leche ${prefix}`, unit: 'ml', current_stock: 1000 }), 'Admin supply insert');
    ok(await admin.from('product_recipes').insert({ product_id: product, supply_id: supply, quantity_required: 125 }), 'Admin recipe insert');
    ok(await admin.from('extras').insert({ id: extra, name: `Grande ${prefix}`, price: 10, phase: 'Tamaño' }), 'Admin extra insert');
    const catalog = ok(await cash.from('products').select('id,name,price').eq('id', product), 'Staff catalog read'); assert.equal(catalog.length, 1);
    const attemptedStock = await cash.from('products').update({ stock: 999 }).eq('id', product).select('id');
    assert.ok(attemptedStock.error || attemptedStock.data.length === 0);
    assert.equal(ok(await admin.from('products').select('stock').eq('id', product).single(), 'Stock remains authoritative').stock, 10);
    pass('Real RLS catalog reads, admin writes and staff stock-write denial');

    const customer = ok(await cash.rpc('pos_register_customer', { p_name: `Cliente ${prefix}`, p_phone: null, p_birth_date: null, p_promos: false }), 'Customer RPC JSON');
    assert.ok(!Array.isArray(customer) && customer.id); assert.equal(customer.points, 50);
    const opening = { p_request: randomUUID(), p_cash: 100, p_rate: 20 };
    const register = ok(await cash.rpc('pos_open_shift', opening), 'Opening RPC JSON');
    assert.ok(register.id && !Array.isArray(register));
    assert.equal(ok(await cash.rpc('pos_open_shift', opening), 'Opening retry').id, register.id);
    const barRegister = ok(await bar.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 0, p_rate: 20 }), 'Second staff opening');
    const payload = { register_id: register.id, items: [{ product_id: product, quantity: 2, extra_ids: [extra], note: 'Sin hielo' }],
      expected_total: 120, payment_method: 'mixto', tender_mxn: 20, tender_usd: 5, customer_id: customer.id, order_type: 'En Local', order_note: 'Prueba aislada' };
    denied(await cash.rpc('pos_checkout', { p_request: randomUUID(), p_payload: { ...payload, expected_total: 1 } }), 'Server-price mismatch rejected');
    denied(await bar.rpc('pos_checkout', { p_request: randomUUID(), p_payload: payload }), 'Foreign register checkout rejected');
    const request = randomUUID();
    const [first, retry] = await Promise.all([cash.rpc('pos_checkout', { p_request: request, p_payload: payload }), cash.rpc('pos_checkout', { p_request: request, p_payload: payload })]);
    const receipt = ok(first, 'Checkout JSON'), repeat = ok(retry, 'Concurrent retry');
    assert.ok(receipt.id && !Array.isArray(receipt)); assert.equal(receipt.id, repeat.id); assert.equal(receipt.total, 120);
    assert.equal(receipt.items[0].product.price, 60); assert.equal(receipt.change_mxn, 0);
    denied(await cash.rpc('pos_checkout', { p_request: request, p_payload: { ...payload, order_note: 'Changed' } }), 'Changed replay payload rejected');
    assert.equal(ok(await admin.from('products').select('stock').eq('id', product).single(), 'Read remaining stock').stock, 8);
    assert.equal(Number(ok(await admin.from('supplies').select('current_stock').eq('id', supply).single(), 'Read ingredient stock').current_stock), 750);
    assert.equal(ok(await cash.from('customers').select('points').eq('id', customer.id).single(), 'Read loyalty').points, 62);
    pass('Scalar JSON RPCs, server prices, tender, atomic stock/loyalty and concurrent replay');

    const own = ok(await cash.from('orders').select('id,order_items(quantity,product_snapshot,products(name))').eq('id', receipt.id), 'Own receipt join');
    assert.equal(own.length, 1); assert.equal(own[0].order_items[0].products.name, `Café ${prefix}`);
    assert.equal(ok(await bar.from('orders').select('id').eq('id', receipt.id), 'Foreign receipt RLS').length, 0);
    assert.equal(ok(await bar.from('order_items').select('id').eq('order_id', receipt.id), 'Foreign item RLS').length, 0);
    assert.equal(ok(await admin.from('orders').select('id').eq('id', receipt.id), 'Admin receipt RLS').length, 1);
    pass('PostgREST nested joins respect cashier ownership and administrator history');

    denied(await cash.rpc('pos_cancel_sale', { p_order: receipt.id }), 'Staff cancellation denied');
    ok(await admin.rpc('pos_cancel_sale', { p_order: receipt.id }), 'Admin cancellation');
    ok(await admin.rpc('pos_cancel_sale', { p_order: receipt.id }), 'Cancellation retry');
    assert.equal(ok(await cash.from('customers').select('points').eq('id', customer.id).single(), 'Reversed loyalty').points, 50);
    assert.equal(ok(await cash.rpc('pos_checkout', { p_request: request, p_payload: payload }), 'Cancelled recovery JSON').status, 'cancelled');
    const abandoned = randomUUID(); ok(await cash.rpc('pos_abandon_checkout', { p_request: abandoned }), 'Abandon absent request');
    denied(await cash.rpc('pos_checkout', { p_request: abandoned, p_payload: payload }), 'Delayed abandoned request rejected');
    const closing = { p_register: register.id, p_counted: 95, p_expenses: [{ desc: 'Gasto sintético', amount: 5 }] };
    const summary = ok(await cash.rpc('pos_shift_expenses', { p_register:register.id,p_request:randomUUID(),p_revision:0,p_expenses:closing.p_expenses }), 'Expense journal');
    const checkedClosing = {...closing,p_preview:summary};
    const report = ok(await cash.rpc('pos_close_shift', checkedClosing), 'Closing JSON');
    assert.ok(!Array.isArray(report)); assert.equal(Number(report.total_sales), 0); assert.equal(Number(report.expected_cash), 95);
    assert.equal(ok(await cash.rpc('pos_close_shift', checkedClosing), 'Close retry').id, report.id);
    denied(await cash.rpc('pos_checkout', { p_request: randomUUID(), p_payload: payload }), 'Closed shift checkout denied');
    const barPreview=ok(await bar.rpc('pos_shift_summary',{p_register:barRegister.id}),'Bar closing preview');
    ok(await bar.rpc('pos_close_shift', { p_register: barRegister.id, p_counted: 0, p_expenses: [],p_preview:barPreview }), 'Second staff closing');
    pass('Cancellation, abandonment and closing/recovery contracts over actual HTTP');

    const disabled = await http('PATCH', { id: actors.cashier.id, full_name: 'Prueba desactivada', username: actors.cashier.username, role: 'cashier', is_active: false }, administrator.cookie());
    assert.equal(disabled.status, 200);
    denied(await cash.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 0, p_rate: 20 }), 'Existing token loses staff privileges after deactivation');
    assert.equal((await http('POST', {}, actors.cashier.cookie())).status, 403);
    const newDirectory = ok(await anon.rpc('pos_login_profiles'), 'Directory after deactivation');
    assert.ok(!newDirectory.some(row => row.id === actors.cashier.id));
    pass('Deactivation takes effect for existing sessions and anonymous directory');

    const result = { run_id: runId, completed_at: new Date().toISOString(), target: 'local Supabase only', passed: checks.length, failed: 0, checks };
    await writeFile(path.join(work, 'last-result.json'), JSON.stringify(result, null, 2));
    console.log(`PASS ${checks.length} local Supabase checks. Synthetic records retained for inspection; no live project contacted.`);
  } catch (error) {
    await writeFile(path.join(work, 'last-result.json'), JSON.stringify({ run_id: runId, completed_at: new Date().toISOString(), target: 'local Supabase only', passed: checks.length, failed: 1, failure: error.message, checks }, null, 2));
    throw error;
  } finally {
    await app?.stop();
    sessions.forEach(session => session.auth.stopAutoRefresh());
    await db.end();
  }
}
