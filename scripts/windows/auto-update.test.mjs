import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runAutoUpdate, printJournalIdle, inCafeUpdateWindow } from './auto-update.mjs';
import { DatabaseSync } from 'node:sqlite';

const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(readFileSync(file));
const base = '1204ca8b7470763da23ffd5881d545d10df2f8f4';
const next = 'a'.repeat(40), badStartup = 'b'.repeat(40), wrongSchema = 'c'.repeat(40);
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const windowsOnly = { skip: process.platform !== 'win32', timeout: 45_000 };

test('05:00 Central follows DST and rejects early, late and business-hour runs', () => {
  for (const day of ['2026-01-15', '2026-11-27']) {
    assert.equal(inCafeUpdateWindow(new Date(day + 'T10:59:59Z')), false);
    assert.equal(inCafeUpdateWindow(new Date(day + 'T11:00:00Z')), true);
    assert.equal(inCafeUpdateWindow(new Date(day + 'T11:14:59.999Z')), true);
    assert.equal(inCafeUpdateWindow(new Date(day + 'T11:15:00Z')), false);
  }
  assert.equal(inCafeUpdateWindow(new Date('2026-07-15T10:00:00Z')), true);
  assert.equal(inCafeUpdateWindow(new Date('2026-07-15T11:00:00Z')), false);
  assert.equal(inCafeUpdateWindow(new Date('2026-03-08T10:00:00Z')), true);
  assert.equal(inCafeUpdateWindow(new Date('2026-11-01T11:00:00Z')), true);
});

test('scheduled signed update is verified at 05:00; busy or missed runs never catch up on GUI open', windowsOnly, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'pos-update-test-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = path.join(root, 'public.pem');
  writeFileSync(publicPem, publicKey.export({ type: 'spki', format: 'pem' }));
  let idle = true, requests = 0, portFree = true;
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/rest/v1/rpc/pos_windows_update_idle');
    assert.equal(request.headers.apikey, 'fixture-service-key');
    requests++;
    response.setHeader('Content-Type', 'application/json');
    if (idle === 'offline') response.statusCode = 503;
    response.end(JSON.stringify(idle));
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    try { await new Promise(resolve => server.close(resolve)); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const target = { supabaseUrl: origin, publicKeySha256: hash('fixture-anon'), fixtureOnly: true, sourceDirty: false };
  const configPath = path.join(root, 'caja.json'), printDir = path.join(root, 'print-data');
  mkdirSync(printDir);
  const journal = path.join(printDir, 'mock-jobs.sqlite');
  const fixtureJournal = new DatabaseSync(journal);
  fixtureJournal.exec("CREATE TABLE jobs (state TEXT NOT NULL); INSERT INTO jobs VALUES ('submitted')");
  fixtureJournal.close();
  writeFileSync(configPath, JSON.stringify({ AutoUpdate: true, AutoUpdatePublicKeyFile: publicPem, SupabaseUrl: origin,
    SupabaseAnonKey: 'fixture-anon', SupabaseServiceRoleKey: 'fixture-service-key', PrintMode: 'mock', PrintDataDirectory: printDir }));
  const configHash = fileHash(configPath);
  function makePackage(commit, schema = 'fixture schema') {
    const folder = path.join(root, commit);
    const files = { 'release.json': JSON.stringify({ ...target, sourceCommit: commit }), 'Start-POS.ps1': '# Synthetic launcher',
      'node.exe': 'fixture only', 'app/server.js': 'fixture only', 'database-migrations/schema.snapshot.json': schema };
    for (const [name, contents] of Object.entries(files)) {
      const file = path.join(folder, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, contents);
    }
    writeFileSync(path.join(folder, 'SHA256.json'), JSON.stringify(Object.entries(files).map(([file, value]) => ({ file, sha256: hash(value) }))));
    return folder;
  }
  const bootstrap = makePackage(base);
  function release(commit, previous, schema) {
    const folder = makePackage(commit, schema), tag = 'pos-' + commit.slice(0, 7), name = 'POS-Cafe-' + commit.slice(0, 7) + '.zip';
    const zip = path.join(root, name);
    execFileSync('tar.exe', ['-a', '-cf', zip, '-C', folder, '.'], { windowsHide: true });
    const payload = Buffer.from(JSON.stringify({ protocol: 1, tag, commit, from: [previous], sha256: fileHash(zip), filesSha256: fileHash(path.join(folder, 'SHA256.json')) }));
    return { tag, name, zip, envelope: { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') } };
  }
  let candidate = release(next, base), tampered = 'signature', zipDownloads = 0, sourceReads = 0;
  let clock = new Date('2026-11-27T11:00:00Z'), crossAfterManifest = false, crossAfterProbe = false;
  let launchResult = { ready: true, code: 0 }, failActive = false;
  const launches = [], logs = [];
  const source = {
    async latest() { sourceReads++; return { draft: false, prerelease: false, tag_name: candidate.tag, assets: [{ name: 'pos-update.json' }, { name: candidate.name }] }; },
    async download(tag, name, directory) {
      assert.equal(tag, candidate.tag);
      if (name === 'pos-update.json') {
        const envelope = tampered === 'signature' ? { ...candidate.envelope, signature: Buffer.alloc(64).toString('base64') } : candidate.envelope;
        writeFileSync(path.join(directory, name), JSON.stringify(envelope));
        if (crossAfterManifest) clock = new Date('2026-11-27T11:15:00Z');
      } else {
        zipDownloads++;
        if (tampered === 'zip') writeFileSync(path.join(directory, name), 'corrupt archive');
        else cpSync(candidate.zip, path.join(directory, name));
      }
    },
  };
  const stateFile = configPath + '.updates/state.json';
  const state = () => readJson(stateFile);
  async function run(scheduled = true) {
    return await runAutoUpdate({ bootstrap, configPath, source, scheduled, now: () => clock, isPortUnused: async () => portFree,
      log: value => logs.push(value),
      async launch(directory, selectedConfig, ready, options) {
        assert.equal(selectedConfig, configPath);
        const commit = readJson(path.join(directory, 'release.json')).sourceCommit;
        launches.push(commit);
        if (scheduled) { assert.equal(options.probe, true); assert.ok(options.signal); }
        if (failActive && commit === next) return { ready: false, code: 1 };
        if (launchResult.ready) ready();
        if (crossAfterProbe) clock = new Date('2026-11-27T11:15:00Z');
        return launchResult;
      },
    });
  }
  assert.equal(await run(), 1); assert.equal(zipDownloads, 0, 'a bad signature never downloads ZIP');
  tampered = 'zip'; assert.equal(await run(), 1); assert.equal(zipDownloads, 1);
  tampered = ''; crossAfterManifest = true;
  assert.equal(await run(), 0); assert.equal(zipDownloads, 1); assert.equal(launches.length, 0);
  clock = new Date('2026-11-27T11:00:00Z'); crossAfterManifest = false;
  idle = false; assert.equal(await run(), 0); assert.equal(zipDownloads, 1);
  idle = 'offline'; assert.equal(await run(), 0); assert.equal(zipDownloads, 1);
  idle = true; portFree = false; assert.equal(await run(), 0); assert.equal(launches.length, 0); portFree = true;
  const heldJournal = new DatabaseSync(journal); heldJournal.exec("INSERT INTO jobs VALUES ('uncertain')");
  assert.equal(await run(), 0); assert.equal(zipDownloads, 1); heldJournal.exec("DELETE FROM jobs WHERE state='uncertain'"); heldJournal.close();
  const journalHash = fileHash(journal);
  crossAfterProbe = true; launchResult = { ready: false, code: 1 };
  assert.equal(await run(), 0); assert.throws(state, /ENOENT/, 'an aborted deadline does not blacklist the valid candidate');
  clock = new Date('2026-11-27T11:00:00Z'); launchResult = { ready: true, code: 0 };
  assert.equal(await run(), 0); assert.throws(state, /ENOENT/);
  crossAfterProbe = false; clock = new Date('2026-11-28T11:00:00Z');
  writeFileSync(path.join(configPath + '.updates', 'versions', next, 'app/server.js'), 'damaged synthetic staging');
  const downloadsBeforeRepair = zipDownloads;
  launchResult = { ready: false, busy: true, code: 1 };
  assert.equal(await run(), 0); assert.equal(zipDownloads, downloadsBeforeRepair + 1, 'damaged staged bytes are downloaded and reverified');
  assert.throws(state, /ENOENT/, 'a race with Caja never rejects the candidate');
  launchResult = { ready: true, code: 0 };
  assert.equal(await run(), 0); assert.deepEqual(state(), { active: next, previous: base, rejected: [], bootstrapCommit: base }, 'the deadline-deferred candidate is accepted on the next day');
  const downloadsBefore = zipDownloads, readsBefore = sourceReads;
  clock = new Date('2026-11-27T14:00:00Z');
  assert.equal(await run(), 0); assert.equal(sourceReads, readsBefore, 'no late catch-up');
  assert.equal(await run(false), 0); assert.equal(launches.at(-1), next); assert.equal(zipDownloads, downloadsBefore); assert.equal(sourceReads, readsBefore);
  writeFileSync(configPath, JSON.stringify({ ...readJson(configPath), AutoUpdate: false }));
  assert.equal(await run(false), 0); assert.equal(launches.at(-1), next, 'pausing updates preserves the installed active version');
  writeFileSync(configPath, JSON.stringify({ ...readJson(configPath), AutoUpdate: true }));
  writeFileSync(stateFile, JSON.stringify({ active: next, fallback: base, rejected: [], bootstrapCommit: base }));
  assert.equal(await run(false), 0); assert.equal(launches.at(-1), base); assert.equal(state().fallback, base, 'legacy pending selection is not tried on GUI open');
  writeFileSync(stateFile, JSON.stringify({ active: next, previous: base, rejected: [], bootstrapCommit: base }));
  clock = new Date('2026-11-27T11:00:00Z'); candidate = release(wrongSchema, next, 'different schema');
  assert.equal(await run(), 1); assert.equal(state().active, next);
  candidate = release(badStartup, next); launchResult = { ready: false, code: 1 };
  assert.equal(await run(), 1); assert.equal(state().active, next); assert.ok(state().rejected.includes(badStartup));
  launchResult = { ready: true, code: 0 }; failActive = true; clock = new Date('2026-11-27T14:00:00Z');
  assert.equal(await run(false), 0); assert.deepEqual(launches.slice(-2), [next, base]); assert.equal(state().active, base);
  assert.equal(fileHash(configPath), configHash); assert.equal(fileHash(journal), journalHash); assert.ok(requests > 0);
});

test('print journal gate refuses unknown, missing and pending states', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pos-update-journal-')), config = { PrintDataDirectory: root, PrintMode: 'mock' };
  assert.equal(printJournalIdle(config), false);
  const db = new DatabaseSync(path.join(root, 'mock-jobs.sqlite'));
  db.exec('CREATE TABLE jobs (state TEXT NOT NULL)'); assert.equal(printJournalIdle(config), true);
  for (const state of ['queued', 'preparing', 'submitting', 'uncertain', 'blocked', 'unknown']) {
    db.prepare('INSERT INTO jobs VALUES (?)').run(state); assert.equal(printJournalIdle(config), false, state); db.exec('DELETE FROM jobs');
  }
  db.exec("INSERT INTO jobs VALUES ('submitted'), ('cancelled')"); assert.equal(printJournalIdle(config), true); db.close();
  rmSync(root, { recursive: true, force: true });
});

test('actual maintenance probe verifies an owned synthetic server, closes it, and refuses a foreign listener', windowsOnly, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'cafe-maintenance-probe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bootstrap = path.join(root, 'release'), privateRoot = path.join(root, 'private'), printDir = path.join(privateRoot, 'print');
  mkdirSync(path.join(bootstrap, 'app'), { recursive: true }); mkdirSync(printDir, { recursive: true });
  const db = new DatabaseSync(path.join(printDir, 'mock-jobs.sqlite')); db.exec('CREATE TABLE jobs (state TEXT)'); db.close();
  const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const configPath = path.join(privateRoot, 'config.json'), origin = 'http://127.0.0.1:' + port;
  writeFileSync(configPath, JSON.stringify({ SupabaseUrl: origin, SupabaseAnonKey: 'synthetic-public', PrintMode: 'mock',
    RequireExistingPrintJournal: true, PrintDataDirectory: printDir, BackupDirectory: path.join(privateRoot, 'backups'), BackupRecoveryKeyFile: path.join(privateRoot, 'recovery.key'), Port: port }));
  writeFileSync(path.join(bootstrap, 'release.json'), JSON.stringify({ sourceCommit: base, sourceDirty: false, fixtureOnly: true,
    supabaseUrl: origin, publicKeySha256: hash('synthetic-public') }));
  cpSync(path.join(import.meta.dirname, 'Start-POS.ps1'), path.join(bootstrap, 'Start-POS.ps1'));
  linkSync(process.execPath, path.join(bootstrap, 'node.exe'));
  writeFileSync(path.join(bootstrap, 'app/server.js'), `require('node:http').createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({protocol:1,instanceToken:process.env.POS_LAUNCH_INSTANCE_TOKEN,
    processId:process.pid,releaseId:process.env.POS_LAUNCH_RELEASE_ID,configId:process.env.POS_LAUNCH_CONFIG_ID}));
  }).listen(Number(process.env.PORT),'127.0.0.1');`);
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const token = randomUUID(), args = ['-NoProfile', '-NonInteractive', '-File', path.join(bootstrap, 'Start-POS.ps1'), '-ConfigPath', configPath, '-MaintenanceProbe'];
  const env = { ...process.env, PSModulePath: path.join(path.dirname(shell), 'Modules'), POS_UPDATE_READY_TOKEN: token };
  const output = execFileSync(shell, args, { windowsHide: true, env, timeout: 35_000, encoding: 'utf8' });
  assert.ok(output.includes('POS_UPDATE_READY ' + token));
  assert.equal(existsSync(configPath + '.instance.json'), false, 'the probe removes its own instance record');
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }), /fetch failed/, 'the owned probe process was stopped');
  const foreign = createServer((req, res) => res.end('untouched synthetic listener')).listen(port, '127.0.0.1');
  await once(foreign, 'listening');
  try {
    assert.throws(() => execFileSync(shell, args, { windowsHide: true, env, timeout: 10_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), error => {
      assert.ok(error.stdout.includes('POS_UPDATE_BUSY ' + token)); return error.status !== 0;
    });
    assert.equal(await (await fetch(origin)).text(), 'untouched synthetic listener');
  } finally { await new Promise(resolve => foreign.close(resolve)); }
});
