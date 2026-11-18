import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { summarizeTvOrders, visibleTvOrders, TV_ORDER_MS, type TvOrder } from '../lib/tv-dashboard';
import { loadTvSnapshot } from '../lib/tv-dashboard-server';
const now = new Date('2026-10-27T22:00:00Z');
const item = (category = 'Postres') => ({ quantity: 2, product: { name: category === 'Bebidas' ? 'Café' : 'Brownie con nieve', category, note: 'Sin nuez', displayExtras: [{ name: 'Vainilla' }] } });
const order = (id: string, _total = 0, status = 'completed', created_at = new Date(+now - 60000).toISOString()): TvOrder => ({ id, ticket_number: Number(id) || 1, status, created_at, receipt_snapshot: { items: [item('Bebidas'), item()], pager_number: 12, order_type: 'takeaway', customer_name: 'PRIVATE', total: 500 } });
test('only paid non-drink lines, preserves quantities and modifiers, no customer or financial data', () => {
    const result = summarizeTvOrders([order('1'), order('2', 0, 'pending'), order('3', 0, 'cancelled'), { ...order('4'), receipt_snapshot: { items: [item('Bebidas')] } }], now);
    assert.equal(result.orders.length, 1);
    assert.equal(result.orders[0].items.length, 1);
    assert.equal(result.orders[0].items[0].quantity, 2);
    assert.equal(result.orders[0].items[0].note, 'Sin nuez');
    assert.deepEqual(result.orders[0].items[0].extras, ['Vainilla']);
    assert.equal(result.orders[0].control, 12);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|customer_name|total|Café/);
});
test('expires at exactly 15 minutes, retains before boundary and across midnight, never restarts timer', () => {
    const paid = new Date('2026-10-28T04:59:00Z');
    const row = order('1', 0, 'completed', paid.toISOString());
    const snapshot = summarizeTvOrders([row], paid);
    assert.equal(visibleTvOrders(snapshot, new Date(+paid + TV_ORDER_MS - 1)).length, 1);
    assert.equal(visibleTvOrders(snapshot, new Date(+paid + TV_ORDER_MS)).length, 0);
    assert.equal(summarizeTvOrders([row], new Date(+paid + TV_ORDER_MS)).orders.length, 0);
    assert.equal(summarizeTvOrders([row], new Date(+paid - 1)).orders.length, 0);
    assert.equal(summarizeTvOrders([row], new Date(+paid + 10000)).orders[0].expiresAt, snapshot.orders[0].expiresAt);
});
test('oldest first and missing categories fail visibly instead of guessing', () => {
    assert.equal(summarizeTvOrders([order('2'), order('1', 0, 'completed', new Date(+now - 120000).toISOString())], now).orders[0].id, '1');
    assert.throws(() => summarizeTvOrders([{ ...order('1'), receipt_snapshot: { items: [item('')] } }], now));
});
function mockClient(rows: TvOrder[], options: {
    signedIn?: boolean;
    role?: string;
    active?: boolean;
    failPage?: number;
    profileError?: {
        code: string;
        message: string;
    };
    authError?: {
        name: string;
        status: number;
    };
} = {}) {
    let orderReads = 0;
    const ranges: number[][] = [];
    const client = {
        auth: { getUser: async () => ({ data: { user: options.signedIn === false ? null : { id: 'fixture-owner' } }, error: options.authError ?? null }) },
        from(table: string) {
            if (table === 'profiles')
                return { select: () => ({ eq: () => ({ single: async () => ({ data: options.profileError ? null : { role: options.role ?? 'admin', is_active: options.active ?? true }, error: options.profileError ?? null }) }) }) };
            assert.equal(table, 'orders');
            orderReads++;
            let from = 0, to = 0;
            const query = {
                select(columns: string) { assert.equal(columns, 'id,ticket_number,created_at,status,receipt_snapshot'); return query; },
                gt(column: string, value: string) { assert.equal(column, 'created_at'); assert.equal(value, new Date(+now - TV_ORDER_MS).toISOString()); return query; },
                eq(column: string, value: string) { assert.equal(column, 'status'); assert.equal(value, 'completed'); return query; },
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
    assert.equal(result.orders.length, 1201);
    assert.deepEqual(mock.ranges, [[0, 499], [500, 999], [1000, 1499]]);
    await assert.rejects(loadTvSnapshot(mockClient(rows, { failPage: 2 }).client, new AbortController().signal, now));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(loadTvSnapshot(mock.client, controller.signal, now));
});
test('TV denies anonymous, cashier and inactive owners before reading orders', async () => {
    for (const options of [{ signedIn: false }, { role: 'cashier' }, { active: false }]) {
        const mock = mockClient([], options);
        await assert.rejects(loadTvSnapshot(mock.client, new AbortController().signal, now), (error: unknown) => {
            assert.equal((error as {
                status: number;
            }).status, options.signedIn === false ? 401 : 403);
            return true;
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
