import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile, readdir, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execute = promisify(execFile), repository = path.resolve(import.meta.dirname, '..');
test('vendored transport is pinned to its shared private operations source without another publication workflow', async () => {
  const bytes = await readFile(path.join(repository, 'scripts/smoothies/SupportTransport.psm1'));
  const origin = JSON.parse(await readFile(path.join(repository, 'scripts/smoothies/support-transport-origin.json'), 'utf8'));
  assert.equal(origin.sourceRepository, 'jorgecantu276/punto-demo'); assert.equal(origin.sourcePath, 'ops/reporting/SupportTransport.psm1');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), origin.sha256);
});

test('actual PS5.1 Smoothies opt-in/reporting uses shared idempotent private transport with mocked GitHub and Scheduler',
  { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'smoothies reporting ')), id = '0123456789abcdef';
    const installed = path.join(root, 'versiones', id), app = path.join(installed, 'app');
    try {
      await mkdir(app, { recursive: true });
      await link(process.execPath, path.join(installed, 'node.exe')).catch(() => copyFile(process.execPath, path.join(installed, 'node.exe')));
      for (const file of ['scripts/smoothies/support-report.mjs','scripts/smoothies/SmoothiesSupport.psm1','scripts/smoothies/SupportTransport.psm1',
        'scripts/customer/lan.mjs','lib/business-backup-format.mjs','lib/business-backup-export.mjs']) {
        await mkdir(path.dirname(path.join(app, file)), { recursive: true }); await copyFile(path.join(repository, file), path.join(app, file));
      }
      const release = { version: 1, product: 'smoothies', id, sourceDirty: false, familySourceDirty: false, appVersion: '1.0.0-rc.6', sourceCommit: 'a'.repeat(40) };
      await writeFile(path.join(root, 'release.json'), JSON.stringify(release)); await writeFile(path.join(installed, 'release.json'), JSON.stringify(release));
      await writeFile(path.join(root, 'caja.env'), 'SMOOTHIES_API_URL=http://127.0.0.1:58000/\nSMOOTHIES_ANON_KEY=PUBLIC-ANON-CANARY\nSMOOTHIES_SERVICE_KEY=PRIVATE-SERVICE-CANARY\n');
      const beforeSettings = await readFile(path.join(root, 'caja.env'));
      await assert.rejects(execute(process.execPath, [path.join(app, 'scripts/smoothies/support-report.mjs'), installed], { windowsHide: true }));
      assert.equal(await lstat(path.join(installed, 'diagnostico')).catch(() => null), null, 'Immutable package cannot become a diagnostic destination.');
      await mkdir(path.join(installed, 'forbidden-data')); await symlink(installed, path.join(root, 'package-alias'), 'junction');
      await assert.rejects(execute(process.execPath, [path.join(app, 'scripts/smoothies/support-report.mjs'), path.join(root, 'package-alias/forbidden-data')], { windowsHide: true }));
      assert.equal(await lstat(path.join(installed, 'forbidden-data/diagnostico')).catch(() => null), null, 'A parent junction cannot disguise an immutable package destination.');
      const shell = path.join(process.env.WINDIR || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const result = await execute(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repository, 'tests/fixtures/smoothies-support-cycle.ps1'), '-Root', root, '-RepositoryRoot', repository], {
        windowsHide: true, timeout: 55_000, env: { ...process.env, SMOOTHIES_API_URL: 'https://ambient.invalid', SMOOTHIES_ANON_KEY: 'AMBIENT-DO-NOT-USE', PSModulePath: path.join(path.dirname(shell), 'Modules') },
      });
      assert.match(result.stdout, /disabled\/null placeholder performs no live setup/);
      assert.match(result.stdout, /unknown acknowledgment reconciles one private issue\/comment/);
      assert.match(result.stdout, /two machines sharing a device label refuse remote binding mismatch/);
      assert.match(result.stdout, /changed machine\/public\/account\/foreign-comment\/schema\/task refusals/);
      assert.deepEqual(JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8')), release);
      assert.deepEqual(await readFile(path.join(root, 'caja.env')), beforeSettings);
      const enrolled = JSON.parse(await readFile(path.join(root, 'soporte/reporting.json'), 'utf8'));
      const digest = (value: string) => createHash('sha256').update(value).digest('hex');
      assert.equal(enrolled.backendIdentitySha256, digest('http://127.0.0.1:58000\n' + digest('PUBLIC-ANON-CANARY')));
      assert.ok(!(await readdir(path.join(root, 'soporte/state'))).some(name => name.startsWith('request-')), 'Transient request files are removed.');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
