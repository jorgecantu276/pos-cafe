import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { backupFilename, decryptBusinessArchive, encryptBusinessArchive, requiredBackupTables, sha256 } from '../lib/business-backup-format.mjs';
import { businessBackupDue, businessBackupStatus, downloadBusinessBackup, handleBusinessBackupRequest, runBusinessBackup } from '../lib/business-backup-server';

const snapshot = { format: 'pos-cafe-business-snapshot-v1', snapshot_at: '2026-10-30T17:00:00Z', sequences: {
  'public.orders_folio_seq': { last_value: '123', is_called: true }, 'public.orders_ticket_number_seq': { last_value: '123', is_called: true } },
  tables: Object.fromEntries(requiredBackupTables
    .map(name => [name, { columns: [{ name: 'id', type: 'uuid' }], rows: [{ id: `${name}-fixture` }] }])) };
const snapshotJson = JSON.stringify(snapshot).replace('"public.orders-fixture"', '"public.orders-fixture", "exact_large_numeric": 9007199254740993');
const schema = JSON.stringify({ tables: [], functions: [], sequences: [] });
const sql = 'begin; -- synthetic fixture only\ncommit;';
const archive = { format: 'pos-cafe-business-backup', version: 1, createdAt: '2026-10-30T17:00:00Z', releaseCommit: 'synthetic', snapshotJson,
  contract: { files: { 'schema.snapshot.json': { content: schema, sha256: sha256(Buffer.from(schema)) }, 'migrations/202610300012_business_backups.sql': { content: sql, sha256: sha256(Buffer.from(sql)) } } } };

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-backup-test-'));
  const contractDirectory = path.join(directory, 'contract'), backup = path.join(directory, 'copies'), keyFile = path.join(directory, 'recovery.key');
  await mkdir(contractDirectory); await writeFile(path.join(contractDirectory, 'schema.snapshot.json'), schema);
  await writeFile(path.join(contractDirectory, '202610300012_business_backups.sql'), sql);
  const config = { directory: backup, keyFile, contractDirectory, releaseCommit: 'synthetic', url: 'https://example.invalid', serviceKey: 'fixture-only' };
  const dependencies = { config: () => config, snapshot: async () => snapshotJson, now: () => new Date('2026-10-30T17:00:00Z') };
  return { directory, config, dependencies, clean: async () => rm(directory, { recursive: true, force: true }) };
}

test('AES-GCM archive validates key/content/contract and preserves exact database numeric text', () => {
  const key = randomBytes(32), bytes = encryptBusinessArchive(archive, key);
  assert.deepEqual(decryptBusinessArchive(bytes, key), archive);
  assert.match(decryptBusinessArchive(bytes, key).snapshotJson, /9007199254740993/);
  assert.equal(bytes.includes(Buffer.from('public.orders-fixture')), false);
  assert.throws(() => decryptBusinessArchive(bytes, randomBytes(32)), /verificar/);
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBusinessArchive(tampered, key), /verificar/);
  assert.throws(() => decryptBusinessArchive(bytes.subarray(0, 20), key), /inválidos/);
  const changed = structuredClone(archive); changed.contract.files['schema.snapshot.json'].content = 'changed';
  assert.throws(() => encryptBusinessArchive(changed, key), /dañado/);
  const missing = structuredClone(archive); missing.snapshotJson = JSON.stringify({ ...snapshot, tables: {} });
  assert.throws(() => encryptBusinessArchive(missing, key), /incompleto/);
  const noSequences = structuredClone(archive); noSequences.snapshotJson = JSON.stringify({ ...snapshot, sequences: {} });
  assert.throws(() => encryptBusinessArchive(noSequences, key), /secuencias/);
  const partialRow = structuredClone(snapshot); partialRow.tables['public.order_items'].rows = [{} as {id: string}];
  assert.throws(() => encryptBusinessArchive({ ...archive, snapshotJson: JSON.stringify(partialRow) }, key), /incompleta/);
});

test('phone backup contract requires durable state without rejecting archives made before migration 019', () => {
  const key=randomBytes(32);
  assert.deepEqual(decryptBusinessArchive(encryptBusinessArchive(archive,key),key),archive);
  const current=structuredClone(archive);
  const content='-- Synthetic migration 019 contract';
  Object.assign(current.contract.files,{'migrations/202611020019_phone_orders.sql':{content,sha256:sha256(Buffer.from(content))}});
  assert.throws(()=>encryptBusinessArchive(current,key),/pedidos por teléfono/);
  const state=JSON.parse(current.snapshotJson);
  for(const name of ['public.pos_phone_orders','cafe_private.phone_requests','cafe_private.inventory_reservations']) {
    state.tables[name]={columns:[{name:'id',type:'uuid'}],rows:[]};
  }
  current.snapshotJson=JSON.stringify(state);
  assert.throws(()=>encryptBusinessArchive(current,key),/secuencia/);
  state.sequences['public.pos_phone_orders_folio_seq']={last_value:'1',is_called:true};
  current.snapshotJson=JSON.stringify(state);
  assert.deepEqual(decryptBusinessArchive(encryptBusinessArchive(current,key),key),current);
  for(const name of ['public.pos_phone_orders','cafe_private.phone_requests','cafe_private.inventory_reservations']) {
    const incomplete=structuredClone(state);delete incomplete.tables[name];
    assert.throws(()=>encryptBusinessArchive({...current,snapshotJson:JSON.stringify(incomplete)},key),/pedidos por teléfono/);
  }
});

test('daily backups publish verified bytes once per Matamoros day and retain the last good archive after failure', async () => {
  const f = await fixture();
  try {
    assert.equal((await businessBackupStatus(f.dependencies)).lastSuccess, undefined);
    const first = await runBusinessBackup(false, f.dependencies);
    assert.ok(first.lastSuccess); assert.equal(first.lastError, undefined);
    const bytes = await readFile(path.join(f.config.directory, first.lastSuccess.filename));
    assert.equal(sha256(bytes), first.lastSuccess.sha256);
    assert.equal(decryptBusinessArchive(bytes, await readFile(f.config.keyFile)).snapshotJson, snapshotJson);
    const second = await runBusinessBackup(false, { ...f.dependencies, snapshot: async () => assert.fail('Same-day read must be skipped') });
    assert.deepEqual(second.lastSuccess, first.lastSuccess);
    assert.equal(businessBackupDue(first.lastSuccess, new Date('2026-10-31T04:59:00Z')), false);
    assert.equal(businessBackupDue(first.lastSuccess, new Date('2026-10-31T06:01:00Z')), true);
    await assert.rejects(runBusinessBackup(true, { ...f.dependencies, snapshot: async () => { throw Error('Secret detail must not escape'); } }), /no se completó/);
    const failed = await businessBackupStatus(f.dependencies);
    assert.deepEqual(failed.lastSuccess, first.lastSuccess); assert.match(failed.lastError ?? '', /no se completó/);
    assert.doesNotMatch(JSON.stringify(failed), /Secret detail|fixture-only|recovery\.key/);
    assert.deepEqual((await downloadBusinessBackup(f.dependencies)).bytes, bytes);
    assert.equal((await readdir(f.config.directory)).some(name => name.endsWith('.tmp')), false);
    const key = await readFile(f.config.keyFile);
    await writeFile(f.config.keyFile, randomBytes(32));
    await assert.rejects(runBusinessBackup(true, f.dependencies), /no se completó/);
    assert.deepEqual((await businessBackupStatus(f.dependencies)).lastSuccess, first.lastSuccess);
    assert.deepEqual((await downloadBusinessBackup(f.dependencies)).bytes, bytes);
    await writeFile(f.config.keyFile, key);
    // Never silently rotate a missing established recovery key.
    await unlink(f.config.keyFile); await assert.rejects(runBusinessBackup(true, f.dependencies), /no se completó/);
    await assert.rejects(readFile(f.config.keyFile));
  } finally { await f.clean(); }
});

test('concurrent manual/startup calls share one snapshot; retention preserves unrelated files and 14 completed copies', async () => {
  const f = await fixture();
  try {
    let release!: (value: string) => void, reads = 0;
    const pending = new Promise<string>(resolve => { release = resolve; });
    const dependencies = { ...f.dependencies, snapshot: async () => { reads++; return pending; } };
    const first = runBusinessBackup(true, dependencies), second = runBusinessBackup(true, dependencies);
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    release(snapshotJson); assert.deepEqual((await first).lastSuccess, (await second).lastSuccess); assert.equal(reads, 1);
    await writeFile(path.join(f.config.directory, 'owner-note.txt'), 'keep');
    for (let n = 1; n <= 15; n++) await runBusinessBackup(true, { ...f.dependencies, now: () => new Date(Date.UTC(2026, 10, n, 17)) });
    const files = await readdir(f.config.directory);
    assert.equal(files.filter(name => backupFilename.test(name)).length, 14);
    assert.equal(await readFile(path.join(f.config.directory, 'owner-note.txt'), 'utf8'), 'keep');
    assert.equal((await downloadBusinessBackup(f.dependencies)).filename, (await businessBackupStatus(f.dependencies)).lastSuccess?.filename);
  } finally { await f.clean(); }
});

test('offline inspect/decrypt tool verifies a copied encrypted archive and never overwrites an export', async () => {
  const f = await fixture();
  try {
    await runBusinessBackup(true, f.dependencies); const latest = await downloadBusinessBackup(f.dependencies);
    const output = path.join(f.directory, 'private-recovery.json');
    const args = [path.resolve('scripts/backups/inspect.mjs'), path.join(f.config.directory, latest.filename), f.config.keyFile, output];
    const result = await promisify(execFile)(process.execPath, args, { windowsHide: true });
    const report = JSON.parse(result.stdout); assert.equal(report.verified, true); assert.equal(report.plaintextExported, true);
    assert.doesNotMatch(result.stdout, /public\.orders-fixture|fixture-only|9007199254740993/);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).snapshotJson, snapshotJson);
    await assert.rejects(promisify(execFile)(process.execPath, args, { windowsHide: true }));
  } finally { await f.clean(); }
});

function caller(role = 'admin', active = true, authenticated = true): SupabaseClient {
  return { auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'actor' } : null }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role, is_active: active }, error: null }) }) }) }) } as unknown as SupabaseClient;
}

test('backup API authorizes the active owner before status/run/download and rejects forged/unsafe actions', async () => {
  let calls = 0;
  const operations = { status: async () => { calls++; return { version: 1 as const, enabled: true, running: false }; },
    run: async () => { calls++; return { version: 1 as const, enabled: true, running: false }; },
    download: async () => { calls++; return { bytes: Buffer.from('encrypted-fixture'), filename: 'backup-fixture.posbackup' }; },
    checkpoint: async () => { calls++; } };
  const request = (suffix = '', method = 'GET', headers = {}) => new Request(`http://localhost/api/backups${suffix}`, { method, headers });
  for (const denied of [caller('cashier'), caller('barista'), caller('admin', false), caller('admin', true, false)])
    for (const input of [request(), request('?download=latest'), request('', 'POST', { 'X-Pos-Backup': '1' })])
      await assert.rejects(handleBusinessBackupRequest(input, denied, operations));
  assert.equal(calls, 0);
  for (const input of [request('?download=../../key'), request('?download=latest&secret=x'), request('', 'POST'),
    request('', 'POST', { 'X-Pos-Backup': '1', origin: 'https://hostile.invalid' })])
    await assert.rejects(handleBusinessBackupRequest(input, caller(), operations), /inválida/);
  assert.equal(calls, 0);
  assert.equal((await handleBusinessBackupRequest(request(), caller(), operations)).headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const download = await handleBusinessBackupRequest(request('?download=latest'), caller(), operations);
  assert.equal(await download.text(), 'encrypted-fixture'); assert.match(download.headers.get('Content-Disposition')!, /attachment/);
  assert.equal((await handleBusinessBackupRequest(request('', 'POST', { 'X-Pos-Backup': '1', origin: 'http://localhost' }), caller(), operations)).status, 200);
  assert.equal(calls, 3);
  for (const role of ['cashier', 'barista', 'admin']) {
    const checkpoint = await handleBusinessBackupRequest(request('', 'POST', { 'X-Pos-Backup': 'checkpoint' }), caller(role), operations);
    assert.equal(checkpoint.status, 202); assert.deepEqual(await checkpoint.json(), { accepted: true });
  }
  assert.equal(calls, 6);
  const normalized = new Request('http://localhost:3111/api/backups', {method:'POST',headers:{Host:'127.0.0.1:3111',Origin:'http://127.0.0.1:3111','X-Pos-Backup':'1'}});
  assert.equal((await handleBusinessBackupRequest(normalized,caller(),operations)).status,200);
  const foreign = new Request('http://localhost:3111/api/backups', {method:'POST',headers:{Host:'127.0.0.1:3111',Origin:'http://other.invalid','X-Pos-Backup':'1'}});
  await assert.rejects(handleBusinessBackupRequest(foreign,caller(),operations),/inválida/);
  assert.equal(calls, 7);
  for (const denied of [caller('outsider'), caller('cashier', false), caller('cashier', true, false)])
    await assert.rejects(handleBusinessBackupRequest(request('', 'POST', { 'X-Pos-Backup': 'checkpoint' }), denied, operations));
  assert.equal(calls, 7);
});
