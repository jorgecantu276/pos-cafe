import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { settings, work } from '../staging/runtime.mjs';
import { verifyIdentity } from '../staging/bootstrap.mjs';
import { createBackup } from './backup.mjs';
import { restoreBackup } from './restore.mjs';
import { databaseFingerprint } from './fingerprint.mjs';
import { allowDatabaseRewind, unseal, sha256 } from './artifacts.mjs';
import { deploymentDrill } from './deployment.mjs';

const runId = randomUUID(), checks = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const started = Date.now();
let restored, db, backup;
const sessions = [];
try {
  const config = await settings(); // Reject hosted targets before any backup access.
  console.log('Creating an encrypted consistent-snapshot backup of synthetic local staging…');
  backup = await createBackup(config, runId);
  pass('Encrypted database/globals/service-config backup verified from disk');
  const damaged = JSON.parse(await (await import('node:fs/promises')).readFile(backup.encrypted, 'utf8'));
  damaged.ciphertext = `${damaged.ciphertext[0] === 'A' ? 'B' : 'A'}${damaged.ciphertext.slice(1)}`;
  await assert.rejects(async () => unseal(damaged, await (await import('node:fs/promises')).readFile(backup.keyFile)));
  pass('Tampered encrypted backup rejected before restore');
  console.log('Restoring into a fresh isolated PostgreSQL cluster with original role passwords…');
  restored = await restoreBackup(backup);
  pass('Failed restore rolls back atomically; complete clean restore succeeds');
  db = new Client({ connectionString: restored.config.database }); await db.connect(); await verifyIdentity(db);
  const fingerprint = await databaseFingerprint(db);
  assert.deepEqual(fingerprint.tables, backup.payload.baseline.tables, 'Restored rows differ');
  assert.deepEqual(fingerprint.counts, backup.payload.baseline.counts);
  for (const [name, catalog] of Object.entries(backup.payload.baseline.catalog)) {
    assert.equal(sha256(JSON.stringify(fingerprint.catalog[name])), sha256(JSON.stringify(catalog)), `Restored catalog differs: ${name}`);
  }
  allowDatabaseRewind(backup.payload.baseline, fingerprint);
  pass('All restored table data, Auth rows, functions, triggers, RLS/grants, defaults and sequence state match');
  pass('Pre-traffic recovery passes the no-new-records rewind guard');
  await restored.startServices();
  const jar = new Map();
  const client = createServerClient(restored.config.api, restored.config.anon, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: values => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  }, auth: { autoRefreshToken: false } }); sessions.push(client);
  const ok = (result, name) => { assert.ifError(result.error && new Error(`${name}: ${result.error.message}`)); return result.data; };
  const admin = backup.payload.credentials.admin;
  ok(await client.auth.signInWithPassword({ email: `${admin.username}@carinitomio.local`, password: admin.password }), 'Restored password login');
  assert.equal(ok(await client.auth.getUser(), 'Restored token verification').user.id, admin.id);
  pass('Real GoTrue login accepts restored Auth password hash and original identity');
  const anon = createClient(restored.config.api, restored.config.anon, { auth: { persistSession: false, autoRefreshToken: false } }); sessions.push(anon);
  const directory = ok(await anon.rpc('pos_login_profiles'), 'Restored directory'); assert.ok(directory.some(row => row.id === admin.id));
  assert.equal((await anon.from('orders').select('*')).error?.code, '42501');
  assert.equal((await anon.rpc('decrement_stock', { row_id: randomUUID(), amount: -1 })).error?.code, '42501');
  pass('Restored PostgREST projection works and anonymous table/legacy stock access stays denied');
  const previous = (await db.query("select o.cashier_id,o.request_id,o.request_payload,o.receipt_snapshot from public.orders o join public.profiles p on p.id=o.cashier_id where o.request_id is not null and p.is_active order by o.created_at limit 1")).rows[0];
  assert.ok(previous, 'A prior synthetic sale is required to verify recovery history');
  // Actor-specific recovery via SQL role fixtures, alongside real Auth checks.
  await db.query('begin');
  try {
    await db.query('set local role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [previous.cashier_id]);
    const replay = (await db.query('select public.pos_checkout($1,$2) receipt', [previous.request_id, previous.request_payload])).rows[0].receipt;
    assert.equal(replay.total, previous.receipt_snapshot.total);
  } finally { await db.query('rollback'); }
  pass('A sale saved before backup remains recoverable under its original actor/request');
  // New writes occur ONLY on the restored disposable clone, not source staging.
  const product = randomUUID();
  ok(await client.from('products').insert({ id: product, name: `Recuperación ${runId.slice(0, 8)}`, price: 35, is_active: true, customizable: false }), 'Recovery product');
  const current = ok(await client.from('cash_registers').select('id').eq('opened_by', admin.id).eq('status', 'open').maybeSingle(), 'Restored opening');
  if(!current){await db.query("update cash_registers set status='closed' where status='open'");await db.query('update cafe_private.drawer_settings set rate=20');}
  const register = current || ok(await client.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 0, p_rate: 20 }), 'Recovery opening');
  const request = randomUUID(), payload = { register_id: register.id, items: [{ product_id: product, quantity: 1, extra_ids: [], note: '' }], expected_total: 35,
    payment_method: 'tarjeta', tender_mxn: 0, tender_usd: 0, customer_id: null, order_type: 'En Local', order_note: 'Solo prueba local de rollback', pager_number: 1 };
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const priorTicket = Number((await db.query('select coalesce(max(ticket_number),0) ticket from public.orders')).rows[0].ticket);
  const deployment = await deploymentDrill(restored.config, backup.payload.contract, cookie, backup.directory, async (replay = false) => {
    const receipt = ok(await client.rpc('pos_checkout', { p_request: request, p_payload: payload }), 'Rollback test sale');
    assert.equal(receipt.total, 35);
    assert.ok(Number(receipt.ticket_number) > priorTicket, 'Restored ticket sequence must not restart or collide');
    if (!replay) pass('New synthetic sale commits on candidate release before simulated failure');
    return receipt;
  });
  pass('Bad readiness and incompatible legacy releases rejected without changing active app');
  pass('Actual production process failure rolls back to retained compatible build');
  assert.equal(ok(await client.from('products').select('stock').eq('id', product).single(), 'Post-rollback stock').stock, 10);
  await assert.rejects(async () => allowDatabaseRewind(backup.payload.baseline, await databaseFingerprint(db)), /rewind refused/);
  pass('Post-backup database rewind refused; sale and idempotency preserved; legacy balance unchanged');
  pass('Restored ticket sequence advances beyond pre-backup sales');
  const sourceDb = new Client({ connectionString: config.database }); await sourceDb.connect();
  try {
    await sourceDb.query('begin isolation level repeatable read read only');
    assert.equal((await databaseFingerprint(sourceDb)).business, backup.payload.baseline.business, 'Source staging business data changed during recovery drill');
    await sourceDb.query('rollback');
  } finally { await sourceDb.end(); }
  pass('Source staging business records independently verified unchanged');
  const result = { runId, completedAt: new Date().toISOString(), elapsedSeconds: Math.round((Date.now() - started) / 1000), passed: checks.length, failed: 0,
    source: 'local synthetic staging only; backup reads', target: 'fresh disposable local recovery cluster', backup: backup.manifest, deployment, checks };
  await writeFile(path.join(work, 'recovery/last-result.json'), JSON.stringify(result, null, 2));
  console.log(`PASS ${checks.length} recovery checks. Source staging and live café records were not changed. Encrypted backup retained under .staging-local/recovery.`);
} catch (error) {
  await writeFile(path.join(work, 'recovery/last-result.json'), JSON.stringify({ runId, passed: checks.length, failed: 1, failure: error.message, checks }, null, 2));
  throw error;
} finally {
  sessions.forEach(client => client.auth.stopAutoRefresh());
  await db?.end(); await restored?.cleanup();
}
