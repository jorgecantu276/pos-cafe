import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectEnrollment, applyEnrollment } from './cafe-enrollment.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const windows = { skip: process.platform !== 'win32' };
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const machine = '1'.repeat(64), prior = 'a'.repeat(40), next = 'b'.repeat(40);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cafe-enrollment-'));
  const installed = path.join(root, 'installed'), bootstrap = path.join(root, 'bootstrap'), privateRoot = path.join(root, 'private');
  for (const folder of [installed, bootstrap, privateRoot]) await mkdir(folder);
  const config = path.join(privateRoot, 'config.json'), shortcut = path.join(root, 'Caja.lnk');
  const key = path.join(privateRoot, 'public.pem'), manifest = path.join(privateRoot, 'pos-update.json');
  const support = path.join(privateRoot, 'support.json'), approval = path.join(privateRoot, 'approval.json'), reporter = path.join(privateRoot, 'settings-v5.json');
  const data = path.join(privateRoot, 'print'), backup = path.join(privateRoot, 'backups');
  await mkdir(data); await mkdir(backup);
  const issuer = path.join(privateRoot, 'issuer.json'), recovery = path.join(privateRoot, 'recovery.key');
  await writeFile(issuer, '{"business":"synthetic"}'); await writeFile(recovery, 'synthetic-only-private-recovery');
  const db = new DatabaseSync(path.join(data, 'windows-jobs.sqlite'));
  db.exec('CREATE TABLE jobs (state TEXT); INSERT INTO jobs VALUES (\'submitted\')'); db.close();
  const configuration = { SupabaseUrl: 'https://synthetic.invalid', SupabaseAnonKey: 'synthetic-public-key',
    SupabaseServiceRoleKey: 'synthetic-service-only', Port: 3137, PrintMode: 'windows', RequireExistingPrintJournal: true,
    PrintDataDirectory: data, ReceiptIssuerFile: issuer, BackupDirectory: backup, BackupRecoveryKeyFile: recovery,
    ClipEnabled: true, ClipTokenFile: path.join(privateRoot, 'clip-token.txt'), AutoUpdate: false, UnknownClientSetting: { keep: 'unchanged' } };
  await writeFile(configuration.ClipTokenFile, 'synthetic-provider-secret');
  await writeFile(config, JSON.stringify(configuration));
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:TEST_CONFIG;$a.SetAccessRuleProtection($true,$false);$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow'));Set-Acl -LiteralPath $env:TEST_CONFIG -AclObject $a"],
  { windowsHide: true, env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules'), TEST_CONFIG: config } });
  const publicKeySha = digest(configuration.SupabaseAnonKey);
  async function packageAt(folder, sourceCommit) {
    const metadata = { sourceCommit, sourceDirty: false, fixtureOnly: false,
      supabaseUrl: configuration.SupabaseUrl, publicKeySha256: publicKeySha };
    const files = { 'node.exe': 'synthetic executable marker', 'release.json': JSON.stringify(metadata),
      'Start-POS.ps1': '# synthetic no execution', 'app/server.js': '// synthetic no execution',
      'database-migrations/schema.snapshot.json': '{}', 'Open-Caja.ps1': '# synthetic fixed launcher',
      'auto-update.mjs': '// synthetic updater', 'Extract-POS-Update.ps1': '# synthetic extraction' };
    for (const [file, value] of Object.entries(files)) { await mkdir(path.dirname(path.join(folder, file)), { recursive: true }); await writeFile(path.join(folder, file), value); }
    const index = Object.entries(files).map(([file, value]) => ({ file, sha256: digest(value) }));
    await writeFile(path.join(folder, 'SHA256.json'), JSON.stringify(index));
  }
  await packageAt(installed, prior); await packageAt(bootstrap, next);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await writeFile(key, publicKey.export({ type: 'spki', format: 'pem' }));
  const filesSha256 = digest(await readFile(path.join(bootstrap, 'SHA256.json')));
  const payload = Buffer.from(JSON.stringify({ protocol: 1, commit: next, tag: 'pos-' + next.slice(0, 7),
    from: [prior], sha256: '2'.repeat(64), filesSha256 }));
  await writeFile(manifest, JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }));
  const backend = digest(configuration.SupabaseUrl + '\n' + publicKeySha);
  await writeFile(support, JSON.stringify({ format: 'pos-cafe-support-v1', machineSha256: machine,
    developmentMachineSha256: '9'.repeat(64), backendIdentitySha256: backend,
    repository: 'synthetic/private-support', publisher: 'synthetic-publisher' }));
  await writeFile(reporter, JSON.stringify({ protocol: 3, MachineSha256: machine, BackendIdentitySha256: backend,
    Repository: 'synthetic/private-support', PublisherLogin: 'synthetic-publisher', InstallDirectory: installed, ConfigPath: config }));
  const reportUrl = 'https://github.com/synthetic/private-support/issues/1#issuecomment-42';
  await writeFile(approval, JSON.stringify({ format: 'pos-cafe-enrollment-approval-v1', independentReviewer: 'Synthetic reviewer',
    approvedAt: new Date().toISOString(), machineSha256: machine, backendIdentitySha256: backend,
    installedCommit: prior, bootstrapCommit: next, bootstrapFilesSha256: filesSha256,
    publicKeySha256: digest(publicKey.export({ type: 'spki', format: 'der' })), reportUrl }));
  // Actual Windows shortcut, never a JSON substitute for the OS integration.
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop';$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:TEST_LINK);$s.TargetPath=$env:TEST_TARGET;$s.Arguments='';$s.Description='Synthetic Caja';$s.Save()"],
  { windowsHide: true, env: { ...process.env, TEST_LINK: shortcut, TEST_TARGET: path.join(installed, 'Open-POS.cmd') } });
  const report = { product: 'cafe', machineSha256: machine, backendIdentitySha256: backend,
    checkedAtUtc: new Date().toISOString(), release: { commit: prior, sourceDirty: false, fixtureOnly: false, source: 'verified_server' } };
  const options = { installed, bootstrap, config, shortcut, key, manifest, support, approval, reporter };
  const requests = [];
  const dependencies = { machine: async () => machine, portUnused: async () => true, idle: async () => true,
    gh: async args => { requests.push(args[0]); return args[0].endsWith('/issues/comments/42')
      ? { user: { login: 'synthetic-publisher' }, html_url: reportUrl, body: '```json\n' + JSON.stringify(report) + '\n```' }
      : { private: true }; } };
  return { root, options, configuration, dependencies, report, requests };
}

test('read-only plan authenticates actual context and supervised enrollment preserves client data and real shortcut', windows, async () => {
  const f = await fixture(), before = await readFile(f.options.config);
  const secretsBefore = await readFile(f.configuration.ClipTokenFile);
  const journalBefore = await readFile(path.join(f.configuration.PrintDataDirectory, 'windows-jobs.sqlite'));
  const plan = await inspectEnrollment(f.options, f.dependencies);
  assert.deepEqual(await readFile(f.options.config), before);
  assert.ok(f.requests.includes('repos/synthetic/private-support/issues/comments/42'));
  assert.ok(!JSON.stringify(plan).includes('synthetic-service-only'));
  const aclFiles = [];
  const dependencies = { ...f.dependencies, copyAcl: async (from, to) => {
    if (from === f.options.config) { assert.equal((await readFile(to)).length, 0, 'Protect empty files before any secret write.'); aclFiles.push(to); }
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop';Get-Acl -LiteralPath $env:TEST_FROM|Set-Acl -LiteralPath $env:TEST_TO"],
      { windowsHide: true, env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules'), TEST_FROM: from, TEST_TO: to } });
  } };
  const receipt = await applyEnrollment(plan, path.join(f.root, 'enrollment.json'), dependencies);
  assert.equal(aclFiles.length, 2, 'Backup and replacement configuration both receive the original ACL before secret writes.');
  const sddl = file => execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "(Get-Acl -LiteralPath $env:TEST_FILE).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)"],
    { windowsHide: true, encoding: 'utf8', env: { ...process.env, PSModulePath: path.join(path.dirname(powershell), 'Modules'), TEST_FILE: file } }).trim();
  assert.equal(sddl(receipt.backup), sddl(f.options.config));
  assert.equal(receipt.state, 'enrolled-auto-update-off');
  const changed = JSON.parse(await readFile(f.options.config, 'utf8'));
  assert.equal(changed.AutoUpdate, false); assert.equal(changed.AutoUpdatePublicKeyFile, f.options.key);
  assert.deepEqual({ ...changed, AutoUpdatePublicKeyFile: undefined }, { ...f.configuration, AutoUpdatePublicKeyFile: undefined });
  assert.deepEqual(await readFile(f.configuration.ClipTokenFile), secretsBefore);
  assert.deepEqual(await readFile(path.join(f.configuration.PrintDataDirectory, 'windows-jobs.sqlite')), journalBefore);
  const managed = await inspectEnrollment(f.options, f.dependencies);
  assert.match(managed.shortcut.arguments, /Open-Caja\.ps1/);
  await assert.rejects(inspectEnrollment({ ...f.options, enabling: true }, f.dependencies), /ActualizarRutaCaja/);
  f.report.release.commit = next;
  await assert.rejects(inspectEnrollment({ ...f.options, enabling: true }, f.dependencies), /ActualizarRutaCaja/);
  const reporter = JSON.parse(await readFile(f.options.reporter, 'utf8'));
  await writeFile(f.options.reporter, JSON.stringify({ ...reporter, InstallDirectory: f.options.bootstrap }));
  const enable = await inspectEnrollment({ ...f.options, enabling: true }, f.dependencies);
  const enabled = await applyEnrollment(enable, path.join(f.root, 'enable.json'), f.dependencies);
  assert.equal(enabled.state, 'enabled');
  assert.equal(JSON.parse(await readFile(f.options.config, 'utf8')).AutoUpdate, true);
});

test('unknown report/machine, busy backend, changed source and changed plan all refuse before mutations', windows, async () => {
  const f = await fixture();
  await assert.rejects(inspectEnrollment(f.options, { ...f.dependencies, machine: async () => '8'.repeat(64) }), /another machine/);
  await assert.rejects(inspectEnrollment(f.options, { ...f.dependencies, idle: async () => false }), /idle RPC/);
  f.report.checkedAtUtc = '2001-01-01T00:00:00Z';
  await assert.rejects(inspectEnrollment(f.options, f.dependencies), /fresh actual-PC report/);
  f.report.checkedAtUtc = new Date().toISOString();
  const plan = await inspectEnrollment(f.options, f.dependencies);
  await assert.rejects(applyEnrollment({ ...plan, machineSha256: '7'.repeat(64) }, path.join(f.root, 'forged.json'), f.dependencies), /plan machineSha256/);
  await writeFile(f.options.config, JSON.stringify({ ...f.configuration, ClipEnabled: false }));
  await assert.rejects(applyEnrollment(plan, path.join(f.root, 'refused.json'), f.dependencies), /inputs changed/);
  assert.equal(JSON.parse(await readFile(f.options.config, 'utf8')).ClipEnabled, false);
  await assert.rejects(readFile(path.join(f.root, 'refused.json')), /ENOENT/);
  await writeFile(f.options.config, JSON.stringify(f.configuration));
  await writeFile(f.options.config, JSON.stringify({ ...f.configuration, ClipTokenFile: path.join(f.options.bootstrap, 'node.exe') }));
  await assert.rejects(inspectEnrollment(f.options, f.dependencies), /outside version/);
  await writeFile(f.options.config, JSON.stringify(f.configuration));
  const accepted = JSON.parse(await readFile(f.options.support, 'utf8'));
  await writeFile(f.options.support, JSON.stringify({ ...accepted, machineSha256: null }));
  await assert.rejects(inspectEnrollment(f.options, f.dependencies), /not been independently accepted/);
  await writeFile(f.options.support, JSON.stringify(accepted));
  const db = new DatabaseSync(path.join(f.configuration.PrintDataDirectory, 'windows-jobs.sqlite'));
  db.exec("INSERT INTO jobs VALUES ('unknown')"); db.close();
  await assert.rejects(inspectEnrollment(f.options, f.dependencies), /unresolved/);
  await writeFile(path.join(f.options.bootstrap, 'app/server.js'), '// tampered');
  await assert.rejects(inspectEnrollment(f.options, f.dependencies), /Hash de archivo invalido/);
});

test('failed actual shortcut staging preserves original config and shortcut and retains rollback evidence', windows, async () => {
  const f = await fixture(), before = await readFile(f.options.config), oldShortcut = await readFile(f.options.shortcut);
  const plan = await inspectEnrollment(f.options, f.dependencies);
  const receipt = path.join(f.root, 'failed.json');
  await assert.rejects(applyEnrollment(plan, receipt, { ...f.dependencies, writeShortcut: async () => { throw Error('Synthetic COM save failure'); } }), /COM save/);
  assert.deepEqual(await readFile(f.options.config), before);
  assert.deepEqual(await readFile(f.options.shortcut), oldShortcut);
  assert.equal(JSON.parse(await readFile(receipt, 'utf8')).state, 'rolled-back');
  assert.ok((await readdir(f.root)).includes('failed.json.previous.json'));
});

test('an actual Windows sharing lock refusing the final shortcut switch restores the changed config', windows, async () => {
  const f = await fixture(), before = await readFile(f.options.config), shortcutBefore = await readFile(f.options.shortcut);
  const plan = await inspectEnrollment(f.options, f.dependencies);
  const ready = path.join(f.root, 'lock-ready'), release = path.join(f.root, 'lock-release');
  let holder;
  const dependencies = { ...f.dependencies, copyAcl: async (from) => {
    if (from !== f.options.shortcut) return;
    holder = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop';$h=[IO.File]::Open($env:TEST_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[IO.File]::WriteAllText($env:TEST_READY,'ready');while(!(Test-Path -LiteralPath $env:TEST_RELEASE)){Start-Sleep -Milliseconds 50}}finally{$h.Dispose()}"],
    { windowsHide: true, stdio: 'ignore', env: { ...process.env, TEST_LOCK: f.options.shortcut, TEST_READY: ready, TEST_RELEASE: release } });
    let locked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(ready).catch(() => null)) { locked = true; break; }
      assert.equal(holder.exitCode, null, 'Synthetic lock holder unexpectedly exited.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(locked, true, 'The actual Windows shortcut sharing lock was not established.');
  } };
  try {
    await assert.rejects(applyEnrollment(plan, path.join(f.root, 'locked.json'), dependencies), /EPERM|EACCES|EBUSY/);
    assert.deepEqual(await readFile(f.options.config), before);
    assert.deepEqual(await readFile(f.options.shortcut), shortcutBefore);
    assert.equal(JSON.parse(await readFile(path.join(f.root, 'locked.json'), 'utf8')).state, 'rolled-back');
  } finally {
    await writeFile(release, 'release');
    if (holder?.exitCode === null) await new Promise(resolve => holder.once('exit', resolve));
  }
});
