import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedOrder } from '../lib/checkout';
import { PrintJournal, type PrintAdapter } from '../lib/print-journal-server';
import { saleDocuments, rememberSalePrint, pendingSalePrints, forgetSalePrint, type PrintAudience } from '../lib/sale-printing';
import { handlePrintRequest, requireLocalPrintRequest } from '../lib/print-dispatch-server';
import { printConfig, printerAdapter } from '../lib/windows-print-server';
import { readReceiptIssuer } from '../lib/receipt-issuer-server';

const queues = { customer: 'POS80 Printer', barista: 'Y813BT Sticker' };
const sale = (): SavedOrder => ({ id: randomUUID(), ticket_number: 1234, status: 'completed', total: 220,
  items: [{ id: 'line', quantity: 2, product: { id: 'iced', name: 'Iced coffee vainilla', price: 110,
    category: 'Bebidas', displayExtras: [{ name: 'Leche de avena', price: 15 }], note: 'Sin hielo <urgente>' } }],
  customer_name: 'Ana & José', order_type: 'Para Llevar', order_note: 'Entregar juntos', created_at: '2026-10-30T16:20:00Z',
  payment_method: 'efectivo', tender_mxn: 250, tender_usd: 0, exchange_rate: 20, change_mxn: 30 });
function scratch() { return mkdtempSync(path.join(tmpdir(), 'pos-print-test-')); }
const remove = (directory: string) => rmSync(directory, { recursive: true, force: true });
const testIssuer = { legalName:'EMISOR FICTICIO DE PRUEBA', rfc:'AAA010101AAA', taxRegime:'601 - General de Ley Personas Morales',
  establishmentAddress:'DOMICILIO FICTICIO DE PRUEBA',postalCode:'87380',city:'H. Matamoros, Tamaulipas' };

test('a Windows UTF-8 BOM does not withhold an otherwise valid local issuer profile', () => {
  const directory=scratch(),file=path.join(directory,'issuer.json');
  try {
    writeFileSync(file,'\uFEFF'+JSON.stringify(testIssuer));
    assert.deepEqual(readReceiptIssuer({POS_RECEIPT_ISSUER_FILE:file}),testIssuer);
  } finally { remove(directory); }
});

test('customer receipt omits issuer name and CFDI wording while preserving remaining issuer fields and amounts', () => {
  const docs = saleDocuments(sale(), { issuer:testIssuer,testOnly:true }), receipt=docs.customer.sections[0].join('\n');
  for(const expected of [testIssuer.rfc,testIssuer.taxRegime,testIssuer.establishmentAddress,testIssuer.postalCode,'Folio: 1234','P.UNITARIO','$110.00','$220.00','TOTAL: $220.00 MXN'])assert.ok(receipt.includes(expected));
  assert.ok(!receipt.includes(testIssuer.legalName));
  assert.equal(docs.customer.issuerComplete,true);assert.equal(docs.customer.testOnly,true);
  assert.match(receipt,/PRUEBA DE IMPRESIÓN · NO ES UNA VENTA/);
  for (const document of Object.values(saleDocuments(sale(), {issuer:testIssuer}))) {
    assert.doesNotMatch(document.sections.flat().join(' '),/PRUEBA DE IMPRESIÓN|NO ES UNA VENTA|NO PREPARAR|INTENTO/i);
  }
  assert.doesNotMatch(receipt,/CFDI|CDFI|IVA\s*(?:8|16)|mismo día|30 días|UUID|Sello Digital/i);
  const draft=saleDocuments(sale()).customer;
  assert.doesNotMatch(draft.sections.flat().join(' '),/PRUEBA DE IMPRESIÓN|NO ES UNA VENTA/i);
  assert.equal(draft.issuerComplete,false);assert.match(draft.sections.flat().join(' '),/\[RFC DEL EMISOR\].*\[RÉGIMEN FISCAL\].*\[DOMICILIO DEL ESTABLECIMIENTO\]/);
  assert.doesNotMatch(draft.sections.flat().join(' '),/NOMBRE O RAZÓN SOCIAL/);
  const label=docs.barista;
  assert.equal(label.sections[0][0],'Ana & José');assert.equal(label.styles?.[0][0],'name');assert.equal(label.styles?.[0][1],'drink');assert.equal(label.styles?.[0].at(-1),'footer');
  assert.equal(label.cupLabels,undefined);assert.equal(label.labelLayout,'reference-v2');
  assert.deepEqual(label.referenceLabels?.[0],{folio:'#1234',cup:'1/2',service:'Para Llevar',date:'30/10/26',time:'11:20 AM'});
});

test('completing fiscal placeholders upgrades only a withheld customer draft and never reprints the accepted barista job', async () => {
  const directory=scratch(),order=sale(),sent:PrintAudience[]=[];
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job,document){
    if(job.audience==='customer'&&!document.issuerComplete)throw Error('Emisor pendiente');
    return {async submit(){sent.push(job.audience);},dispose(){}};
  }});
  try{
    journal.ensure('cashier',order,queues);await journal.dispatch('cashier',order.id);
    assert.deepEqual(sent,['barista']);
    journal.ensure('cashier',order,queues,{issuer:testIssuer});await journal.dispatch('cashier',order.id);
    journal.ensure('cashier',order,queues,{issuer:{...testIssuer,legalName:'NOMBRE CORREGIDO PARA NUEVAS VENTAS'}});await journal.dispatch('cashier',order.id);
    assert.deepEqual(sent,['barista','customer']);
  }finally{journal.close();remove(directory);}
});

test('local issuer configuration cannot be supplied by the browser and incomplete physical sale receipts stop before the helper', async () => {
  const directory=scratch(),file=path.join(directory,'issuer.json');
  try{
    writeFileSync(file,JSON.stringify(testIssuer));assert.deepEqual(readReceiptIssuer({POS_RECEIPT_ISSUER_FILE:file}),testIssuer);
    assert.throws(()=>readReceiptIssuer({POS_RECEIPT_ISSUER_FILE:'relative.json'}),/absoluta/);
    writeFileSync(file,JSON.stringify({...testIssuer,rfc:''}));assert.throws(()=>readReceiptIssuer({POS_RECEIPT_ISSUER_FILE:file}),/Completa/);
    if(process.platform==='win32'){
      const adapter=printerAdapter({mode:'windows',directory,queues,baristaStock:{widthMm:57.15,heightMm:31.75}});
      await assert.rejects(adapter.prepare({orderId:'sample',ticket:'1',audience:'customer',queue:queues.customer,state:'queued',message:'',attempts:0,updatedAt:''},saleDocuments(sale()).customer),/datos fiscales/);
    }
  }finally{remove(directory);}
});

test('one confirmed snapshot yields financial customer context and complete per-cup barista context', () => {
  const docs = saleDocuments(sale()), customer = docs.customer.sections.flat().join('\n'), barista = docs.barista.sections.flat().join('\n');
  assert.match(customer, /TOTAL: \$220.00 MXN/); assert.match(customer, /Cambio: \$30.00/);
  assert.equal(docs.barista.sections.length, 2);
  for (const section of docs.barista.sections) {
    const text = section.join('\n');
    for (const expected of ['1234', 'Ana & José', 'Para Llevar', 'Iced coffee vainilla', 'Leche de avena', 'Sin hielo <urgente>', 'Entregar juntos']) assert.ok(text.includes(expected));
  }
  assert.doesNotMatch(barista, /\$|TOTAL|Cambio|efectivo/);
  assert.match(barista, /1\/2/); assert.match(barista, /2\/2/);
  assert.throws(() => saleDocuments({ ...sale(), status: 'pending' }), /comprobante completo/);
  assert.throws(() => saleDocuments({ ...sale(), status: 'cancelled' }), /comprobante completo/);
});

test('all 82 real menu presentations preserve their names and prices without catalog/network access', () => {
  const menu = JSON.parse(readFileSync(new URL('./fixtures/real-menu.json', import.meta.url), 'utf8'));
  const order = sale();
  order.items = menu.products.map((p: { name: string; price_mxn: number }, index: number) => ({ id: String(index), quantity: 1,
    product: { id: String(index), name: p.name, price: p.price_mxn, category: 'Prueba'} }));
  order.total = order.items.reduce((sum, item) => sum + item.product.price, 0);
  const docs = saleDocuments(order);
  assert.equal(order.items.length, 82); assert.equal(docs.barista.sections.length, 82);
  for (const item of order.items) {
    const index = docs.customer.sections[0].indexOf(item.product.name);
    assert.ok(index >= 0); assert.ok(docs.customer.sections[0][index + 1].includes(item.product.price.toFixed(2)));
  }
});

test('receipt-only acceptance creates no barista copy and preserves prior journal jobs across retries', async () => {
  const directory=scratch(),sent:PrintAudience[]=[],old=sale(),receipt={...sale(),ticket_number:'PRUEBA-R8'};
  const journal=new PrintJournal(path.join(directory,'jobs.sqlite'),{async prepare(job){return{async submit(){sent.push(job.audience);},dispose(){}};}});
  try {
    journal.ensure('physical-test-only',old,queues);await journal.dispatch('physical-test-only',old.id);
    const previous=journal.get('physical-test-only',old.id);
    journal.ensure('physical-test-only',receipt,queues,{testOnly:true},'customer');
    await journal.dispatch('physical-test-only',receipt.id,'customer');
    journal.ensure('physical-test-only',receipt,queues,{testOnly:true},'customer');
    await journal.dispatch('physical-test-only',receipt.id,'customer');
    assert.deepEqual(sent.sort(),['barista','customer','customer']);
    assert.deepEqual(journal.get('physical-test-only',old.id),previous);
    const jobs=journal.get('physical-test-only',receipt.id);
    assert.equal(jobs.length,1);assert.equal(jobs[0].audience,'customer');assert.equal(jobs[0].attempts,1);
    assert.equal(jobs[0].state,'submitted');
  } finally {journal.close();remove(directory);}
});

test('two workers, repeated POSTs, refresh and process restart cannot submit a successful copy twice', async () => {
  const directory = scratch(), order = sale();
  const sent: PrintAudience[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter: PrintAdapter = { async prepare(job) { return { async submit() { sent.push(job.audience); await gate; }, dispose() {} }; } };
  const filename = path.join(directory, 'jobs.sqlite');
  const first = new PrintJournal(filename, adapter), second = new PrintJournal(filename, adapter);
  try {
    first.ensure('cashier', order, queues); second.ensure('cashier', order, queues);
    const run = first.dispatch('cashier', order.id);
    await second.dispatch('cashier', order.id);
    assert.equal(sent.length, 2, 'Both audiences started without waiting on one another');
    release(); await run; first.close();
    const restarted = new PrintJournal(filename, adapter);
    try {
      restarted.ensure('cashier', order, queues);
      await restarted.dispatch('cashier', order.id); await second.dispatch('cashier', order.id);
      assert.deepEqual(sent.sort(), ['barista', 'customer']);
      assert.ok(restarted.get('cashier', order.id).every(job => job.state === 'submitted'));
      assert.deepEqual(restarted.list('other-cashier'), []);
      assert.throws(() => restarted.ensure('cashier', { ...order, order_note: 'Changed after commit' }, queues), /otro comprobante/);
      assert.throws(() => restarted.ensure('other-cashier', order, queues), /otro comprobante/);
    } finally { restarted.close(); }
  } finally { second.close(); remove(directory); }
});

test('Bluetooth unavailable before handoff retries only barista, without a checkout or customer reprint', async () => {
  const directory = scratch(), order = sale(); let offline = true;
  const sent: PrintAudience[] = [];
  const adapter: PrintAdapter = { async prepare(job) {
    if (job.audience === 'barista' && offline) throw Error('Bluetooth desconectado');
    return { async submit() { sent.push(job.audience); }, dispose() {} };
  } };
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), adapter);
  try {
    journal.ensure('cashier', order, queues); await journal.dispatch('cashier', order.id);
    assert.deepEqual(sent, ['customer']); assert.equal(journal.get('cashier', order.id).find(j => j.audience === 'barista')?.state, 'blocked');
    offline = false; await journal.dispatch('cashier', order.id, 'barista'); await journal.dispatch('cashier', order.id);
    assert.deepEqual(sent, ['customer', 'barista']);
  } finally { journal.close(); remove(directory); }
});

test('lost spool acknowledgment and expired submitting state never allow blind retries', async () => {
  const directory = scratch(), order = sale(); let now = Date.now();
  const sent: PrintAudience[] = [];
  const adapter: PrintAdapter = { async prepare(job) { return { async submit() { sent.push(job.audience); if (job.audience === 'barista') throw Error('Lost acknowledgment'); }, dispose() {} }; } };
  let journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), adapter, () => now);
  try {
    journal.ensure('cashier', order, queues); await journal.dispatch('cashier', order.id);
    assert.equal(journal.get('cashier', order.id).find(j => j.audience === 'barista')?.state, 'uncertain');
    journal.close(); now += 3600_000;
    journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), adapter, () => now);
    await journal.dispatch('cashier', order.id); assert.equal(sent.length, 2);
  } finally { journal.close(); remove(directory); }
});

test('expired preflight can be recovered; its stale worker cannot later print', async () => {
  const directory = scratch(), order = sale(); let now = Date.now(), calls = 0, submitted = 0;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter: PrintAdapter = { async prepare() { if (++calls === 1) await gate; return { async submit() { submitted++; }, dispose() {} }; } };
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), adapter, () => now);
  try {
    journal.ensure('cashier', order, queues);
    const stale = journal.dispatch('cashier', order.id, 'customer'); now += 61_000;
    await journal.dispatch('cashier', order.id, 'customer'); release(); await stale;
    assert.equal(submitted, 1); assert.equal(journal.get('cashier', order.id).find(j => j.audience === 'customer')?.attempts, 2);
  } finally { journal.close(); remove(directory); }
});

test('a process loss after submitting commit is durable and blocks resend after restart', async () => {
  const directory = scratch(), order = sale(); let now = Date.now(), calls = 0;
  // Leave the first dispatch suspended exactly at the spool boundary, as a killed process would be.
  const adapter: PrintAdapter = { async prepare() { return { submit() { calls++; return new Promise(() => {}); }, dispose() {} }; } };
  const filename = path.join(directory, 'jobs.sqlite');
  const first = new PrintJournal(filename, adapter, () => now);
  try {
    first.ensure('cashier', order, queues); void first.dispatch('cashier', order.id, 'customer');
    await new Promise(resolve => setImmediate(resolve)); now += 121_000;
    const restarted = new PrintJournal(filename, adapter, () => now);
    try {
      assert.equal(restarted.get('cashier', order.id).find(j => j.audience === 'customer')?.state, 'uncertain');
      await restarted.dispatch('cashier', order.id, 'customer'); assert.equal(calls, 1);
    } finally { restarted.close(); }
  } finally { first.close(); remove(directory); }
});

test('browser outbox survives reload, separates cashiers and retains independently added sales', () => {
  const map = new Map<string, string>();
  const storage = { get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const a = sale(), b = sale(); rememberSalePrint(storage, 'cashier-a', a); rememberSalePrint(storage, 'cashier-a', b);
  assert.deepEqual(pendingSalePrints(storage, 'cashier-a').sort(), [a.id, b.id].sort());
  assert.deepEqual(pendingSalePrints(storage, 'cashier-b'), []);
  rememberSalePrint(storage, 'cashier-a', a); forgetSalePrint(storage, 'cashier-a', a.id);
  assert.deepEqual(pendingSalePrints(storage, 'cashier-a'), [b.id]);
});

test('mock adapter writes only synthetic spool data and preserves unknown outcomes', async () => {
  const directory = scratch(), faultPath = path.join(directory, 'faults.json'), order = sale();
  writeFileSync(faultPath, JSON.stringify({ barista: 'offline' }));
  const config = printConfig({ POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: directory, POS_PRINT_MOCK_FAULTS: faultPath });
  const journal = new PrintJournal(path.join(directory, 'mock-jobs.sqlite'), printerAdapter(config));
  try {
    journal.ensure('cashier', order, queues); await journal.dispatch('cashier', order.id);
    writeFileSync(faultPath, JSON.stringify({ barista: 'uncertain' }));
    await journal.dispatch('cashier', order.id, 'barista'); await journal.dispatch('cashier', order.id);
    const spool = readFileSync(path.join(directory, 'mock-spool.jsonl'), 'utf8').trim().split('\n').map(row => JSON.parse(row));
    assert.equal(spool.length, 2); assert.equal(spool[0].queue, queues.customer); assert.equal(spool[1].queue, queues.barista);
  } finally { journal.close(); remove(directory); }
  assert.throws(() => printConfig({}), /impresión local no está configurada/);
  assert.throws(() => printConfig({ POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: '\\\\server\\share\\print-journal' }), /disco local/);
  assert.throws(() => printConfig({ POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: directory, POS_PRINT_CUSTOMER_QUEUE: 'same', POS_PRINT_BARISTA_QUEUE: 'same' }), /impresora distinta/);
});

test('actual API accepts only own completed server snapshot; read/retry never invokes a charge RPC', async () => {
  const directory = scratch(), order = sale(); let status = 'completed', owner = 'cashier', auth = true, active = true, reads = 0;
  const submitted: PrintAudience[] = [];
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), { async prepare(job) { return { async submit() { submitted.push(job.audience); }, dispose() {} }; } });
  const client = { auth: { getUser: async () => ({ data: { user: auth ? { id: 'cashier' } : null }, error: null }) },
    from(table: string) {
      assert.ok(['orders', 'profiles'].includes(table)); reads++;
      const query = { select: () => query, eq: () => query, abortSignal: () => query,
        single: async () => ({ error: null, data: table === 'profiles' ? { role: 'cashier', is_active: active }
          : { id: order.id, ticket_number: order.ticket_number, status, cashier_id: owner, receipt_snapshot: order } }) };
      return query;
    }, rpc() { assert.fail('Printing must never charge or write business data'); } } as unknown as SupabaseClient;
  const config = printConfig({ POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: directory });
  const request = (body: unknown = { orderId: order.id }) => new Request('http://127.0.0.1:3000/api/printing', {
    method: 'POST', headers: { 'X-Pos-Print': '1', Origin: 'http://127.0.0.1:3000' }, body: JSON.stringify(body) });
  try {
    status = 'pending'; await assert.rejects(handlePrintRequest(request(), client, journal, config), /no está completada/); assert.equal(submitted.length, 0);
    status = 'completed'; owner = 'other'; await assert.rejects(handlePrintRequest(request(), client, journal, config), /no pertenece/);
    owner = 'cashier'; await assert.rejects(handlePrintRequest(request({ orderId: order.id, queue: 'arbitrary' }), client, journal, config), /inválida/);
    await handlePrintRequest(request(), client, journal, config); await handlePrintRequest(request({ orderId: order.id, audience: 'barista' }), client, journal, config);
    assert.equal(submitted.length, 2); assert.ok(reads > 0);
    auth = false; await assert.rejects(handlePrintRequest(request(), client, journal, config), /Inicia sesión/); auth = true;
    active = false; await assert.rejects(handlePrintRequest(request(), client, journal, config), /Sin acceso/);
  } finally { journal.close(); remove(directory); }
  assert.throws(() => requireLocalPrintRequest(new Request('https://remote.example/api/printing', { headers: { 'X-Pos-Print': '1' } })), /dirección configurada/);
  assert.throws(() => requireLocalPrintRequest(new Request('http://127.0.0.1:3000/api/printing', { headers: { 'X-Pos-Print': '1', Origin: 'https://evil.example' } })), /dirección configurada/);
});

for (const lateState of ['cancelled', 'read-failed']) test(`cancellation/eligibility after paused Windows preparation withholds both copies: ${lateState}`, async () => {
  const directory = scratch(), order = sale(), submitted: PrintAudience[] = [];
  let status = 'completed', failed = false, prepared = 0, disposed = 0, release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bothPrepared = new Promise<void>(resolve => { ready = resolve; });
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), { async prepare(job) {
    if (++prepared === 2) ready(); await gate;
    return { async submit() { submitted.push(job.audience); }, dispose() { disposed++; } };
  } });
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'cashier' } }, error: null }) }, from(table: string) {
    const query = { select: () => query, eq: () => query, abortSignal: () => query, single: async () => ({
      error: table === 'orders' && failed ? { code: '', message: 'Synthetic unavailable backend' } : null,
      data: table === 'profiles' ? { role: 'cashier', is_active: true }
        : { id: order.id, ticket_number: order.ticket_number, status, cashier_id: 'cashier', receipt_snapshot: order },
    }) }; return query;
  }, rpc() { assert.fail('No business writes'); } } as unknown as SupabaseClient;
  const request = () => new Request('http://127.0.0.1:3000/api/printing', { method: 'POST', headers: { 'X-Pos-Print': '1' }, body: JSON.stringify({ orderId: order.id }) });
  try {
    const run = handlePrintRequest(request(), client, journal, printConfig({ POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: directory }));
    await bothPrepared;
    if (lateState === 'cancelled') status = 'cancelled'; else failed = true;
    release(); await run;
    assert.equal(disposed, 2); assert.deepEqual(submitted, []);
    assert.ok(journal.get('cashier', order.id).every(j => j.state === (failed ? 'blocked' : 'cancelled')));
    if (!failed) { await assert.rejects(handlePrintRequest(request(), client, journal, printConfig({ POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: directory })), /no está completada/); }
  } finally { release(); journal.close(); remove(directory); }
});

test('a failed stale worker cannot resurrect locally cancelled preparation', async () => {
  const directory = scratch(), order = sale(); let release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), prepared = new Promise<void>(resolve => { ready = resolve; });
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), { async prepare() { ready(); await gate; throw new Error('Late preparation failure'); } });
  try {
    journal.ensure('cashier', order, queues); const run = journal.dispatch('cashier', order.id);
    await prepared; journal.cancel('cashier', order.id); release(); await run;
    assert.ok(journal.get('cashier', order.id).every(j => j.state === 'cancelled'));
  } finally { release(); journal.close(); remove(directory); }
});
