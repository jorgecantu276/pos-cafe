import assert from 'node:assert/strict';
import { X509Certificate, createHash, createPublicKey, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { lanOrigin } from '../customer/lan.mjs';
import { backupFilename, maximumBackupBytes } from '../../lib/business-backup-format.mjs';
import { backupDestinationId } from '../../lib/business-backup-export.mjs';

const packageId = /^[a-f0-9]{16}$/;
const commit = /^[a-f0-9]{40}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;
const sourceRoot = path.resolve(import.meta.dirname, '../..');
const inside = (parent, child) => { const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const localPath = value => typeof value === 'string' && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value);
const isoDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

async function boundedFile(filename, maximum = 65_536) {
  const info = await lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= maximum);
  const bytes = await readFile(filename);
  assert.ok(bytes.length <= maximum);
  return bytes;
}
async function json(filename) { return JSON.parse((await boundedFile(filename)).toString('utf8').replace(/^\uFEFF/, '')); }
async function present(filename) {
  if (!localPath(filename)) return false;
  try { const info = await lstat(filename); return info.isFile() && !info.isSymbolicLink() && info.size > 0; }
  catch { return false; }
}

async function releaseReport(root) {
  try {
    const release = await json(path.join(root, 'release.json'));
    assert.ok(release.version === 1 && release.product === 'smoothies' && packageId.test(release.id));
    return { state: 'identified', packageId: release.id,
      ...(version.test(release.appVersion) ? { appVersion: release.appVersion } : {}),
      ...(commit.test(release.sourceCommit) ? { sourceCommit: release.sourceCommit } : {}) };
  } catch (error) { return { state: error.code === 'ENOENT' ? 'missing' : 'invalid' }; }
}

async function applicationReport(release, fetcher) {
  if (release.state !== 'identified') return { state: 'not-checked' };
  try {
    const response = await fetcher('http://127.0.0.1:3180/api/local-instance', {
      redirect: 'error', signal: AbortSignal.timeout(2500), headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { state: 'stopped-or-unreachable' };
    const declared = Number(response.headers.get('content-length') || 0);
    assert.ok(Number.isFinite(declared) && declared >= 0 && declared <= 16_384);
    const reader = response.body.getReader(); let bytes = 0; const chunks = [];
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length;
      if (bytes > 16_384) { await reader.cancel(); throw Error(); } chunks.push(next.value); }
    const identity = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { state: identity.protocol === 1 && identity.packageId === release.packageId ? 'ready' : 'identity-mismatch' };
  } catch { return { state: 'stopped-or-unreachable' }; }
}

async function tlsReport(settings, now) {
  const values = [settings.SMOOTHIES_LAN_ORIGIN, settings.SMOOTHIES_LAN_CERT_FILE, settings.SMOOTHIES_LAN_KEY_FILE];
  const trust = 'requires-device-acceptance';
  if (values.every(value => !value)) return { state: 'not-configured', trust };
  try {
    assert.ok(values.every(Boolean));
    const bind = lanOrigin(values[0]);
    assert.ok(localPath(values[1]) && localPath(values[2]) && !inside(sourceRoot, values[1]) && !inside(sourceRoot, values[2]));
    const certificate = new X509Certificate(await boundedFile(values[1]));
    const keyPresent = await present(values[2]);
    const validFrom = Date.parse(certificate.validFrom), validTo = Date.parse(certificate.validTo);
    const matchingIp = certificate.checkIP(bind.address) === bind.address;
    const daysRemaining = Math.floor((validTo - now.getTime()) / 86_400_000);
    const state = !keyPresent || !matchingIp ? 'invalid' : validFrom > now.getTime() || validTo <= now.getTime() ? 'expired-or-not-yet-valid'
      : daysRemaining <= 30 ? 'renewal-due' : 'configured';
    return { state, trust, keyPresent, matchingIp, keyPairVerification: 'not-repeated-by-diagnostics', expiresAt: new Date(validTo).toISOString(), daysRemaining,
      originSha256: createHash('sha256').update(bind.origin).digest('hex') };
  } catch { return { state: 'invalid', trust }; }
}

async function backupReport(settings, now) {
  const directory = settings.SMOOTHIES_BACKUP_DIR, key = settings.SMOOTHIES_BACKUP_KEY_FILE;
  const recoveryKeyPresent = await present(key);
  const pendingCopy = { state: 'pending', configured: Boolean(settings.SMOOTHIES_BACKUP_EXPORT_DIR), restoreAcceptance: 'pending-live-testing' };
  if (!directory) return { state: 'not-configured', recoveryKeyPresent, externalCopy: pendingCopy };
  try {
    assert.ok(localPath(directory));
    const status = await json(path.join(directory, 'status.json'));
    assert.equal(status.version, 1);
    const saved = status.lastSuccess;
    if (!saved) return { state: 'no-success-recorded', recoveryKeyPresent, lastAttemptFailed: Boolean(status.lastError), externalCopy: pendingCopy };
    const createdAt = isoDate(saved.createdAt);
    assert.ok(createdAt && Date.parse(createdAt) <= now.getTime() + 300_000 && backupFilename.test(saved.filename)
      && Number.isInteger(saved.bytes) && saved.bytes > 0 && saved.bytes <= maximumBackupBytes && /^[a-f0-9]{64}$/.test(saved.sha256));
    const archive = await lstat(path.join(directory, saved.filename)).catch(() => null);
    const archivePresent = Boolean(archive?.isFile() && !archive.isSymbolicLink());
    const sizeMatches = archivePresent && archive.size === saved.bytes;
    const ageHours = Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / 3_600_000));
    const externalCopy = { ...pendingCopy };
    if (status.externalCopy && pendingCopy.configured) {
      const copy = status.externalCopy, exported = copy.lastSuccess;
      const configuredDestination = localPath(settings.SMOOTHIES_BACKUP_EXPORT_DIR) && backupDestinationId(settings.SMOOTHIES_BACKUP_EXPORT_DIR);
      if (copy.configured !== true || !['pending', 'copied', 'failed'].includes(copy.state)
        || copy.destinationId !== configuredDestination) externalCopy.state = 'pending';
      else if (copy.state === 'failed') externalCopy.state = 'failed';
      else if (exported && exported.sha256 === saved.sha256 && exported.filename === saved.filename && exported.bytes === saved.bytes
        && isoDate(exported.createdAt) === createdAt && copy.state === 'copied') externalCopy.state = 'copied-current';
      else if (exported) externalCopy.state = 'previous-copy-only';
    }
    return { state: !archivePresent || !sizeMatches || !recoveryKeyPresent ? 'needs-review' : ageHours >= 24 ? 'stale' : 'current',
      lastSuccessAt: createdAt, ageHours, archivePresent, sizeMatches, recoveryKeyPresent,
      lastAttemptFailed: Boolean(status.lastError), contentVerification: 'not-repeated-by-diagnostics', externalCopy };
  } catch (error) { return { state: error.code === 'ENOENT' ? 'no-success-recorded' : 'invalid', recoveryKeyPresent, externalCopy: pendingCopy }; }
}

async function updateReport(root) {
  try {
    const policy = await json(path.join(root, 'actualizaciones/policy.json'));
    assert.ok(policy.protocol === 1 && policy.product === 'smoothies' && typeof policy.enabled === 'boolean'
      && /^[a-z][a-z0-9-]{0,30}$/.test(policy.channel));
    const url = new URL(policy.manifestUrl);
    assert.ok(url.protocol === 'https:' && !url.username && !url.password);
    let signingKeyPresent = false, signingKeySha256;
    try { const key = createPublicKey(await boundedFile(path.join(root, 'actualizaciones/public-key.pem')));
      signingKeyPresent = key.asymmetricKeyType === 'ed25519';
      if (signingKeyPresent) signingKeySha256 = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
    } catch { /* No secrets or raw key errors enter the report. */ }
    let rejectedCandidateCount = 0, stateReadable = true;
    try { const status = await json(path.join(root, 'actualizaciones/state.json'));
      assert.ok(Array.isArray(status.rejected) && status.rejected.every(value => packageId.test(value)));
      rejectedCandidateCount = status.rejected.length;
    } catch (error) { if (error.code !== 'ENOENT') stateReadable = false; }
    return { state: !signingKeyPresent || !stateReadable ? 'needs-review' : policy.enabled ? 'enabled' : 'disabled',
      channel: policy.channel, signingKeyPresent, rejectedCandidateCount,
      signingTrust: { state: signingKeyPresent ? 'valid-key-format' : 'invalid-or-missing', ...(signingKeySha256 ? { keySha256: signingKeySha256 } : {}), enrollment: 'requires-device-acceptance' },
      preparedCandidatePresent: await present(path.join(root, 'actualizaciones/prepared.json')),
      feedReachability: 'not-checked' };
  } catch (error) { return { state: error.code === 'ENOENT' ? 'not-configured' : 'invalid' }; }
}

async function privateSupportRoot(root) {
  assert.ok(localPath(root), 'Usa la carpeta privada instalada de POS Smoothies.');
  const info = await lstat(root); assert.ok(info.isDirectory() && !info.isSymbolicLink());
  const actualRoot = await realpath(root), actualSource = await realpath(sourceRoot);
  assert.ok(!inside(actualSource, actualRoot), 'Usa la carpeta privada instalada de POS Smoothies.');
  // Packaged scripts live under <immutable-package>/app. The installed data home
  // lives above versiones/<package>/app and remains a separate writable root.
  const packageRoot = path.dirname(actualSource);
  try {
    const release = await json(path.join(packageRoot, 'release.json'));
    if (release.version === 1 && release.product === 'smoothies' && packageId.test(release.id)) assert.ok(!inside(packageRoot, actualRoot), 'No escribas diagnósticos dentro del paquete.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return actualRoot;
}

/** Local enrollment fingerprint uses the saved file, never ambient shell keys. */
export async function supportBackendBinding(root) {
  root = await privateSupportRoot(root);
  const settings = parseEnv((await boundedFile(path.join(root, 'caja.env'))).toString('utf8'));
  const api = new URL(settings.SMOOTHIES_API_URL), key = settings.SMOOTHIES_ANON_KEY;
  assert.ok(api.href === 'http://127.0.0.1:58000/' && key && key !== settings.SMOOTHIES_SERVICE_KEY);
  const digest = value => createHash('sha256').update(value).digest('hex');
  return { backendIdentitySha256: digest(`${api.origin}\n${digest(key)}`) };
}

async function publicationReport(root) {
  try {
    const settings = await json(path.join(root, 'soporte/reporting.json'));
    assert.ok(settings.protocol === 1 && settings.product === 'smoothies' && typeof settings.enabled === 'boolean');
    if (!settings.enabled) return { state: 'disabled' };
    assert.ok(settings.repository === 'jorgecantu276/punto-demo' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(settings.publisher)
      && /^[a-z0-9-]{1,40}$/.test(settings.device) && [settings.machineSha256, settings.backendIdentitySha256, settings.developmentMachineSha256].every(value => /^[a-f0-9]{64}$/.test(value)));
    try {
      const status = await json(path.join(root, 'soporte/state/state.json'));
      assert.equal(status.version, 1);
      const lastSuccessAt = isoDate(status.lastSuccessAt);
      return { state: lastSuccessAt ? 'reported' : 'enabled-awaiting-report', ...(lastSuccessAt ? { lastSuccessAt } : {}), lastAttemptFailed: Boolean(status.lastError) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; return { state: 'enabled-awaiting-report' }; }
  } catch (error) { return { state: error.code === 'ENOENT' ? 'not-configured' : 'invalid' }; }
}

/** Reads operational metadata only; neither healthy metadata nor a live app proves a store workflow. */
export async function collectSupportReport({ root = '', now = new Date(), fetcher = fetch } = {}) {
  root = await privateSupportRoot(root);
  assert.ok(now instanceof Date && Number.isFinite(now.getTime()));
  const release = await releaseReport(root);
  let settings = {}, configuration = 'readable';
  try { settings = parseEnv((await boundedFile(path.join(root, 'caja.env'))).toString('utf8')); }
  catch (error) { configuration = error.code === 'ENOENT' ? 'missing' : 'invalid'; }
  const [application, tls, backup, updates, remotePublication] = await Promise.all([
    applicationReport(release, fetcher), tlsReport(settings, now), backupReport(settings, now), updateReport(root), publicationReport(root),
  ]);
  let storage = { state: 'unavailable' };
  try { const disk = await statfs(root); storage = { state: 'observed', availableBytes: disk.bavail * disk.bsize }; } catch { /* Remains explicitly unobserved. */ }
  return { protocol: 1, product: 'smoothies', collectedAt: now.toISOString(), release, configuration, application, tls, backup, updates, storage,
    remotePublication,
    siteAcceptance: { state: 'pending-live-testing', checks: ['ipad-trust', 'safari-workflow', 'network-reconnect', 'pc-reboot', 'internet-loss-with-lan', 'physical-paper', 'external-restore'] } };
}

/** A fixed private destination prevents an operator-supplied path from overwriting business files. */
export async function writeSupportReport(options) {
  const report = await collectSupportReport(options);
  const directory = path.join(options.root, 'diagnostico');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory); assert.ok(info.isDirectory() && !info.isSymbolicLink());
  const temporary = path.join(directory, `support-${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(directory, 'support-report.json'));
  } finally { await rm(temporary, { force: true }); }
  return report;
}

async function main() {
  try {
    if (process.argv[2] === '--binding') { assert.equal(process.argv.length, 4); console.log(JSON.stringify(await supportBackendBinding(process.argv[3]))); }
    else { assert.equal(process.argv.length, 3); const report = await writeSupportReport({ root: process.argv[2] }); console.log(JSON.stringify(report)); }
  }
  catch { console.error('No se pudo preparar el diagnóstico de POS Smoothies. Revisa la carpeta de instalación y sus permisos.'); process.exitCode = 1; }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
