import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { settings, work, root } from '../staging/runtime.mjs';
import { startApp } from '../staging/app.mjs';
import { createBackup } from '../recovery/backup.mjs';
import { restoreBackup } from '../recovery/restore.mjs';
import { databaseFingerprint } from '../recovery/fingerprint.mjs';
import { legacyWorker, fixture } from './browser-fixture.mjs';

const runId = randomUUID(), started = Date.now(), checks = [], browser = [];
const directory = path.join(work, 'lifecycle');
await mkdir(directory, { recursive: true });
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
let restored, app, gateway, db, source, backup, backendDown = false, dropNext = false, upgraded = false, lost, busy = false, finished = false;
// Ignore stale commands from previous runs. Commands are issued only after READY.
let lastCommand = JSON.parse(await readFile(path.join(directory, 'command.json'), 'utf8').catch(() => '{}')).id;
const worker = await readFile(path.join(root, 'public/sw.js'), 'utf8');
async function save() {
  await writeFile(path.join(directory, 'last-result.json'), JSON.stringify({ runId, completedAt: finished ? new Date().toISOString() : null,
    elapsedSeconds: Math.round((Date.now() - started) / 1000), passed: checks.length, checks, browser, buildId: app && (await readFile(path.join(app.app, '.next/BUILD_ID'), 'utf8')).trim(),
    target: 'Disposable restored local database; production app on Windows loopback', finished }, null, 2));
}
async function command(action) {
  switch (action) {
    case 'backend-down':
      backendDown = true;
      assert.equal((await fetch('http://127.0.0.1:3110/rest/v1/rpc/pos_login_profiles', {method:'POST'})).status, 503);
      assert.equal((await fetch('http://127.0.0.1:3110/api/users', {redirect:'manual'})).status, 401);
      pass('Unavailable cloud dependency returns an error and cannot grant protected API access');
      return { backendDown };
    case 'backend-up':
      backendDown = false;
      assert.equal((await fetch('http://127.0.0.1:3110/auth/v1/health')).status, 200);
      pass('Dependency returns healthy without rebuilding or restarting the production app');
      return { backendDown };
    case 'drop-next-checkout': dropNext = true; return { dropNext };
    case 'upgrade': upgraded = true; return { upgraded };
    case 'verify-draft': {
      const drafts = browser.filter(b => b.event === 'draft').map(b => b.drafts);
      assert.ok(drafts.length >= 2, 'Inspect the unpaid draft before and after refresh/process restart');
      assert.equal(drafts[0].length, 1); assert.deepEqual(drafts.at(-1), drafts[0], 'Unsubmitted draft changed across restart');
      assert.equal(drafts[0][0].items[0].quantity, 2);
      assert.equal(drafts[0][0].orderType, 'Para Llevar');
      assert.equal(drafts[0][0].orderNote, 'Borrador local de reinicio');
      pass('Unsubmitted draft UUID, quantities, order type and note survive refresh and production restart');
      return { draftId: drafts[0][0].id, quantity:2, total:74 };
    }
    case 'stop-app':
      await app.stop();
      assert.equal((await fetch('http://127.0.0.1:3110/login')).status, 503);
      pass('Stopped production process is visibly unavailable; gateway does not serve cached POS HTML'); return {};
    case 'restart': {
      const id = await readFile(path.join(app.app, '.next/BUILD_ID'), 'utf8');
      await app.restart();
      assert.equal(await readFile(path.join(app.app, '.next/BUILD_ID'), 'utf8'), id);
      assert.equal((await fetch('http://127.0.0.1:3110/login')).status, 200);
      pass('Production process restarts on the same port with the identical retained build'); return {};
    }
    case 'verify-sale': {
      assert.ok(lost, 'No committed lost-response sale was intercepted');
      const sales = (await db.query('select id,status,ticket_number,receipt_snapshot from public.orders where request_id=$1', [lost.request])).rows;
      assert.equal(sales.length, 1); assert.equal(sales[0].id, lost.receipt.id);
      const {receipt_snapshot: snapshot, ...identity} = sales[0];
      assert.deepEqual({...snapshot, ...identity}, lost.receipt);
      assert.equal((await db.query('select stock from public.products where id=$1', [lost.product])).rows[0].stock, 4);
      assert.ok(lost.replayed, 'Browser must actually retry the same RPC after restart');
      assert.deepEqual(lost.replayed, lost.receipt);
      pass('Browser recovery replays the exact committed receipt; one order and one stock decrement');
      return { orderId: lost.receipt.id, ticket: lost.receipt.ticket_number, orders: 1, stock: 4 };
    }
    case 'finish': {
      assert.ok(checks.some(c => c.startsWith('Browser recovery')), 'Browser sale recovery has not been verified');
      const legacy = browser.find(b => b.event === 'legacy-installed'), probes = browser.filter(b => b.event === 'probe');
      assert.ok(legacy?.controller && legacy.updateViaCache === 'none');
      assert.ok(probes.some(b => b.response === 'STALE_LEGACY_RESPONSE'));
      const upgrade = browser.find(b => b.event === 'upgraded');
      assert.deepEqual(upgrade?.caches, ['lifecycle-unrelated']);
      assert.equal(upgrade.waiting, null); assert.equal(upgrade.active, 'activated');
      assert.ok(upgrade.controllerChanges > 0);
      assert.ok(probes.some(b => b.response === 'FRESH_NETWORK_RESPONSE'));
      pass('Real Chromium replaces an already controlling legacy worker without waiting for old tabs to close');
      pass('Legacy Workbox/API/start-url caches removed; unrelated cache preserved');
      pass('Updated worker uses fresh network responses instead of old cached API data');
      await source.query('begin isolation level repeatable read read only');
      assert.equal((await databaseFingerprint(source)).business, backup.payload.baseline.business);
      await source.query('rollback');
      pass('Source staging business records independently verified unchanged');
      finished = true; return { finished };
    }
    case 'abort': finished = true; return { aborted: true };
    default: throw new Error('Unknown lifecycle command');
  }
}
try {
  const config = await settings();
  backup = await createBackup(config, runId);
  restored = await restoreBackup(backup); await restored.startServices();
  db = new Client({ connectionString: restored.config.database }); await db.connect();
  source = new Client({ connectionString: config.database }); await source.connect();
  const product = randomUUID();
  // Only the disposable clone receives synthetic writes. Keep one obvious item
  // so browser clicks cannot accidentally sell an unrelated fixture product.
  await db.query('update public.products set is_active=false');
  await db.query('insert into public.products(id,name,price,stock,is_active,customizable) values($1,$2,37,5,true,false)', [product, 'Prueba reinicio local']);
  pass('Fresh backup restored into disposable local services; only clone receives test writes');
  gateway = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1:3110');
      const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
      if (url.pathname === '/__lifecycle') return send(200, 'text/html; charset=utf-8', fixture);
      if (url.pathname === '/__cache_probe') return send(200, 'text/plain', 'FRESH_NETWORK_RESPONSE');
      const body = []; for await (const chunk of request) { body.push(chunk); if (body.reduce((n, b) => n + b.length, 0) > 1_000_000) throw Error('Oversized fixture request'); }
      const bytes = Buffer.concat(body);
      if (url.pathname === '/__evidence' && request.method === 'POST') {
        assert.equal(request.headers.origin, 'http://127.0.0.1:3110');
        const evidence = JSON.parse(bytes.toString());
        browser.push(evidence); await save(); return send(200, 'text/plain', 'Recorded');
      }
      if (url.pathname === '/sw.js' && !upgraded) return send(200, 'application/javascript', legacyWorker);
      const backend = url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/');
      if (backend && backendDown) return send(503, 'application/json', JSON.stringify({message:'Simulated café internet outage'}));
      const headers = { ...request.headers }; delete headers.host; delete headers.connection;
      const upstream = await fetch(`${backend ? restored.config.api : 'http://127.0.0.1:3111'}${request.url}`, {
        method: request.method, headers, redirect:'manual', signal:AbortSignal.timeout(15_000),
        body:['GET','HEAD'].includes(request.method) ? undefined : bytes });
      const result = Buffer.from(await upstream.arrayBuffer());
      if (url.pathname === '/rest/v1/rpc/pos_checkout' && upstream.ok) {
        const sent = JSON.parse(bytes.toString()), receipt = JSON.parse(result.toString());
        if (dropNext) {
          dropNext = false; assert.equal(sent.p_payload.items[0].product_id, product);
          lost = { request: sent.p_request, receipt, product };
          pass('Actual browser checkout commits before its success response is deliberately withheld');
          await save(); return send(503, 'application/json', JSON.stringify({message:'Simulated lost receipt response'}));
        }
        if (lost && sent.p_request === lost.request) lost.replayed = receipt;
      }
      if (url.pathname === '/sw.js') assert.equal(result.toString(), worker, 'Production worker differs from reviewed source');
      const outgoing = Object.fromEntries([...upstream.headers].filter(([key]) => !['transfer-encoding','content-encoding','content-length','set-cookie'].includes(key)));
      const cookies = upstream.headers.getSetCookie(); if(cookies.length) outgoing['set-cookie'] = cookies;
      response.writeHead(upstream.status, outgoing); response.end(result);
    } catch { response.writeHead(503, {'Cache-Control':'no-store'}); response.end('Local lifecycle service unavailable'); }
  });
  await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(3110, '127.0.0.1', resolve); });
  app = await startApp({ ...restored.config, api:'http://127.0.0.1:3110' }, {port:3111}); await app.ready();
  assert.equal((await fetch('http://127.0.0.1:3110/login')).status, 200);
  assert.equal((await fetch('http://127.0.0.1:3110/', {redirect:'manual'})).status, 307);
  assert.equal((await fetch('http://127.0.0.1:3110/api/users', {redirect:'manual'})).status, 401);
  upgraded = true;
  const sw = await fetch('http://127.0.0.1:3110/sw.js'); assert.equal(await sw.text(), worker);
  assert.match(sw.headers.get('cache-control'), /no-store/); assert.match(sw.headers.get('content-type'), /javascript/);
  const manifest = await (await fetch('http://127.0.0.1:3110/manifest.json')).json();
  assert.equal(manifest.display, 'standalone');
  upgraded = false;
  pass('Production cold startup serves login, manifest and non-cacheable worker; unauthenticated POS/API stay protected');
  await save(); console.log('READY lifecycle browser fixture: http://127.0.0.1:3110/__lifecycle');
  while (!finished) {
    if (!busy) {
      busy = true;
      try {
        const input = JSON.parse(await readFile(path.join(directory, 'command.json'), 'utf8'));
        if (input.id !== lastCommand) {
          lastCommand = input.id;
          try { const result = await command(input.action); await save(); await writeFile(path.join(directory, 'command-result.json'), JSON.stringify({id:input.id,ok:true,...result})); }
          catch (error) { await writeFile(path.join(directory, 'command-result.json'), JSON.stringify({id:input.id,ok:false,error:error.message})); }
        }
      } catch { /* No command yet. */ }
      busy = false;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
} finally {
  await app?.stop();
  if (gateway) await new Promise(resolve => gateway.close(resolve));
  await db?.end(); await source?.end(); await restored?.cleanup();
}
