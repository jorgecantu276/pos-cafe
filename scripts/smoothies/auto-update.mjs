import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const hex = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{16}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;
const maximumZipBytes = 300 * 1024 * 1024;
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const inside = (root, value) => {
  const relative = path.relative(root, value);
  return relative !== '' && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
};
async function optionalJson(file) {
  try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveJson(file, value) {
  const pending = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await rename(pending, file);
  } finally { await rm(pending, { force: true }); }
}
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function https(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Usa HTTPS para las actualizaciones.');
  return url;
}
export function compareVersions(left, right) {
  const a = releasePattern.exec(left), b = releasePattern.exec(right);
  assert.ok(a && b, 'Version invalida.');
  for (let i = 1; i <= 3; i++) {
    const difference = BigInt(a[i]) - BigInt(b[i]);
    if (difference !== 0n) return difference > 0n ? 1 : -1;
  }
  if (!a[4] || !b[4]) return a[4] === b[4] ? 0 : !a[4] ? 1 : -1;
  return Math.sign(Number(BigInt(a[4]) - BigInt(b[4])));
}
export function readSignedUpdate(envelope, publicKey, policy) {
  assert.ok(envelope && typeof envelope.payload === 'string' && envelope.payload.length <= 128_000
    && typeof envelope.signature === 'string' && envelope.signature.length <= 128, 'Manifiesto invalido.');
  const payload = Buffer.from(envelope.payload, 'base64');
  const key = createPublicKey(publicKey);
  assert.equal(key.asymmetricKeyType, 'ed25519');
  assert.ok(verify(null, payload, key, Buffer.from(envelope.signature, 'base64')), 'Firma de actualizacion invalida.');
  const data = JSON.parse(payload.toString('utf8'));
  assert.ok(data.protocol === 1 && data.product === 'smoothies' && data.product === policy.product
    && data.channel === policy.channel && releasePattern.test(data.appVersion)
    && data.familyRelease === `pos-v${data.appVersion}` && idPattern.test(data.packageId)
    && commitPattern.test(data.sourceCommit) && hex.test(data.databaseContract)
    && hex.test(data.sha256) && hex.test(data.filesSha256)
    && typeof data.publishedAt === 'string' && Number.isFinite(Date.parse(data.publishedAt)), 'Manifiesto invalido.');
  https(data.zipUrl);
  return data;
}
function validFileName(file) {
  return typeof file === 'string' && file.length < 240 && file.split('/').every(part => part && part !== '.' && part !== '..'
    && !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export async function verifyPackage(folder, update, baseline) {
  assert.ok((await lstat(folder)).isDirectory(), 'Carpeta invalida.');
  assert.equal(await fileHash(path.join(folder, 'SHA256.json')), update.filesSha256, 'Indice de archivos invalido.');
  const index = await json(path.join(folder, 'SHA256.json'));
  assert.ok(Array.isArray(index) && index.length > 0 && index.length <= 30_000);
  const expected = new Map();
  for (const row of index) {
    assert.ok(validFileName(row.file) && hex.test(row.sha256) && row.file.toLowerCase() !== 'sha256.json'
      && !expected.has(row.file.toLowerCase()), 'Indice de archivos invalido.');
    expected.set(row.file.toLowerCase(), row.sha256);
  }
  for (const required of ['node.exe', 'release.json', 'app/server.js', 'app/scripts/smoothies/auto-update.mjs',
    'app/scripts/smoothies/start-local.mjs', 'app/supabase/schema.snapshot.json']) assert.ok(expected.has(required), 'Paquete incompleto.');
  const found = new Set();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(folder, full).replaceAll('\\', '/');
      assert.ok(validFileName(relative) && inside(folder, full) && !entry.isSymbolicLink(), 'Archivo invalido.');
      if (entry.isDirectory()) { await walk(full); continue; }
      assert.ok(entry.isFile(), 'Archivo invalido.');
      const key = relative.toLowerCase();
      if (key === 'sha256.json') continue;
      assert.ok(!found.has(key) && expected.has(key), 'Archivo inesperado.');
      assert.equal(await fileHash(full), expected.get(key), 'Archivo alterado.');
      found.add(key);
    }
  }
  await walk(folder);
  assert.equal(found.size, expected.size, 'Faltan archivos de la version.');
  const candidate = await json(path.join(folder, 'release.json'));
  assert.ok(candidate.version === 1 && candidate.product === 'smoothies' && candidate.id === update.packageId
    && candidate.sourceCommit === update.sourceCommit && candidate.sourceDirty === false
    && candidate.familySourceDirty === false && candidate.familySourceCommit === update.sourceCommit
    && candidate.appVersion === update.appVersion && candidate.familyRelease === update.familyRelease
    && candidate.databaseContract === update.databaseContract && candidate.databaseContract === baseline.databaseContract,
  'La version no corresponde a esta caja o requiere migrar la base.');
  return candidate;
}

// Bound each response and validate every redirect, including GitHub's download CDN.
async function download(url, maximum, signal) {
  let target = https(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(target, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      target = https(new URL(response.headers.get('location'), target).href);
      continue;
    }
    assert.ok(response.ok && response.body, 'La descarga no esta disponible.');
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      assert.ok(length <= maximum, 'La descarga supera el limite.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Demasiadas redirecciones.');
}
function command(executable, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore', signal });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('No se pudo preparar la actualizacion.')));
  });
}
export function extractWindowsZip(zip, destination, signal) {
  const ps = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return command(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(import.meta.dirname, 'Extract-Smoothies-Update.ps1'), '-ZipPath', zip, '-Destination', destination], signal);
}
export async function loadPolicy(root) {
  const policy = await optionalJson(path.join(root, 'actualizaciones/policy.json'));
  if (!policy || policy.enabled !== true) return null;
  assert.ok(policy.protocol === 1 && policy.product === 'smoothies' && /^[a-z][a-z0-9-]{0,30}$/.test(policy.channel));
  https(policy.manifestUrl);
  const publicKey = await readFile(path.join(root, 'actualizaciones/public-key.pem'), 'utf8');
  assert.equal(createPublicKey(publicKey).asymmetricKeyType, 'ed25519');
  return { ...policy, publicKey };
}
export async function stageUpdate({ root, policy, baseline, source = download, extract = extractWindowsZip, signal = new AbortController().signal }) {
  const updates = path.join(root, 'actualizaciones');
  const envelope = JSON.parse((await source(policy.manifestUrl, 128_000, signal)).toString('utf8'));
  const update = readSignedUpdate(envelope, policy.publicKey, policy);
  const state = await optionalJson(path.join(updates, 'state.json')) || { rejected: [] };
  if (update.packageId === baseline.id || compareVersions(update.appVersion, baseline.appVersion) <= 0
    || state.rejected.includes(update.packageId)) return false;
  assert.equal(update.databaseContract, baseline.databaseContract, 'La actualizacion requiere mantenimiento de la base.');
  const destination = path.join(root, 'versiones', update.packageId);
  try {
    await verifyPackage(destination, update, baseline);
  } catch {
    const scratch = path.join(updates, `descarga-${randomUUID()}`);
    await mkdir(scratch, { recursive: true });
    try {
      const bytes = await source(update.zipUrl, maximumZipBytes, signal);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), update.sha256, 'ZIP alterado.');
      const zip = path.join(scratch, 'update.zip');
      await writeFile(zip, bytes, { flag: 'wx' });
      const unpacked = path.join(scratch, 'paquete');
      await extract(zip, unpacked, signal);
      await verifyPackage(unpacked, update, baseline);
      signal?.throwIfAborted();
      await mkdir(path.dirname(destination), { recursive: true });
      if (await lstat(destination).catch(() => null)) {
        // Quarantine a damaged staged folder; never replace the active or previous version.
        const previous = await optionalJson(path.join(root, 'release.previous.json'));
        assert.ok(update.packageId !== baseline.id && update.packageId !== previous?.id);
        await rename(destination, path.join(updates, `danada-${update.packageId}-${randomUUID()}`));
      }
      await rename(unpacked, destination);
    } finally {
      assert.ok(inside(updates, scratch) && path.basename(scratch).startsWith('descarga-'));
      await rm(scratch, { recursive: true, force: true });
    }
  }
  await saveJson(path.join(updates, 'prepared.json'), envelope);
  return true;
}
export async function printJournalsIdle(directory) {
  assert.ok(path.isAbsolute(directory || '') && !/^(?:\\\\|\/\/)/.test(directory));
  for (const name of ['mock-jobs.sqlite', 'windows-jobs.sqlite']) {
    const file = path.join(directory, name);
    const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const db = new DatabaseSync(file, { readOnly: true, timeout: 3000 });
    try {
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok'
        || db.prepare("SELECT count(*) AS n FROM jobs WHERE state NOT IN ('submitted','cancelled')").get().n !== 0) return false;
    } finally { db.close(); }
  }
  return true;
}
async function lockPrintJournals(directory, live) {
  const held = [];
  try {
    let found = false;
    for (const name of ['mock-jobs.sqlite', 'windows-jobs.sqlite']) {
      const filename = path.join(directory, name);
      const info = await lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (!info) continue;
      assert.ok(info.isFile() && !info.isSymbolicLink());
      const db = new DatabaseSync(filename, { timeout: 3000 });
      held.push(db);
      // A new print cannot claim a job between this check and stopping the owned server.
      db.exec('BEGIN IMMEDIATE');
      assert.equal(db.prepare("SELECT count(*) AS n FROM jobs WHERE state NOT IN ('submitted','cancelled')").get().n, 0);
      found = true;
    }
    assert.ok(found || !live, 'La caja aun no tiene un diario de impresion.');
    return () => { for (const db of held) { db.exec('ROLLBACK'); db.close(); } };
  } catch (error) {
    for (const db of held) { try { db.exec('ROLLBACK'); } catch {} db.close(); }
    throw error;
  }
}
export async function acquireIdle(env = process.env, { live = false } = {}) {
  const url = new URL(env.SMOOTHIES_DATABASE_URL);
  assert.equal(`${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`, 'postgresql://127.0.0.1:55432/postgres');
  const db = new Client({ connectionString: url.href, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  await db.connect();
  let releasePrint;
  try {
    const { held } = (await db.query('select pg_try_advisory_lock(60281030) held')).rows[0];
    assert.ok(held, 'La caja esta ocupada.');
    const { idle } = (await db.query(`select
      not exists(select 1 from public.cash_registers where status='open')
      and not exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null)
      and not exists(select 1 from cafe_private.clip_payments where state not in ('failed','completed')) idle`)).rows[0];
    assert.ok(idle && await printJournalsIdle(env.SMOOTHIES_PRINT_DIR), 'La caja tiene operaciones pendientes.');
    releasePrint = await lockPrintJournals(env.SMOOTHIES_PRINT_DIR, live);
    return async () => { releasePrint(); await db.end(); };
  } catch (error) { releasePrint?.(); await db.end(); throw error; }
}
async function instance() {
  const response = await fetch('http://127.0.0.1:3180/api/local-instance', { redirect: 'error', signal: AbortSignal.timeout(1000) }).catch(() => null);
  if (!response) return null;
  assert.ok(response.ok, 'El puerto de caja esta ocupado.');
  return response.json();
}
export async function launchWindows(root, release) {
  const folder = path.join(root, 'versiones', release.id);
  const child = spawn(path.join(folder, 'node.exe'), [path.join(folder, 'app/scripts/smoothies/start-local.mjs'), 'start'], {
    cwd: path.join(folder, 'app'), windowsHide: true, stdio: 'inherit',
    env: { ...process.env, SMOOTHIES_PACKAGE_ID: release.id, SMOOTHIES_DATA_HOME: root },
  });
  const finished = new Promise(resolve => { child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1)); });
  let ready = false;
  const deadline = Date.now() + 125_000;
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') await command('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    else child.kill();
    await finished;
  }
  try {
    while (Date.now() < deadline && child.pid && child.exitCode === null && child.signalCode === null) {
      const current = await instance();
      if (current?.packageId === release.id && current.protocol === 1) { ready = true; break; }
      if (current) break;
      await sleep(250);
    }
  } catch { ready = false; }
  finally { if (!ready) await stop(); }
  return { ready, finished, stop };
}
export async function runAutoUpdate({ root, launch = launchWindows, idle = acquireIdle, source = download, extract = extractWindowsZip,
  probe = instance, interval = 15 * 60_000, idleInterval = 10_000, log = console.log }) {
  assert.ok(path.isAbsolute(root));
  let baseline = await json(path.join(root, 'release.json'));
  assert.ok(idPattern.test(baseline.id));
  const updates = path.join(root, 'actualizaciones');
  let policy;
  try { await mkdir(updates, { recursive: true }); policy = await loadPolicy(root); }
  catch { log('Actualizaciones pausadas. Revisa la configuracion de soporte.'); }
  const stopRequested = async () => Boolean(await lstat(path.join(updates, 'stop-requested')).catch(() => null));
  async function preparedCandidate(verifyFiles = true) {
    if (!policy) return null;
    const envelope = await optionalJson(path.join(updates, 'prepared.json'));
    const state = await optionalJson(path.join(updates, 'state.json')) || { rejected: [] };
    if (!envelope) return null;
    const update = readSignedUpdate(envelope, policy.publicKey, policy);
    if (compareVersions(update.appVersion, baseline.appVersion) <= 0 || state.rejected.includes(update.packageId)) return null;
    if (!verifyFiles) return { id: update.packageId };
    return verifyPackage(path.join(root, 'versiones', update.packageId), update, baseline);
  }
  async function activate(candidate) {
    const release = { ...candidate, settingsPath: baseline.settingsPath };
    let trial;
    try { trial = await launch(root, release); }
    catch { trial = { ready: false, finished: Promise.resolve(1), stop: async () => {} }; }
    if (trial.ready) {
      try {
        await saveJson(path.join(root, 'release.previous.json'), baseline);
        await saveJson(path.join(root, 'release.json'), release);
        baseline = release;
        log(`Caja actualizada a ${release.appVersion}.`);
      } catch {
        await trial.stop();
        trial = { ready: false, finished: Promise.resolve(1), stop: async () => {} };
      }
    }
    if (!trial.ready) {
      const state = await optionalJson(path.join(updates, 'state.json')) || { rejected: [] };
      try { await saveJson(path.join(updates, 'state.json'), { rejected: [...new Set([...state.rejected, candidate.id])] }); }
      catch { policy = null; log('Actualizaciones pausadas. No se pudo guardar el resultado.'); }
      log('La version nueva no abrio. Se conserva la version anterior.');
      return launch(root, baseline);
    }
    return trial;
  }
  let running, unlock, candidate;
  try {
    try {
      candidate = await preparedCandidate();
      if (candidate) unlock = await idle();
    } catch { candidate = null; log('La actualizacion espera a un turno cerrado sin operaciones pendientes.'); }
    running = candidate ? await activate(candidate) : await launch(root, baseline);
  } finally { await unlock?.(); }
  if (!running.ready) return await running.finished ?? 1;
  const stop = new AbortController();
  let switching = false;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  function watch(server) {
    server.finished.then(code => { if (!switching && running === server) finish(code); });
  }
  watch(running);
  const background = (async () => {
    let nextCheck = 0;
    while (policy && !stop.signal.aborted) {
      if (Date.now() >= nextCheck) {
        try {
          if (await stageUpdate({ root, policy, baseline, source, extract,
            signal: AbortSignal.any([stop.signal, AbortSignal.timeout(180_000)]) })) {
            log('Version nueva preparada. Esperando el cierre del turno.');
          }
        } catch { if (!stop.signal.aborted) log('No se pudo revisar una actualizacion. Caja sigue disponible.'); }
        nextCheck = Date.now() + interval;
      }
      let releaseIdle;
      let stopped = false;
      try {
        let next = await preparedCandidate(false);
        if (next && !stop.signal.aborted && !await stopRequested()) {
          releaseIdle = await idle(process.env, { live: true });
          next = await preparedCandidate();
          assert.ok(next);
          const current = await probe();
          assert.equal(current?.packageId, baseline.id, 'La instancia de caja cambio.');
          if (!await stopRequested()) {
            switching = true;
            await running.stop();
            stopped = true;
            if (await stopRequested()) { finish(0); break; }
            running = await activate(next);
            if (!running.ready) { finish(await running.finished ?? 1); break; }
            switching = false;
            watch(running);
          }
        }
      } catch {
        if (stopped) {
          try { running = await launch(root, baseline); switching = false; watch(running); }
          catch { finish(1); break; }
        } else {
          switching = false;
          watch(running);
        }
        log('La actualizacion espera a un turno cerrado sin operaciones pendientes.');
      } finally { await releaseIdle?.(); }
      await sleep(Math.min(idleInterval, Math.max(1, nextCheck - Date.now())), undefined, { signal: stop.signal }).catch(() => {});
    }
  })();
  try { return await finished; }
  finally { stop.abort(); await background; }
}

async function main() {
  const [root] = process.argv.slice(2);
  const log = async message => {
    console.log(message);
    await appendFile(path.join(root, 'diagnostico/actualizaciones.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {});
  };
  try { process.exitCode = await runAutoUpdate({ root, log }); }
  catch { console.error('No se pudo abrir POS Smoothies. Revisa el diagnostico de inicio.'); process.exitCode = 1; }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
