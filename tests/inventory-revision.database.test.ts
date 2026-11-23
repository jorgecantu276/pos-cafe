import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { Client } from 'pg';
import { createTestPostgres } from '../scripts/testing/postgres.mjs';
import { baselineStatements } from '../scripts/staging/safety.mjs';
import { InventoryRevisionRejected, readInventoryRequest, saveInventoryRequest,
  type InventoryClient, type InventoryRequest } from '../lib/inventory';

test('real SQL stale rejection retires only rolled-back requests; lost commits replay once', { timeout: 120_000 }, async () => {
  // This test creates its own loopback database/password/accounts. It never
  // reads a .env, linked project, customer directory or existing listener.
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-inventory-recovery-'));
  const password = randomUUID(), actor = randomUUID(), cashier = randomUUID();
  const server = createTestPostgres({ databaseDir: path.join(directory, 'data'), user: 'postgres', password,
    port, persistent: true, onLog: () => {}, onError: () => {} });
  const settings = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' };
  const db = new Client(settings), admin = new Client(settings), cash = new Client(settings);
  const values = new Map<string, string>();
  const state = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  try {
    await server.initialise(); await server.start(); await db.connect();
    await db.query(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema extensions; create table auth.users(id uuid primary key);
      create table auth.identities(id uuid primary key,user_id uuid,provider text,identity_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`);
    const snapshot = JSON.parse(await readFile(new URL('../supabase/schema.snapshot.json', import.meta.url), 'utf8'));
    for (const statement of baselineStatements(snapshot)) await db.query(statement);
    for (const [id, role] of [[actor, 'admin'], [cashier, 'cashier']]) {
      await db.query('insert into auth.users values($1)', [id]);
      await db.query('insert into profiles(id,full_name,username,role) values($1,$2,$2,$2)', [id, role]);
    }
    // SQL-only scope deliberately excludes Storage's platform migration 022.
    // Every other current migration, including the new rejection contract, runs.
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    const names = (await readdir(migrations)).filter(name => name.endsWith('.sql') && !name.includes('0022_')).sort();
    assert.ok(names.some(name => name.endsWith('_inventory_revision_rejection.sql')));
    for (const name of names) await db.query(await readFile(new URL(name, migrations), 'utf8'));
    await admin.connect(); await cash.connect();
    for (const [client, id] of [[admin, actor], [cash, cashier]] as const) {
      await client.query('set role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    }
    const { rows: [{ id: product }] } = await db.query("insert into products(name,price,category,is_active) values('Synthetic recovery item',10,'Pruebas',true) returning id");
    const current = async () => (await db.query('select * from pos_inventory_items where product_id=$1', [product])).rows[0];
    const rpcCalls: unknown[] = [];
    const api = { rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(structuredClone(args));
      try {
        const result = name === 'pos_inventory_write'
          ? await admin.query('select pos_inventory_write($1,$2,$3) result', [args.p_request, JSON.stringify(args.p_changes), args.p_actor])
          : await admin.query('select pos_inventory_set_enabled($1,$2,$3,$4) result', [args.p_request, args.p_enabled, args.p_revision, args.p_actor]);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        const failure = error as { code: string; message: string };
        return { data: null, error: { code: failure.code, message: failure.message } };
      }
    } } as unknown as InventoryClient;
    const count = async (quantity: number): Promise<InventoryRequest> => ({ actor, request: randomUUID(), rpc: 'pos_inventory_write',
      args: { p_changes: [{ product_id: product, revision: (await current()).revision, action: 'count', quantity }] } });
    await admin.query('select pos_inventory_set_enabled($1,true,0)', [randomUUID()]);
    await admin.query('select pos_inventory_write($1,$2)', [randomUUID(), JSON.stringify([{
      product_id: product, revision: (await current()).revision, action: 'configure', mode: 'counted', unit: 'pieza', minimum: null,
    }])]);
    await saveInventoryRequest(api, state, await count(10));
    const stale = await count(20);
    await admin.query('select pos_set_drawer_rate($1,$2)', [randomUUID(), { rate: 20 }]);
    const shift = (await cash.query('select pos_open_shift($1,0,20) result', [randomUUID()])).rows[0].result;
    await cash.query('select pos_checkout($1,$2)', [randomUUID(), { register_id: shift.id,
      items: [{ product_id: product, quantity: 1, extra_ids: [], note: '' }], expected_total: 10,
      payment_method: 'tarjeta', tender_mxn: 0, tender_usd: 0, customer_id: null,
      order_type: 'Para Llevar', order_note: '', pager_number: 1 }]);
    assert.equal((await current()).quantity, 9);
    const before = JSON.stringify(await current());
    await assert.rejects(saveInventoryRequest(api, state, stale), InventoryRevisionRejected);
    assert.equal(readInventoryRequest(state, actor), null);
    assert.equal(JSON.stringify(await current()), before);
    assert.equal((await db.query('select count(*)::int n from cafe_private.inventory_requests where request_id=$1', [stale.request])).rows[0].n, 0);
    // Even an old client replay receives the same known no-write rejection.
    await assert.rejects(saveInventoryRequest(api, state, stale), InventoryRevisionRejected);
    await saveInventoryRequest(api, state, await count(12));
    assert.equal((await current()).quantity, 12);

    const committed = await count(14), callsBefore = rpcCalls.length;
    const loseReply = { rpc: async (name: string, args: Record<string, unknown>) => {
      const result = await api.rpc(name, args);
      assert.equal(result.error, null);
      throw new Error('Synthetic connection lost after commit');
    } } as unknown as InventoryClient;
    await assert.rejects(saveInventoryRequest(loseReply, state, committed), /lost after commit/);
    assert.deepEqual(readInventoryRequest(state, actor), committed);
    const afterCommit = JSON.stringify(await current());
    await saveInventoryRequest(api, state, readInventoryRequest(state, actor)!);
    assert.equal(JSON.stringify(await current()), afterCommit);
    assert.deepEqual(rpcCalls[callsBefore], rpcCalls[callsBefore + 1]);
    assert.equal((await db.query('select count(*)::int n from pos_inventory_movements where request_id=$1', [committed.request])).rows[0].n, 1);

    const activation: InventoryRequest = { actor, request: randomUUID(), rpc: 'pos_inventory_set_enabled', args: { p_enabled: false, p_revision: 0 } };
    await assert.rejects(saveInventoryRequest(api, state, activation), InventoryRevisionRejected);
    assert.equal(readInventoryRequest(state, actor), null);
    assert.deepEqual((await admin.query('select pos_inventory_state() result')).rows[0].result, { enabled: true, revision: 1 });
  } finally {
    await Promise.allSettled([admin.end(), cash.end(), db.end()]);
    await server.stop();
    const relative = path.relative(tmpdir(), directory);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('pos-inventory-recovery-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});
