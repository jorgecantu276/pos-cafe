import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryCsv, previewInventoryCsv, csvRows, inventoryStatus, saveInventoryRequest, readInventoryRequest, inventoryRequestKey, InventoryRejected,
  type InventoryClient, type InventoryItem, type InventoryRequest } from '../lib/inventory';
import { catalogProduct, productAvailable } from '../lib/pos-types';

const item: InventoryItem = { product_id: '00000000-0000-4000-8000-000000000001', code: 'CM-000001', name: 'Galleta, pistache "especial"',
  category: 'Postres', is_active: true, mode: 'counted', unit: 'pieza', quantity: null, minimum: 3, available: true, revision: 2, last_counted_at: null };
test('inventory CSV round-trips quoted names, unknown/zero counts and formula-safe names', () => {
  const items = [item, { ...item, product_id: '2', code: 'CM-000002', name: '  =Nombre de prueba', quantity: 0 }];
  const result = previewInventoryCsv(inventoryCsv(items), items);
  assert.deepEqual(result.errors, []);assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].quantity, null);assert.equal(result.changes[1].quantity, 0);
  assert.ok(inventoryCsv(items).includes("'  =Nombre"));
  assert.deepEqual(csvRows('a,b\r\n"una\nrebanada","con ""fresa"""\r\n'), [['a','b'],['una\nrebanada','con "fresa"']]);
});
test('CSV rejects stale product names, unknown and duplicated codes, invalid amounts and broken structure before saving', () => {
  const header = 'codigo,producto,modo,unidad,cantidad,minimo,disponible\n';
  for (const row of ['NO-EXISTE,,conteo,pieza,3,1,si','CM-000001,Otro,conteo,pieza,3,1,si',
    'CM-000001,,conteo,pieza,-1,1,si','CM-000001,,conteo,pieza,1.5,1,si','CM-000001,,conteo,pieza,1000001,1,si',
    'CM-000001,,disponibilidad,pieza,2,1,si','CM-000001,,conteo,kg,3,1,si','CM-000001,,conteo,pieza,3,1,yes',
    'CM-000001,,conteo,pieza,3,1,si,extra']) assert.ok(previewInventoryCsv(header + row, [item]).errors.length);
  assert.match(previewInventoryCsv(header + 'CM-000001,,conteo,pieza,3,,si\nCM-000001,,conteo,pieza,3,,si', [item]).errors[0], /repetido/);
  assert.throws(() => previewInventoryCsv('name,quantity\nBrownie,1', [item]), /plantilla/);
  assert.throws(() => csvRows('a,"b'), /comillas/);assert.throws(() => csvRows('"a"x,b'), /comillas/);
  assert.throws(() => csvRows('x'.repeat(300_001)), /300 KB/);
});
test('blank import preserves unknown state and captures the preview revision, never an invented count', () => {
  const result = previewInventoryCsv('codigo,producto,modo,unidad,cantidad,minimo,disponible\nCM-000001,,conteo,pieza,,,si', [item]);
  assert.deepEqual(result.errors, []);assert.equal(result.changes[0].quantity, null);assert.equal(result.changes[0].revision, 2);
  assert.equal(inventoryStatus(item), 'Sin contar');assert.equal(inventoryStatus({ ...item, quantity: 0 }), 'Agotado');
  assert.equal(inventoryStatus({ ...item, quantity: 2 }), 'Por reponer');
});
const request: InventoryRequest = { actor: 'admin', request: '00000000-0000-4000-8000-000000000002', rpc: 'pos_inventory_write',
  args: { p_changes: [{ product_id: item.product_id, revision: 2, action: 'count', quantity: 8 }] } };
function storage() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k,v); }, removeItem: (k: string) => { values.delete(k); } }; }
const client = (rpc: unknown) => ({ rpc } as InventoryClient);
test('timeout retains the exact inventory operation across reload and recovery clears it only after acknowledgement', async () => {
  const s = storage();
  await assert.rejects(saveInventoryRequest(client(() => new Promise(() => {})), s, request, 5), /conexión/);
  assert.deepEqual(readInventoryRequest(s, 'admin'), request);
  let args: unknown;
  await saveInventoryRequest(client((_name: string, value: unknown) => { args = value; return Promise.resolve({ data: [{ product_id: item.product_id, revision: 3 }], error: null }); }), s, readInventoryRequest(s, 'admin')!);
  assert.deepEqual(args, { ...request.args, p_request: request.request, p_actor: request.actor });assert.equal(readInventoryRequest(s, 'admin'), null);
});
test('database rollback clears pending stock changes; transport errors and malformed acknowledgements preserve recovery', async () => {
  const s = storage();
  await assert.rejects(saveInventoryRequest(client(() => Promise.resolve({ error: { code: '40001', message: 'Cambió' } })), s, request), InventoryRejected);
  assert.equal(readInventoryRequest(s, 'admin'), null);
  await assert.rejects(saveInventoryRequest(client(() => Promise.resolve({ error: { code: '', message: 'Network' } })), s, request), /Network/);
  assert.deepEqual(readInventoryRequest(s, 'admin'), request);
  await assert.rejects(saveInventoryRequest(client(() => Promise.resolve({ error: { code: '42501', message: 'Session changed' } })), s, request), /Session changed/);
  assert.deepEqual(readInventoryRequest(s, 'admin'), request);
  await assert.rejects(saveInventoryRequest(client(() => Promise.resolve({ error: null, data: null })), s, request), /confirmó/);
  assert.deepEqual(readInventoryRequest(s, 'admin'), request);
  await assert.rejects(saveInventoryRequest(client(() => Promise.resolve({ error: null, data: [{}] })), s, request), /confirmó/);
  assert.deepEqual(readInventoryRequest(s, 'admin'), request);
  await assert.rejects(saveInventoryRequest(client(() => { throw Error('Must not send'); }), s, { ...request, request: crypto.randomUUID() }), /Recupera primero/);
  s.setItem(inventoryRequestKey('other'), JSON.stringify(request));assert.throws(() => readInventoryRequest(s, 'other'), /revisión/);
});
test('register projection supports PostgREST one-to-one inventory and never uses legacy stock as a gate', () => {
  const product = { id: '1', name: 'Brownie', price: 30, category: 'Postres', image_url: null, is_active: true, customizable: false, wizard_steps: [], stock: 999 };
  const out = catalogProduct({ ...product, pos_inventory_items: { mode: 'counted', quantity: 0, available: true } });
  assert.equal(productAvailable(out), false);
  assert.equal(productAvailable(catalogProduct({ ...product, pos_inventory_items: [{ mode: 'counted', quantity: null, available: true }] })), true);
  assert.equal(productAvailable(catalogProduct({ ...product, pos_inventory_items: { mode: 'availability', quantity: null, available: false } })), false);
  assert.equal('stock' in out, false);
});
