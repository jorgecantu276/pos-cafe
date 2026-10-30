import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cafeDayRange, summarizeTvOrders, tvIsStale, tvStatus, type TvOrder } from '../lib/tv-dashboard';
import { loadTvSnapshot } from '../lib/tv-dashboard-server';

const now = new Date('2026-10-27T22:00:00Z');
const order = (id: string, total: number, status = 'completed', created_at = '2026-10-27T15:00:00Z'): TvOrder => ({
  id, ticket_number: Number(id) || 1, total, status, created_at, payment_method: 'tarjeta',
});

test('TV totals exclude cancelled, pending, previous-day and future sales; preserve cents and unknown statuses', () => {
  const snapshot = summarizeTvOrders([order('1', 10.10), order('2', 20.20), order('3', 900, 'pending'),
    order('4', 900, 'cancelled'), order('5', 900, 'canceled'), order('6', 900, 'unknown'),
    order('7', 900, 'completed', '2026-10-27T04:59:59Z'), order('8', 900, 'completed', '2026-10-28T03:00:00Z')], now);
  assert.equal(snapshot.sales, 30.3); assert.equal(snapshot.average, 15.15);
  assert.equal(snapshot.completed, 2); assert.equal(snapshot.pending, 1); assert.equal(snapshot.cancelled, 2);
  assert.equal(snapshot.hourly[10], 30.3); assert.deepEqual(snapshot.payments, [{ name: 'Tarjeta', total: 30.3 }]);
  assert.equal(snapshot.recent.length, 6); assert.equal(tvStatus('pending'), 'Revisar pago');
  assert.equal(tvStatus('unknown'), 'Sin clasificar');
  assert.equal(tvIsStale(snapshot, new Date(+now + 21_000)), true);
  assert.equal(tvIsStale(snapshot, new Date(+now + 5_000)), false);
  assert.equal(summarizeTvOrders([], now).average, 0);
  assert.throws(() => summarizeTvOrders([order('1', NaN)], now));
});

test('TV uses Matamoros midnight, handles DST and resets to the next business day', () => {
  const before = new Date('2026-10-28T04:59:59Z');
  assert.deepEqual(cafeDayRange(before), { day: '2026-10-27', start: '2026-10-27T05:00:00.000Z', end: '2026-10-28T05:00:00.000Z' });
  const snapshot = summarizeTvOrders([order('1', 50, 'completed', before.toISOString())], before);
  assert.equal(tvIsStale(snapshot, new Date('2026-10-28T05:00:00Z')), true);
  assert.equal(summarizeTvOrders([order('1', 50, 'completed', before.toISOString())], new Date('2026-10-28T05:00:00Z')).sales, 0);
  for (const [date, hours] of [['2026-03-08T12:00:00Z', 23], ['2026-11-01T12:00:00Z', 25]] as const) {
    const range = cafeDayRange(new Date(date));
    assert.equal((Date.parse(range.end) - Date.parse(range.start)) / 3_600_000, hours);
  }
});

function mockClient(rows: TvOrder[], options: { signedIn?: boolean; role?: string; active?: boolean; failPage?: number; profileError?: {code: string; message: string}; authError?: {name: string; status: number} } = {}) {
  let orderReads = 0;
  const ranges: number[][] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedIn === false ? null : { id: 'fixture-owner' } }, error: options.authError ?? null }) },
    from(table: string) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: options.profileError ? null : { role: options.role ?? 'admin', is_active: options.active ?? true }, error: options.profileError ?? null }) }) }) };
      assert.equal(table, 'orders'); orderReads++;
      let from = 0, to = 0;
      const query = {
        select(columns: string) { assert.equal(columns, 'id,ticket_number,created_at,total,status,payment_method'); return query; },
        gte(column: string, value: string) { assert.equal(column, 'created_at'); assert.equal(value, '2026-10-27T05:00:00.000Z'); return query; },
        lt(column: string, value: string) { assert.equal(column, 'created_at'); assert.equal(value, '2026-10-28T05:00:00.000Z'); return query; },
        lte: () => query, order: () => query,
        range(start: number, end: number) { from = start; to = end; ranges.push([start, end]); return query; },
        abortSignal: async (signal: AbortSignal) => {
          signal.throwIfAborted();
          return options.failPage === orderReads ? { data: null, error: { message: 'fixture network failure' } } : { data: rows.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, ranges, reads: () => orderReads };
}

test('TV paginates above 1,000 rows and rejects partial totals or aborted requests', async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => order(String(i), 10));
  const mock = mockClient(rows);
  const result = await loadTvSnapshot(mock.client, new AbortController().signal, now);
  assert.equal(result.completed, 1201); assert.equal(result.sales, 12010);
  assert.deepEqual(mock.ranges, [[0, 499], [500, 999], [1000, 1499]]);
  await assert.rejects(loadTvSnapshot(mockClient(rows, { failPage: 2 }).client, new AbortController().signal, now));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadTvSnapshot(mock.client, controller.signal, now));
});

test('TV denies anonymous, cashier and inactive owners before reading orders', async () => {
  for (const options of [{ signedIn: false }, { role: 'cashier' }, { active: false }]) {
    const mock = mockClient([], options);
    await assert.rejects(loadTvSnapshot(mock.client, new AbortController().signal, now), (error: unknown) => {
      assert.equal((error as { status: number }).status, options.signedIn === false ? 401 : 403); return true;
    });
    assert.equal(mock.reads(), 0);
  }
});

test('TV treats unavailable access services as retryable and still denies missing profiles', async () => {
  for (const options of [
    { profileError: { code: '', message: 'fetch failed' } },
    { profileError: { code: 'PGRST002', message: 'database unavailable' } },
    { authError: { name: 'AuthRetryableFetchError', status: 0 } },
  ]) {
    const mock = mockClient([], options);
    await assert.rejects(loadTvSnapshot(mock.client, new AbortController().signal, now), { status: 503 });
    assert.equal(mock.reads(), 0);
  }
  const missing = mockClient([], { profileError: { code: 'PGRST116', message: 'no profile' } });
  await assert.rejects(loadTvSnapshot(missing.client, new AbortController().signal, now), { status: 403 });
  assert.equal(missing.reads(), 0);
});
