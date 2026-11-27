// Temporary diagnostic only. This never executes the harness or changes test budgets.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'win32', 'Measure the Windows compiler only.');
const root = path.resolve(import.meta.dirname, '../..');
// JavaScript template literals normalize source CRLF to LF before String.raw.
const test = (await readFile(path.join(root, 'tests/hosted-docker-pipe.test.ts'), 'utf8')).replace(/\r\n?/g, '\n');
const match = test.match(/await writeFile\(harness, String\.raw`([\s\S]*?)`\);/g);
assert.equal(match?.length, 1, 'Extract exactly the actual test Harness source.');
const harnessSource = match[0].slice(match[0].indexOf('`') + 1, match[0].lastIndexOf('`'));
const directory = await mkdtemp(path.join(tmpdir(), 'pos-compiler-profile-'));
const harness = path.join(directory, 'Harness.cs'), executable = path.join(directory, 'Harness.exe');
await writeFile(harness, harnessSource);
const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const args = ['/nologo', '/target:exe', '/main:Harness', `/out:${executable}`,
  path.join(root, 'scripts/testing/WslDockerPipe.cs'), harness];

async function measure(attempt) {
  const started = performance.now();
  const streams = { stdout: { bytes: 0, hash: createHash('sha256') }, stderr: { bytes: 0, hash: createHash('sha256') } };
  return new Promise(resolve => {
    const child = spawn(compiler, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false, exitCode = null, signal = null, spawnError = false, rootExited = false, timedOut = false, terminationTimer;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(terminationTimer);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      const report = { diagnosticOnly: true, attempt, budgetMs: 30_000,
        elapsedMs: Math.round(performance.now() - started), exitCode, signal, rootExited,
        rootTerminationConfirmed: rootExited, timedOut, spawnError,
        stdoutBytes: streams.stdout.bytes, stdoutSha256: streams.stdout.hash.digest('hex'),
        stderrBytes: streams.stderr.bytes, stderrSha256: streams.stderr.hash.digest('hex') };
      console.log(JSON.stringify(report)); resolve(report);
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      if (rootExited || !child.pid) { finish(); return; }
      // Confirm only this compiler root's exit before another compilation may
      // reuse its output. An unconfirmed termination ends the measurement.
      terminationTimer = setTimeout(finish, 2_000);
      try { child.kill(); } catch { /* The bounded exit check remains authoritative. */ }
    }, 30_000);
    for (const name of ['stdout', 'stderr']) child[name].on('data', bytes => {
      if (!settled) { streams[name].bytes += bytes.length; streams[name].hash.update(bytes); }
    });
    child.once('error', () => { spawnError = true; finish(); });
    child.once('exit', (code, why) => {
      rootExited = true; exitCode = code; signal = why;
      if (timedOut) finish();
    });
    child.once('close', finish);
  });
}

// No cache purge or machine configuration: these labels mean observed order only.
const first = await measure('first-invocation');
const results = [first];
if (first.rootTerminationConfirmed) results.push(await measure('second-invocation'));
else console.log(JSON.stringify({ diagnosticOnly: true, attempt: 'second-invocation', skipped: 'first-root-termination-unconfirmed' }));
if (results.some(result => result.timedOut || result.spawnError || result.exitCode !== 0)) process.exitCode = 1;
