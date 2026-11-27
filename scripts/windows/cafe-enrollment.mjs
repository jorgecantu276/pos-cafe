import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { printJournalIdle, readSignedUpdate, verifyPackage } from './auto-update.mjs';

const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const shell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const inside = (folder, value) => {
  const relative = path.relative(folder, value);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

async function normalPath(value, directory = false) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value) && !value.startsWith('\\\\'), 'Use explicit absolute local paths.');
  let current = path.resolve(value);
  const stat = await lstat(current);
  assert.ok(directory ? stat.isDirectory() : stat.isFile(), 'The selected path has the wrong kind.');
  for (;;) {
    assert.equal((await lstat(current)).isSymbolicLink(), false, 'Redirected paths are refused.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(value);
}

async function powershell(script, variables) {
  return (await execute(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 15_000, env: { ...process.env, PSModulePath: path.join(path.dirname(shell), 'Modules'), ...variables },
  })).stdout.trim();
}

async function readShortcut(file) {
  return JSON.parse(await powershell("$ErrorActionPreference='Stop';$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:POS_ENROLL_LINK);@{target=$s.TargetPath;arguments=$s.Arguments;workingDirectory=$s.WorkingDirectory;icon=$s.IconLocation;description=$s.Description;windowStyle=$s.WindowStyle}|ConvertTo-Json -Compress", { POS_ENROLL_LINK: file }));
}

async function writeShortcut(file, properties) {
  await powershell("$ErrorActionPreference='Stop';$p=$env:POS_ENROLL_PROPERTIES|ConvertFrom-Json;$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:POS_ENROLL_LINK);$s.TargetPath=$p.target;$s.Arguments=$p.arguments;$s.WorkingDirectory=$p.workingDirectory;$s.IconLocation=$p.icon;$s.Description=$p.description;$s.WindowStyle=$p.windowStyle;$s.Save()", {
    POS_ENROLL_LINK: file, POS_ENROLL_PROPERTIES: JSON.stringify(properties),
  });
}

const native = {
  async copyAcl(from, to) {
    await powershell("$ErrorActionPreference='Stop';Get-Acl -LiteralPath $env:POS_ENROLL_FROM|Set-Acl -LiteralPath $env:POS_ENROLL_TO", { POS_ENROLL_FROM: from, POS_ENROLL_TO: to });
  },
  async machine() {
    const guid = await powershell("$ErrorActionPreference='Stop';[string](Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid", {});
    assert.match(guid, /^[a-fA-F0-9-]{32,36}$/, 'Windows machine identity is unavailable.');
    return hash(guid.toLowerCase());
  },
  async gh(args) {
    return JSON.parse((await execute('gh.exe', ['api', ...args], {
      windowsHide: true, timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    })).stdout);
  },
  readShortcut, writeShortcut,
  async portUnused(port) {
    return await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.setTimeout(1200);
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
  },
  async idle(config) {
    if (!config.SupabaseServiceRoleKey) return false;
    const key = config.SupabaseServiceRoleKey;
    const response = await fetch(new URL('/rest/v1/rpc/pos_windows_update_idle', config.SupabaseUrl), {
      redirect: 'error', signal: AbortSignal.timeout(3500),
      headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: 'Bearer ' + key }) },
    });
    return response.ok && await response.json() === true;
  },
};

function shortcutFor(bootstrap, configPath, old) {
  return { ...old, target: shell,
    arguments: `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${path.join(bootstrap, 'Open-Caja.ps1')}" -ConfigPath "${configPath}"`,
    workingDirectory: bootstrap, windowStyle: 7 };
}

function recent(timestamp, now) {
  const date = Date.parse(timestamp);
  return Number.isFinite(date) && date <= now + 5 * 60_000 && date >= now - 48 * 60 * 60_000;
}

/** All probes are read-only. Dependencies are injectable only for isolated tests. */
export async function inspectEnrollment(options, dependencies = {}) {
  const services = { ...native, ...dependencies };
  const now = Date.now();
  const inputs = {};
  for (const field of ['installed', 'bootstrap']) inputs[field] = await normalPath(options[field], true);
  for (const field of ['config', 'shortcut', 'key', 'manifest', 'support', 'approval', 'reporter']) inputs[field] = await normalPath(options[field]);
  assert.equal(path.extname(inputs.shortcut).toLowerCase(), '.lnk', 'Select the existing Caja shortcut.');
  for (const file of Object.values(inputs)) assert.ok(!/[\r\n"]/.test(file), 'Unsupported path characters.');
  const configBytes = await readFile(inputs.config);
  const config = JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const baseline = await json(path.join(inputs.installed, 'release.json'));
  const candidate = await json(path.join(inputs.bootstrap, 'release.json'));
  const keyBytes = await readFile(inputs.key);
  const key = createPublicKey(keyBytes);
  assert.equal(key.asymmetricKeyType, 'ed25519', 'An Ed25519 public signing key is required.');
  assert.ok(!keyBytes.toString().includes('PRIVATE KEY'), 'Never copy private signing keys to the POS.');
  const publicKeySha256 = hash(key.export({ type: 'spki', format: 'der' }));
  const origin = new URL(config.SupabaseUrl);
  assert.ok(origin.protocol === 'https:' && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'A real HTTPS backend is required.');
  const publicHash = hash(config.SupabaseAnonKey || '');
  const backendIdentitySha256 = hash(origin.origin + '\n' + publicHash);
  for (const release of [baseline, candidate]) {
    assert.match(release.sourceCommit, commit);
    assert.equal(release.sourceDirty, false);
    assert.equal(release.fixtureOnly, false, 'Fixture packages cannot enroll a store.');
    assert.equal(release.supabaseUrl, origin.origin, 'Package/backend mismatch.');
    assert.equal(release.publicKeySha256, publicHash, 'Package/public-key mismatch.');
  }
  const signed = readSignedUpdate(await json(inputs.manifest), key);
  assert.equal(signed.commit, candidate.sourceCommit);
  assert.ok(signed.from.includes(baseline.sourceCommit), 'The actual installed predecessor is not signed as supported.');
  await verifyPackage(inputs.bootstrap, signed, inputs.bootstrap, baseline);
  await verifyPackage(inputs.installed, { commit: baseline.sourceCommit, filesSha256: hash(await readFile(path.join(inputs.installed, 'SHA256.json'))) }, inputs.installed, baseline);
  for (const file of ['Open-Caja.ps1', 'auto-update.mjs', 'Extract-POS-Update.ps1']) await normalPath(path.join(inputs.bootstrap, file));
  const privateFiles = [inputs.config, inputs.key, inputs.support, inputs.approval, inputs.manifest, inputs.reporter, inputs.shortcut,
    await normalPath(config.PrintDataDirectory, true), await normalPath(config.ReceiptIssuerFile),
    await normalPath(config.BackupDirectory || path.join(path.dirname(inputs.config), 'pos-cafe-backups'), true),
    await normalPath(config.BackupRecoveryKeyFile || path.join(path.dirname(inputs.config), 'pos-cafe-backup-recovery.key'))];
  if (config.ClipTokenFile) privateFiles.push(await normalPath(config.ClipTokenFile));
  for (const file of privateFiles) {
    for (const folder of [inputs.installed, inputs.bootstrap, inputs.config + '.updates']) assert.ok(!inside(folder, file), 'Private files must remain outside version/update folders.');
  }
  assert.equal(config.RequireExistingPrintJournal, true, 'The original print journal must be required.');
  assert.equal(config.PrintMode, 'windows', 'Enroll the real Windows printing configuration.');
  assert.equal(printJournalIdle(config), true, 'The existing print journal is absent, unreadable or unresolved.');
  assert.equal(await services.portUnused(config.Port || 3000), true, 'Close Caja through its owner before enrollment.');
  assert.equal(await services.idle(config), true, 'The backend idle RPC is missing, unavailable or busy. No SQL was applied.');
  const machineSha256 = await services.machine();
  const support = await json(inputs.support);
  assert.equal(support.format, 'pos-cafe-support-v1');
  assert.match(support.machineSha256 || '', sha, 'The real PC report has not been independently accepted.');
  assert.equal(support.machineSha256, machineSha256, 'The accepted report belongs to another machine.');
  assert.notEqual(support.developmentMachineSha256, machineSha256, 'Development PCs cannot enroll as the store.');
  assert.equal(support.backendIdentitySha256, backendIdentitySha256);
  assert.match(support.repository || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(support.publisher || '', /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, 'The accepted report publisher is required.');
  const reporter = await json(inputs.reporter);
  assert.equal(reporter.protocol, 3, 'Use the accepted existing private reporter.');
  assert.equal(reporter.MachineSha256, machineSha256);
  assert.equal(reporter.BackendIdentitySha256, backendIdentitySha256);
  assert.equal(reporter.Repository, support.repository);
  assert.equal(reporter.PublisherLogin, support.publisher);
  assert.equal(path.resolve(reporter.ConfigPath).toLowerCase(), inputs.config.toLowerCase());
  if (options.enabling) assert.equal(path.resolve(reporter.InstallDirectory).toLowerCase(), inputs.bootstrap.toLowerCase(),
    'Rebind the existing reporter with its guarded -ActualizarRutaCaja installer before accepting the bootstrap report.');
  const approval = await json(inputs.approval);
  assert.equal(approval.format, 'pos-cafe-enrollment-approval-v1');
  assert.ok(typeof approval.independentReviewer === 'string' && approval.independentReviewer.trim(), 'Record independent final package acceptance.');
  assert.equal(recent(approval.approvedAt, now), true, 'Use a fresh independently reviewed enrollment approval.');
  const expected = { machineSha256, backendIdentitySha256, installedCommit: baseline.sourceCommit,
    bootstrapCommit: candidate.sourceCommit, bootstrapFilesSha256: signed.filesSha256, publicKeySha256 };
  for (const [field, value] of Object.entries(expected)) assert.equal(approval[field], value, `Approval ${field} differs.`);
  const migrations = async folder => (await json(path.join(folder, 'SHA256.json'))).filter(entry => entry.file.startsWith('database-migrations/')).sort((a, b) => a.file.localeCompare(b.file));
  const changedDatabaseContract = JSON.stringify(await migrations(inputs.installed)) !== JSON.stringify(await migrations(inputs.bootstrap));
  if (changedDatabaseContract) assert.equal(approval.databaseMaintenanceAccepted, true, 'Bootstrap schema changes require separately accepted maintenance. This command never applies SQL.');
  const reportUrl = new URL(approval.reportUrl);
  const reportMatch = reportUrl.pathname.match(/^\/([^/]+\/[^/]+)\/issues\/[1-9][0-9]*$/);
  const commentMatch = reportUrl.hash.match(/^#issuecomment-([1-9][0-9]*)$/);
  assert.ok(reportUrl.origin === 'https://github.com' && reportMatch?.[1] === support.repository && commentMatch && !reportUrl.search, 'Use the exact authenticated private report comment URL.');
  const destination = await services.gh([`repos/${support.repository}`]);
  assert.equal(destination.private, true, 'The support report destination must be private.');
  await services.gh(['repos/jorgecantu276/pos-cafe']);
  const reportComment = await services.gh([`repos/${support.repository}/issues/comments/${commentMatch[1]}`]);
  assert.equal(reportComment.user?.login, support.publisher, 'The report publisher is unexpected.');
  assert.equal(reportComment.html_url, approval.reportUrl, 'The selected report URL differs.');
  const blocks = [...String(reportComment.body || '').matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length, 1, 'The private report must contain one diagnostic JSON record.');
  const report = JSON.parse(blocks[0][1]);
  assert.equal(report.product, 'cafe');
  assert.equal(report.machineSha256, machineSha256);
  assert.equal(report.backendIdentitySha256, backendIdentitySha256);
  assert.equal(recent(report.checkedAtUtc, now), true, 'A fresh actual-PC report is required.');
  assert.equal(report.release?.commit, options.enabling ? candidate.sourceCommit : baseline.sourceCommit, 'The actual reported installation differs.');
  assert.equal(report.release?.sourceDirty, false);
  assert.equal(report.release?.fixtureOnly, false);
  if (options.enabling) assert.equal(report.release?.source, 'verified_server', 'Enable only after the enrolled bootstrap has run and reported its verified identity.');
  const shortcut = await services.readShortcut(inputs.shortcut);
  const desired = shortcutFor(inputs.bootstrap, inputs.config, shortcut);
  const alreadyManaged = shortcut.target.toLowerCase() === desired.target.toLowerCase() && shortcut.arguments === desired.arguments;
  if (!alreadyManaged) {
    const knownLaunchers = ['Start-POS.ps1', 'Open-Caja.ps1'].map(name => path.join(inputs.installed, name));
    const knownDirect = ['Open-POS.cmd', 'Open-Caja.ps1'].some(name => path.join(inputs.installed, name).toLowerCase() === shortcut.target.toLowerCase());
    const managedPowerShell = shortcut.target.toLowerCase() === shell.toLowerCase() &&
      knownLaunchers.some(file => shortcut.arguments.toLowerCase().includes(`-file "${file}"`.toLowerCase())) &&
      shortcut.arguments.toLowerCase().includes(`-configpath "${inputs.config}"`.toLowerCase());
    assert.ok(knownDirect || managedPowerShell, 'Unknown shortcut ownership; leave it intact.');
  }
  if (options.enabling) {
    assert.equal(alreadyManaged, true, 'Supervised bootstrap enrollment must establish the fixed shortcut first.');
    assert.equal(config.AutoUpdatePublicKeyFile, inputs.key);
  }
  const bindings = {};
  for (const [field, file] of Object.entries(inputs)) if (!['installed', 'bootstrap'].includes(field)) bindings[field] = hash(await readFile(file));
  return { format: 'pos-cafe-enrollment-plan-v1', createdAt: new Date(now).toISOString(), inputs, bindings,
    ...expected, changedDatabaseContract, reportUrl: approval.reportUrl, enabling: options.enabling === true,
    shortcut, desiredShortcut: desired, autoUpdate: config.AutoUpdate === true, actions: options.enabling ? ['enable-compatible-updates'] : ['bind-fixed-shortcut', 'keep-auto-update-off'],
    scope: 'Procedural independent acceptance is supplied separately; no database migration, download, launch or business data change.' };
}

async function sameFile(file, expected) {
  assert.equal(hash(await readFile(file)), expected, 'A bound file changed; inspect and review a new plan.');
}

/** Changes only config and the existing shortcut, after fresh complete validation. */
export async function applyEnrollment(plan, receiptFile, dependencies = {}) {
  assert.equal(plan.format, 'pos-cafe-enrollment-plan-v1');
  assert.equal(typeof plan.enabling, 'boolean', 'The plan must name its enrollment operation.');
  assert.equal(recent(plan.createdAt, Date.now()), true, 'The enrollment plan expired.');
  const receipt = path.resolve(receiptFile);
  await normalPath(path.dirname(receipt), true);
  for (const folder of [plan.inputs.installed, plan.inputs.bootstrap, plan.inputs.config + '.updates']) assert.ok(!inside(folder, receipt), 'Keep enrollment evidence outside version folders.');
  assert.ok(!Object.values(plan.inputs).includes(receipt), 'The receipt cannot replace an input.');
  const lockPath = plan.inputs.config + '.enrollment.lock';
  let configChanged = false, shortcutChanged = false, changedConfigHash, changedShortcutHash;
  const originalConfig = await readFile(plan.inputs.config), originalShortcut = await readFile(plan.inputs.shortcut);
  const configTemporary = plan.inputs.config + '.enrollment-' + randomUUID();
  const shortcutTemporary = plan.inputs.shortcut + '.enrollment-' + randomUUID() + '.lnk';
  let receiptOwned = false;
  const lock = await import('node:fs/promises').then(fs => fs.open(lockPath, 'wx'));
  try {
    const current = await inspectEnrollment({ ...plan.inputs, enabling: plan.enabling }, dependencies);
    assert.deepEqual(current.bindings, plan.bindings, 'Bound inputs changed after review.');
    assert.deepEqual(current.desiredShortcut, plan.desiredShortcut, 'The shortcut changed after review.');
    for (const field of ['machineSha256', 'backendIdentitySha256', 'installedCommit', 'bootstrapCommit', 'bootstrapFilesSha256', 'publicKeySha256', 'reportUrl', 'changedDatabaseContract']) {
      assert.equal(current[field], plan[field], `The plan ${field} changed after review.`);
    }
    const backup = receipt + '.previous.json';
    // Windows ignores POSIX mode bits. Apply the original config's access ACL
    // while both files are empty, before writing any client credential bytes.
    await writeFile(backup, '', { flag: 'wx', mode: 0o600 });
    await (dependencies.copyAcl || native.copyAcl)(plan.inputs.config, backup);
    await writeFile(backup, JSON.stringify({ configBase64: originalConfig.toString('base64'), shortcutBase64: originalShortcut.toString('base64') }));
    await writeFile(receipt, JSON.stringify({ format: 'pos-cafe-enrollment-receipt-v1', state: 'prepared', backup }), { flag: 'wx', mode: 0o600 });
    receiptOwned = true;
    const config = JSON.parse(originalConfig.toString('utf8').replace(/^\uFEFF/, ''));
    const updated = { ...config, AutoUpdate: plan.enabling === true, AutoUpdatePublicKeyFile: plan.inputs.key };
    const configBytes = Buffer.from(JSON.stringify(updated, null, 2) + '\n');
    changedConfigHash = hash(configBytes);
    await writeFile(configTemporary, '', { flag: 'wx', mode: 0o600 });
    await (dependencies.copyAcl || native.copyAcl)(plan.inputs.config, configTemporary);
    await writeFile(configTemporary, configBytes);
    if (!plan.enabling) {
      await (dependencies.writeShortcut || native.writeShortcut)(shortcutTemporary, plan.desiredShortcut);
      await (dependencies.copyAcl || native.copyAcl)(plan.inputs.shortcut, shortcutTemporary);
      changedShortcutHash = hash(await readFile(shortcutTemporary));
    }
    await sameFile(plan.inputs.config, plan.bindings.config);
    await sameFile(plan.inputs.shortcut, plan.bindings.shortcut);
    await rename(configTemporary, plan.inputs.config); configChanged = true;
    if (!plan.enabling) { await rename(shortcutTemporary, plan.inputs.shortcut); shortcutChanged = true; }
    const result = { format: 'pos-cafe-enrollment-receipt-v1', state: plan.enabling ? 'enabled' : 'enrolled-auto-update-off',
      completedAt: new Date().toISOString(), machineSha256: plan.machineSha256, backendIdentitySha256: plan.backendIdentitySha256,
      installedCommit: plan.installedCommit, bootstrapCommit: plan.bootstrapCommit, publicKeySha256: plan.publicKeySha256,
      reportUrl: plan.reportUrl, configSha256: changedConfigHash, shortcutSha256: shortcutChanged ? changedShortcutHash : plan.bindings.shortcut,
      backup, nextGate: plan.enabling ? 'Observe one exact signed compatible update and recovery.' : 'Use the existing support installer -ActualizarRutaCaja to bind this bootstrap, run the fixed shortcut, accept its genuine verified report, then inspect an enable plan.' };
    await writeFile(receipt, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } catch (error) {
    if (shortcutChanged) { await sameFile(plan.inputs.shortcut, changedShortcutHash); await writeFile(plan.inputs.shortcut, originalShortcut); }
    if (configChanged) { await sameFile(plan.inputs.config, changedConfigHash); await writeFile(plan.inputs.config, originalConfig); }
    if (receiptOwned) await writeFile(receipt, JSON.stringify({ format: 'pos-cafe-enrollment-receipt-v1', state: 'rolled-back', completedAt: new Date().toISOString() }));
    throw error;
  } finally {
    await unlink(configTemporary).catch(() => {}); await unlink(shortcutTemporary).catch(() => {});
    await lock.close(); await unlink(lockPath);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    assert.equal(process.platform, 'win32', 'Cafe enrollment runs on the actual Windows POS.');
    const [command, ...args] = process.argv.slice(2);
    const values = {};
    for (let index = 0; index < args.length; index += 2) {
      assert.match(args[index], /^--[a-z]+$/); assert.ok(args[index + 1]);
      const name = args[index].slice(2); assert.equal(values[name], undefined, 'Duplicate option.'); values[name] = args[index + 1];
    }
    if (command === 'inspect' || command === 'inspect-enable') {
      assert.ok(values.output && path.isAbsolute(values.output), 'Choose a new private absolute plan output file.');
      const plan = await inspectEnrollment({ ...values, enabling: command === 'inspect-enable' });
      for (const folder of [plan.inputs.installed, plan.inputs.bootstrap, plan.inputs.config + '.updates']) assert.ok(!inside(folder, values.output), 'Keep the plan outside version folders.');
      await writeFile(values.output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ state: 'ready-for-supervised-application', autoUpdate: plan.autoUpdate, actions: plan.actions, plan: values.output }));
    } else if (command === 'apply') {
      assert.ok(values.plan && values.receipt && path.isAbsolute(values.plan) && path.isAbsolute(values.receipt));
      const result = await applyEnrollment(await json(values.plan), values.receipt);
      console.log(JSON.stringify({ state: result.state, nextGate: result.nextGate }));
    } else throw Error('Use inspect, inspect-enable or apply; see docs/cafe-enrollment.md.');
  } catch (error) { console.error('Cafe enrollment refused: ' + error.message); process.exitCode = 1; }
}
