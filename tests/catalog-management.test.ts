import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { catalogRequestKey, readCatalogRequest, saveCatalogChange, type CatalogChange } from '../lib/catalog-management';
import { loadActiveDrawer } from '../lib/active-drawer';

type Args = { p_request: string; p_payload: CatalogChange & { actor_id: string } };
const id = '00000000-0000-4000-8000-000000000001';
const change: CatalogChange = { kind: 'product', action: 'save', id: null, fields: { name: 'Café', price: 50 } };
const api = (run: (name: string, args: Args) => Promise<unknown>) => ({ rpc: (name: string, args: Args) => {
  const result = run(name, args); return Object.assign(result, { abortSignal: () => result });
} }) as unknown as Pick<SupabaseClient, 'rpc'>;
function harness() {
  const values = new Map<string, string>(), locks = new Set<string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (key: string, _options: unknown, action: (lock: object | null) => unknown) => {
    if (locks.has(key)) return action(null); locks.add(key); try { return await action({}); } finally { locks.delete(key); }
  } } } });
  return { storage, values, restore() { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); } };
}
test('catalog lost acknowledgment survives restart and exact replay prevents duplicate creation', async () => {
  const h = harness(), calls: Args[] = []; let fail = true;
  const client = api(async (name, args) => {
    assert.equal(name, 'pos_save_catalog'); assert.ok(h.storage.getItem(catalogRequestKey('owner'))); calls.push(args);
    return fail ? { error: { message: 'Respuesta perdida', code: '' } } : { error: null, data: { request_id: args.p_request, kind: args.p_payload.kind, action: args.p_payload.action, id } };
  });
  try {
    await assert.rejects(saveCatalogChange(client, h.storage, 'owner', change), /perdida/);
    assert.deepEqual(readCatalogRequest(h.storage, 'owner')?.payload.fields, change.fields);
    await assert.rejects(saveCatalogChange(client, h.storage, 'owner', change), /pendiente/); assert.equal(calls.length, 1);
    fail = false; assert.equal((await saveCatalogChange(client, h.storage, 'owner')).id, id);
    assert.deepEqual(calls[0], calls[1]); assert.equal(h.values.size, 0);
  } finally { h.restore(); }
});
test('catalog failed storage sends nothing; malformed success remains recoverable; confirmed rejection unlocks editing', async () => {
  const h = harness(); let calls = 0;
  try {
    await assert.rejects(saveCatalogChange(api(async () => { calls++; }), { ...h.storage, setItem() { throw Error('Disco lleno'); } }, 'owner', change), /lleno/);
    assert.equal(calls, 0);
    await assert.rejects(saveCatalogChange(api(async () => ({ error: null, data: {} })), h.storage, 'owner', change), /no confirmada/);
    assert.ok(readCatalogRequest(h.storage, 'owner'));
    await assert.rejects(saveCatalogChange(api(async () => ({ error: { code: 'P0001', message: 'Precio inválido' } })), h.storage, 'owner'), /inválido/);
    assert.equal(h.values.size, 0);
    await assert.rejects(saveCatalogChange(api(async () => assert.fail()), h.storage, 'other-owner'), /No hay/);
  } finally { h.restore(); }
});
test('administration loads the global drawer owner and rejects a concurrent handoff', async () => {
  let drawerReads = 0, changed = false;
  const drawer = { rate: 20, active: { id, cashier_id: id, cashier_name: 'Ana' }, handoff: null, cashiers: [] };
  const client = api(async (name) => {
    if (name === 'pos_drawer_status') { drawerReads++; return { error: null, data: changed && drawerReads % 2 === 0 ? { ...drawer, active: null } : drawer }; }
    assert.equal(name, 'pos_shift_summary');
    return { error: null, data: { register_id: id, status: 'open', opened_at: '2026-11-02T12:00:00Z', starting_cash: 100, exchange_rate: 20, total_sales: 60, cash_sales: 60, expected_cash: 160, expenses: [], expenses_revision: 0, payments: { efectivo: 60 } } };
  });
  assert.equal((await loadActiveDrawer(client)).drawer.active?.cashier_name, 'Ana');
  changed = true; await assert.rejects(loadActiveDrawer(client), /cambió/);
});
