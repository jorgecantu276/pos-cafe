import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

// Never reuse an installed business: this test owns one newly created Docker
// project and verifies its identity again before removing its test volumes.
const root = path.resolve(import.meta.dirname, '../..');
const [zipFile, evidenceDirectory, referencePackage, ...extra] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.equal(process.version, 'v24.22.2');
assert.ok(zipFile && evidenceDirectory && referencePackage && !extra.length
  && [zipFile, evidenceDirectory, referencePackage].every(file => path.isAbsolute(file)),
  'Use node scripts/smoothies/acceptance.mjs <absolute-final-zip> <absolute-evidence-directory> <absolute-built-package>.');
const work = path.join(root, '.staging-local');
await mkdir(work, { recursive: true });
await mkdir(evidenceDirectory, { recursive: true });
const scratch = await mkdtemp(path.join(work, 'smoothies-acceptance-'));
const packageRoot = path.join(scratch, 'extracted');
const fixture = path.join(scratch, 'installed');
const secret = randomBytes(24).toString('base64url');
const env = { ...process.env, SMOOTHIES_ADMIN_PASSWORD: secret, POS_TEST_PORTABLE_HOME: fixture,
  POS_ACCEPTANCE_ARTIFACTS: evidenceDirectory };
const ps = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const docker = (args, options = {}) => execFileSync('docker.exe', args,
  { windowsHide: true, encoding: 'utf8', ...options });
const list = args => docker(args).trim().split(/\r?\n/).filter(Boolean);
const filters = ['--filter', 'label=com.docker.compose.project=pos-smoothies'];
const containers = ['ps', '-aq', ...filters];
const volumes = ['volume', 'ls', '-q', ...filters];
assert.equal(list(containers).length, 0, 'An existing Smoothies project is present; leave its records intact.');
assert.equal(list(volumes).length, 0, 'Existing Smoothies volumes are present; never reset them for acceptance.');
assert.ok(!(await fetch('http://127.0.0.1:3180/api/local-instance', { signal: AbortSignal.timeout(1500) }).catch(() => null)),
  'The Smoothies app test port must be unused.');
execFileSync(powershell, [...ps, path.join(import.meta.dirname, 'Extract-Smoothies-Update.ps1'),
  '-ZipPath', zipFile, '-Destination', packageRoot], { windowsHide: true, stdio: 'inherit' });
const release = JSON.parse(await readFile(path.join(packageRoot, 'release.json'), 'utf8'));
const referenceRelease = JSON.parse(await readFile(path.join(referencePackage, 'release.json'), 'utf8'));
assert.deepEqual(release, referenceRelease, 'The ZIP manifest must equal the reviewed build manifest.');
const referenceIndex = await readFile(path.join(referencePackage, 'SHA256.json'));
const filesSha256 = createHash('sha256').update(referenceIndex).digest('hex');
assert.equal(createHash('sha256').update(await readFile(path.join(packageRoot, 'SHA256.json'))).digest('hex'), filesSha256);
const { verifyPackage } = await import(pathToFileURL(path.join(packageRoot, 'app/scripts/smoothies/auto-update.mjs')));
const indexedRelease = { ...release, packageId: release.id, filesSha256 };
await verifyPackage(packageRoot, indexedRelease, release);
console.log('PASS: the exact ZIP matches the reviewed manifest/index and every extracted file hash; no extra files are present.');
assert.equal(release.product, 'smoothies');
assert.equal(release.sourceDirty, false);
assert.equal(release.familySourceDirty, false);
const node = path.join(packageRoot, 'node.exe');
assert.equal(execFileSync(node, ['-p', 'process.version'], { encoding: 'utf8', windowsHide: true }).trim(), 'v24.22.2');
const next = JSON.parse(await readFile(path.join(packageRoot, 'app/node_modules/next/package.json'), 'utf8'));
assert.equal(next.version, '16.4.6', 'The shipped server must carry the patched Next.js dependency.');
const install = () => execFileSync(powershell, [...ps, path.join(packageRoot, 'app/scripts/smoothies/Install-Smoothies.ps1'),
  '-DataDirectory', fixture, '-NoShortcuts', '-Offline'], { env, windowsHide: true, stdio: 'inherit' });
const base = 'http://127.0.0.1:3180';
const start = () => spawn(powershell, [...ps, path.join(fixture, 'Launch-Smoothies.ps1'), '-Background'],
  { env, windowsHide: true, stdio: 'inherit' });
const stop = () => execFileSync(powershell, [...ps, path.join(fixture, 'Launch-Smoothies.ps1'), '-Stop'],
  { env, windowsHide: true, stdio: 'inherit' });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitForExit(child, timeout = 20_000) {
  if (child.exitCode !== null) return child.exitCode;
  const completed = once(child, 'exit');
  const result = await Promise.race([completed, pause(timeout).then(() => null)]);
  assert.ok(result, 'The owned launcher must exit after its server stops.');
  return result[0];
}
async function ready(child) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await fetch(`${base}/api/local-instance`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (response?.ok) {
      const identity = await response.json();
      assert.equal(identity.packageId, release.id);
      return identity;
    }
    if (child.exitCode !== null) break;
    await pause(500);
  }
  for (const file of ['inicio.log', 'servidor-error.log', 'servidor.log']) {
    console.log(await readFile(path.join(fixture, 'diagnostico', file), 'utf8').catch(() => ''));
  }
  throw Error('The extracted installer did not start its identified standalone server.');
}
let settings, launch;
try {
  install();
  settings = parseEnv(await readFile(path.join(fixture, 'instalacion.env'), 'utf8'));
  await verifyPackage(path.join(fixture, 'versiones', release.id), indexedRelease, release);
  const privateBefore = await readFile(path.join(fixture, 'instalacion.env'));
  const startup = await readFile(path.join(fixture, 'caja.env'), 'utf8');
  assert.equal(settings.SMOOTHIES_MANAGED_SUPABASE, '1');
  assert.ok(!startup.includes(secret) && !startup.includes('SMOOTHIES_DATABASE_URL'));
  console.log('PASS: exact ZIP installs with its bundled Node and generates private local configuration.');
  launch = start();
  const identity = await ready(launch);
  const competing = start();
  assert.equal(await waitForExit(competing), 0);
  assert.equal((await ready(launch)).instanceToken, identity.instanceToken);
  console.log('PASS: competing launch reuses the same identified app instance.');
  const ui = path.join(import.meta.dirname, 'acceptance-ui.mjs');
  execFileSync(node, [ui], { env, windowsHide: true, stdio: 'inherit', cwd: root });
  const keyBefore = await readFile(path.join(fixture, 'clave/recuperacion.key'));
  stop();
  assert.equal(await waitForExit(launch), 0);
  execFileSync(node, [`--env-file=${path.join(fixture, 'instalacion.env')}`,
    `--env-file=${path.join(fixture, 'caja.env')}`, path.join(import.meta.dirname, 'acceptance-update.mjs'),
    fixture, packageRoot, evidenceDirectory], { env, windowsHide: true, stdio: 'inherit', cwd: root });
  const compose = ['compose', '--project-name', 'pos-smoothies', '-f', settings.SMOOTHIES_COMPOSE_FILE];
  docker([...compose, 'stop'], { stdio: 'inherit' });
  launch = start();
  assert.notEqual((await ready(launch)).instanceToken, identity.instanceToken);
  stop();
  assert.equal(await waitForExit(launch), 0);
  install();
  launch = start();
  await ready(launch);
  assert.deepEqual(await readFile(path.join(fixture, 'instalacion.env')), privateBefore);
  assert.deepEqual(await readFile(path.join(fixture, 'clave/recuperacion.key')), keyBefore);
  const login = await fetch(settings.SMOOTHIES_API_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: settings.SMOOTHIES_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smoothies.local', password: secret }),
  });
  assert.equal(login.status, 200);
  const { access_token } = await login.json();
  const orders = await fetch(settings.SMOOTHIES_API_URL + '/rest/v1/orders?select=id,ticket_number', {
    headers: { apikey: settings.SMOOTHIES_ANON_KEY, Authorization: `Bearer ${access_token}` },
  });
  assert.equal(orders.status, 200);
  assert.equal((await orders.json()).length, 1);
  console.log('PASS: stopped Docker, restart, authentication and installer repair retain the sale and private recovery material.');
  await writeFile(path.join(evidenceDirectory, 'acceptance.json'), JSON.stringify({
    result: 'pass', completedAt: new Date().toISOString(), version: release.appVersion,
    sourceCommit: release.sourceCommit, familyRelease: release.familyRelease, packageId: release.id,
    next: next.version, node: '24.22.2', zipSha256: createHash('sha256').update(await readFile(zipFile)).digest('hex'), filesSha256,
    checks: ['zip-build-equality', 'complete-file-index', 'exact-zip-install', 'private-config', 'launch-reuse', 'browser-offline', 'json-import',
      'opening-counts', 'photos', 'private-recipes', 'extra-scope', 'weekly-special', 'cash-sale',
      'closing', 'gzip', 'backup-attachment', 'full-restore', 'signed-live-update', 'docker-restart', 'installer-repair'],
  }, null, 2));
} finally {
  settings ||= await readFile(path.join(fixture, 'instalacion.env'), 'utf8').then(parseEnv).catch(() => null);
  if (launch && launch.exitCode === null) {
    try { stop(); await waitForExit(launch); }
    catch { execFileSync('taskkill.exe', ['/PID', String(launch.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
  }
  if (settings) {
    const owned = ['--filter', `label=mx.pos-smoothies.instance=${settings.SMOOTHIES_SUPABASE_INSTANCE}`];
    assert.deepEqual(list([...containers, ...owned]).sort(), list(containers).sort(), 'Refuse to remove unowned Docker containers.');
    assert.deepEqual(list([...volumes, ...owned]).sort(), list(volumes).sort(), 'Refuse to remove unowned Docker volumes.');
    docker(['compose', '--project-name', 'pos-smoothies', '-f', settings.SMOOTHIES_COMPOSE_FILE, 'down', '--volumes'], { stdio: 'inherit' });
  }
}
