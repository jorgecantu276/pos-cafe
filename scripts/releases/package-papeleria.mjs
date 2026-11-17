import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packageVersion } from './version-info.mjs';

const [source, destination, mode, ...rest] = process.argv.slice(2);
assert.ok(process.platform === 'win32', 'Build the Papelería Windows package on Windows.');
assert.ok(source && destination && !rest.length && [undefined, '--demos'].includes(mode),
  'Use npm run release:papeleria -- <native checkout> <output directory> [--demos].');
const root = path.resolve(source);
const script = path.join(root, 'package-demos.ps1');
assert.ok(existsSync(path.join(root, 'scripts/read-family-release.ps1')), 'Use the Papelería checkout with family release support.');
const manifest = { version: 1, ...packageVersion('papeleria', root) };
const scratch = mkdtempSync(path.join(tmpdir(), 'pos-family-manifest-'));
const manifestPath = path.join(scratch, 'release.json');
try {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-OutputDirectory', path.resolve(destination), '-ReleaseManifest', manifestPath,
    ...(mode === '--demos' ? [] : ['-Operation']),
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Papelería packaging failed.');
} finally {
  try { if (existsSync(manifestPath)) unlinkSync(manifestPath); }
  finally { rmdirSync(scratch); }
}
