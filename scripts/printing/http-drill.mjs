import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { startApp } from '../staging/app.mjs';
import { work } from '../staging/runtime.mjs';
await mkdir(work, { recursive: true });

// Own loopback fixture implements READ-ONLY Auth/PostgREST responses. It cannot
// proxy to a hosted service, charge, change inventory, or submit a physical job.
const directory = await mkdtemp(path.join(work, 'printing-http-'));
const faults = path.join(directory, 'faults.json');
await writeFile(faults, JSON.stringify({ barista: 'offline' }));
const actors = [randomUUID(), randomUUID()], tokens = new Map(), orders = new Map(), checks = [], methods = [];
let app, backend;
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const send = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
function user(id) { return { id, aud: 'authenticated', role: 'authenticated', email: id + '@local.invalid', email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {} }; }
function token(id) {
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  return encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200 }) + '.fixture-signature';
}
function newSale(ticket) {
  const id = randomUUID();
  orders.set(id, { id, ticket_number: ticket, status: 'completed', cashier_id: actors[0], receipt_snapshot: {
    items: [{ id: 'line', quantity: 2, product: { id: 'iced', name: 'Iced coffee caramelo', price: 110, category: 'Bebidas', stock: 0,
      displayExtras: [{ name: 'Leche de avena', price: 15 }], note: 'Sin hielo' } }], total: 220,
    customer_name: 'Cliente sintético', order_type: 'Para Llevar', order_note: 'Entregar juntos', created_at: '2026-10-30T17:00:00Z',
    payment_method: 'efectivo', tender_mxn: 250, tender_usd: 0, exchange_rate: 20, change_mxn: 30 } });
  return id;
}
try {
  backend = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1'); methods.push(`${request.method} ${url.pathname}`);
    if (request.method === 'POST' && url.pathname === '/auth/v1/token') {
      let bytes = ''; for await (const chunk of request) bytes += chunk;
      const id = JSON.parse(bytes).email?.split('@')[0];
      if (!actors.includes(id)) return send(response, 401, { message: 'No fixture session' });
      const access = token(id); tokens.set(access, id);
      return send(response, 200, { access_token: access, token_type: 'bearer', expires_in: 7200, refresh_token: 'fixture-refresh', user: user(id) });
    }
    const actor = tokens.get(request.headers.authorization?.replace(/^Bearer /i, ''));
    if (!actor) return send(response, 401, { message: 'No fixture session' });
    if (request.method === 'GET' && url.pathname === '/auth/v1/user') return send(response, 200, user(actor));
    if (request.method === 'GET' && url.pathname === '/rest/v1/profiles') return send(response, 200, { role: 'cashier', is_active: true });
    if (request.method === 'GET' && url.pathname === '/rest/v1/orders') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, ''); const order = orders.get(id);
      if (!order || order.cashier_id !== actor) return send(response, 406, { code: 'PGRST116', message: 'No rows' });
      return send(response, 200, order);
    }
    return send(response, 400, { message: 'This local fixture refuses business writes and unknown routes' });
  });
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const api = 'http://127.0.0.1:' + backend.address().port;
  const config = { api, anon: 'local-fixture-anon', service: 'local-fixture-service' };
  const cookies = [];
  for (const actor of actors) {
    const jar = new Map();
    const client = createServerClient(api, config.anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) } });
    const login = await client.auth.signInWithPassword({ email: actor + '@local.invalid', password: 'Synthetic-only' });
    assert.ifError(login.error); cookies.push([...jar].map(([k, v]) => `${k}=${v}`).join('; ')); client.auth.stopAutoRefresh();
  }
  const issuer = path.join(directory, 'synthetic-issuer.json');
  await writeFile(issuer, JSON.stringify({ legalName: 'EMISOR FICTICIO', rfc: 'AAA010101AAA', taxRegime: '601 - General de Ley Personas Morales',
    establishmentAddress: 'Domicilio ficticio', postalCode: '87380', city: 'Matamoros' }));
  app = await startApp(config, { port: 3112, printing: { directory, faults, issuer } }); await app.ready();
  const url = 'http://127.0.0.1:3112/api/printing';
  const http = (body, cookie = cookies[0], origin = 'http://127.0.0.1:3112') => fetch(url, {
    method: body ? 'POST' : 'GET', redirect: 'manual', headers: { Cookie: cookie, Origin: origin, 'X-Pos-Print': '1', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(75_000) });
  const post = async body => { const response = await http(body); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
  const spool = async () => (await readFile(path.join(directory, 'mock-spool.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(row => JSON.parse(row));
  assert.equal((await http(null, '')).status, 401);
  assert.equal((await http(null, cookies[0], 'https://other.invalid')).status, 403);
  pass('Actual production middleware and route reject anonymous and cross-origin print requests');
  const first = newSale(4001);
  await Promise.all(Array.from({ length: 8 }, () => post({ orderId: first })));
  assert.equal((await spool()).length, 1);
  const blocked = await (await http()).json(); assert.equal(blocked.mode, 'mock');
  assert.equal(blocked.jobs.find(j => j.audience === 'customer').state, 'submitted');
  assert.equal(blocked.jobs.find(j => j.audience === 'barista').state, 'blocked');
  pass('Eight concurrent production HTTP submissions yield one USB job while Bluetooth is disconnected');
  await writeFile(faults, '{}');
  await post({ orderId: first, audience: 'barista' });
  assert.equal((await spool()).length, 2);
  assert.deepEqual((await spool()).map(j => j.queue).sort(), ['POS80 Printer', 'Y813BT Sticker'].sort());
  const documents = await spool(); assert.match(documents.find(j => j.audience === 'barista').document.sections.flat().join(' '), /Leche de avena.*Sin hielo.*Entregar juntos/);
  pass('Bluetooth retry routes only the missing preparation copy; both copies use the same immutable folio');
  const receiptUrl = 'http://127.0.0.1:3112/api/receipts?orderId=' + first;
  const receiptResponse = await fetch(receiptUrl, { headers: { Cookie: cookies[0] }, redirect: 'manual' });
  assert.equal(receiptResponse.status, 200);
  const savedReceipt = await receiptResponse.json();
  assert.equal(savedReceipt.source, 'stored');
  assert.match(savedReceipt.document.sections.flat().join(' '), /AAA010101AAA.*Domicilio ficticio/);
  assert.doesNotMatch(savedReceipt.document.sections.flat().join(' '), /EMISOR FICTICIO/);
  assert.match(savedReceipt.document.sections.flat().join(' '), /Entregar juntos/);
  assert.match(savedReceipt.document.sections.flat().join(' '), /Recibido MXN:.*250\.00.*Cambio:.*30\.00/);
  assert.match(receiptResponse.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await fetch(receiptUrl, { headers: { Cookie: cookies[1] }, redirect: 'manual' })).status, 404);
  assert.equal((await spool()).length, 2);
  pass('Production receipt endpoint preserves stored customer content, denies another cashier and never submits a print job');
  await app.restart(); await post({ orderId: first }); assert.equal((await spool()).length, 2);
  pass('Production process restart preserves the disk journal and cannot reprint either accepted copy');
  const second = newSale(4002); await writeFile(faults, JSON.stringify({ barista: 'uncertain' }));
  const uncertain = await post({ orderId: second }); assert.equal(uncertain.jobs.find(j => j.audience === 'barista').state, 'uncertain');
  await app.restart(); await post({ orderId: second, audience: 'barista' }); assert.equal((await spool()).length, 4);
  pass('Lost printer acknowledgment survives restart and refuses blind retries after potential output');
  const third = newSale(4003); await writeFile(faults, JSON.stringify({ barista: 'offline' }));
  await post({ orderId: third }); orders.get(third).status = 'cancelled';
  assert.equal((await http({ orderId: third, audience: 'barista' })).status, 409);
  assert.equal((await spool()).length, 5);
  assert.equal((await (await http()).json()).jobs.find(j => j.orderId === third && j.audience === 'barista').state, 'cancelled');
  const other = await (await http(null, cookies[1])).json(); assert.equal(other.jobs.length, 0);
  assert.equal((await http({ orderId: first }, cookies[1])).status, 404);
  pass('Cancelled preparation is withheld and another cashier cannot read or dispatch these sales');
  const approved = newSale(4004), approvedSnapshot = orders.get(approved).receipt_snapshot;
  approvedSnapshot.items[0].quantity = 1;
  approvedSnapshot.items[0].product.note = 'SIN HIELO. NO PREPARAR.';
  approvedSnapshot.customer_name = 'Ana (Prueba)'; approvedSnapshot.order_note = '';
  approvedSnapshot.total = 110; approvedSnapshot.tender_mxn = 150; approvedSnapshot.change_mxn = 40;
  const beforeApproved = (await spool()).length;
  await writeFile(faults, '{}');
  await Promise.all(Array.from({ length: 4 }, () => post({ orderId: approved })));
  const approvedCopies = (await spool()).filter(job => job.orderId === approved);
  assert.equal((await spool()).length, beforeApproved + 2); assert.equal(approvedCopies.length, 2);
  const receiptDoc = approvedCopies.find(job => job.audience === 'customer').document;
  const labelDoc = approvedCopies.find(job => job.audience === 'barista').document;
  assert.equal(receiptDoc.receiptBranding.version, 1);
  assert.equal(receiptDoc.receiptBranding.qrUrl, 'https://www.instagram.com/_carinitomio/');
  assert.equal(receiptDoc.styles[0][0], 'logo'); assert.equal(receiptDoc.testOnly, false);
  assert.match(receiptDoc.sections.flat().join(' '), /TOTAL: \$110\.00 MXN.*Recibido MXN: \$150\.00.*Cambio: \$40\.00/);
  assert.equal(labelDoc.cupLabels, undefined);
  assert.equal(labelDoc.labelLayout,'reference-v2');
  assert.equal(labelDoc.referenceLabels[0].folio,'#4004');assert.equal(labelDoc.referenceLabels[0].cup,'1/1');
  assert.deepEqual(labelDoc.sections[0].slice(0, 4), ['Ana (Prueba)', 'Iced coffee caramelo', 'Leche de avena', 'SIN HIELO. NO PREPARAR.']);
  assert.match(labelDoc.sections[0].at(-1), /^#4004 · 1\/1 · Para Llevar ·/);
  if (process.platform === 'win32') {
    for (const audience of ['customer', 'barista']) {
      const label = audience === 'barista';
      const rendered = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile','-NonInteractive','-File',path.join(app.app,'scripts/printing/windows-print.ps1'),'-LayoutOnly'],
        {input:JSON.stringify({...approvedCopies.find(job=>job.audience===audience).document,verticalLabel:label,fontPoints:9,
          widthMm:label?56.9:71.88,heightMm:label?32:210.06,previewDirectory:path.join(directory,'approved-pos-output',audience)})+'\n',
        encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(rendered.status,0,rendered.stderr||rendered.stdout);
      assert.equal(JSON.parse(rendered.stdout).length,1,'The production document fits its accepted single-page sample');
    }
  }
  await app.restart(); await post({ orderId: approved });
  assert.equal((await spool()).length, beforeApproved + 2);
  pass('Confirmed POS sale uses the V8 receipt and versioned reference label; production renderers fit both and restart cannot duplicate them');
  if(process.env.POS_MULTI_ITEM_DB_EVIDENCE){
    const evidence=JSON.parse(await readFile(process.env.POS_MULTI_ITEM_DB_EVIDENCE,'utf8'));
    assert.equal(evidence.exactUiPayloadUsed,true);assert.equal(evidence.liveDataAccess,false);
    const receipt=evidence.receipt,before=(await spool()).length;
    orders.set(receipt.id,{id:receipt.id,ticket_number:receipt.ticket_number,status:'completed',cashier_id:actors[0],receipt_snapshot:receipt});
    await writeFile(faults,'{}');
    await post({orderId:receipt.id});await post({orderId:receipt.id});
    const printed=(await spool()).filter(job=>job.orderId===receipt.id);
    assert.equal((await spool()).length,before+2);assert.equal(printed.length,2);
    const customer=printed.find(job=>job.audience==='customer').document,barista=printed.find(job=>job.audience==='barista').document;
    assert.match(customer.sections.flat().join(' '),/TOTAL: \$425\.00 MXN/);assert.equal(barista.sections.length,4);
    assert.deepEqual(barista.sections.map(lines=>lines[1]),['Iced coffee caramelo','Iced coffee caramelo','Iced coffee caramelo','Iced coffee vainilla']);
    assert.deepEqual(barista.sections.map(lines=>lines.find(line=>['sin hielo','extra hielo','sin tapa'].includes(line))),['sin hielo','sin hielo','extra hielo','sin tapa']);
    pass('Exact mixed-order UI payload, confirmed by real local SQL, yields one customer job and four cup sections through the production API without duplicate retries');
  }
  if(process.env.POS_RECEIPT_CONTRACT_EVIDENCE){
    const evidence=JSON.parse(await readFile(process.env.POS_RECEIPT_CONTRACT_EVIDENCE,'utf8'));
    assert.equal(evidence.liveDataAccess,false);assert.equal(evidence.scenarios.length,6);
    for(const scenario of evidence.scenarios){
      const {receipt,documents}=scenario,before=(await spool()).length;
      orders.set(receipt.id,{id:receipt.id,ticket_number:receipt.ticket_number,status:'completed',cashier_id:actors[0],receipt_snapshot:receipt});
      await post({orderId:receipt.id});await post({orderId:receipt.id});
      const printed=(await spool()).filter(job=>job.orderId===receipt.id);
      assert.equal((await spool()).length,before+2);assert.equal(printed.length,2);
      const customer=printed.find(job=>job.audience==='customer').document;
      // Issuer comes from this installation's local profile, not sale SQL.
      const saleLines=doc=>doc.sections[0].filter((_,index)=>doc.styles[0][index]!=='issuer');
      assert.deepEqual(saleLines(customer),saleLines(documents.customer));
      assert.deepEqual(printed.find(job=>job.audience==='barista').document,documents.barista);
      const response=await fetch('http://127.0.0.1:3112/api/receipts?orderId='+receipt.id,{headers:{Cookie:cookies[0]}});
      assert.equal(response.status,200);const saved=await response.json();
      assert.equal(saved.source,'stored');assert.deepEqual(saved.document,customer);
      assert.equal((await spool()).length,before+2);
    }
    pass('All six real local SQL receipts retain exact financial/preparation fields through the production print API and read-only receipt endpoint; duplicate requests add no copies');
  }
  const privateResponse = await http(); assert.match(privateResponse.headers.get('cache-control'), /private.*no-store/);
  assert.equal(methods.some(method => method.includes('/rpc/') || /^(PATCH|DELETE) /.test(method) || (method.startsWith('POST ') && !method.includes('/auth/v1/token'))), false);
  pass('Print retries perform no checkout/stock/payment writes; responses are private and uncached');
  await mkdir(path.join(work, 'printing-acceptance'), { recursive: true });
  const result = { date: '2026-10-31', passed: checks.length, checks,
    scope: 'Isolated production Next.js; own loopback Auth/PostgREST fixtures and simulated printers only. No live café or source-staging access.',
    simulatedSpoolJobs: (await spool()).length, buildId: (await readFile(path.join(app.app, '.next/BUILD_ID'), 'utf8')).trim(), directory };
  await writeFile(path.join(work, 'printing-acceptance/http-result.json'), JSON.stringify(result, null, 2));
  console.log('PASS completed production HTTP acceptance; no physical print jobs');
} finally { await app?.stop(); if (backend) await new Promise(resolve => backend.close(resolve)); }
