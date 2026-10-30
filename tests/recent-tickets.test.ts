import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canReprintTicket, readRecentTickets, ticketStatusLabel } from '../lib/recent-tickets';

const receipt = { id: 'stored-order', ticket_number: 194, total: '83.50', created_at: '2026-10-30T17:00:00Z', status: 'cancelled', cashier_name: 'Ana' };
function client(result: { data: unknown; error: unknown }, calls: unknown[] = []) {
  return { rpc(name: string, args: unknown) {
    calls.push([name, args]);
    return { then: Promise.resolve(result).then.bind(Promise.resolve(result)), abortSignal: () => Promise.resolve(result) };
  } } as unknown as SupabaseClient;
}

test('recent receipts perform one bounded read and preserve actual saved total, folio, cashier and cancellation', async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await readRecentTickets(client({ data: [receipt], error: null }, calls)), [{ ...receipt, ticket_number: '194', total: 83.5 }]);
  assert.deepEqual(calls, [['pos_recent_tickets', { p_limit: 10 }]]);
  assert.equal(canReprintTicket('cancelled'), true); assert.equal(canReprintTicket('canceled'), true);
  assert.equal(ticketStatusLabel('cancelled'), 'Cancelado'); assert.equal(canReprintTicket('completed'), true);
  for (const status of ['pending', '', 'unknown', 'refunded']) assert.equal(canReprintTicket(status), false);
  assert.equal(ticketStatusLabel('pending'), 'Pendiente de revisión');
  assert.equal(ticketStatusLabel('unknown'), 'Estado por revisar');
});

test('an empty permitted history is distinct from connection or malformed response failures', async () => {
  assert.deepEqual(await readRecentTickets(client({ data: [], error: null })), []);
  await assert.rejects(readRecentTickets(client({ data: null, error: { message: 'SQL/credential detail' } })), /Revisa la conexión/);
  for (const data of [null, {}, Array.from({ length: 11 }, () => receipt), [receipt, receipt], [{ ...receipt, total: null }],
    [{ ...receipt, total: -1 }], [{ ...receipt, ticket_number: 0 }], [{ ...receipt, total: 'NaN' }],
    [{ ...receipt, created_at: 'not-a-date' }], [{ ...receipt, cashier_name: '' }]])
    await assert.rejects(readRecentTickets(client({ data, error: null })), /lista válida/);
  assert.equal((await readRecentTickets(client({ data: [{ ...receipt, created_at: null }], error: null })))[0].created_at, null);
});

test('an aborted list read never begins another request', async () => {
  const controller = new AbortController(), calls: unknown[] = [];
  controller.abort(new Error('Panel cerrado'));
  await assert.rejects(readRecentTickets(client({ data: [receipt], error: null }, calls), controller.signal), /Panel cerrado/);
  assert.deepEqual(calls, []);
});
