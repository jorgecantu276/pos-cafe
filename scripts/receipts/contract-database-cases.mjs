import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Called only by the disposable PostgreSQL runner after ALL migrations.
// Fixtures and register setup below must never run against a hosted database.
export async function receiptContractDatabaseCases(db, connection, ids) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const cents = value => Math.round(Number(value) * 100);
  const owner = randomUUID(), register = randomUUID(), customer = randomUUID();
  const matcha = randomUUID(), pastry = randomUUID(), decimal = randomUUID();
  const oat = randomUUID(), free = randomUUID(), tenth = randomUUID(), forbidden = randomUUID();
  await db.query('insert into auth.users values($1)', [owner]);
  await db.query("insert into profiles(id,full_name,username,role) values($1,'Auditor sintético',$2,'cashier')", [owner, `receipt-${owner}`]);
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,0,20.5,'open')", [register, owner]);
  await db.query("insert into customers(id,name,phone) values($1,'Cliente de auditoría','5551234567')", [customer]);
  for (const [id, name, price, steps] of [
    [matcha, 'Matcha de auditoría', 105, ['Tipo de Leche', 'Endulzante']],
    [pastry, 'Postre de auditoría', 35, []],
    [decimal, 'Producto decimal de auditoría', 19.99, ['Adición']],
  ]) await db.query('insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,$2,$3,\'Auditoría\',true,true,$4)', [id, name, price, steps]);
  for (const [id, name, price, phase] of [
    [oat, 'Leche de avena', 15, 'Tipo de Leche'], [free, 'Sin azúcar', 0, 'Endulzante'],
    [tenth, 'Adición decimal', 0.10, 'Adición'], [forbidden, 'Extra no permitido', 10, 'Otra fase'],
  ]) await db.query('insert into extras(id,name,price,phase,active) values($1,$2,$3,$4,true)', [id, name, price, phase]);
  const staff = await connection('authenticated', owner);
  const admin=await connection('authenticated',ids.admin);
  const state=(await admin.query('select pos_inventory_state() r')).rows[0].r;
  await admin.query('select pos_inventory_set_enabled($1,true,$2)',[randomUUID(),state.revision]);
  let catalog=(await admin.query('select pos_inventory_catalog() r')).rows[0].r;
  const tracked=[matcha,pastry,decimal];
  await admin.query('select pos_inventory_write($1,$2)',[randomUUID(),JSON.stringify(tracked.map(product_id=>({product_id,revision:catalog.find(i=>i.product_id===product_id).revision,action:'configure',mode:'counted',unit:'pieza',minimum:2})))]);
  catalog=(await admin.query('select pos_inventory_catalog() r')).rows[0].r;
  await admin.query('select pos_inventory_write($1,$2)',[randomUUID(),JSON.stringify(tracked.map(product_id=>({product_id,revision:catalog.find(i=>i.product_id===product_id).revision,action:'count',quantity:100})))]);
  const stock=async()=>Object.fromEntries((await db.query('select product_id,quantity from pos_inventory_items where product_id=any($1)',[tracked])).rows.map(r=>[r.product_id,r.quantity]));
  const rpc = async (key, payload) => (await staff.query('select pos_checkout($1,$2) result', [key, payload])).rows[0].result;
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../lib/sale-printing.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
  const { saleDocuments } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const issuer = { legalName: 'EMISOR SINTÉTICO OMITIDO', rfc: 'AAA010101AAA', taxRegime: '601 - General de Ley Personas Morales', establishmentAddress: 'Domicilio de prueba', postalCode: '87380', city: 'Matamoros' };
  const branding = JSON.parse(await readFile(new URL('../../config/receipt-branding.json', import.meta.url), 'utf8'));
  const line = (product_id, quantity, extra_ids = [], note = '') => ({ product_id, quantity, extra_ids, note });
  const base = { register_id: register, customer_id: customer, order_type: 'Para Llevar', order_note: 'Entregar juntos', tender_mxn: 0, tender_usd: 0,pager_number:30 };
  const scenarios = [
    { name: 'card-base', payload: { ...base, items: [line(matcha, 1)], expected_total: 105, payment_method: 'tarjeta' }, change: 0 },
    { name: 'cash-quantity-paid-and-free-extras', payload: { ...base, items: [line(matcha, 2, [oat, free], 'Sin hielo'), line(pastry, 3, [], 'Sin tapa')], expected_total: 345, payment_method: 'efectivo', tender_mxn: 400 }, change: 55 },
    { name: 'mixed-currency-decimal', payload: { ...base, items: [line(matcha, 2, [oat]), line(pastry, 3), line(decimal, 3, [tenth])], expected_total: 405.27, payment_method: 'mixto', tender_mxn: 300, tender_usd: 6 }, change: 17.73 },
    { name: 'usd-only-guest', payload: { ...base, items: [line(matcha, 1, [oat])], customer_id: null, order_type: 'En Local', order_note: '', expected_total: 120, payment_method: 'efectivo', tender_usd: 6 }, change: 3 },
    { name: 'other-payment', payload: { ...base, items: [line(pastry, 1)], expected_total: 35, payment_method: 'otro' }, change: 0 },
    { name: 'client-price-and-name-ignored', payload: { ...base, items: [{ ...line(matcha, 1, [oat]), unit_price: 1, name: 'Nombre falso', product: { price: 1, name: 'Nombre falso' } }], customer_name: 'Cliente falso', expected_total: 120, payment_method: 'tarjeta' }, change: 0 },
  ];
  const evidence = [];
  for (const scenario of scenarios) {
    const beforeStock=await stock();
    const key = randomUUID(), payload = scenario.payload, receipt = await rpc(key, payload);
    const stored = (await db.query("select *,to_char(created_at at time zone 'America/Matamoros','DD/MM/YY') local_date,to_char(created_at at time zone 'America/Matamoros','HH12:MI AM') local_time from orders where id=$1", [receipt.id])).rows[0];
    const items = (await db.query('select * from order_items where order_id=$1', [receipt.id])).rows;
    equal(receipt, { ...stored.receipt_snapshot, id: stored.id, ticket_number: stored.ticket_number, status: stored.status });
    equal(stored.request_payload, payload);
    equal(receipt.status, 'completed'); equal(receipt.total, payload.expected_total);
    equal(receipt.pager_number,30);
    const expectedStock={...beforeStock};for(const line of payload.items)expectedStock[line.product_id]-=line.quantity;
    equal(await stock(),expectedStock);
    equal(Number(stored.subtotal), receipt.total); equal(Number(stored.discount), 0);
    equal(new Date(receipt.created_at).toISOString(), stored.created_at.toISOString());
    for (const field of ['total', 'tender_mxn', 'tender_usd', 'exchange_rate', 'change_mxn']) equal(Number(stored[field]), receipt[field]);
    equal(receipt.payment_method, stored.payment_method); equal(receipt.payment_method, payload.payment_method);
    equal(receipt.tender_mxn, payload.tender_mxn); equal(receipt.tender_usd, payload.tender_usd);
    equal(receipt.exchange_rate, 20.5); equal(cents(receipt.change_mxn), cents(scenario.change));
    equal(receipt.customer_name, payload.customer_id ? 'Cliente de auditoría' : 'Invitado');
    equal(receipt.order_type, payload.order_type); equal(receipt.order_note, payload.order_note);
    equal(items.length, payload.items.length);
    const documents = saleDocuments(receipt, { issuer }), text = documents.customer.sections[0];
    const rows = text.filter(value => /^\d+\s+\$\d+\.\d{2}\s+\$\d+\.\d{2}$/.test(value));
    equal(rows.length, items.length);
    let sum = 0, cup = 0;
    for (const [index, input] of payload.items.entries()) {
      const saved = receipt.items[index];
      const item = items.find(value => value.product_id === input.product_id && value.product_snapshot.note === input.note);
      const product = (await db.query('select name,price from products where id=$1', [input.product_id])).rows[0];
      const extras = (await db.query('select id,name,price,phase from extras where id=any($1::uuid[])', [input.extra_ids])).rows;
      const unit = cents(product.price) + extras.reduce((sum, extra) => sum + cents(extra.price), 0);
      equal(cents(item.unit_price), unit); equal(cents(item.total_price), unit * input.quantity);
      equal(item.quantity, input.quantity); equal(item.product_snapshot, saved.product);
      equal(saved.quantity, input.quantity); equal(saved.product.name, product.name);
      equal(cents(saved.product.price), unit); equal(cents(saved.product.basePrice), cents(product.price));
      equal(saved.product.note, input.note);
      equal(saved.product.displayExtras, input.extra_ids.map(id => { const extra = extras.find(value => value.id === id); return { ...extra, price: Number(extra.price) }; }));
      equal(item.notes, [input.note, extras.length ? input.extra_ids.map(id => extras.find(value => value.id === id).name).join(', ') : ''].filter(Boolean).join(' · '));
      const amounts = rows[index].trim().split(/\s+/);
      equal(amounts, [String(input.quantity), `$${(unit / 100).toFixed(2)}`, `$${(unit * input.quantity / 100).toFixed(2)}`]);
      for (let n = 0; n < input.quantity; n++) {
        const section = documents.barista.sections[cup], meta = documents.barista.referenceLabels[cup];
        equal(section.slice(0, 2), [receipt.customer_name, product.name]);
        equal(section.slice(2, 2 + extras.length), saved.product.displayExtras.map(extra => extra.name));
        equal(meta, { folio: 'CONTROL 30 · #' + String(receipt.ticket_number).padStart(4, '0'), cup: `${++cup}/${receipt.items.reduce((sum, item) => sum + item.quantity, 0)}`, service: receipt.order_type, date: stored.local_date, time: stored.local_time });
        if (input.note) equal(section.includes(input.note), true);
        if (payload.order_note) equal(section.includes('ORDEN: ' + payload.order_note), true);
      }
      equal(text.includes(product.name), true);
      for (const extra of extras) equal(text.includes(`  + ${extra.name} (incl.)`), true);
      if (input.note) equal(text.includes('  ' + input.note), true);
      sum += cents(item.total_price);
    }
    equal(sum, cents(stored.total)); equal(documents.barista.sections.length, cup);
    equal(text.some(value => value.startsWith('Folio: ' + String(stored.ticket_number).padStart(4, '0') + ' · ')), true);
    equal(text.includes('Cliente: ' + receipt.customer_name), true); equal(text.includes(receipt.order_type), true);
    equal(text.includes('CONTROL: 30'),true);
    equal(text.includes('TOTAL: $' + Number(stored.total).toFixed(2) + ' MXN'), true);
    equal(text.includes('Pago: ' + ({ efectivo: 'EFECTIVO', tarjeta: 'TARJETA', mixto: 'MIXTO', otro: 'otro' })[stored.payment_method]), true);
    const cash = ['efectivo', 'mixto'].includes(stored.payment_method);
    equal(text.some(value => value.startsWith('Recibido MXN:')), cash); equal(text.some(value => value.startsWith('Cambio:')), cash);
    if (cash) { equal(text.includes('Recibido MXN: $' + Number(stored.tender_mxn).toFixed(2)), true); equal(text.includes('Cambio: $' + Number(stored.change_mxn).toFixed(2)), true); }
    if (receipt.tender_usd) equal(text.includes(`Recibido USD: $${Number(stored.tender_usd).toFixed(2)} · TC ${Number(stored.exchange_rate).toFixed(4)}`), true);
    equal(documents.customer.receiptBranding, branding); equal(documents.customer.issuerComplete, true);
    for (const value of [`RFC: ${issuer.rfc}`, `Régimen: ${issuer.taxRegime}`, issuer.establishmentAddress, `${issuer.city} · C.P. ${issuer.postalCode}`, 'Teléfono: +52 868 305 4668', 'MENÚ E INSTAGRAM', '@_carinitomio']) equal(text.includes(value), true);
    equal(/CFDI|CDFI|EMISOR SINTÉTICO OMITIDO|Nombre falso|Cliente falso|PRUEBA DE IMPRESIÓN|Ajuste de la venta/.test(text.join('\n')), false);
    equal(await rpc(key, payload), receipt);
    equal(await stock(),expectedStock);
    equal((await db.query('select count(*)::int n from orders where cashier_id=$1 and request_id=$2', [owner, key])).rows[0].n, 1);
    evidence.push({ scenario: scenario.name, receipt, documents, storedArithmeticMatches: true, oneOrderAfterReplay: true,inventoryActive:true,stockBefore:beforeStock,stockAfter:expectedStock });
  }
  const count = async () => (await db.query('select count(*)::int orders,(select count(*)::int from order_items) items from orders')).rows[0];
  const valid = scenarios[3].payload;
  for (const bad of [
    { ...valid, expected_total: 110 },
    { ...valid, items: [line(matcha, 1, [forbidden])] },
    { ...valid, items: [line(matcha, 1, [oat, oat])] },
    { ...valid, items: [line(matcha, 1.5, [oat])] },
    { ...valid, tender_usd: 1 },
  ]) { const before = await count(); await assert.rejects(rpc(randomUUID(), bad)); checks++; equal(await count(), before); }
  // Historical receipts use sold snapshots, including names and paid modifiers.
  await db.query("update products set price=999,name='Catálogo editado' where id=any($1::uuid[])", [[matcha, pastry, decimal]]);
  await db.query("update extras set price=99,name='Extra editado' where id=any($1::uuid[])", [[oat, free, tenth]]);
  await db.query("update customers set name='Cliente editado' where id=$1", [customer]);
  for (const item of evidence) {
    const row = (await db.query('select * from orders where id=$1', [item.receipt.id])).rows[0];
    const frozen = { ...row.receipt_snapshot, id: row.id, ticket_number: row.ticket_number, status: row.status };
    equal(saleDocuments(frozen, { issuer }), item.documents);
    equal(await rpc(row.request_id, row.request_payload), item.receipt);
  }
  if (process.env.POS_RECEIPT_CONTRACT_EVIDENCE) await writeFile(process.env.POS_RECEIPT_CONTRACT_EVIDENCE, JSON.stringify({
    scope: 'Disposable local PostgreSQL 17 with all repository migrations; real pos_checkout SQL and POS document generator',
    liveDataAccess: false, physicalPrints: 0, checks, scenarios: evidence,
    rejectedWithoutWrites: ['incorrect expected total', 'incompatible extra', 'duplicate extra', 'fractional quantity', 'insufficient tender'],
    catalogChangesPreserveOriginalReceipts: true,
  }, null, 2));
  console.log(`PASS ${checks} receipt/database contract checks: six payments/preparation cases, saved SQL line amounts, extras, totals, currency/change, labels, immutable replay and rejected-write rollback`);
  return checks;
}
