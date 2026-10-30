import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadReport, reportDate, reportParams, reportQuery } from '../lib/reports';

test('report range sends inclusive calendar dates without using the PC timezone; old ranges cannot leak into Today', () => {
  const q = { ...reportQuery('range'), from: '2025-03-09', to: '2025-03-09' };
  assert.deepEqual(reportParams(q), { p_period: 'range', p_from: '2025-03-09', p_to: '2025-03-09', p_page: 0, p_as_of: null });
  assert.equal(reportParams({ ...q, period: 'today' }).p_from, null);
  assert.throws(() => reportParams({ ...q, from: '2025-03-10' }));
  assert.throws(() => reportParams({ ...q, to: '' }));
  assert.match(reportDate('2025-02-13T05:59:00Z', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), /12\/02\/2025.*23:59/);
});

function client(response: unknown) {
  return { rpc: () => ({ abortSignal: () => response }) } as unknown as SupabaseClient;
}
test('failed, null and invalid report responses never become a zero-sales success', async () => {
  for (const response of [{ data: null, error: null }, { data: null, error: { message: 'local outage' } },
    { data: { summary: { rows: 1, sales: 'NaN' }, orders: [], captured_at: new Date().toISOString() }, error: null }]) {
    await assert.rejects(loadReport(client(Promise.resolve(response)), 'pos_sales_report', {}, new AbortController().signal));
  }
  const data = { summary: { rows: 0, sales: 0 }, orders: [], captured_at: new Date().toISOString() };
  assert.deepEqual(await loadReport(client(Promise.resolve({ data, error: null })), 'pos_sales_report', {}, new AbortController().signal), data);
});

test('aborted report does not wait on a stalled SDK/Auth promise or accept its late result', async () => {
  const controller = new AbortController();
  const pending = loadReport(client(new Promise(() => {})), 'pos_sales_report', {}, controller.signal);
  controller.abort(new Error('filter changed'));
  await assert.rejects(pending, /filter changed/);
  await assert.rejects(loadReport(client(new Promise(() => {})), 'pos_sales_report', {}, controller.signal), /filter changed/);
});
