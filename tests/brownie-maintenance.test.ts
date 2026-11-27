import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('catalog CLI binds the actual pg connection to the validated project and verified TLS', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'brownie-connection-'));
  const driver = path.join(fixture, 'backup-tools/node_modules/pg');
  await mkdir(driver, { recursive: true });
  await writeFile(path.join(driver, 'index.js'), `exports.Client=class {
    constructor(options){require('node:fs').writeFileSync(process.env.BROWNIE_OPTIONS,JSON.stringify(options));}
    async connect(){} async query(){return {rows:[]};} async end(){}
  };`);
  const optionsFile = path.join(fixture, 'options.json');
  const run = (url: string) => spawnSync(process.execPath, ['scripts/catalog/brownie-syrup-cli.mjs', 'Plan', fixture,
    'https://correct.supabase.co', path.join(fixture, 'plan.json')], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, POS_CATALOG_DATABASE_URL: url, BROWNIE_OPTIONS: optionsFile } });
  for (const override of ['host=db.other.supabase.co', 'user=postgres.other', 'sslmode=disable']) {
    const result = run('postgresql://postgres.correct:synthetic@aws.pooler.supabase.com/postgres?' + override);
    assert.equal(result.status, 1); assert.match(result.stderr, /sobrescribir.*TLS/);
  }
  await assert.rejects(readFile(optionsFile), { code: 'ENOENT' });
  const result = run('postgresql://postgres.correct:synthetic@aws.pooler.supabase.com:6543/postgres?sslmode=require');
  assert.equal(result.status, 1); assert.match(result.stderr, /No hay brownies/);
  const options = JSON.parse(await readFile(optionsFile, 'utf8'));
  assert.equal(options.host, 'aws.pooler.supabase.com'); assert.equal(options.user, 'postgres.correct');
  assert.equal(options.port, 6543); assert.equal(options.database, 'postgres');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true }); assert.equal(options.connectionString, undefined);
});
