import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const startupScript = path.resolve('scripts/windows/Start-POS.ps1');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(predicate: () => Promise<boolean> | boolean, message: string, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  assert.fail(message);
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('Windows launcher parses in PowerShell 5.1 and preserves one identified local process across reuse and bounded restarts', { skip: process.platform !== 'win32', timeout: 180_000 }, async () => {
  const parser = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
    foreach($file in @('scripts/windows/Start-POS.ps1','scripts/windows/Install-POS-shortcut.ps1')) {
      $tokens=$null; $errors=$null
      [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file),[ref]$tokens,[ref]$errors)|Out-Null
      if($errors.Count){throw ($errors|Out-String)}
    }
  `], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(parser.status, 0, parser.stderr);
  const wrapper = readFileSync('scripts/windows/Open-POS.cmd', 'utf8');
  assert.match(wrapper, /-File "%~dp0Start-POS.ps1" %\*/);
  assert.match(wrapper, /if errorlevel 1/);

  const scratch = mkdtempSync(path.join(tmpdir(), 'pos-startup-'));
  const release = path.join(scratch, 'release with spaces');
  mkdirSync(path.join(release, 'app'), { recursive: true });
  cpSync(startupScript, path.join(release, 'Start-POS.ps1'));
  cpSync('scripts/windows/Open-POS.cmd', path.join(release, 'Open-POS.cmd'));
  linkSync(process.execPath, path.join(release, 'node.exe'));
  const key = 'isolated-startup-fixture-public-key';
  writeFileSync(path.join(release, 'release.json'), JSON.stringify({ supabaseUrl: 'http://127.0.0.1:59999', publicKeySha256: createHash('sha256').update(key).digest('hex'), fixtureOnly: true, sourceCommit: 'fixture-only' }));
  writeFileSync(path.join(release, 'app/server.js'), `
    const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
    fs.mkdirSync(process.env.POS_PRINT_DATA_DIR,{recursive:true});
    fs.appendFileSync(path.join(process.env.POS_PRINT_DATA_DIR,'fixture-starts.jsonl'),JSON.stringify({pid:process.pid,journal:process.env.POS_PRINT_DATA_DIR,backup:process.env.POS_BACKUP_DIR,key:process.env.POS_BACKUP_KEY_FILE,contract:process.env.POS_DATABASE_CONTRACT_DIR,commit:process.env.POS_RELEASE_COMMIT})+'\\n');
    if(fs.existsSync(path.join(__dirname,'fail-fast')))process.exit(12);
    else http.createServer((request,response)=>{
      response.setHeader('Content-Type','application/json');
      if(request.url==='/api/local-instance')response.end(JSON.stringify({protocol:1,instanceToken:process.env.POS_LAUNCH_INSTANCE_TOKEN,processId:process.pid,releaseId:process.env.POS_LAUNCH_RELEASE_ID,configId:process.env.POS_LAUNCH_CONFIG_ID}));
      else response.end(JSON.stringify({name:'manifest-alone-is-not-identity'}));
    }).listen(Number(process.env.PORT),'127.0.0.1');
  `);
  const configPath = path.join(scratch, 'pos-cafe-config.json');
  const data = path.join(scratch, 'permanent journal');
  const config = { SupabaseUrl: 'http://127.0.0.1:59999', SupabaseAnonKey: key, Port: await availablePort(), PrintMode: 'mock', PrintDataDirectory: data };
  writeFileSync(configPath, JSON.stringify(config));
  const statePath = configPath + '.instance.json';
  const tracked = new Set<ChildProcess>();
  const readOwner = () => JSON.parse(readFileSync(statePath, 'utf8')) as { processId: number; configId: string; releaseId: string; instanceToken: string };
  const launch = (folder = release, useWrapper = false) => {
    const executable = useWrapper ? (process.env.ComSpec || 'C:/Windows/System32/cmd.exe') : powershell;
    const args = useWrapper ? ['/d', '/s', '/c', `""${path.join(folder, 'Open-POS.cmd')}" -NoBrowser"`] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(folder, 'Start-POS.ps1'), '-ConfigPath', configPath, '-NoBrowser'];
    const child = spawn(executable, args, { windowsHide: true, windowsVerbatimArguments: useWrapper, stdio: ['ignore', 'pipe', 'pipe'] });
    tracked.add(child);
    let output = '';
    child.stdout!.on('data', chunk => { output += chunk.toString(); });
    child.stderr!.on('data', chunk => { output += chunk.toString(); });
    const done = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => { tracked.delete(child); resolve({ code, output }); });
    });
    return { process: child, done, output: () => output };
  };
  const ready = async () => {
    try { return existsSync(statePath) && (await fetch(`http://127.0.0.1:${config.Port}/api/local-instance`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
  };
  const noListener = async () => {
    try { await fetch(`http://127.0.0.1:${config.Port}`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; }
  };
  let passed = false;
  try {
    const first = launch();
    await eventually(ready, 'Initial fixture startup did not become ready: ' + first.output());
    const original = readOwner();
    await eventually(() => first.output().includes('Caja disponible'), 'Launcher did not verify fixture identity: ' + first.output());
    const second = await launch(release, true).done;
    assert.equal(second.code, 0, second.output);
    assert.match(second.output, /ya estaba abierta/);
    assert.equal(readOwner().processId, original.processId, 'A second opening must reuse the existing process');

    const otherRelease = path.join(scratch, 'another release');
    mkdirSync(path.join(otherRelease, 'app'), { recursive: true });
    for (const file of ['Start-POS.ps1', 'release.json']) cpSync(path.join(release, file), path.join(otherRelease, file));
    linkSync(process.execPath, path.join(otherRelease, 'node.exe'));
    cpSync(path.join(release, 'app/server.js'), path.join(otherRelease, 'app/server.js'));
    const wrongRelease = await launch(otherRelease).done;
    assert.notEqual(wrongRelease.code, 0);
    assert.match(wrongRelease.output, /otra version o configuracion/);
    writeFileSync(configPath, JSON.stringify({ ...config, SupabaseServiceRoleKey: 'changed-fixture-value' }));
    const wrongConfig = await launch().done;
    assert.notEqual(wrongConfig.code, 0);
    assert.match(wrongConfig.output, /otra version o configuracion/);
    writeFileSync(configPath, JSON.stringify(config));

    process.kill(original.processId);
    await eventually(async () => existsSync(statePath) && readOwner().processId !== original.processId && await ready(), 'Unexpected exit did not restart the fixture: ' + first.output());
    await eventually(() => first.output().split('Caja disponible').length === 3, 'Restart was not verified: ' + first.output());
    const restarted = readOwner();
    assert.equal(restarted.configId, original.configId);
    assert.equal(restarted.releaseId, original.releaseId);
    const observations = readFileSync(path.join(data, 'fixture-starts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(observations.length, 2);
    for (const observation of observations) {
      assert.equal(observation.journal, data);
      assert.equal(observation.backup, path.join(scratch, 'pos-cafe-backups'));
      assert.equal(observation.key, path.join(scratch, 'pos-cafe-backup-recovery.key'));
      assert.equal(observation.contract, path.join(release, 'database-migrations'));
      assert.equal(observation.commit, 'fixture-only');
    }
    first.process.kill();
    await first.done;
    await eventually(noListener, 'Closing the launcher left its Node server listening');

    // An unrelated listener offers the old manifest signal. It must be left intact.
    const foreign = spawn(process.execPath, ['-e', `require('node:http').createServer((q,s)=>s.end('{"name":"POS"}')).listen(${config.Port},'127.0.0.1')`], { windowsHide: true, stdio: 'ignore' });
    tracked.add(foreign);
    await eventually(async () => !await noListener(), 'Foreign fixture did not start');
    const refused = await launch().done;
    assert.notEqual(refused.code, 0);
    assert.match(refused.output, /ocupado por otra aplicacion/);
    assert.equal(foreign.exitCode, null, 'An unrelated listener must not be stopped');
    foreign.kill();
    await new Promise(resolve => foreign.once('exit', resolve));
    tracked.delete(foreign);
    await eventually(noListener, 'Foreign fixture did not stop');

    writeFileSync(configPath, JSON.stringify({ ...config, BackupRecoveryKeyFile: path.join(scratch, 'pos-cafe-backups', 'bad.key') }));
    const badKeyPath = await launch().done;
    assert.notEqual(badKeyPath.code, 0);
    assert.match(badKeyPath.output, /clave de recuperacion fuera/);
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(path.join(release, 'app/fail-fast'), 'fixture');
    const failed = await launch().done;
    assert.notEqual(failed.code, 0);
    assert.match(failed.output, /tras 3 reintentos/);
    assert.equal((failed.output.match(/Reintentando en/g) || []).length, 3);
    assert.equal(readFileSync(path.join(data, 'fixture-starts.jsonl'), 'utf8').trim().split('\n').length, 6, 'Startup retry budget must be finite');
    assert.equal(existsSync(statePath), false, 'Failed owned state must be cleaned');
    await eventually(noListener, 'Retry exhaustion left a listener');
    passed = true;
  } finally {
    for (const child of tracked) if (child.exitCode === null) child.kill();
    if (passed) {
      // Delete only this completed synthetic fixture, after checking its resolved temp boundary.
      assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()));
      assert.ok(path.basename(scratch).startsWith('pos-startup-'));
      rmSync(scratch, { recursive: true });
    }
  }
});
