import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrationContract } from '../scripts/testing/migrations.mjs';
import { nextAcceptanceVersion } from '../scripts/smoothies/acceptance-version.mjs';
import { compareVersions } from '../scripts/smoothies/auto-update.mjs';

test('application fixtures include every current application migration and declare Storage exclusion', async () => {
  const all = (await readdir(path.resolve('supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  const application = await migrationContract();
  assert.deepEqual(application.files, all.filter(name => name !== '202611020022_catalog_photos.sql'));
  assert.deepEqual(application.omittedPlatformMigrations, ['202611020022_catalog_photos.sql']);
  assert.ok(application.files.includes('202611050023_alternative_milk_choice.sql'));
  const platform = await migrationContract({ storage: true });
  assert.deepEqual(platform.files, all);
  assert.match(platform.migration, /insert into storage\.buckets/);
  assert.equal(application.migration.includes('insert into storage.buckets'), false);
});

test('a new forward migration reaches HTTP fixture contract without a copied list edit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-migration-contract-'));
  try {
    await writeFile(path.join(directory, '202611010001_original.sql'), 'select 1;');
    await writeFile(path.join(directory, '202611020022_catalog_photos.sql'), 'select 2;');
    await writeFile(path.join(directory, '202611250025_forward.sql'), 'select 3;');
    const contract = await migrationContract({ directory });
    assert.deepEqual(contract.files, ['202611010001_original.sql', '202611250025_forward.sql']);
    assert.equal(contract.migration, 'select 1;\nselect 3;');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('synthetic update candidate is newer than the supplied baseline without changing family versions', async () => {
  const configured = JSON.parse(await readFile(path.resolve('config/pos-versions.json'), 'utf8'));
  for (const baseline of [configured.version, '1.0.0-rc.4', '1.0.0-rc.6', '1.0.0-rc.99', '1.0.0', '1.2.3']) {
    assert.equal(compareVersions(nextAcceptanceVersion(baseline), baseline) > 0, true);
  }
  assert.throws(() => nextAcceptanceVersion('latest'));
});
