import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import PrintDispatch from '../app/register/PrintDispatch';
import { PrintJournal } from '../lib/print-journal-server';
import { rememberSalePrint, pendingSalePrints, type PrintAudience } from '../lib/sale-printing';
import type { SavedOrder } from '../lib/checkout';

test('actual retry controls and refresh recover only the missing copy, including a lost HTTP response', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-print-ui-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' });
  const key = 'mi_cafe_checkout_review:cashier', queues = { customer: 'POS80 Printer', barista: 'Y813BT Sticker' };
  let offline = true, loseResponse = false;
  const sent: PrintAudience[] = [];
  const order: SavedOrder = { id: randomUUID(), ticket_number: 1, status: 'completed', total: 80,
    items: [{ id: 'a', quantity: 1, product: { id: 'coffee', name: 'Cappuccino', price: 80, category: 'Bebidas', stock: 0 } }],
    customer_name: 'Sintético', order_type: 'Para Llevar', order_note: '', created_at: '2026-10-30T17:00:00Z',
    payment_method: 'tarjeta', tender_mxn: 0, tender_usd: 0, exchange_rate: 20, change_mxn: 0 };
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), { async prepare(job) {
    if (job.audience === 'barista' && offline) throw Error('Bluetooth desconectado');
    return { async submit() { sent.push(job.audience); }, dispose() {} };
  } });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/printing');
      if (options.method === 'POST') {
        const body = JSON.parse(options.body as string); assert.equal(body.orderId, order.id);
        journal.ensure('cashier', order, queues); await journal.dispatch('cashier', order.id, body.audience);
        if (loseResponse) { loseResponse = false; throw Error('Respuesta HTTP perdida'); }
      }
      return Response.json({ mode: 'mock', jobs: journal.list('cashier') });
    } })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let root = createRoot(dom.window.document.getElementById('root')!);
  const mount = () => act(async () => { root.render(createElement(PrintDispatch, { checkoutKey: key, latestOrderId: order.id })); });
  try {
    rememberSalePrint(dom.window.localStorage, key, order); await mount();
    assert.deepEqual(sent, ['customer']);
    assert.match(dom.window.document.body.textContent!, /Bluetooth desconectado/);
    const retry = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === 'Reintentar barra'); assert.ok(retry);
    offline = false;
    await act(async () => { retry.click(); retry.click(); });
    assert.deepEqual(sent, ['customer', 'barista']);
    assert.equal(dom.window.document.body.textContent?.includes('Reintentar barra'), false);
    // A browser that missed the successful response still retains the same sale marker.
    rememberSalePrint(dom.window.localStorage, key, order); loseResponse = true;
    await act(async () => { root.unmount(); }); root = createRoot(dom.window.document.getElementById('root')!); await mount();
    assert.equal(pendingSalePrints(dom.window.localStorage, key).length, 1);
    assert.match(dom.window.document.body.textContent!, /Respuesta HTTP perdida/);
    await act(async () => { root.unmount(); }); root = createRoot(dom.window.document.getElementById('root')!); await mount();
    assert.equal(pendingSalePrints(dom.window.localStorage, key).length, 0); assert.equal(sent.length, 2);
  } finally {
    await act(async () => root.unmount()); journal.close(); dom.window.close(); rmSync(directory, { recursive: true, force: true });
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
});
