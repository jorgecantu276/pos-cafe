import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline, RequestTimeout } from '../lib/request-deadline';
import { executeCheckout, CheckoutRejected, type CheckoutReview, type SavedOrder } from '../lib/checkout';

test('deadline releases an unresolved SDK wait, handles late failures and respects abort before a write', async () => {
  let reject!: (error: Error) => void;
  const unresolved = new Promise<void>((_, fail) => { reject = fail; });
  await assert.rejects(withDeadline(() => unresolved, { timeoutMs: 10 }), RequestTimeout);
  reject(new Error('Late synthetic failure'));
  const controller = new AbortController(); controller.abort(new Error('Aborted before submit'));
  let calls = 0;
  await assert.rejects(withDeadline(async () => { calls++; }, { signal: controller.signal }), /Aborted/);
  assert.equal(calls, 0);
  assert.equal(await withDeadline(async () => 7), 7);
});

test('checkout timeout retains exact identity; a late commit is recovered with one logical sale', async () => {
  const pending = { startedAt: '2026-10-30', total: 220, requestId: 'same-sale-identity', payload: { expected_total: 220 } } as CheckoutReview;
  const original = JSON.stringify(pending), calls: unknown[] = [];
  let commit!: (response: unknown) => void;
  const late = new Promise(resolve => { commit = resolve; });
  const receipt = { id: 'one-sale', ticket_number: 1, status: 'completed', total: 220, items: [] } as unknown as SavedOrder;
  const client = { rpc(name: string, params: unknown) { calls.push({ name, params }); return calls.length === 1 ? late : Promise.resolve({ data: receipt, error: null }); } } as unknown as SupabaseClient;
  const timeout = await executeCheckout(client, pending, 10).catch(error => error);
  assert.ok(timeout instanceof RequestTimeout); assert.equal(timeout instanceof CheckoutRejected, false);
  assert.equal(JSON.stringify(pending), original);
  commit({ data: receipt, error: null });
  assert.equal((await executeCheckout(client, pending, 50)).id, receipt.id);
  assert.deepEqual(calls[0], calls[1]);
});
