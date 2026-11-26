import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { runAutoUpdate, printJournalIdle } from './auto-update.mjs';
import { DatabaseSync } from 'node:sqlite';

const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(readFileSync(file));
const base = '1204ca8b7470763da23ffd5881d545d10df2f8f4';
const next = 'a'.repeat(40);
const badStartup = 'b'.repeat(40);
const wrongSchema = 'c'.repeat(40);
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const windowsOnly = { skip: process.platform !== 'win32', timeout: 45_000 };

test('Windows updater stages a signed ZIP, waits for a closed shift and rolls back a failed start', windowsOnly, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'pos-update-test-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = path.join(root, 'public.pem');
  writeFileSync(publicPem, publicKey.export({ type: 'spki', format: 'pem' }));
  let idle = false;
  let requests = 0;
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
  const configPath = path.join(root, 'caja.json');
  const printDir = path.join(root, 'print-data');
  mkdirSync(printDir);
  const journal = path.join(printDir, 'mock-jobs.sqlite');
  const fixtureJournal = new DatabaseSync(journal);
  fixtureJournal.exec("CREATE TABLE jobs (state TEXT NOT NULL); INSERT INTO jobs VALUES ('submitted')");
  fixtureJournal.close();
  writeFileSync(configPath, JSON.stringify({
    AutoUpdate: true, AutoUpdatePublicKeyFile: publicPem, SupabaseUrl: origin,
    SupabaseAnonKey: 'fixture-anon', SupabaseServiceRoleKey: 'fixture-service-key',
    PrintMode: 'mock', PrintDataDirectory: printDir,
  }));
  const configHash = fileHash(configPath);
  let journalHash = fileHash(journal);

  function makePackage(commit, schema = 'fixture schema') {
    const folder = path.join(root, commit);
    const files = {
      'release.json': JSON.stringify({ ...target, sourceCommit: commit }),
      'Start-POS.ps1': '# Synthetic launcher',
      'node.exe': 'fixture only',
      'app/server.js': 'fixture only',
      'database-migrations/schema.snapshot.json': schema,
    };
    for (const [name, contents] of Object.entries(files)) {
      const file = path.join(folder, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, contents);
    }
    writeFileSync(path.join(folder, 'SHA256.json'), JSON.stringify(Object.entries(files).map(([file, value]) => ({ file, sha256: hash(value) }))));
    return folder;
  }
  const bootstrap = makePackage(base);
  function release(commit, previous, schema) {
    const folder = makePackage(commit, schema);
    const tag = 'pos-' + commit.slice(0, 7);
    const name = 'POS-Cafe-' + commit.slice(0, 7) + '.zip';
    const zip = path.join(root, name);
    execFileSync('tar.exe', ['-a', '-cf', zip, '-C', folder, '.'], { windowsHide: true });
    const payload = Buffer.from(JSON.stringify({
      protocol: 1, tag, commit, from: [previous],
      sha256: fileHash(zip), filesSha256: fileHash(path.join(folder, 'SHA256.json')),
    }));
    return { tag, name, zip, envelope: {
      payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64'),
    } };
  }
  let candidate = release(next, base);
  let tampered = 'signature';
  let zipDownloads = 0;
  let launches = [];
  let failActive = false;
  let nonStartup;
  const source = {
    async latest() {
      return { draft: false, prerelease: false, tag_name: candidate.tag, assets: [{ name: 'pos-update.json' }, { name: candidate.name }] };
    },
    async download(tag, name, directory) {
      assert.equal(tag, candidate.tag);
      if (name === 'pos-update.json') {
        const envelope = tampered === 'signature' ? { ...candidate.envelope, signature: Buffer.alloc(64).toString('base64') } : candidate.envelope;
        writeFileSync(path.join(directory, name), JSON.stringify(envelope));
      } else {
        zipDownloads++;
        if (tampered === 'zip') writeFileSync(path.join(directory, name), 'corrupt archive');
        else cpSync(candidate.zip, path.join(directory, name));
      }
    },
  };
  const state = () => readJson(configPath + '.updates/state.json');

  async function run(until, onClose = () => {}, launcher = bootstrap, expectedCode = 0) {
    const logs = [];
    const result = await runAutoUpdate({
      bootstrap: launcher, configPath, source, interval: 60_000,
      log: message => logs.push(message),
      async launch(directory, selectedConfig, ready) {
        assert.equal(selectedConfig, configPath);
        const commit = readJson(path.join(directory, 'release.json')).sourceCommit;
        launches.push(commit);
        if (nonStartup) return nonStartup;
        if (commit === badStartup || (failActive && commit === next)) return { ready: false, code: 1 };
        ready();
        if (until) {
          for (let i = 0; i < 300 && !logs.some(until); i++) await sleep(30);
          assert.ok(logs.some(until), logs.join('\n'));
        }
        onClose();
        return { ready: true, code: 0 };
      },
    });
    assert.equal(result, expectedCode);
    return logs;
  }
  const refused = message => message.startsWith('No se pudo preparar');
  const staged = message => message.startsWith('Hay una version nueva preparada');
  await run(refused);
  assert.equal(zipDownloads, 0, 'a bad signature never downloads the ZIP');
  tampered = 'zip';
  await run(refused);
  assert.equal(zipDownloads, 1);
  tampered = '';
  await run(staged);
  assert.equal(requests, 1, 'the backend is checked at shutdown, not while downloading');
  assert.deepEqual(launches, [base, base, base]);
  idle = 'offline';
  await run();
  assert.equal(launches.at(-1), base);
  writeFileSync(path.join(configPath + '.updates', 'versions', next, 'app', 'server.js'), 'corrupt staging');
  await run(staged);
  assert.equal(launches.at(-1), base);
  idle = true;
  const heldJournal = new DatabaseSync(journal);
  heldJournal.exec("INSERT INTO jobs VALUES ('uncertain')");
  await run();
  assert.equal(launches.at(-1), base);
  assert.throws(state, /ENOENT/, 'uncertain print prevents even publishing a new active selection');
  heldJournal.exec("DELETE FROM jobs WHERE state='uncertain'");
  heldJournal.close();
  journalHash = fileHash(journal);
  // The synthetic temporary record is removed before the preserved journal check below.
  await run();
  assert.equal(launches.at(-1), base);
  assert.deepEqual(state(), { active: next, fallback: base, rejected: [], bootstrapCommit: base });
  idle = false;
  await run();
  assert.equal(launches.at(-1), base, 'a new shift delays the trial even after selection');
  idle = true;
  nonStartup = { ready: false, busy: true, code: 1 };
  await run(undefined, undefined, bootstrap, 1);
  assert.deepEqual(state(), { active: next, fallback: base, rejected: [], bootstrapCommit: base }, 'a running Caja does not reject the pending trial');
  nonStartup = undefined;
  await run();
  assert.equal(launches.at(-1), next);
  assert.deepEqual(state(), { active: next, previous: base, rejected: [], bootstrapCommit: base });
  nonStartup = { ready: false, code: 0 };
  await run();
  assert.deepEqual(state(), { active: next, previous: base, rejected: [], bootstrapCommit: base }, 'reusing the open server does not reject the active version');
  nonStartup = undefined;

  candidate = release(wrongSchema, next, 'different schema');
  await run(refused);
  assert.equal(state().active, next);
  candidate = release(badStartup, next);
  await run(staged);
  assert.equal(state().active, badStartup);
  await run();
  assert.deepEqual(launches.slice(-2), [badStartup, next]);
  assert.deepEqual(state(), { active: next, previous: base, rejected: [badStartup], bootstrapCommit: base });
  await run();
  assert.equal(launches.at(-1), next, 'the failed candidate is not retried');
  assert.equal(fileHash(configPath), configHash);
  assert.equal(printJournalIdle({ PrintDataDirectory: printDir, PrintMode: 'mock' }), true);
  assert.equal(fileHash(journal), journalHash);
  writeFileSync(configPath, JSON.stringify({ ...readJson(configPath), AutoUpdate: false }));
  const previousDownloads = zipDownloads;
  await run();
  assert.equal(launches.at(-1), next, 'pausing downloads preserves the installed version');
  assert.equal(zipDownloads, previousDownloads);
  failActive = true;
  await run();
  assert.deepEqual(launches.slice(-2), [next, base]);
  assert.deepEqual(state(), { active: base, rejected: [badStartup, next], bootstrapCommit: base });
  const manual = makePackage('d'.repeat(40), 'forward schema');
  await run(undefined, undefined, manual);
  assert.equal(launches.at(-1), 'd'.repeat(40), 'manual maintenance selects the new launcher and ignores the old installation state');
  assert.deepEqual(state(), { active: 'd'.repeat(40), rejected: [], bootstrapCommit: 'd'.repeat(40) });
});

test('print journal gate refuses unknown, missing and pending states', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pos-update-journal-'));
  const config = { PrintDataDirectory: root, PrintMode: 'mock' };
  assert.equal(printJournalIdle(config), false);
  const db = new DatabaseSync(path.join(root, 'mock-jobs.sqlite'));
  db.exec('CREATE TABLE jobs (state TEXT NOT NULL)');
  assert.equal(printJournalIdle(config), true);
  for (const state of ['queued', 'preparing', 'submitting', 'uncertain', 'blocked', 'unknown']) {
    db.prepare('INSERT INTO jobs VALUES (?)').run(state);
    assert.equal(printJournalIdle(config), false, state);
    db.exec('DELETE FROM jobs');
  }
  db.exec("INSERT INTO jobs VALUES ('submitted'), ('cancelled')");
  assert.equal(printJournalIdle(config), true);
  db.close();
  rmSync(root, { recursive: true, force: true });
});
