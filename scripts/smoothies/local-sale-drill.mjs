import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { freshLocalApi } from '../testing/local-api.mjs';
import { prepareLocal } from './prepare-local.mjs';

const stack = await freshLocalApi({ portBase: 55541, emptyWithStorage: true });
const config = { ...stack.config, apiPort: 55541, dbPort: 55542, password: randomBytes(24).toString('base64url') };
const localFetch = (request, init) => {
  assert.equal(new URL(typeof request === 'string' ? request : request.url).origin, config.api);
  return fetch(request, init);
};
const api = createClient(config.api, config.anon, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch },
});
function ok({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}
try {
  await prepareLocal(config);
  await prepareLocal(config);
  ok(await api.auth.signInWithPassword({ email: 'admin@smoothies.local', password: config.password }));
  const { data: { user } } = await api.auth.getUser();
  const product = ok(await api.rpc('pos_save_catalog', { p_request: randomUUID(),
    p_payload: { actor_id: user.id, kind: 'product', action: 'save', id: null,
      fields: { name: 'Mango con plátano 16 oz', category: 'Smoothies', price: 85,
        customizable: true, image_url: '', wizard_steps: ['Leche alternativa'] } } })).id;
  const milk = ok(await api.rpc('pos_save_catalog', { p_request: randomUUID(),
    p_payload: { actor_id: user.id, kind: 'extra', action: 'save', id: null,
      fields: { name: 'Leche de avena', phase: 'Leche alternativa', price: 5 } } })).id;
  ok(await api.rpc('pos_set_drawer_rate', { p_request: randomUUID(), p_payload: { rate: 20 } }));
  const shift = ok(await api.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 100, p_rate: 20 }));
  const request = randomUUID();
  const payload = { register_id: shift.id, items: [{ product_id: product, quantity: 1, extra_ids: [milk] }],
    expected_total: 90, payment_method: 'efectivo', tender_mxn: 100, tender_usd: 0,
    order_type: 'Para Llevar', pager_number: null };
  const sale = ok(await api.rpc('pos_checkout', { p_request: request, p_payload: payload }));
  assert.equal(sale.total, 90);
  assert.equal(sale.change_mxn, 10);
  assert.equal(sale.pager_number, null);
  assert.equal(ok(await api.rpc('pos_checkout', { p_request: request, p_payload: payload })).id, sale.id);
  assert.equal(ok(await api.from('orders').select('id').eq('id',sale.id).single()).id, sale.id);
  console.log('PASS: inicio de sesión, turno, venta en efectivo, cambio y reintento sin duplicación por API local.');
} finally {
  await stack.cleanup();
}
