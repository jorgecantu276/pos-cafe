// Synthetic signing trust lives only in the disposable acceptance installation.
// This exercises the shipped supervisor, ZIP extractor, database/print locks,
// real process health identity and activation; no publisher key is read.
import assert from 'node:assert/strict';
import { nextAcceptanceVersion } from './acceptance-version.mjs';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';

const [root, packageRoot, evidenceDirectory] = process.argv.slice(2);
assert.ok([root, packageRoot, evidenceDirectory].every(value => value && path.isAbsolute(value)));
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const baseline = await json(path.join(root, 'release.json'));
const installed = path.join(root, 'versiones', baseline.id);
const { runAutoUpdate, acquireIdle } = await import(pathToFileURL(path.join(installed, 'app/scripts/smoothies/auto-update.mjs')));
const scratch = await mkdtemp(path.join(path.dirname(root), 'update-acceptance-'));
const candidateFolder = path.join(scratch, 'candidate');
await cp(packageRoot, candidateFolder, { recursive: true });
const fixtureVersion = nextAcceptanceVersion(baseline.appVersion);
const candidate = { ...baseline, id: randomBytes(8).toString('hex'), appVersion: fixtureVersion,
  familyRelease: `pos-v${fixtureVersion}`, releaseLabel: `smoothies-v${fixtureVersion}`,
  sourceCommit: 'a'.repeat(40), familySourceCommit: 'a'.repeat(40), sourceDirty: false, familySourceDirty: false };
delete candidate.settingsPath;
await writeFile(path.join(candidateFolder, 'release.json'), JSON.stringify(candidate));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
await writeFile(path.join(candidateFolder, 'update-public-key.pem'), pem);
const index = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      assert.ok(entry.isFile());
      const name = path.relative(candidateFolder, file).replaceAll('\\', '/');
      if (name !== 'SHA256.json') index.push({ file: name, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
    }
  }
}
await walk(candidateFolder);
index.sort((left, right) => left.file.localeCompare(right.file));
const indexBytes = Buffer.from(JSON.stringify(index));
await writeFile(path.join(candidateFolder, 'SHA256.json'), indexBytes);
const zip = path.join(scratch, 'fixture-update.zip');
const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  path.resolve(import.meta.dirname, '../releases/archive-package.ps1'), '-Mode', 'Create', '-Source', candidateFolder, '-Destination', zip],
{ windowsHide: true, stdio: 'inherit' });
const zipBytes = await readFile(zip);
const manifestUrl = 'https://updates.invalid/acceptance/manifest.json';
const zipUrl = 'https://updates.invalid/acceptance/fixture.zip';
const payload = Buffer.from(JSON.stringify({ protocol: 1, product: 'smoothies', channel: 'pilot',
  appVersion: candidate.appVersion, familyRelease: candidate.familyRelease, sourceCommit: candidate.sourceCommit,
  packageId: candidate.id, databaseContract: candidate.databaseContract, zipUrl,
  sha256: createHash('sha256').update(zipBytes).digest('hex'),
  filesSha256: createHash('sha256').update(indexBytes).digest('hex'), publishedAt: new Date().toISOString(),
}));
const envelope = Buffer.from(JSON.stringify({ payload: payload.toString('base64'),
  signature: sign(null, payload, privateKey).toString('base64') }));
const stateFiles = ['release.json', 'release.previous.json', 'actualizaciones/policy.json',
  'actualizaciones/public-key.pem', 'actualizaciones/prepared.json', 'actualizaciones/state.json', 'actualizaciones/stop-requested'];
const original = new Map();
for (const name of stateFiles) original.set(name, await readFile(path.join(root, name)).catch(error => {
  if (error.code !== 'ENOENT') throw error; return null;
}));
const privateBefore = await readFile(path.join(root, 'instalacion.env'));
const startupBefore = await readFile(path.join(root, 'caja.env'));
const keyBefore = await readFile(path.join(root, 'clave/recuperacion.key'));
const printFile = path.join(root, 'impresion/mock-jobs.sqlite');
const journalRows = () => {
  const db = new DatabaseSync(printFile, { readOnly: true });
  try { return db.prepare('select order_id,audience,state,attempts from jobs order by order_id,audience').all(); }
  finally { db.close(); }
};
const beforeRows = journalRows();
const api = createClient(process.env.SMOOTHIES_API_URL, process.env.SMOOTHIES_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const ok = ({ data, error }) => { if (error) throw Error(error.message); return data; };
ok(await api.auth.signInWithPassword({ email: 'admin@smoothies.local', password: process.env.SMOOTHIES_ADMIN_PASSWORD }));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function eventually(check, message, timeout = 150_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(250); }
  throw Error(message);
}
async function probe() {
  return (await fetch('http://127.0.0.1:3180/api/local-instance', { signal: AbortSignal.timeout(1500) }).catch(() => null))?.json();
}
const source = async url => {
  if (url === manifestUrl) return envelope;
  assert.equal(url, zipUrl);
  return zipBytes;
};
let running, currentShift;
try {
  await mkdir(path.join(root, 'actualizaciones'), { recursive: true });
  await writeFile(path.join(root, 'actualizaciones/policy.json'), JSON.stringify({
    protocol: 1, enabled: true, product: 'smoothies', channel: 'pilot', manifestUrl,
  }));
  await writeFile(path.join(root, 'actualizaciones/public-key.pem'), pem);
  for (const name of ['prepared.json', 'state.json', 'stop-requested'])
    await rm(path.join(root, 'actualizaciones', name), { force: true });
  const status = ok(await api.rpc('pos_drawer_status'));
  currentShift = ok(await api.rpc('pos_open_shift', { p_request: randomUUID(), p_cash: 0, p_rate: status.rate ?? 1 }));
  running = runAutoUpdate({ root, source, interval: 15 * 60_000, idleInterval: 500 });
  await eventually(async () => (await probe())?.packageId === baseline.id, 'The real baseline process did not start.');
  const initialIdentity = await probe();
  await eventually(async () => Boolean(await lstat(path.join(root, 'actualizaciones/prepared.json')).catch(() => null)),
    'The supervisor did not download, extract and prepare the signed fixture.');
  await pause(1500);
  assert.equal((await probe()).instanceToken, initialIdentity.instanceToken, 'An open shift must not restart the register.');
  await assert.rejects(acquireIdle(process.env, { live: true }));
  console.log('PASS: real signed ZIP stages while the register is open without replacing its live process.');
  const summary = ok(await api.rpc('pos_shift_summary', { p_register: currentShift.id }));
  ok(await api.rpc('pos_close_shift', { p_register: currentShift.id, p_counted: summary.expected_cash,
    p_expenses: summary.expenses, p_preview: summary }));
  currentShift = null;
  await eventually(async () => (await probe())?.packageId === candidate.id
    && (await json(path.join(root, 'release.json'))).id === candidate.id,
  'The closed register did not switch to the actual candidate process.');
  assert.notEqual((await probe()).instanceToken, initialIdentity.instanceToken);
  assert.equal(ok(await api.from('orders').select('id')).length, 1);
  assert.deepEqual(await readFile(path.join(root, 'instalacion.env')), privateBefore);
  assert.deepEqual(await readFile(path.join(root, 'caja.env')), startupBefore);
  assert.deepEqual(await readFile(path.join(root, 'clave/recuperacion.key')), keyBefore);
  assert.deepEqual(journalRows(), beforeRows);
  const active = await json(path.join(root, 'release.json'));
  execFileSync(process.execPath, [path.join(root, 'versiones', active.id, 'app/scripts/smoothies/stop-local.mjs'), active.id, root],
    { windowsHide: true, stdio: 'inherit' });
  assert.equal(await Promise.race([running, pause(20_000).then(() => 'timeout')]), 0);
  running = null;
  await writeFile(path.join(evidenceDirectory, 'updater-acceptance.json'), JSON.stringify({ result: 'pass',
    originalPackage: baseline.id, syntheticCandidate: candidate.id, fixtureTrustOnly: true,
    source: 'same compiled package; synthetic version metadata',
    checks: ['signed-real-zip-staging', 'open-shift-no-restart', 'closed-shift-live-process-switch',
      'real-health-identity', 'sale-preserved', 'journal-preserved', 'private-settings-key-preserved'],
  }, null, 2));
  console.log('PASS: real packaged supervisor activates only after closing, preserves sale/config/key/journal, and stops cleanly.');
} finally {
  if (currentShift) {
    const summary = ok(await api.rpc('pos_shift_summary', { p_register: currentShift.id }));
    ok(await api.rpc('pos_close_shift', { p_register: currentShift.id, p_counted: summary.expected_cash,
      p_expenses: summary.expenses, p_preview: summary }));
  }
  if (running) {
    const active = await probe();
    if (active) {
      const release = await json(path.join(root, 'release.json'));
      execFileSync(process.execPath, [path.join(root, 'versiones', release.id, 'app/scripts/smoothies/stop-local.mjs'), active.packageId, root],
        { windowsHide: true, stdio: 'inherit' });
    }
    await Promise.race([running, pause(20_000)]);
  }
  assert.ok(!await probe(), 'Do not restore test trust while a candidate process is still running.');
  for (const [name, bytes] of original) {
    if (bytes === null) await rm(path.join(root, name), { force: true });
    else await writeFile(path.join(root, name), bytes);
  }
}
