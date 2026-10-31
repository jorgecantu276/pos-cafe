import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import type { SavedOrder } from '../lib/checkout';
import { saleDocuments } from '../lib/sale-printing';
import { PrintJournal } from '../lib/print-journal-server';
import { handleReceiptRequest, storedCustomerReceipt } from '../lib/receipt-reprint-server';
import { renderReceiptReprint } from '../lib/receipt-reprint';

const issuer = { legalName: 'EMISOR FICTICIO', rfc: 'AAA010101AAA', taxRegime: '601 - General de Ley Personas Morales',
  establishmentAddress: 'Domicilio ficticio', postalCode: '87380', city: 'Matamoros' };
const order: SavedOrder = { id: randomUUID(), ticket_number: 1234, status: 'completed', total: 80, customer_name: 'Ana & José',
  order_type: 'Para Llevar', order_note: 'Entregar juntos <script>unsafe</script>', created_at: '2026-10-30T17:00:00Z',
  payment_method: 'efectivo', tender_mxn: 100, tender_usd: 0, exchange_rate: 20, change_mxn: 20,
  items: [{ id: 'line', quantity: 1, product: { id: 'coffee', name: 'Café', price: 80, category: '',
    displayExtras: [{ name: 'Avena', price: 15 }], note: 'Sin hielo' } }] };

function fixture() {
  const state = { auth: true, active: true, role: 'cashier', owner: 'cashier', status: 'completed', snapshot: order as SavedOrder | null };
  const filters: unknown[] = [];
  const client = { auth: { getUser: async () => ({ data: { user: state.auth ? { id: 'cashier' } : null }, error: null }) },
    from(table: string) {
      const query = { select: () => query, eq: (key: string, value: string) => { filters.push([key, value]); return query; },
        order: () => query, limit: () => query, abortSignal: () => query, single: async () => ({ error: null,
          data: table === 'profiles' ? { role: state.role, is_active: state.active } : {
            id: order.id, ticket_number: 1234, cashier_id: state.owner, status: state.status, receipt_snapshot: state.snapshot,
            total: 80, created_at: order.created_at, payment_method: 'efectivo', tender_mxn: null, tender_usd: null, exchange_rate: null, change_mxn: null,
            order_items: [{ product_id: 'coffee', quantity: 1, unit_price: 80, total_price: 80, notes: 'Sin hielo · Avena', product_snapshot: { name: 'Café histórico' } }],
          } }) }; return query;
    }, rpc() { assert.fail('Reprints must not mutate business data'); } } as unknown as SupabaseClient;
  return { state, filters, client };
}
const request = (query = `orderId=${order.id}`) => new Request(`http://127.0.0.1:3000/api/receipts?${query}`);

test('reprint preserves the original saved document after issuer changes and adds only escaped reprint/cancellation context', async () => {
  const f = fixture(), original = saleDocuments(order, { issuer }).customer, unchanged = JSON.stringify(original);
  f.state.status = 'cancelled';
  const result = await handleReceiptRequest(request(), f.client, { stored: (owner, id) => {
    assert.equal(owner, 'cashier'); assert.equal(id, order.id); return original;
  }, issuer: () => { assert.fail('Original issuer must not be replaced'); } });
  assert.equal(result.source, 'stored'); assert.equal(JSON.stringify(result.document), unchanged);
  const dom = new JSDOM(renderReceiptReprint(result.document, result.status, result.source));
  try {
    const text = dom.window.document.body.textContent!;
    for (const value of [issuer.legalName, issuer.rfc, issuer.establishmentAddress, order.customer_name, order.order_note, 'Avena', 'Sin hielo', 'Recibido MXN: $100.00', 'Cambio: $20.00', 'REIMPRESIÓN', 'VENTA CANCELADA']) assert.ok(text.includes(value), value);
    assert.equal(dom.window.document.querySelector('script'), null);
    assert.equal(dom.window.document.querySelector('svg[aria-label="QR de Instagram"]')?.getAttribute('viewBox'),'0 0 37 37');
    assert.equal(dom.window.document.querySelector('image')?.getAttribute('href'),'/receipt-branding/carinito-logo-v1.jpg');
    assert.match(text,/MENÚ E INSTAGRAM[\s\S]*Para el postre y una sonrisa,/);
    assert.equal(result.document.receiptBranding?.qrUrl,'https://www.instagram.com/_carinitomio/');
    assert.equal(JSON.stringify(original), unchanged);
  } finally { dom.window.close(); }
});

test('a missing local original rebuilds from immutable sale snapshot; legacy missing values are explicit', async () => {
  const f = fixture(), options = { stored: () => undefined, issuer: () => issuer };
  const fresh = await handleReceiptRequest(request(), f.client, options);
  assert.equal(fresh.source, 'snapshot'); assert.deepEqual(fresh.document, saleDocuments(order, { issuer }).customer);
  f.state.snapshot = null;
  const legacy = await handleReceiptRequest(request(), f.client, options);
  assert.equal(legacy.source, 'legacy'); const text = legacy.document.sections.flat().join('\n');
  assert.match(text, /Sin hielo · Avena/); assert.match(text, /Cambio: no registrado/); assert.match(text, /Recibido MXN: no registrado/);
  assert.doesNotMatch(text, /Cambio: \$0\.00/);
  await assert.rejects(handleReceiptRequest(request(), f.client, { stored: () => undefined, issuer: () => undefined }), /datos fiscales/);
});

test('reprints enforce caller, active role, own-sale boundary, valid selector and pending-sale rejection', async () => {
  const f = fixture(), options = { stored: () => saleDocuments(order, { issuer }).customer };
  f.state.auth = false; await assert.rejects(handleReceiptRequest(request(), f.client, options), /Inicia sesión/);
  f.state.auth = true; f.state.active = false; await assert.rejects(handleReceiptRequest(request(), f.client, options), /Sin acceso/);
  f.state.active = true; f.state.owner = 'other'; await assert.rejects(handleReceiptRequest(request(), f.client, options), /Sin acceso/);
  assert.ok(f.filters.some(v => JSON.stringify(v) === JSON.stringify(['cashier_id', 'cashier'])));
  f.state.role = 'admin'; assert.equal((await handleReceiptRequest(request(), f.client, options)).source, 'stored');
  f.state.status = 'pending'; await assert.rejects(handleReceiptRequest(request(), f.client, options), /pendiente/);
  for (const query of ['orderId=bad', 'ticketNumber=0', 'ticketNumber=12x', `orderId=${order.id}&ticketNumber=1234`, 'issuer=injected'])
    await assert.rejects(handleReceiptRequest(request(query), f.client, options), /Folio inválido/);
});

test('saved receipt lookup is owner-scoped, read-only and preserves the print journal after reopening', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-reprint-'));
  const keys = ['POS_PRINT_MODE', 'POS_PRINT_DATA_DIR'], previous = keys.map(key => process.env[key]);
  process.env.POS_PRINT_MODE = 'mock'; process.env.POS_PRINT_DATA_DIR = directory;
  try {
    const adapter = { async prepare() { assert.fail('Read-only lookup must not submit'); } };
    const file = path.join(directory, 'mock-jobs.sqlite');
    const journal = new PrintJournal(file, adapter); journal.ensure('cashier', order, { customer: 'USB', barista: 'BT' }, { issuer }); journal.close();
    assert.deepEqual(storedCustomerReceipt('cashier', order.id), saleDocuments(order, { issuer }).customer);
    assert.equal(storedCustomerReceipt('other', order.id), undefined);
    const reopened = new PrintJournal(file, adapter);
    try { assert.ok(reopened.get('cashier', order.id).every(job => job.state === 'queued' && job.attempts === 0)); }
    finally { reopened.close(); }
  } finally {
    for (const [i, key] of keys.entries()) { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }
    rmSync(directory, { recursive: true, force: true });
  }
});
