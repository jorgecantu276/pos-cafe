import assert from 'node:assert/strict';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { run, dockerCheck } from '../scripts/staging/runtime.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
export async function initializeDemoPrintFaults(directory) {
  assert.ok(path.isAbsolute(directory));
  await writeFile(path.join(directory,'mock-faults.json'), '{}\n', { flag: 'wx', mode: 0o600 });
}
export async function readDemoJson(file) {
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 2_000_000, 'Expected a bounded regular demo record.');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function writeDemoJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export function webDemoContract(product) {
  assert.ok(product === 'cafe' || product === 'smoothies', 'Choose an exact web product.');
  const appPort = product === 'cafe' ? 3151 : 3153, apiPort = product === 'cafe' ? 55901 : 55921;
  return { profile: product, edition: 'demo', app: `http://127.0.0.1:${appPort}`, api: `http://127.0.0.1:${apiPort}`,
    databasePort: apiPort + 1, tier: 1, printMode: 'mock', clipEnabled: false, externalPayments: 'disabled' };
}
export async function verifyDemoSource(app, identity) {
  const manifest = await readDemoJson(path.join(app, 'ops-demo-source.json'));
  assert.equal(manifest.format, 'pos-web-demo-source-v1');
  for (const field of ['product','sourceCommit','sourceTree','contentSha256','databaseContractSha256','packager']) assert.equal(manifest[field], identity[field], `Demo ${field} changed.`);
  assert.equal(manifest.contentSha256, sha(json(manifest.files)));
  const actual = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (!prefix && ['node_modules','.next','next-env.d.ts','tsconfig.tsbuildinfo'].includes(entry.name)) continue;
      assert.ok(!entry.isSymbolicLink(), 'Demo source links are refused.');
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else { assert.ok(entry.isFile()); if (relative !== 'ops-demo-source.json') actual.push(relative); }
    }
  }
  await walk(app); assert.deepEqual(actual.sort(), Object.keys(manifest.files).sort(), 'Unexpected or missing demo source.');
  for (const [relative, hash] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:]/.test(part)));
    assert.equal(sha(await readFile(path.join(app, relative))), hash, `Demo source changed: ${relative}`);
  }
}
export async function demoBuildIdentity(app) {
  const files = ['BUILD_ID','build-manifest.json','server/app-paths-manifest.json'];
  async function walk(directory, prefix = 'static/') {
    const info=await lstat(directory);assert.ok(info.isDirectory()&&!info.isSymbolicLink());
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink());
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), prefix + entry.name + '/');
      else { assert.ok(entry.isFile()); files.push(prefix + entry.name); }
    }
  }
  await walk(path.join(app, '.next/static'));
  const hashes = {};
  for (const file of files.sort()) { const target=path.join(app,'.next',file),info=await lstat(target);assert.ok(info.isFile()&&!info.isSymbolicLink());hashes[file]=sha(await readFile(target)); }
  const buildId=(await readFile(path.join(app,'.next/BUILD_ID'),'utf8')).trim();assert.match(buildId,/^[a-zA-Z0-9_-]{1,256}$/);
  return { buildId, sha256: sha(JSON.stringify(hashes)), files: files.length };
}
const protectedName = key => /^(?:POS_|SMOOTHIES_|NEXT_PUBLIC_|SUPABASE_|STRIPE_|NODE_OPTIONS$|NODE_ENV$|NEXT_TELEMETRY_DISABLED$)/i.test(key);
/** @param {any} record @param {any} config @param {Record<string,string|undefined>} [inherited] @returns {Record<string,string|undefined>} */
export function demoEnvironment(record, config, inherited = process.env) {
  const contract = webDemoContract(record.identity.product), directory = record.directory;
  assert.equal(record.identity.preset,record.identity.product);assert.equal(record.identity.tier,1);
  assert.ok(path.isAbsolute(record.app) && path.isAbsolute(directory));
  assert.equal(config.api, contract.api);
  assert.ok(typeof config.anon==='string'&&config.anon.length>0&&typeof config.service==='string'&&config.service.length>0&&config.anon!==config.service,'Original backend key identities are required.');
  const db = new URL(config.database);
  assert.equal(db.protocol, 'postgresql:'); assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.port, String(contract.databasePort)); assert.equal(db.pathname, '/postgres'); assert.equal(db.search + db.hash, '');
  assert.match(record.token, /^[a-f0-9]{64}$/);
  const expected = { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_POS_PROFILE: contract.profile,
    NEXT_PUBLIC_POS_OPS_DEMO: '1',
    NEXT_PUBLIC_SUPABASE_URL: contract.api, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anon, SUPABASE_SERVICE_ROLE_KEY: config.service,
    POS_REGISTER_UI: 'workspace', POS_CLIP_ENABLED: '0', POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: path.join(directory, 'printing'),
    POS_PRINT_MOCK_FAULTS: path.join(directory, 'mock-faults.json'), POS_RECEIPT_ISSUER_FILE: path.join(directory, 'issuer.json'),
    POS_BACKUP_DIR: path.join(directory, 'backups'), POS_BACKUP_KEY_FILE: path.join(directory, 'backup.key'),
    POS_DATABASE_CONTRACT_DIR: path.join(record.app, 'supabase'), POS_RELEASE_COMMIT: record.identity.sourceCommit,
    POS_OPS_DEMO_TOKEN: record.token, POS_OPS_DEMO_ACCESS_FILE: path.join(directory, 'access.private.json') };
  return { ...Object.fromEntries(Object.entries(inherited).filter(([key]) => !protectedName(key))), ...expected };
}
export function configurationIdentity(record, access, env = access.env) {
  const expected = demoEnvironment(record, access.config, {});
  for (const [key, value] of Object.entries(expected)) assert.ok(env[key] === value, `Demo setting ${key} changed.`);
  for (const key of Object.keys(env)) if (protectedName(key)) assert.ok(Object.hasOwn(expected, key), 'Unexpected provider/customer setting.');
  const environment = Object.fromEntries(Object.keys(expected).sort().map(key => [key, sha(expected[key])]));
  return sha(JSON.stringify({ identity: { product: record.identity.product, preset:record.identity.preset,tier:record.identity.tier,
    runId: record.identity.runId, sourceCommit: record.identity.sourceCommit,sourceTree: record.identity.sourceTree,
    contentSha256: record.identity.contentSha256,databaseContractSha256:record.identity.databaseContractSha256,packager:record.identity.packager }, app: record.app, directory: record.directory, isolation: record.isolation, environment }));
}
export async function verifyDemoBackend(record, access) {
  assert.equal(record.format, 'pos-web-demo-runtime-v1');
  assert.equal(record.phase, 'ready');
  assert.deepEqual(access.identity, record.identity); assert.deepEqual(access.isolation, record.isolation);
  assert.equal(access.app,record.app);assert.equal(access.directory,record.directory);assert.equal(record.url,webDemoContract(record.identity.product).app);assert.equal(access.url,record.url);
  assert.equal(record.accessFile,path.join(record.directory,'access.private.json'));
  assert.match(record.isolation.project,/^pos-cafe-admin-[a-f0-9]{8}$/);assert.equal(record.isolation.network,`supabase_network_${record.isolation.project}`);
  assert.equal(record.identity.configSha256, configurationIdentity(record, access));
  await verifyDemoSource(record.app, record.identity);
  assert.deepEqual(await demoBuildIdentity(record.app), record.identity.buildIdentity, 'Compiled demo changed.');
  await dockerCheck();
  const ids = record.isolation.containers.map(item => { assert.match(item.id, /^[a-f0-9]{64}$/); return item.id; });
  assert.ok(ids.length >= 4);
  const containers = JSON.parse(await run('docker', ['inspect', ...ids]));
  for (const container of containers) {
    const original = record.isolation.containers.find(item => item.id === container.Id);
    assert.ok(original && container.State.Running && original.image === container.Image);
    assert.ok(container.Name.endsWith('_' + record.isolation.project) && container.NetworkSettings.Networks[record.isolation.network]);
    for (const bindings of Object.values(container.NetworkSettings.Ports || {})) for (const binding of bindings || []) assert.equal(binding.HostIp, '127.0.0.1');
  }
  const [network] = JSON.parse(await run('docker', ['network','inspect',record.isolation.network]));
  assert.equal(network.Labels?.['pos-cafe.admin-test'], record.isolation.project);
  assert.equal(network.Options?.['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  const db = new Client({ connectionString: access.config.database, connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    const { rows } = await db.query('select * from cafe_private.ops_demo_identity');
    assert.deepEqual(rows, [{ run_id: record.identity.runId, product: record.identity.product, source_commit: record.identity.sourceCommit,
      source_tree: record.identity.sourceTree, content_sha256: record.identity.contentSha256, database_contract_sha256: record.identity.databaseContractSha256 }]);
  } finally { await db.end(); }
}
export function assertDemoStopped(record, isAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }) {
  for (const pid of [record.launcherPid, record.appPid]) {
    assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Original process identity is missing.');
    assert.equal(isAlive(pid), false, 'Original launcher/app may remain active; no process was killed.');
  }
}
export async function localDemoAccess(request, { token = false, post = false } = {}) {
  const file = process.env.POS_OPS_DEMO_ACCESS_FILE, expectedToken = process.env.POS_OPS_DEMO_TOKEN;
  assert.ok(file && expectedToken && process.env.POS_RELEASE_BUILD !== '1');
  const access = await readDemoJson(file), contract = webDemoContract(access.identity.product);
  assert.equal(access.phase,'ready');assert.equal(access.appPid,process.pid);
  assert.equal(request.headers.get('host'), new URL(contract.app).host);
  // NextRequest normalizes internal loopback URLs to localhost. The wire Host
  // and browser Origin remain the authority for this fixed loopback listener.
  if (post || request.headers.get('origin')) assert.equal(request.headers.get('origin'), contract.app);
  assert.equal(access.identity.configSha256, configurationIdentity(access, access, process.env));
  if (token) {
    const supplied = request.headers.get('X-Pos-Ops-Token');
    assert.match(expectedToken, /^[a-f0-9]{64}$/); assert.match(supplied || '', /^[a-f0-9]{64}$/);
    assert.ok(timingSafeEqual(Buffer.from(expectedToken, 'hex'), Buffer.from(supplied, 'hex')));
  }
  assert.deepEqual(await demoBuildIdentity(access.app), access.identity.buildIdentity);
  return access;
}
