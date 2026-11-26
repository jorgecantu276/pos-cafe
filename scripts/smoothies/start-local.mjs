import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localTarget } from './prepare-local.mjs';
import { openSmoothiesLan, readSmoothiesLan } from './lan.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const action = process.argv[2];
assert.ok(['build', 'start', 'open'].includes(action), 'Usa build, start u open.');
const building = action === 'build';
const portable = process.env.SMOOTHIES_PORTABLE === '1';
const base = 'http://127.0.0.1:3180';
const lan = building ? null : await readSmoothiesLan(process.env, { sourceRoot: root });
const browserUrl = lan?.origin || base;
const api = localTarget(process.env.SMOOTHIES_API_URL, 'http:', 58000);
assert.equal(api.href, 'http://127.0.0.1:58000/');
const { SMOOTHIES_ANON_KEY: anon, SMOOTHIES_SERVICE_KEY: service, SMOOTHIES_PRINT_DIR: journal } = process.env;
assert.ok(anon && anon !== service, 'Configura la clave pública local de Supabase.');
const printDirectory = journal ? path.resolve(journal) : '';
const composeFile = process.env.SMOOTHIES_COMPOSE_FILE;
const backupDirectory = process.env.SMOOTHIES_BACKUP_DIR;
const backupKey = process.env.SMOOTHIES_BACKUP_KEY_FILE;
const hash = value => createHash('sha256').update(value).digest('hex');
const buildDirectory = path.join(root, '.next');
const buildFile = path.join(buildDirectory, 'smoothies-local.json');
const publicKeyHash = hash(anon);
let configId;
let releaseId;
let instanceToken;

function docker(args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: 'ignore', timeout });
    child.once('error', reject);
    child.once('exit', code => resolve(code === 0));
  });
}

async function backendReady() {
  const options = { redirect: 'error', signal: AbortSignal.timeout(2500) };
  const [health, catalog] = await Promise.all([
    fetch(new URL('/auth/v1/health', api), { ...options, headers: { apikey: anon } }).catch(() => null),
    fetch(new URL('/rest/v1/extras?select=applicable_product_ids&limit=1', api), {
      ...options, method: 'HEAD', headers: { apikey: service, Authorization: `Bearer ${service}` },
    }).catch(() => null),
  ]);
  return health?.ok === true && catalog?.ok === true;
}

async function startBackend() {
  assert.ok(path.isAbsolute(composeFile) && !/^(?:\\\\|\/\/)/.test(composeFile) && (await stat(composeFile)).isFile(),
    'Indica una ruta local absoluta al archivo Compose de smoothies.');
  try {
    if (!await docker(['info', '--format', '{{.ServerVersion}}'], 5000)) {
      assert.equal(process.platform, 'win32');
      assert.ok(await docker(['desktop', 'start', '--timeout', '60'], 65_000));
    }
    assert.ok(await docker(['compose', '--project-name', 'pos-smoothies', '-f', composeFile, 'start'], 30_000));
  } catch {
    throw new Error('No se pudo iniciar la base de smoothies. Abre Docker Desktop y revisa que el proyecto pos-smoothies esté instalado.');
  }
  for (let attempt = 0; attempt < 45; attempt++) {
    if (await backendReady()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('La base local de smoothies no respondió. Revisa Docker Desktop y vuelve a abrir caja.');
}

if (!building) {
  assert.ok(service, 'Falta la clave privada de la instancia local.');
  assert.ok(journal && path.isAbsolute(journal) && !journal.startsWith('\\\\'), 'Indica una carpeta absoluta en el disco local.');
  if (backupDirectory || backupKey) {
    const onDisk = value => value && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value);
    assert.ok(onDisk(backupDirectory) && onDisk(backupKey), 'Indica rutas locales absolutas para la carpeta de respaldos y su clave.');
  }
  const buildId = (await readFile(path.join(buildDirectory, 'BUILD_ID'), 'utf8').catch(() => '')).trim();
  const build = JSON.parse(await readFile(buildFile, 'utf8').catch(() => 'null'));
  assert.ok(buildId && (portable ? (await stat(path.join(root, 'server.js'))).isFile()
    : build?.buildId === buildId && build.publicKeyHash === publicKeyHash),
    'El paquete de POS Smoothies no está completo.');
  releaseId = hash(JSON.stringify([root, buildId]));
  configId = hash(JSON.stringify([api.origin, anon, service, printDirectory, backupDirectory, backupKey,
    ...(lan ? [[lan.origin, lan.fingerprint]] : [])]));
  instanceToken = randomUUID();
  if (!await backendReady()) {
    assert.ok(composeFile, 'Inicia la base local o configura SMOOTHIES_COMPOSE_FILE antes de abrir caja.');
    await startBackend();
  }
  await mkdir(printDirectory, { recursive: true });
}
const env = {
  ...process.env, NEXT_PUBLIC_POS_PROFILE: 'smoothies', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: api.origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SMOOTHIES_RUNTIME_ANON_KEY: portable ? anon : '',
  SUPABASE_SERVICE_ROLE_KEY: building ? '' : service,
  POS_CLIP_ENABLED: '0', POS_CLIP_TOKEN: '',
  POS_PRINT_MODE: 'mock', POS_PRINT_DATA_DIR: printDirectory,
  POS_BACKUP_DIR: !building ? backupDirectory || '' : '',
  POS_BACKUP_KEY_FILE: !building ? backupKey || '' : '',
  POS_DATABASE_CONTRACT_DIR: !building && backupDirectory ? path.join(root, 'supabase') : '',
  POS_LAUNCH_INSTANCE_TOKEN: instanceToken || '', POS_LAUNCH_CONFIG_ID: configId || '', POS_LAUNCH_RELEASE_ID: releaseId || '',
  POS_LAUNCH_PACKAGE_ID: portable ? process.env.SMOOTHIES_PACKAGE_ID || '' : '',
  POS_LAN_MODE: lan ? '1' : '', POS_PUBLIC_ORIGIN: lan?.origin || '',
};
delete env.SMOOTHIES_ADMIN_PASSWORD;
delete env.SMOOTHIES_SERVICE_KEY;
delete env.SMOOTHIES_DATABASE_URL;
delete env.POS_RELEASE_BUILD;

async function existingInstance() {
  const response = await fetch(`${base}/api/local-instance`, { signal: AbortSignal.timeout(1500), redirect: 'error' }).catch(() => null);
  if (!response) return null;
  const identity = response.ok ? await response.json().catch(() => null) : null;
  assert.ok(identity?.protocol === 1 && identity.releaseId === releaseId && identity.configId === configId,
    'El puerto 3180 ya está en uso. Cierra esa aplicación antes de abrir esta caja.');
  return identity;
}

function openBrowser() {
  return new Promise((resolve, reject) => {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', browserUrl], { windowsHide: true, stdio: 'ignore' });
    browser.once('error', reject);
    browser.once('exit', code => code === 0 ? resolve() : reject(new Error(`Abre ${browserUrl} en el navegador.`)));
  });
}

async function main() {
  if (action === 'open') {
    assert.equal(process.platform, 'win32', `Usa start y abre ${browserUrl} en el navegador.`);
    if (await existingInstance()) return openBrowser();
  }
  if (building) await rm(buildFile, { force: true });
  // Bind exclusively before Next starts. A failed front never leaves a partial app.
  const front = await openSmoothiesLan(lan);
  let child, monitor, stopping = false, result;
  const stop = () => { stopping = true; child?.kill(); };
  try {
    const args = portable && !building ? [path.join(root, 'server.js')]
      : [path.join(root, 'node_modules/next/dist/bin/next'), ...(building ? ['build', '--webpack'] : ['start', '--hostname', '127.0.0.1', '--port', '3180'])];
    child = spawn(process.execPath, args,
      { cwd: root, env: { ...env, HOSTNAME: '127.0.0.1', PORT: '3180' }, stdio: 'inherit', windowsHide: true });
    const finished = new Promise(resolve => {
      child.once('error', error => { console.error(error.message); resolve(1); });
      child.once('exit', code => resolve(code ?? 1));
    });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const stopFile = portable && process.env.SMOOTHIES_DATA_HOME ? path.join(process.env.SMOOTHIES_DATA_HOME, 'detener-caja') : '';
    monitor = stopFile && setInterval(async () => {
      if (stopping) return;
      const token = await readFile(stopFile, 'utf8').catch(() => '');
      if (token !== instanceToken) return;
      stop();
      await rm(stopFile, { force: true }).catch(() => {});
    }, 500);
    if (action === 'open') {
      const deadline = Date.now() + 20_000;
      let ready = false;
      while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && child.pid) {
        if ((await existingInstance())?.instanceToken === instanceToken) {
          await openBrowser(); ready = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready && Date.now() >= deadline) throw new Error('La caja no abrió a tiempo. Revisa si Supabase local sigue abierto.');
    }
    result = await finished;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (monitor) clearInterval(monitor);
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await front?.close();
  }
  if (building && result === 0) {
    const buildId = (await readFile(path.join(buildDirectory, 'BUILD_ID'), 'utf8')).trim();
    await writeFile(buildFile, JSON.stringify({ buildId, publicKeyHash }));
  }
  process.exitCode = stopping ? 0 : result;
}

await main();
