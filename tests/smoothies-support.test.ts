import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSupportReport, writeSupportReport } from '../scripts/smoothies/support-report.mjs';
import { provisionSmoothiesLan } from '../scripts/smoothies/provision-lan.mjs';
import { backupDestinationId } from '../lib/business-backup-export.mjs';

const id = '0123456789abcdef';
const filename = 'backup-20261126T120000000Z-00000000-0000-4000-8000-000000000001.posbackup';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'smoothies-support-'));
  const backup = path.join(root, 'copies'), key = path.join(root, 'key', 'recovery.key');
  await mkdir(backup); await mkdir(path.dirname(key)); await mkdir(path.join(root, 'actualizaciones'));
  const now = new Date(), archive = Buffer.from('synthetic-encrypted-fixture');
  await writeFile(key, 'PRIVATE-RECOVERY-MATERIAL'); await writeFile(path.join(backup, filename), archive);
  const saved = { filename, createdAt: now.toISOString(), bytes: archive.length, sha256: digest(archive) };
  const status = { version: 1, lastSuccess: saved, lastError: 'SECRET-RAW-BACKUP-ERROR' };
  await writeFile(path.join(backup, 'status.json'), JSON.stringify(status));
  await writeFile(path.join(root, 'release.json'), JSON.stringify({ version: 1, product: 'smoothies', id, appVersion: '1.0.0-rc.6', sourceCommit: 'a'.repeat(40), privateValue: 'SECRET-RELEASE' }));
  const settings = `SMOOTHIES_ANON_KEY="SECRET-ANON"\nSMOOTHIES_SERVICE_KEY="SECRET-SERVICE"\nSMOOTHIES_BACKUP_DIR="${backup.replaceAll('\\', '/')}"\nSMOOTHIES_BACKUP_KEY_FILE="${key.replaceAll('\\', '/')}"\n`;
  await writeFile(path.join(root, 'caja.env'), settings);
  await writeFile(path.join(root, 'actualizaciones/policy.json'), JSON.stringify({ protocol: 1, product: 'smoothies', enabled: true, channel: 'pilot', manifestUrl: 'https://fixture.invalid/feed?private=SECRET-URL' }));
  await writeFile(path.join(root, 'actualizaciones/public-key.pem'), generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
  await writeFile(path.join(root, 'actualizaciones/state.json'), JSON.stringify({ rejected: ['f'.repeat(16)], privateValue: 'SECRET-UPDATE' }));
  const fetcher = (async (url: string, options: RequestInit) => {
    assert.equal(url, 'http://127.0.0.1:3180/api/local-instance');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return Response.json({ protocol: 1, packageId: id, instanceToken: 'SECRET-LAUNCH-TOKEN', configId: 'SECRET-CONFIG', processId: 1234 });
  }) as typeof fetch;
  return { root, backup, key, saved, status, now, fetcher, clean: () => rm(root, { recursive: true, force: true }) };
}

test('support snapshot is allowlisted, bounded and explicitly separates observed software from live acceptance', async () => {
  const f = await fixture();
  try {
    const report = await collectSupportReport({ root: f.root, now: f.now, fetcher: f.fetcher });
    assert.equal(report.product, 'smoothies'); assert.ok('packageId' in report.release); assert.equal(report.release.packageId, id);
    assert.equal(report.application.state, 'ready'); assert.equal(report.backup.state, 'current');
    assert.equal(report.backup.lastAttemptFailed, true);
    assert.equal(report.backup.externalCopy.state, 'pending');
    assert.equal(report.updates.state, 'enabled'); assert.equal(report.updates.rejectedCandidateCount, 1);
    assert.equal(report.updates.signingTrust.state, 'valid-key-format');
    assert.match(report.updates.signingTrust.keySha256!, /^[a-f0-9]{64}$/);
    assert.equal(report.updates.signingTrust.enrollment, 'requires-device-acceptance');
    assert.equal(report.updates.feedReachability, 'not-checked');
    assert.equal(report.tls.state, 'not-configured'); assert.equal(report.tls.trust, 'requires-device-acceptance');
    assert.equal(report.remotePublication.state, 'not-configured');
    assert.equal(report.siteAcceptance.state, 'pending-live-testing');
    const output = JSON.stringify(report);
    for (const secret of ['SECRET-', 'PRIVATE-RECOVERY', f.root, f.root.replaceAll('\\', '/'), filename, 'fixture.invalid', 'processId', 'instanceToken']) assert.ok(!output.includes(secret), secret);
  } finally { await f.clean(); }
});

test('stale, missing, damaged and unverified recovery records remain visible instead of reporting healthy', async () => {
  const f = await fixture();
  try {
    const stale = { ...f.status, lastSuccess: { ...f.saved, createdAt: new Date(f.now.getTime() - 48 * 3_600_000).toISOString() } };
    await writeFile(path.join(f.backup, 'status.json'), JSON.stringify(stale));
    assert.equal((await collectSupportReport(f)).backup.state, 'stale');
    await writeFile(path.join(f.backup, filename), 'damaged');
    assert.equal((await collectSupportReport(f)).backup.state, 'needs-review');
    await writeFile(path.join(f.backup, 'status.json'), JSON.stringify({ ...stale, lastSuccess: { ...stale.lastSuccess, filename: '../../SECRET' } }));
    assert.equal((await collectSupportReport(f)).backup.state, 'invalid');
    await rm(path.join(f.backup, 'status.json'));
    assert.equal((await collectSupportReport(f)).backup.state, 'no-success-recorded');
    await writeFile(path.join(f.root, 'actualizaciones/public-key.pem'), 'SECRET-BROKEN-KEY');
    assert.equal((await collectSupportReport(f)).updates.state, 'needs-review');
    await writeFile(path.join(f.root, 'actualizaciones/policy.json'), '{');
    assert.equal((await collectSupportReport(f)).updates.state, 'invalid');
  } finally { await f.clean(); }
});

test('foreign instance, failed probe and wrong product cannot masquerade as the identified Smoothies app', async () => {
  const f = await fixture();
  try {
    const foreign = (async () => Response.json({ protocol: 1, packageId: 'f'.repeat(16), instanceToken: 'SECRET-OTHER' })) as typeof fetch;
    assert.equal((await collectSupportReport({ ...f, fetcher: foreign })).application.state, 'identity-mismatch');
    const unavailable = (async () => { throw Error('SECRET-PRIVATE-PATH'); }) as typeof fetch;
    const down = await collectSupportReport({ ...f, fetcher: unavailable });
    assert.equal(down.application.state, 'stopped-or-unreachable'); assert.ok(!JSON.stringify(down).includes('SECRET-'));
    let calls = 0;
    await writeFile(path.join(f.root, 'release.json'), JSON.stringify({ version: 1, product: 'cafe', id }));
    const wrong = await collectSupportReport({ ...f, fetcher: (async () => { calls++; throw Error(); }) as typeof fetch });
    assert.equal(wrong.release.state, 'invalid'); assert.equal(wrong.application.state, 'not-checked'); assert.equal(calls, 0);
  } finally { await f.clean(); }
});

test('external-copy status belongs to the configured destination and latest local archive, never proves an external restore', async () => {
  const f = await fixture();
  try {
    const external = path.join(f.root, 'synthetic-external-drive');
    const settings = await readFile(path.join(f.root, 'caja.env'), 'utf8');
    await writeFile(path.join(f.root, 'caja.env'), settings + `SMOOTHIES_BACKUP_EXPORT_DIR="${external.replaceAll('\\', '/')}"\n`);
    const copy = { configured: true, state: 'copied', destinationId: backupDestinationId(external), lastSuccess: f.saved };
    await writeFile(path.join(f.backup, 'status.json'), JSON.stringify({ ...f.status, externalCopy: copy }));
    let report = await collectSupportReport(f);
    assert.equal(report.backup.externalCopy.state, 'copied-current');
    assert.equal(report.backup.externalCopy.restoreAcceptance, 'pending-live-testing');
    assert.ok(!JSON.stringify(report).includes(external));
    await writeFile(path.join(f.backup, 'status.json'), JSON.stringify({ ...f.status, externalCopy: { ...copy, state: 'failed', lastError: 'SECRET-EXTERNAL-ERROR' } }));
    report = await collectSupportReport(f);
    assert.equal(report.backup.externalCopy.state, 'failed'); assert.equal(report.backup.state, 'current');
    assert.ok(!JSON.stringify(report).includes('SECRET-'));
    await writeFile(path.join(f.backup, 'status.json'), JSON.stringify({ ...f.status, externalCopy: { ...copy, destinationId: 'f'.repeat(64) } }));
    assert.equal((await collectSupportReport(f)).backup.externalCopy.state, 'pending');
    await writeFile(path.join(f.backup, 'status.json'), JSON.stringify({ ...f.status, externalCopy: { ...copy, lastSuccess: { ...f.saved, sha256: 'f'.repeat(64) } } }));
    assert.equal((await collectSupportReport(f)).backup.externalCopy.state, 'previous-copy-only');
  } finally { await f.clean(); }
});

test('reporting diagnostics observe disabled, configured and reported metadata without network publication or device acceptance', async () => {
  const f = await fixture();
  try {
    const support = path.join(f.root, 'soporte'); await mkdir(support);
    await writeFile(path.join(support, 'reporting.json'), JSON.stringify({ protocol: 1, product: 'smoothies', enabled: false }));
    assert.equal((await collectSupportReport(f)).remotePublication.state, 'disabled');
    const settings = { protocol: 1, product: 'smoothies', enabled: true, repository: 'jorgecantu276/punto-demo', publisher: 'fixture-owner', device: 'fixture-smoothies', machineSha256: 'a'.repeat(64), backendIdentitySha256: 'b'.repeat(64), developmentMachineSha256: 'c'.repeat(64) };
    await writeFile(path.join(support, 'reporting.json'), JSON.stringify(settings));
    assert.equal((await collectSupportReport(f)).remotePublication.state, 'enabled-awaiting-report');
    await mkdir(path.join(support, 'state')); await writeFile(path.join(support, 'state/state.json'), JSON.stringify({ version: 1, lastSuccessAt: f.now.toISOString(), lastError: 'SECRET-PRIVATE-PATH' }));
    const report = await collectSupportReport(f);
    assert.equal(report.remotePublication.state, 'reported'); assert.ok('lastAttemptFailed' in report.remotePublication); assert.equal(report.remotePublication.lastAttemptFailed, true);
    assert.equal(report.siteAcceptance.state, 'pending-live-testing'); assert.ok(!JSON.stringify(report).includes('SECRET-'));
    await writeFile(path.join(support, 'reporting.json'), JSON.stringify({ ...settings, repository: 'public/elsewhere' }));
    assert.equal((await collectSupportReport(f)).remotePublication.state, 'invalid');
  } finally { await f.clean(); }
});

test('explicit support export writes only its fixed diagnostics record and preserves all business/configuration bytes', async () => {
  const f = await fixture();
  try {
    const files = ['release.json', 'caja.env', path.relative(f.root, f.key), path.relative(f.root, path.join(f.backup, filename)), 'actualizaciones/policy.json'];
    const before = await Promise.all(files.map(file => readFile(path.join(f.root, file))));
    const report = await writeSupportReport(f);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'diagnostico/support-report.json'), 'utf8')), report);
    assert.deepEqual(await readdir(path.join(f.root, 'diagnostico')), ['support-report.json']);
    for (const [index, file] of files.entries()) assert.deepEqual(await readFile(path.join(f.root, file)), before[index]);
    await writeSupportReport(f);
    assert.deepEqual(await readdir(path.join(f.root, 'diagnostico')), ['support-report.json']);
  } finally { await f.clean(); }
});

test('support records configured TLS expiry without pretending PC or iPad trust was accepted',
  { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
    const f = await fixture();
    try {
      const ip = '192.168.245.10';
      const config = await provisionSmoothiesLan({ origin: `https://${ip}:3443`, directory: path.join(f.root, 'https'),
        interfaces: { fixture: [{ address: ip, internal: false, family: 'IPv4', netmask: '255.255.255.0', cidr: `${ip}/24`, mac: '00:00:00:00:00:00' }] } });
      const settings = await readFile(path.join(f.root, 'caja.env'), 'utf8');
      await writeFile(path.join(f.root, 'caja.env'), settings + `SMOOTHIES_LAN_ORIGIN="${config.origin}"\nSMOOTHIES_LAN_CERT_FILE="${config.certFile.replaceAll('\\', '/')}"\nSMOOTHIES_LAN_KEY_FILE="${config.keyFile.replaceAll('\\', '/')}"\n`);
      const report = await collectSupportReport({ root: f.root, now: new Date(), fetcher: f.fetcher });
      assert.equal(report.tls.state, 'configured'); assert.equal(report.tls.matchingIp, true);
      assert.equal(report.tls.trust, 'requires-device-acceptance'); assert.ok(report.tls.daysRemaining <= 365);
      const due = await collectSupportReport({ root: f.root, now: new Date(Date.parse(report.tls.expiresAt!) - 20 * 86_400_000), fetcher: f.fetcher });
      assert.equal(due.tls.state, 'renewal-due');
      assert.ok(!JSON.stringify(report).includes(ip));
    } finally { await f.clean(); }
  });
