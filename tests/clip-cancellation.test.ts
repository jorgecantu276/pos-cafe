import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ClipGateway } from '../lib/clip-server';

const config = { enabled: false, tokenReady: true, token: 'SYNTHETIC_TEST_TOKEN', serial: 'TESTSERIAL', webhook: 'https://test.invalid/hook' };

function cancellation(change: Record<string, unknown> = {}, attached = true, responseStatus = 200) {
  const request = randomUUID(), actor = randomUUID(), provider = `pinpad-${randomUUID()}`;
  const payment = { request_id: request, actor_id: actor, state: attached ? 'pending' : 'dispatching',
    terminal_serial: config.serial, provider_id: attached ? provider : null, webhook_key: randomUUID(),
    quote: { total: 50 }, hints: [provider], result: null };
  const settlements: Record<string, unknown>[] = [];
  let posts = 0;
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(args.p_request, request);
    assert.equal(args.p_actor, actor);
    if (name === 'pos_clip_get') return { data: structuredClone(payment), error: null };
    assert.equal(args.p_provider, provider);
    if (name === 'pos_clip_attach') { payment.provider_id = provider; payment.state = 'pending'; }
    else if (name === 'pos_clip_settle') {
      settlements.push(args);
      assert.equal(args.p_outcome, 'failed');
      payment.state = 'failed';
    } else assert.fail(`Unexpected RPC ${name}`);
    return { data: null, error: null };
  } } as unknown as Pick<SupabaseClient, 'rpc'>;
  const providerFetch: typeof fetch = async (url, init) => {
    if (init?.method === 'POST') { posts++; assert.fail('Recovery must never create another provider payment'); }
    assert.equal(String(url), `https://api.payclip.io/f2f/pinpad/v1/payment?pinpadRequestId=${provider}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${config.token}`);
    assert.equal(init?.cache, 'no-store');
    return Response.json({ pinpad_request_id: provider, reference: `pos-${request}`, amount: '50.00', status: 'CANCELED',
      detail: { pages: { total: 0, total_results: 0 }, results: [] }, ...change }, { status: responseStatus });
  };
  return { request, actor, provider, payment, settlements, get posts() { return posts; },
    gateway: new ClipGateway(db, config, providerFetch) };
}

test('authenticated canceled/rejected requests may omit totals only with complete non-paid detail', async t => {
  for (const status of ['CANCELED', 'REJECTED']) {
    for (const totals of [{}, { amount_paid: null, tip_amount: null }, { amount_paid: '0.00', tip_amount: '0.00' }, { amount_paid: 0, tip_amount: 0 }]) {
      await t.test(`${status}: ${JSON.stringify(totals)}`, async () => {
        const h = cancellation({ status, ...totals });
        const result = await h.gateway.status(h.request, h.actor);
        assert.equal(result.state, 'failed');
        assert.equal(h.settlements.length, 1);
        assert.deepEqual(h.settlements[0].p_evidence, { reference: `pos-${h.request}`, amount_cents: 5000,
          paid_cents: 0, tip_cents: 0, currency: 'MXN', device: config.serial, status, transaction: '' });
        await h.gateway.start(h.request, h.actor);
        assert.equal(h.settlements.length, 1);
        assert.equal(h.posts, 0);
      });
    }
  }
});

test('canceled identity, money and detail contradictions keep the original pending request', async t => {
  const cases: Record<string, unknown>[] = [
    { pinpad_request_id: `pinpad-${randomUUID()}` }, { reference: 'pos-another-request' }, { amount: '49.00' },
    { amount_paid: '0.01' }, { tip_amount: '0.01' }, { amount_paid: '' }, { tip_amount: 'not-money' },
    { amount_paid: {} }, { status: 'PENDING' }, { status: ['CANCELED'] },
    { detail: null }, { detail: { pages: { total_results: 1 }, results: [] } },
    { detail: { pages: { total_results: 0 } } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'approved', paid_amount: 0 }] } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'rejected', paid_amount: 50 }] } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'rejected' }] } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'APPROVED', paid_amount: 0 }] } },
    { detail: { pages: { total_results: 1 }, results: [{ paid_amount: 0 }] } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'unknown', paid_amount: 0 }] } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'rejected', paid_amount: 0, tip_amount: 1 }] } },
    { detail: { pages: { total_results: 1 }, results: [{ status: 'rejected', paid_amount: 0, amount_refunded: 50 }] } },
  ];
  for (const change of cases) await t.test(JSON.stringify(change), async () => {
    const h = cancellation(change);
    const result = await h.gateway.start(h.request, h.actor);
    assert.equal(result.requestId, h.request);
    assert.notEqual(result.state, 'failed');
    assert.notEqual(result.state, 'completed');
    assert.equal(h.payment.state, 'pending');
    assert.equal(h.settlements.length, 0);
    assert.equal(h.posts, 0);
  });
});

test('explicit non-paid transaction detail accepts string-valued zero without accepting an unknown status', async () => {
  for (const status of ['canceled', 'rejected', 'declined']) {
    const h = cancellation({ detail: { pages: { total: 1, total_results: 1 },
      results: [{ status, paid_amount: '0.00', tip_amount: '0.00', amount_refunded: '0.00' }] } });
    assert.equal((await h.gateway.status(h.request, h.actor)).state, 'failed');
    assert.equal(h.settlements.length, 1);
  }
});

test('missing or null paid/tip fields never qualify an approved payment', async t => {
  for (const status of ['APPROVED', 'COMPLETED']) {
    for (const totals of [{}, { amount_paid: null, tip_amount: null }, { amount_paid: '50.00' }, { tip_amount: '0.00' }]) {
      await t.test(`${status}: ${JSON.stringify(totals)}`, async () => {
        const h = cancellation({ status, ...totals, detail: { pages: { total: 1, total_results: 1 },
          results: [{ transaction_id: randomUUID(), status: 'approved', currency: 'MXN', amount: 50,
            paid_amount: 50, tip_amount: 0, amount_refunded: 0, device: { id: config.serial } }] } });
        assert.notEqual((await h.gateway.status(h.request, h.actor)).state, 'completed');
        assert.equal(h.settlements.length, 0);
        assert.equal(h.payment.state, 'pending');
      });
    }
  }
});

test('an unbound callback hint is attached only after matching authenticated cancellation lookup', async () => {
  const h = cancellation({}, false);
  assert.equal((await h.gateway.status(h.request, h.actor)).state, 'failed');
  assert.equal(h.payment.provider_id, h.provider);
  assert.equal(h.settlements.length, 1);
  const wrong = cancellation({ reference: 'other' }, false);
  await wrong.gateway.status(wrong.request, wrong.actor);
  assert.equal(wrong.payment.provider_id, null);
  assert.equal(wrong.settlements.length, 0);
});

test('non-success provider responses cannot release a canceled-looking request', async () => {
  const h = cancellation({}, true, 403);
  assert.notEqual((await h.gateway.status(h.request, h.actor)).state, 'failed');
  assert.equal(h.settlements.length, 0);
  assert.equal(h.posts, 0);
});
