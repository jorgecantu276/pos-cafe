import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('actual acceptance stop flags keep an unchanged launcher failure headless and preserve its original diagnosis', { skip: process.platform !== 'win32' }, async () => {
  const acceptance = await readFile(path.resolve('scripts/smoothies/acceptance.mjs'), 'utf8');
  const call = acceptance.match(/const stop = \(\) => execFileSync\(powershell, \[\.\.\.ps, path\.join\(fixture, 'Launch-Smoothies\.ps1'\),([^\]]+)\]/);
  assert.ok(call, 'Extract the actual harness stop invocation before launching any fixture.');
  const flags = [...call[1].matchAll(/'(-[A-Za-z]+)'/g)].map(match => match[1]);
  // Fail BEFORE running production code if its GUI-suppression flag disappears.
  assert.ok(flags.includes('-Background'), 'Automated stop must never enter the modal GUI branch.');
  assert.ok(flags.includes('-Stop'));
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-headless-stop-'));
  const launcher = path.join(directory, 'Launch-Smoothies.ps1');
  await copyFile(path.resolve('scripts/smoothies/Launch-Smoothies.ps1'), launcher);
  // There is deliberately no release.json or bundled Node. The real launcher
  // fails before reading configuration, contacting a backend or stopping an app.
  const powershell = path.join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  let failure: { code?: string | number; killed?: boolean } | undefined;
  try {
    await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher, ...flags],
      { windowsHide: true, timeout: 10_000 });
  } catch (error) { failure = error as typeof failure; }
  assert.equal(failure?.code, 1, 'The actual launcher must return its original failure promptly.');
  assert.ok(!failure?.killed, 'A deadline must not be mistaken for a headless return.');
  const log = await readFile(path.join(directory, 'diagnostico/inicio.log'), 'utf8');
  assert.ok(log.includes('release.json'), 'The original missing-release diagnosis must remain in the owned launcher log.');
});
