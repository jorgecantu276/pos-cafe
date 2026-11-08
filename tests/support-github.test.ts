import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('GitHub support preserves the journal, excludes secrets and rejects invalid destinations', { skip: process.platform !== 'win32' }, () => {
  const shellDirectory = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0');
  const output = execFileSync(path.join(shellDirectory, 'powershell.exe'), ['-NoProfile', '-File', path.resolve('scripts/support/test-support-kit.ps1')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, PSModulePath: path.join(shellDirectory, 'Modules') },
  });
  assert.match(output, /secrets\/log content excluded/);
  assert.match(output, /public destination rejected/);
  assert.match(output, /private issue target validated/);
  assert.match(output, /unknown send outcome preserves report and journal/);
});

test('automatic GitHub monitor recovers acknowledgments and preserves owned status identity', { skip: process.platform !== 'win32' }, () => {
  const shellDirectory = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0');
  const output = execFileSync(path.join(shellDirectory, 'powershell.exe'), ['-NoProfile', '-File', path.resolve('scripts/support/test-monitor.ps1')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, PSModulePath: path.join(shellDirectory, 'Modules') },
  });
  assert.match(output, /automatic heartbeat reuses one issue\/comment/);
  assert.match(output, /overlapping cycles rejected/);
  assert.match(output, /task XML repeats every 15 minutes/);
  assert.match(output, /installer copies outside POS, registers once/);
});
