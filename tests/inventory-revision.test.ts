import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { InventoryRevisionRejected, inventoryRequestKey, readInventoryRequest, saveInventoryRequest,
  type InventoryClient, type InventoryRequest } from '../lib/inventory';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
const pending: InventoryRequest = { actor: 'admin', request: randomUUID(), rpc: 'pos_inventory_write',
  args: { p_changes: [{ product_id: randomUUID(), revision: 2, action: 'count', quantity: 8 }] } };
const rejecting = (code: string, effect = () => {}) => ({ rpc: async () => {
  effect(); return { data: null, error: { code, message: 'Las existencias cambiaron. Actualiza y revisa el conteo.' } };
} }) as unknown as InventoryClient;

test('only the explicit stale inventory contract retires a rejected count or activation', async () => {
  for (const request of [pending, { actor: 'admin', request: randomUUID(), rpc: 'pos_inventory_set_enabled',
    args: { p_enabled: true, p_revision: 2 } } satisfies InventoryRequest]) {
    const state = storage();
    await assert.rejects(saveInventoryRequest(rejecting('PIV01'), state, request), InventoryRevisionRejected);
    assert.equal(readInventoryRequest(state, 'admin'), null);
  }
});

test('generic serialization/connection uncertainty keeps the exact original inventory request', async () => {
  for (const code of ['40001', '40003', '08006', '08007']) {
    const state = storage();
    await assert.rejects(saveInventoryRequest(rejecting(code), state, pending), error => !(error instanceof InventoryRevisionRejected));
    assert.deepEqual(readInventoryRequest(state, 'admin'), pending);
    await assert.rejects(saveInventoryRequest(rejecting('PIV01'), state, { ...pending, request: randomUUID() }), /Recupera primero/);
  }
});

test('a stale rejection never removes a different operation written by another window', async () => {
  const state = storage(), other = { ...pending, request: randomUUID() };
  await assert.rejects(saveInventoryRequest(rejecting('PIV01', () => {
    state.setItem(inventoryRequestKey('admin'), JSON.stringify(other));
  }), state, pending), InventoryRevisionRejected);
  assert.deepEqual(readInventoryRequest(state, 'admin'), other);
});
