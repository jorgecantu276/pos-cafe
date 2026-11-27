import { cpSync, existsSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!existsSync(path.join(repository, 'node_modules'))) throw new Error('Run npm ci before verifying the build.');
const stage = mkdtempSync(path.join(repository, '.build-check-'));
const excluded = new Set(['.git', '.next', '.staging-local', '.print-data', 'node_modules', 'next-env.d.ts', 'tsconfig.tsbuildinfo']);
for (const entry of readdirSync(repository)) {
  if (excluded.has(entry) || entry.startsWith('.build-check-')) continue;
  cpSync(path.join(repository, entry), path.join(stage, entry), { recursive: true });
}
symlinkSync(path.join(repository, 'node_modules'), path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
console.log('Production build in an isolated directory:', stage);
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', '--webpack'], {
  cwd: stage, stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0 && process.env.POS_VERIFY_LAN === '1') {
  const smoke = spawnSync(process.execPath, ['--import', 'tsx', path.join(repository, 'scripts/testing/smoothies-lan-app.mjs'), stage], {
    cwd: repository, stdio: 'inherit', env: process.env,
  });
  if (smoke.error) throw smoke.error;
  process.exitCode = smoke.status ?? 1;
}
