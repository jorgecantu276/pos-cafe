import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('existing loopback launcher translates only explicitly attested hosted-WSL fixture mounts and preserves port refusal', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-wsl-launcher-'));
  const run = promisify(execFile), compiler = path.join(process.env.WINDIR!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const launcher = path.join(directory, 'docker.exe'), echo = path.join(directory, 'capture.exe'), source = path.join(directory, 'capture.cs');
  await writeFile(source, 'using System; using System.Text; class Capture { static void Main(string[] args) { foreach(var a in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(a))); } }');
  await run(compiler, ['/nologo', '/target:exe', `/out:${echo}`, source], { windowsHide: true });
  await run(compiler, ['/nologo', '/target:exe', `/out:${launcher}`, path.resolve('scripts/staging/docker-loopback.cs')], { windowsHide: true });
  await run(launcher, ['--pos-cafe-self-test'], { windowsHide: true });
  const args = ['create', '-p', '55451:8000', '-v', String.raw`C:\Owned Space\roles.sql:/init/roles.sql:ro`, String.raw`--mount=type=bind,src=D:\owned\gateway.yml,target=/gateway.yml,readonly`, 'fixture-image'];
  const invoke = async (overrides: Record<string, string>) => {
    const response = await run(launcher, args, { windowsHide: true, env: { ...process.env, POS_CAFE_REAL_DOCKER: echo, POS_TEST_WSL_ENGINE: '', ...overrides } });
    return response.stdout.trim().split(/\r?\n/).map(value => Buffer.from(value, 'base64').toString('utf8'));
  };
  const ordinary = await invoke({});
  assert.equal(ordinary[2], '127.0.0.1:55451:8000'); assert.equal(ordinary[4], args[4]);
  const hosted = await invoke({ POS_TEST_WSL_ENGINE: '1', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' });
  assert.equal(hosted[2], '127.0.0.1:55451:8000');
  assert.equal(hosted[4], '/mnt/c/Owned Space/roles.sql:/init/roles.sql:ro');
  assert.equal(hosted[5], '--mount=type=bind,src=/mnt/d/owned/gateway.yml,target=/gateway.yml,readonly');
  await assert.rejects(invoke({ POS_TEST_WSL_ENGINE: '1', GITHUB_ACTIONS: '', RUNNER_ENVIRONMENT: '' }), /disposable hosted runner/);
  await assert.rejects(run(launcher, ['create', '-p', '58000:8000', 'fixture'], { windowsHide: true, env: { ...process.env, POS_CAFE_REAL_DOCKER: echo } }), /unexpected staging port/);
});
