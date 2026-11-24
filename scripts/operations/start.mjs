import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { freshLocalApi } from '../testing/local-api.mjs';
import { prepareLocal } from '../smoothies/prepare-local.mjs';
import { webDemoContract, readDemoJson, writeDemoJson, verifyDemoSource, demoEnvironment,
  configurationIdentity, demoBuildIdentity, verifyDemoBackend, assertDemoStopped } from '../../lib/operations-demo.mjs';

const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url);
const recordFile = process.argv[2], resume = process.argv[3] === '--resume';
assert.ok(path.isAbsolute(recordFile || '') && process.argv.length === (resume ? 4 : 3));
assert.ok(/^24\.(?:2[2-9]|[3-9]\d)\./.test(process.versions.node) && (Number(process.versions.node.split('.')[1]) > 22 || Number(process.versions.node.split('.')[2]) >= 2));
let record = await readDemoJson(recordFile), access, local;
assert.equal(record.format, 'pos-web-demo-runtime-v1'); assert.equal(record.app, root);
const contract = webDemoContract(record.identity.product), appPort = Number(new URL(contract.app).port);
await verifyDemoSource(root, record.identity);
let child;
const ok = result => { assert.ifError(result.error && Error(result.error.message)); return result.data; };
async function freePort(port) {
  await new Promise((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
}
async function seed() {
  const smoothies = record.identity.product === 'smoothies';
  const { db, service, config } = local;
  const actors = {};
  if (smoothies) {
    const password = randomBytes(24).toString('base64url');
    await prepareLocal({ ...config, password, apiPort: Number(new URL(contract.api).port), dbPort: contract.databasePort });
    const { rows } = await db.query("select id from public.profiles where username='admin'");
    assert.equal(rows.length, 1);
    actors.admin = { id: rows[0].id, username: 'admin', email: 'admin@smoothies.local', password };
  }
  for (const role of smoothies ? ['cashier'] : ['admin','cashier']) {
    const username = `demo_${role}`, password = randomBytes(24).toString('base64url'), email = `${username}@${smoothies ? 'smoothies' : 'carinitomio'}.local`;
    const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
    await db.query('insert into public.profiles(id,username,full_name,role) values($1,$2,$3,$4)', [user.id, username, role === 'admin' ? 'Administración demo' : 'Caja demo', role]);
    actors[role] = { id: user.id, username, email, password };
  }
  if (!smoothies) await local.install();
  const admin = createClient(config.api, config.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    ok(await admin.auth.signInWithPassword(actors.admin));
    for (let attempt = 0; ; attempt++) {
      const result = await admin.rpc('pos_drawer_status');
      if (!result.error) break;
      if (attempt === 60) ok(result);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const menu = smoothies ? [['Mango con plátano 16 oz',85],['Fresa con plátano 16 oz',80],['Verde con manzana 20 oz',95]]
      : [['Café latte',60],['Té frío',45],['Brownie',55]];
    for (const [name, price] of menu) ok(await admin.rpc('pos_save_catalog', { p_request: randomUUID(), p_payload: {
      actor_id: actors.admin.id, kind: 'product', action: 'save', id: null, fields: { name, price,
        category: smoothies ? 'Smoothies' : 'Cafetería', customizable: false, image_url: '', wizard_steps: [] } } }));
    ok(await admin.rpc('pos_set_drawer_rate', { p_request: randomUUID(), p_payload: { rate: 20 } }));
  } finally { await admin.auth.signOut(); }
  return actors;
}
try {
  if (resume) {
    assertDemoStopped(record);
    access = await readDemoJson(record.accessFile); await verifyDemoBackend(record, access);
  } else {
    assert.equal(record.phase, 'preparing');
    for (const port of [appPort, Number(new URL(contract.api).port), contract.databasePort]) await freePort(port);
    local = await freshLocalApi({ portBase: Number(new URL(contract.api).port), storage: true,
      emptyWithStorage: record.identity.product === 'smoothies', runtimeDirectory: path.join(record.directory, 'backend') });
    record.isolation = local.isolation;
    const actors = await seed();
    await local.db.query(`create table cafe_private.ops_demo_identity(run_id uuid primary key, product text not null,
      source_commit text not null, source_tree text not null, content_sha256 text not null, database_contract_sha256 text not null);
      revoke all on cafe_private.ops_demo_identity from public, anon, authenticated`);
    await local.db.query('insert into cafe_private.ops_demo_identity values($1,$2,$3,$4,$5,$6)', [record.identity.runId, record.identity.product,
      record.identity.sourceCommit, record.identity.sourceTree, record.identity.contentSha256, record.identity.databaseContractSha256]);
    for (const folder of ['printing','backups']) await mkdir(path.join(record.directory, folder), { recursive: true });
    await writeFile(path.join(record.directory, 'backup.key'), randomBytes(32), { flag: 'wx', mode: 0o600 });
    await writeDemoJson(path.join(record.directory, 'issuer.json'), { legalName: 'COMERCIO FICTICIO DEMO', rfc: 'XAXX010101000',
      taxRegime: '616 - Sin obligaciones fiscales', establishmentAddress: 'Avenida Ejemplo 100', postalCode: '00000', city: 'Ciudad Demo' });
    access = { ...record, actors, config: local.config, env: demoEnvironment(record, local.config) };
    record.identity.configSha256 = configurationIdentity(record, access);
  }
  await freePort(appPort);
  const next = require.resolve('next/dist/bin/next'), env = access.env;
  assert.equal(configurationIdentity(record, access, env), record.identity.configSha256);
  await new Promise((resolve, reject) => { const build = spawn(process.execPath, [next,'build','--webpack'], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    build.once('error', reject); build.once('exit', code => code === 0 ? resolve() : reject(Error('Demo production build failed.'))); });
  record.identity.buildIdentity = await demoBuildIdentity(root);
  record.accessFile = path.join(record.directory, 'access.private.json');
  record.launcherPid = process.pid; record.phase = 'ready';
  access = { ...access, ...record };
  await writeDemoJson(record.accessFile, access);
  child = spawn(process.execPath, [next,'start','--hostname','127.0.0.1','--port',String(appPort)], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  record.appPid = child.pid;
  for (let attempt = 0; ; attempt++) {
    assert.equal(child.exitCode, null, 'Owned app exited before readiness.');
    try { if ((await fetch(contract.app + '/login', { signal: AbortSignal.timeout(1000) })).status === 200) break; } catch { /* startup */ }
    if (attempt === 180) throw Error('Owned app readiness timed out.');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  access = { ...access, ...record }; await writeDemoJson(record.accessFile, access); await writeDemoJson(recordFile, record);
  console.log(`POS ${record.identity.product} DEMO READY ${contract.app}/ops-demo`);
  await new Promise((resolve, reject) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
    child.once('exit', () => reject(Error('Owned app stopped; review retained demo before resume.'))); });
} catch (error) {
  await writeDemoJson(recordFile, { ...record, phase: record.phase === 'ready' ? 'ready' : 'attention', error: 'Demo startup/runtime requires review; data and backend were retained.' });
  throw error;
} finally { await local?.db.end(); }
