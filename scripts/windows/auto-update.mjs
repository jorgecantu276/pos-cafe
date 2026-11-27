import { spawn } from 'node:child_process';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { appendFileSync, createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import {inspectLegacyRouteCache, legacyCafeCommit} from './legacy-route-cache.mjs';
import { DatabaseSync } from 'node:sqlite';

const repo = 'jorgecantu276/pos-cafe';
const commitPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const asset = 'pos-update.json';
const ps = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const psArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const inside = (folder, value) => {
  const relative = path.relative(folder, value);
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
};

async function optionalJson(file) {
  try { return await json(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveJson(file, value) {
  const temporary = file + '.' + randomUUID();
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export function readSignedUpdate(envelope, publicKey) {
  const payload = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (!verify(null, payload, publicKey, signature)) throw new Error('Firma de actualizacion invalida.');
  const data = JSON.parse(payload);
  if (data.protocol !== 1 || !commitPattern.test(data.commit) ||
      !Array.isArray(data.from) || !data.from.length ||
      data.from.some(commit => !commitPattern.test(commit) || commit === data.commit) ||
      !hashPattern.test(data.sha256) || !hashPattern.test(data.filesSha256) ||
      data.tag !== 'pos-' + data.commit.slice(0, 7)) {
    throw new Error('Manifiesto de actualizacion invalido.');
  }
  return { ...data, zip: 'POS-Cafe-' + data.commit.slice(0, 7) + '.zip' };
}

function targetMatches(a, b) {
  return a.supabaseUrl === b.supabaseUrl && a.publicKeySha256 === b.publicKeySha256 &&
    a.fixtureOnly === b.fixtureOnly && a.sourceDirty === false;
}

async function packageFiles(directory) {
  const expected = new Map();
  for (const { file, sha256: hash } of await json(path.join(directory, 'SHA256.json'))) {
    const components = file.split('/');
    if (components.some(part => !part || part === '.' || part === '..' ||
        /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)) ||
        file.toLowerCase() === 'sha256.json' || expected.has(file.toLowerCase()) || !hashPattern.test(hash)) {
      throw new Error('Lista de archivos invalida.');
    }
    expected.set(file.toLowerCase(), hash);
  }
  for (const required of ['node.exe', 'release.json', 'start-pos.ps1', 'app/server.js', 'database-migrations/schema.snapshot.json']) {
    if (!expected.has(required)) throw new Error('Paquete de Caja incompleto.');
  }
  return expected;
}

export async function verifyPackage(directory, update, currentDirectory, baseline, {legacyInstalledPredecessor = false} = {}) {
  if (legacyInstalledPredecessor) {
    if (update.commit !== legacyCafeCommit || baseline.sourceCommit !== legacyCafeCommit || path.resolve(directory) !== path.resolve(currentDirectory)) {
      throw new Error('Legacy cache verification requires the exact installed rc.6 predecessor.');
    }
  }
  if (!(await lstat(directory)).isDirectory() ||
      await sha256(path.join(directory, 'SHA256.json')) !== update.filesSha256) {
    throw new Error('La carpeta del paquete no es valida.');
  }
  const expected = await packageFiles(directory);
  const seen = new Set();
  const legacyExtras = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    const file = path.relative(directory, full).replaceAll('\\', '/').toLowerCase();
    if (entry.isDirectory()) continue;
    if (!entry.isFile() || seen.has(file)) throw new Error('Archivo de actualizacion inesperado.');
    if (file === 'sha256.json') continue;
    if (legacyInstalledPredecessor && !expected.has(file)) { legacyExtras.push(path.relative(directory, full).replaceAll('\\', '/')); continue; }
    if (!expected.has(file) || await sha256(full) !== expected.get(file)) throw new Error('Hash de archivo invalido.');
    seen.add(file);
  }
  if (seen.size !== expected.size) throw new Error('Faltan archivos de la version.');
  const candidate = await json(path.join(directory, 'release.json'));
  if (candidate.sourceCommit !== update.commit || !targetMatches(candidate, baseline)) {
    throw new Error('La version no corresponde a esta Caja.');
  }
  const migrations = files => [...files].filter(([file]) => file.startsWith('database-migrations/')).sort();
  if (JSON.stringify(migrations(expected)) !== JSON.stringify(migrations(await packageFiles(currentDirectory)))) {
    throw new Error('Esta version requiere revisar la compatibilidad de la base de datos.');
  }
  const legacyRuntimeCache = legacyExtras.length ? await inspectLegacyRouteCache(directory, update.commit, expected, legacyExtras) : [];
  return {legacyRuntimeCache};
}

function command(file, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    const chunks = [];
    child.stdout.on('data', bytes => chunks.push(bytes));
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error('No se pudo consultar o preparar la version.'));
    });
  });
}

const github = {
  async latest(signal) {
    const result = await command('gh.exe', ['api', 'repos/' + repo + '/releases/latest'], signal);
    return JSON.parse(result);
  },
  download(tag, name, directory, signal) {
    return command('gh.exe', ['release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', directory], signal);
  },
};

export function extractWindowsZip(zip, destination, signal) {
  const script = path.join(import.meta.dirname, 'Extract-POS-Update.ps1');
  return command(ps, [...psArgs, '-File', script, '-ZipPath', zip, '-Destination', destination], signal);
}

async function closedShift(config) {
  const key = config.SupabaseServiceRoleKey;
  if (!key) return false;
  const url = new URL('/rest/v1/rpc/pos_windows_update_idle', config.SupabaseUrl);
  try {
    const response = await fetch(url, {
      redirect: 'error', signal: AbortSignal.timeout(3500),
      headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: 'Bearer ' + key }) },
    });
    return response.ok && await response.json() === true;
  } catch { return false; }
}

export function printJournalIdle(config) {
  let database;
  try {
    if (!path.isAbsolute(config.PrintDataDirectory || '') || !['windows', 'mock'].includes(config.PrintMode)) return false;
    database = new DatabaseSync(path.join(config.PrintDataDirectory, config.PrintMode + '-jobs.sqlite'), { readOnly: true });
    database.exec('PRAGMA busy_timeout=1000');
    return database.prepare("SELECT count(*) AS pending FROM jobs WHERE state NOT IN ('submitted', 'cancelled')").get().pending === 0;
  } catch { return false; }
  finally { database?.close(); }
}

function launchWindows(directory, configPath, onReady, { probe = false, signal } = {}) {
  return new Promise(resolve => {
    const token = randomUUID();
    let ready = false;
    let busy = false;
    let failed = false;
    const child = spawn(ps, [...psArgs, '-File', path.join(directory, 'Start-POS.ps1'),
      '-ConfigPath', configPath, ...(probe ? ['-NoBrowser', '-MaintenanceProbe'] : ['-DesktopApp'])], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'], signal,
      env: { ...process.env, POS_UPDATE_READY_TOKEN: token },
    });
    createInterface({ input: child.stdout }).on('line', line => {
      if (line === 'POS_UPDATE_READY ' + token && !ready) {
        ready = true;
        onReady();
      } else if (line === 'POS_UPDATE_BUSY ' + token) busy = true;
      else console.log(line);
    });
    child.once('error', () => { failed = true; });
    child.once('close', code => resolve({ ready: ready && !failed, busy, code: failed ? 1 : code }));
  });
}

const centralClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Matamoros', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

// The scheduled task starts at 05:00. Late starts and overlong downloads must
// never turn into a business-hours installation. Intl applies Central DST.
export function inCafeUpdateWindow(date = new Date()) {
  const parts = Object.fromEntries(centralClock.formatToParts(date).map(part => [part.type, part.value]));
  return parts.hour === '05' && Number(parts.minute) < 15;
}

function remainingWindow(date) {
  if (!inCafeUpdateWindow(date)) return 0;
  const minute = Number(centralClock.formatToParts(date).find(part => part.type === 'minute').value);
  return (15 - minute) * 60_000 - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds();
}

async function portUnused(port) {
  return await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1200);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

export async function runAutoUpdate({
  configPath, bootstrap, source = github, extract = extractWindowsZip, launch = launchWindows,
  scheduled = false, now = () => new Date(), isPortUnused = portUnused, log = console.log,
}) {
  if (scheduled && !inCafeUpdateWindow(now())) {
    log('Actualizacion omitida: solo a las 05:00, hora Central (hasta 05:15).');
    return 0;
  }
  const config = await json(configPath);
  if (!path.isAbsolute(configPath) || !path.isAbsolute(bootstrap)) throw new Error('Se requieren rutas absolutas.');
  const baseline = await json(path.join(bootstrap, 'release.json'));
  const root = configPath + '.updates';
  const versions = path.join(root, 'versions');
  const stateFile = path.join(root, 'state.json');
  const stagedFile = path.join(root, 'staged.json');
  let publicKey;
  let state;
  let resetSelection = false;
  try {
    const origin = new URL(config.SupabaseUrl);
    const local = origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && baseline.fixtureOnly;
    if ((!local && (origin.protocol !== 'https:' || baseline.fixtureOnly !== false)) ||
        origin.origin !== baseline.supabaseUrl || baseline.sourceDirty !== false ||
        createHash('sha256').update(config.SupabaseAnonKey).digest('hex') !== baseline.publicKeySha256 ||
        !commitPattern.test(baseline.sourceCommit)) throw new Error('Destino de actualizaciones invalido.');
    await mkdir(root, { recursive: true });
    if (!(await lstat(root)).isDirectory()) throw new Error('Carpeta de actualizaciones invalida.');
    await mkdir(versions, { recursive: true });
    if (!(await lstat(versions)).isDirectory()) throw new Error('Carpeta de versiones invalida.');
    const saved = await optionalJson(stateFile);
    resetSelection = !!saved && saved.bootstrapCommit !== baseline.sourceCommit;
    state = !saved || resetSelection ? { active: baseline.sourceCommit, rejected: [] } : saved;
    if (!commitPattern.test(state.active) || !Array.isArray(state.rejected) ||
        ['fallback', 'previous'].some(field => state[field] && !commitPattern.test(state[field]))) {
      throw new Error('Estado de actualizacion invalido.');
    }
  } catch {
    if (scheduled) { log('Actualizacion omitida: estado local no verificado.'); return 1; }
    log('Actualizacion no disponible. Abriendo la version de inicio.');
    return (await launch(bootstrap, configPath, () => {})).code;
  }

  if (config.AutoUpdate === true) {
    try {
      const keyPath = config.AutoUpdatePublicKeyFile || '';
      if (!path.isAbsolute(keyPath) || inside(bootstrap, keyPath) || inside(root, keyPath)) {
        throw new Error('La clave de actualizaciones debe estar fuera de la version.');
      }
      if (!path.isAbsolute(config.PrintDataDirectory || '') ||
          (!baseline.fixtureOnly && (config.PrintMode !== 'windows' || config.RequireExistingPrintJournal !== true)) ||
          !(await lstat(path.join(config.PrintDataDirectory, config.PrintMode + '-jobs.sqlite'))).isFile()) {
        throw new Error('Se requiere el diario de impresion existente.');
      }
      for (const field of ['PrintDataDirectory', 'BackupDirectory', 'BackupRecoveryKeyFile', 'ReceiptIssuerFile', 'ClipTokenFile']) {
        const value = config[field];
        if (value && (!path.isAbsolute(value) || inside(bootstrap, value) || inside(root, value))) {
          throw new Error('Los datos de Caja deben estar fuera de las versiones.');
        }
      }
      const key = createPublicKey(await readFile(keyPath));
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('Se requiere una clave publica Ed25519.');
      publicKey = key;
    } catch {
      log('Actualizacion pausada. Revisa la clave publica y las rutas de los archivos de Caja.');
    }
  }

  let active = state.fallback || state.active;
  const directory = commit => commit === baseline.sourceCommit ? bootstrap : path.join(versions, commit);
  const activeDirectory = directory(active);
  const eligible = update => update.from.includes(active) && !state.rejected.includes(update.commit);

  async function stage(signal) {
    if (!inCafeUpdateWindow(now())) return;
    const release = await source.latest(signal);
    if (!inCafeUpdateWindow(now())) return;
    const tag = release.tag_name;
    if (release.draft !== false || release.prerelease !== false || !/^pos-[0-9a-f]{7}$/.test(tag) ||
        !release.assets?.some(item => item.name === asset)) return;
    const scratch = path.join(root, 'download-' + randomUUID());
    await mkdir(scratch);
    try {
      if (!inCafeUpdateWindow(now())) return;
      await source.download(tag, asset, scratch, signal);
      const envelope = await json(path.join(scratch, asset));
      const update = readSignedUpdate(envelope, publicKey);
      if (update.tag !== tag || !eligible(update) ||
          !release.assets.some(item => item.name === update.zip)) return;
      const destination = directory(update.commit);
      let existing;
      try { existing = await optionalJson(stagedFile); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (existing?.payload === envelope.payload) {
        try {
          await verifyPackage(destination, update, directory(active), baseline);
          if (existing.signature !== envelope.signature) await saveJson(stagedFile, envelope);
          return;
        } catch { /* A damaged staged package can be downloaded again. */ }
      }
      if (!inCafeUpdateWindow(now())) return;
      await source.download(tag, update.zip, scratch, signal);
      const zip = path.join(scratch, update.zip);
      if (await sha256(zip) !== update.sha256) throw new Error('ZIP de actualizacion invalido.');
      const unpacked = path.join(scratch, 'unpacked');
      await extract(zip, unpacked, signal);
      await verifyPackage(unpacked, update, directory(active), baseline);
      signal.throwIfAborted();
      if (!inCafeUpdateWindow(now())) return;
      try { await rename(unpacked, destination); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
        try { await verifyPackage(destination, update, directory(active), baseline); }
        catch {
          await rename(destination, path.join(root, 'damaged-' + update.commit + '-' + randomUUID()));
          await rename(unpacked, destination);
        }
      }
      await saveJson(stagedFile, envelope);
      log('Hay una version nueva preparada: ' + tag);
    } finally {
      if (path.dirname(scratch) === path.resolve(root) && path.basename(scratch).startsWith('download-')) {
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }

  async function trialWhenClosed() {
    if (!publicKey || !inCafeUpdateWindow(now())) return null;
    try {
      const envelope = await optionalJson(stagedFile);
      if (!envelope) return null;
      const update = readSignedUpdate(envelope, publicKey);
      if (!eligible(update)) return null;
      await verifyPackage(directory(update.commit), update, directory(active), baseline);
      if (!await closedShift(config)) return null;
      if (!printJournalIdle(config)) return null;
      return inCafeUpdateWindow(now()) ? update : null;
    } catch {
      log('El paquete preparado no se pudo verificar.');
      return null;
    }
  }

  let record = Promise.resolve();
  const saveState = () => saveJson(stateFile, { ...state, bootstrapCommit: baseline.sourceCommit }).catch(() => log('No se pudo guardar el estado de la actualizacion.'));

  if (scheduled) {
    if (!publicKey || !await isPortUnused(config.Port || 3000) || !await closedShift(config) || !printJournalIdle(config)) {
      log('Actualizacion omitida: Caja abierta, estado pendiente o actualizaciones desactivadas.');
      return 0;
    }
    if (!inCafeUpdateWindow(now())) return 0;
    try { await stage(AbortSignal.timeout(Math.max(1, Math.min(180_000, remainingWindow(now()))))); }
    catch { log('No se pudo preparar una actualizacion. Se conserva la version actual.'); return 1; }
    const prepared = await trialWhenClosed();
    if (!prepared || !await isPortUnused(config.Port || 3000) || !inCafeUpdateWindow(now())) return 0;
    const remaining = remainingWindow(now());
    if (!remaining) return 0;
    const probeSignal = AbortSignal.timeout(Math.max(1, remaining));
    let result;
    try {
      result = await launch(directory(prepared.commit), configPath, () => {}, { probe: true, signal: probeSignal });
    } catch {
      log('La comprobacion programada no termino. Se conserva la version actual.');
      return probeSignal.aborted || !inCafeUpdateWindow(now()) ? 0 : 1;
    }
    // A deadline is not evidence of a broken release. Keep it eligible for
    // tomorrow rather than permanently rejecting a valid package at 05:15.
    if (probeSignal.aborted || !inCafeUpdateWindow(now())) {
      log('Actualizacion aplazada: termino la ventana de las 05:00 Central.');
      return 0;
    }
    if (!result.ready || result.code !== 0) {
      if (!result.busy && result.code !== 0) {
        state = { ...state, rejected: [...new Set([...state.rejected, prepared.commit])] };
        await saveState();
      }
      log('La version nueva no abrio. Se conserva la version anterior.');
      return result.busy ? 0 : 1;
    }
    try { await verifyPackage(directory(prepared.commit), prepared, directory(active), baseline); }
    catch {
      log('El paquete cambio durante la comprobacion. Se conserva la version anterior.');
      return 1;
    }
    if (!inCafeUpdateWindow(now()) || !await closedShift(config) || !printJournalIdle(config) || !await isPortUnused(config.Port || 3000) || !inCafeUpdateWindow(now())) {
      log('Actualizacion aplazada: termino la ventana o cambio el estado de Caja.');
      return 0;
    }
    const previous = active;
    active = prepared.commit;
    state = { active, previous, rejected: state.rejected };
    await saveJson(stateFile, { ...state, bootstrapCommit: baseline.sourceCommit });
    log('Caja actualizada a ' + prepared.tag + ' durante la ventana de las 05:00 Central.');
    return 0;
  }

  // Opening/closing Caja never downloads or activates an update. It opens the
  // version already validated at 05:00, with existing safe startup fallback.
  let result = await launch(activeDirectory, configPath, () => {
    if (resetSelection) record = saveState();
  });
  await record;
  if (!result.ready && !result.busy && result.code !== 0 && state.previous && state.previous !== active) {
    const rejected = [...state.rejected, active];
    active = state.previous;
    state = { active, rejected };
    await saveState();
    log('Caja no abrio. Se recupera la version anterior.');
    result = await launch(directory(active), configPath, () => {});
  }
  return result.code ?? 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [configPath, bootstrap, mode] = process.argv.slice(2);
  const log = message => {
    console.log(message);
    try { appendFileSync(configPath + '.update.log', new Date().toISOString() + ' ' + message + '\n'); }
    catch { /* A log failure cannot prevent opening Caja. */ }
  };
  try { process.exitCode = await runAutoUpdate({ configPath, bootstrap, log, scheduled: mode === '--scheduled' }); }
  catch { console.error('No se pudo iniciar el actualizador de Caja.'); process.exitCode = 1; }
}
