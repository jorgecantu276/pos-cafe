import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { backupDestinationId, copyBusinessBackupArchive, exportBusinessBackup } from '../lib/business-backup-export.mjs';
import { decryptBusinessArchive, encryptBusinessArchive, requiredBackupTables, sha256 } from '../lib/business-backup-format.mjs';
import { businessBackupStatus, downloadBusinessBackup, runBusinessBackup } from '../lib/business-backup-server';

const snapshotJson = JSON.stringify({ format: 'pos-cafe-business-snapshot-v1', snapshot_at: '2026-11-26T17:00:00Z',
  sequences: { 'public.orders_folio_seq': { last_value: '1', is_called: true }, 'public.orders_ticket_number_seq': { last_value: '1', is_called: true } },
  tables: Object.fromEntries(requiredBackupTables.map(name => [name, { columns: [{ name: 'id', type: 'uuid' }], rows: [] }])) });
const schema = JSON.stringify({ tables: [], functions: [], sequences: [] });
const sql = 'begin; -- synthetic export fixture\ncommit;';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pos-backup-export-')), directory = path.join(root, 'local'), external = path.join(root, 'external');
  const keyFile = path.join(root, 'key', 'recovery.key'), contractDirectory = path.join(root, 'contract');
  for (const dir of [directory, external, path.dirname(keyFile), contractDirectory]) await mkdir(dir);
  await writeFile(keyFile, randomBytes(32));
  await writeFile(path.join(contractDirectory, 'schema.snapshot.json'), schema);
  await writeFile(path.join(contractDirectory, '202610300012_business_backups.sql'), sql);
  const bytes = encryptBusinessArchive({ format: 'pos-cafe-business-backup', version: 1, createdAt: '2026-11-26T17:00:00Z', releaseCommit: 'synthetic', snapshotJson,
    contract: { files: { 'schema.snapshot.json': { content: schema, sha256: sha256(Buffer.from(schema)) },
      'migrations/202610300012_business_backups.sql': { content: sql, sha256: sha256(Buffer.from(sql)) } } } }, await readFile(keyFile));
  const success = { filename: `backup-20261126T170000000Z-${randomUUID()}.posbackup`, createdAt: '2026-11-26T17:00:00Z', bytes: bytes.length, sha256: sha256(bytes) };
  await writeFile(path.join(directory, success.filename), bytes);
  const config = { directory, keyFile, contractDirectory, releaseCommit: 'synthetic', url: 'https://synthetic.invalid', serviceKey: 'synthetic-only', exportDirectory: external };
  return { root, config, success, bytes, clean: () => rm(root, { recursive: true, force: true }) };
}

test('copies only verified encrypted bytes, reuses an identical copy and never exports its recovery key', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await exportBusinessBackup(f.config, f.success), f.success);
    assert.deepEqual(await readFile(path.join(f.config.exportDirectory, f.success.filename)), f.bytes);
    assert.deepEqual(decryptBusinessArchive(f.bytes, await readFile(f.config.keyFile)).snapshotJson, snapshotJson);
    assert.deepEqual(await readdir(f.config.exportDirectory), [f.success.filename]);
    await exportBusinessBackup(f.config, f.success);
    assert.deepEqual(await readdir(f.config.exportDirectory), [f.success.filename]);
    await writeFile(path.join(f.config.exportDirectory, f.success.filename), 'preserve conflicting destination bytes');
    await assert.rejects(exportBusinessBackup(f.config, f.success));
    assert.equal(await readFile(path.join(f.config.exportDirectory, f.success.filename), 'utf8'), 'preserve conflicting destination bytes');
    assert.deepEqual(await readdir(f.config.exportDirectory), [f.success.filename]);
  } finally { await f.clean(); }
});

test('refuses missing, aliased, local-backup and key-directory destinations without creating substitutes', async () => {
  const f = await fixture();
  try {
    const absent = path.join(f.root, 'disconnected-device');
    await assert.rejects(exportBusinessBackup({ ...f.config, exportDirectory: absent }, f.success));
    await assert.rejects(readFile(absent), { code: 'ENOENT' });
    for (const exportDirectory of [f.config.directory, path.dirname(f.config.keyFile), process.cwd()])
      await assert.rejects(copyBusinessBackupArchive({ ...f.config, exportDirectory }, f.success), /separado/);
    const alias = path.join(f.root, 'alias');
    await symlink(f.config.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(copyBusinessBackupArchive({ ...f.config, exportDirectory: alias }, f.success), /enlace/);
    await unlink(alias);
    assert.deepEqual(await readdir(f.config.exportDirectory), []);
  } finally { await f.clean(); }
});

test('a stalled owned export worker is terminated without blocking local backup access', async () => {
  const f = await fixture();
  try {
    const sourceRoot = path.join(f.root, 'worker-fixture'); await mkdir(path.join(sourceRoot, 'scripts/smoothies'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'scripts/smoothies/export-backup.mjs'), 'process.stdin.resume(); setInterval(()=>{},1000);');
    const before = Date.now();
    await assert.rejects(exportBusinessBackup({ ...f.config, sourceRoot }, f.success, { timeout: 150 }), error => {
      assert.equal((error as { killed?: boolean }).killed, true); return true;
    });
    assert.ok(Date.now() - before < 5_000);
    assert.deepEqual(await readFile(path.join(f.config.directory, f.success.filename)), f.bytes);
    assert.deepEqual(await readdir(f.config.exportDirectory), []);
  } finally { await f.clean(); }
});

test('an unavailable external destination leaves the local backup usable and the same scheduled hook retries its latest archive', async () => {
  const f = await fixture();
  try {
    const missing = path.join(f.root, 'media-not-connected');
    f.config.exportDirectory = missing;
    const now = new Date('2026-11-26T18:00:00Z');
    const dependencies = { config: () => f.config, snapshot: async () => snapshotJson, now: () => now };
    const first = await runBusinessBackup(true, dependencies);
    assert.ok(first.lastSuccess); assert.equal(first.lastError, undefined);
    assert.equal(first.externalCopy?.state, 'failed');
    assert.equal(first.externalCopy.destinationId, backupDestinationId(missing));
    assert.ok(!(JSON.stringify(first.externalCopy).includes(missing)));
    assert.equal((await downloadBusinessBackup(dependencies)).filename, first.lastSuccess.filename);
    await mkdir(missing);
    const retried = await runBusinessBackup(false, { ...dependencies, snapshot: async () => assert.fail('Retry must use the verified local archive, not another database snapshot') });
    assert.equal(retried.externalCopy?.state, 'copied');
    assert.equal(retried.externalCopy.lastSuccess?.sha256, first.lastSuccess.sha256);
    assert.equal(retried.lastSuccess?.filename, first.lastSuccess.filename);
    assert.deepEqual(await readdir(missing), [first.lastSuccess.filename]);
    await rename(missing, path.join(f.root, 'disconnected-after-good-copy'));
    const later = await runBusinessBackup(true, { ...dependencies, now: () => new Date('2026-11-26T19:00:00Z') });
    assert.ok(later.lastSuccess); assert.equal(later.lastError, undefined);
    assert.equal(later.externalCopy?.state, 'failed');
    assert.equal(later.externalCopy.lastSuccess?.sha256, retried.externalCopy.lastSuccess?.sha256);
    assert.notEqual(later.lastSuccess.sha256, later.externalCopy.lastSuccess?.sha256);
    assert.equal((await downloadBusinessBackup(dependencies)).filename, later.lastSuccess.filename);
    f.config.exportDirectory = '';
    const unconfigured = await businessBackupStatus(dependencies);
    assert.deepEqual(unconfigured.externalCopy, { configured: false, state: 'pending' });
    assert.ok(unconfigured.lastSuccess);
  } finally { await f.clean(); }
});
