import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { compareVersions, fileHash, printJournalsIdle, readSignedUpdate, runAutoUpdate, stageUpdate,
  verifyPackage } from '../scripts/smoothies/auto-update.mjs';
import { verifyRestoreContract } from '../scripts/smoothies/restore-contract.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const policy = { protocol: 1, product: 'smoothies', enabled: true, channel: 'pilot',
  manifestUrl: 'https://example.com/pilot.json', publicKey: publicPem };
const envelope = (value: unknown) => {
  const payload = Buffer.from(JSON.stringify(value));
  return { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
};
const baseline = { version: 1, product: 'smoothies', appVersion: '1.0.0-rc.3', id: '1'.repeat(16),
  databaseContract: 'a'.repeat(64), settingsPath: 'private-settings.env' };
const release = { ...baseline, appVersion: '1.0.0-rc.4', familyRelease: 'pos-v1.0.0-rc.4', id: '2'.repeat(16),
  sourceCommit: 'b'.repeat(40), familySourceCommit: 'b'.repeat(40), sourceDirty: false, familySourceDirty: false };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'smoothies-update-'));
  const packageRoot = path.join(root, 'candidate');
  await mkdir(path.join(root, 'actualizaciones'), { recursive: true });
  await writeFile(path.join(root, 'actualizaciones/policy.json'), JSON.stringify(policy));
  await writeFile(path.join(root, 'actualizaciones/public-key.pem'), publicPem);
  await writeFile(path.join(root, 'release.json'), JSON.stringify(baseline));
  const files = ['node.exe', 'app/server.js', 'app/scripts/smoothies/auto-update.mjs',
    'app/scripts/smoothies/start-local.mjs', 'app/supabase/schema.snapshot.json'];
  for (const file of files) {
    await mkdir(path.dirname(path.join(packageRoot, file)), { recursive: true });
    await writeFile(path.join(packageRoot, file), `synthetic ${file}`);
  }
  await writeFile(path.join(packageRoot, 'release.json'), JSON.stringify(release));
  const rows = await Promise.all([...files, 'release.json'].map(async file => ({ file, sha256: await fileHash(path.join(packageRoot, file)) })));
  await writeFile(path.join(packageRoot, 'SHA256.json'), JSON.stringify(rows));
  const zip = Buffer.from('synthetic ZIP used only with the injected extractor');
  const manifest = { protocol: 1, product: 'smoothies', channel: 'pilot', appVersion: release.appVersion,
    familyRelease: release.familyRelease, sourceCommit: release.sourceCommit, packageId: release.id,
    databaseContract: release.databaseContract, zipUrl: 'https://example.com/release.zip',
    sha256: createHash('sha256').update(zip).digest('hex'), filesSha256: await fileHash(path.join(packageRoot, 'SHA256.json')),
    publishedAt: '2026-11-17T18:00:00.000Z' };
  let downloads = 0;
  return { root, packageRoot, manifest, zip, get downloads() { return downloads; },
    source: async (url: string) => { downloads++; return url.endsWith('.json') ? Buffer.from(JSON.stringify(envelope(manifest))) : zip; },
    extract: async (_zip: string, into: string) => cp(packageRoot, into, { recursive: true }),
    cleanup: () => rm(root, { recursive: true, force: true }) };
}
test('signed Smoothies updates enforce publisher, product, channel, version order, and HTTPS', async () => {
  const f = await fixture();
  try {
    assert.equal(readSignedUpdate(envelope(f.manifest), publicPem, policy).packageId, release.id);
    assert.throws(() => readSignedUpdate(envelope({ ...f.manifest, product: 'cafe' }), publicPem, policy));
    assert.throws(() => readSignedUpdate(envelope({ ...f.manifest, channel: 'stable' }), publicPem, policy));
    assert.throws(() => readSignedUpdate(envelope({ ...f.manifest, zipUrl: 'http://example.com/x' }), publicPem, policy));
    const tampered = envelope(f.manifest);
    tampered.payload = Buffer.from(JSON.stringify({ ...f.manifest, packageId: '3'.repeat(16) })).toString('base64');
    assert.throws(() => readSignedUpdate(tampered, publicPem, policy));
    assert.equal(compareVersions('1.0.0', '1.0.0-rc.99'), 1);
    assert.equal(compareVersions('1.0.0-rc.9', '1.0.0-rc.10'), -1);
  } finally { await f.cleanup(); }
});
test('staging checks ZIP and every file, rejects extra/tampered files and a changed schema before activation', async () => {
  const f = await fixture();
  try {
    assert.equal(await stageUpdate({ ...f, policy, baseline }), true);
    const staged = path.join(f.root, 'versiones', release.id);
    await verifyPackage(staged, f.manifest, baseline);
    await writeFile(path.join(staged, 'unexpected.js'), 'not in signed index');
    await assert.rejects(verifyPackage(staged, f.manifest, baseline));
    await rm(path.join(staged, 'unexpected.js'));
    await writeFile(path.join(staged, 'app/server.js'), 'changed');
    await assert.rejects(verifyPackage(staged, f.manifest, baseline));
    const count = f.downloads;
    await assert.rejects(stageUpdate({ ...f, policy, baseline: { ...baseline, databaseContract: 'c'.repeat(64) } }));
    assert.equal(f.downloads, count + 1, 'schema mismatch does not download or extract another package');
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'release.json'), 'utf8')).id, baseline.id);
  } finally { await f.cleanup(); }
});
test('signed older releases cannot downgrade the active release', async () => {
  const f = await fixture();
  try {
    assert.equal(await stageUpdate({ ...f, policy, baseline: { ...baseline, appVersion: '1.0.0' } }), false);
    assert.equal(f.downloads, 1);
    assert.deepEqual(await readdir(path.join(f.root, 'actualizaciones')), ['policy.json', 'public-key.pem']);
  } finally { await f.cleanup(); }
});
test('any unfinished print state blocks updates, including an uncertain handoff', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'smoothies-print-idle-'));
  const db = new DatabaseSync(path.join(root, 'mock-jobs.sqlite'));
  try {
    db.exec('create table jobs(state text not null)');
    for (const state of ['queued', 'blocked', 'preparing', 'submitting', 'uncertain']) {
      db.exec('delete from jobs');
      db.prepare('insert into jobs values(?)').run(state);
      assert.equal(await printJournalsIdle(root), false, state);
    }
    db.exec("delete from jobs; insert into jobs values('submitted'),('cancelled')");
    assert.equal(await printJournalsIdle(root), true);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
test('open shift/unresolved operation keeps active version, offline feed never prevents opening', async () => {
  const f = await fixture();
  try {
    await stageUpdate({ ...f, policy, baseline });
    const launched: string[] = [];
    const log: string[] = [];
    await runAutoUpdate({ root: f.root, log: message => log.push(message),
      idle: async () => { throw Error('synthetic open shift'); },
      source: async () => { throw Error('offline'); },
      launch: async (_root, active) => {
        launched.push(active.id);
        return { ready: true, finished: new Promise(resolve => setTimeout(() => resolve(0), 10)), stop: async () => {} };
      } });
    assert.deepEqual(launched, [baseline.id]);
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'release.json'), 'utf8')).id, baseline.id);
    assert.ok(log.some(line => line.includes('Caja sigue disponible')));
  } finally { await f.cleanup(); }
});
test('candidate startup failure restores last good version and rejects repeat activation without modifying private data', async () => {
  const f = await fixture();
  try {
    await stageUpdate({ ...f, policy, baseline });
    const privateFile = path.join(f.root, 'private-sales-and-keys.fixture');
    await writeFile(privateFile, 'preserve this exact synthetic data');
    const before = await fileHash(privateFile);
    const launched: string[] = [];
    const launch = async (_root: string, active: typeof baseline) => {
      launched.push(active.id);
      return { ready: active.id === baseline.id, finished: Promise.resolve(active.id === baseline.id ? 0 : 1), stop: async () => {} };
    };
    const args = { root: f.root, launch, log: () => {}, idle: async () => async () => {}, source: async () => { throw Error('offline'); } };
    assert.equal(await runAutoUpdate(args), 0);
    assert.deepEqual(launched, [release.id, baseline.id]);
    assert.equal(await fileHash(privateFile), before);
    launched.length = 0;
    assert.equal(await runAutoUpdate(args), 0);
    assert.deepEqual(launched, [baseline.id]);
  } finally { await f.cleanup(); }
});
test('only verified healthy startup commits the candidate while retaining previous release and trust', async () => {
  const f = await fixture();
  try {
    await stageUpdate({ ...f, policy, baseline });
    const trust = await fileHash(path.join(f.root, 'actualizaciones/public-key.pem'));
    let unlocked = false;
    await runAutoUpdate({ root: f.root, log: () => {}, source: async () => { throw Error('offline'); },
      idle: async () => async () => { unlocked = true; },
      launch: async (_root, active) => {
        assert.equal(unlocked, false, 'drawer lock is held through candidate health verification');
        assert.equal(JSON.parse(await readFile(path.join(f.root, 'release.json'), 'utf8')).id, baseline.id);
        assert.equal(active.id, release.id);
        return { ready: true, finished: Promise.resolve(0), stop: async () => {} };
      } });
    assert.equal(unlocked, true);
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'release.json'), 'utf8')).id, release.id);
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'release.previous.json'), 'utf8')).id, baseline.id);
    assert.equal(await fileHash(path.join(f.root, 'actualizaciones/public-key.pem')), trust);
  } finally { await f.cleanup(); }
});
test('candidate launcher exception also rejects that candidate and opens the known good version', async () => {
  const f = await fixture();
  try {
    await stageUpdate({ ...f, policy, baseline });
    const launches: string[] = [];
    assert.equal(await runAutoUpdate({ root: f.root, idle: async () => async () => {}, log: () => {},
      source: async () => { throw Error('offline'); }, launch: async (_root, active) => {
        launches.push(active.id);
        if (active.id === release.id) throw Error('synthetic malformed readiness response');
        return { ready: true, finished: Promise.resolve(0), stop: async () => {} };
      } }), 0);
    assert.deepEqual(launches, [release.id, baseline.id]);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'actualizaciones/state.json'), 'utf8')).rejected, [release.id]);
  } finally { await f.cleanup(); }
});
test('a staged update activates after an already-running register closes its shift without a manual restart', async () => {
  const f = await fixture();
  try {
    let closeCurrent: (value: number) => void = () => {};
    const currentFinished = new Promise<number>(resolve => { closeCurrent = resolve; });
    const launches: string[] = [];
    let idleChecks = 0, stops = 0, unlocks = 0;
    assert.equal(await runAutoUpdate({ root: f.root, source: f.source, extract: f.extract, log: () => {},
      interval: 60_000, idleInterval: 10, probe: async () => ({ packageId: baseline.id }),
      idle: async (_env, options) => {
        assert.equal(options?.live, true);
        if (++idleChecks === 1) throw Error('shift still open');
        return async () => { unlocks++; };
      },
      launch: async (_root, active) => {
        launches.push(active.id);
        if (active.id === baseline.id) return { ready: true, finished: currentFinished,
          stop: async () => { stops++; closeCurrent(0); } };
        return { ready: true, finished: new Promise(resolve => setTimeout(() => resolve(0), 15)), stop: async () => {} };
      } }), 0);
    assert.deepEqual(launches, [baseline.id, release.id]);
    assert.equal(stops, 1);
    assert.equal(unlocks, 1);
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'release.json'), 'utf8')).id, release.id);
  } finally { await f.cleanup(); }
});
test('an unavailable update storage directory does not prevent opening the installed register', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'smoothies-bad-update-folder-'));
  try {
    await writeFile(path.join(root, 'release.json'), JSON.stringify(baseline));
    await writeFile(path.join(root, 'actualizaciones'), 'synthetic unavailable directory');
    const launches: string[] = [];
    assert.equal(await runAutoUpdate({ root, log: () => {}, launch: async (_root, active) => {
      launches.push(active.id);
      return { ready: true, finished: Promise.resolve(0), stop: async () => {} };
    } }), 0);
    assert.deepEqual(launches, [baseline.id]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('restore resolves archived Smoothies migrations from their dedicated folder and rejects a changed SQL contract', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'smoothies-restore-contract-'));
  try {
    await mkdir(path.join(root, 'migrations'));
    await mkdir(path.join(root, 'smoothies'));
    const files = { 'schema.snapshot.json': '{}', 'migrations/202611050023_base.sql': 'select 1;',
      'smoothies/202611140029_setup.sql': 'select 2;' };
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
    const contract = { files: Object.fromEntries(Object.entries(files).map(([name, content]) =>
      [name.replace('smoothies/', 'migrations/'), { content, sha256: createHash('sha256').update(content).digest('hex') }])) };
    await verifyRestoreContract(contract, root);
    await writeFile(path.join(root, 'smoothies/202611140029_setup.sql'), 'changed');
    await assert.rejects(verifyRestoreContract(contract, root), /no coincide/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
