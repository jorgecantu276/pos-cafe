import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshLocalApi } from './local-api.mjs';

// A new owned empty Auth/Storage stack. No linked project, existing database,
// production credentials, physical printer or payment provider is consulted.
const local = await freshLocalApi({ portBase: 55541, storage: true });
try {
  const { data, error } = await local.service.auth.admin.createUser({ email: 'storage_fixture_admin@fixture.invalid', password: randomUUID() + '!', email_confirm: true });
  assert.ifError(error);
  await local.db.query('insert into profiles(id,username,full_name,role) values($1,$2,$3,$4)', [data.user.id, 'storage_fixture_admin', 'Storage fixture administrator', 'admin']);
  await local.install();
  const bucket = (await local.db.query("select public,file_size_limit from storage.buckets where id='catalog-photos'")).rows;
  assert.equal(bucket.length, 1);
  assert.equal(bucket[0].public, true);
  assert.equal(Number(bucket[0].file_size_limit), 5242880);
  assert.equal(Number((await local.db.query("select count(*) n from pg_policies where schemaname='storage' and policyname='Catalog administrators can upload photos'")).rows[0].n), 1);
  const inventory = (await local.db.query("select pg_get_functiondef('public.pos_inventory_write(uuid,jsonb,uuid)'::regprocedure) body")).rows[0].body;
  assert.ok(inventory.includes('PIV01'), 'Latest application recovery migration must accompany the Storage platform contract.');
  console.log(JSON.stringify({ passed: true, freshOwnedStack: true, catalogStorageMigration: true, latestInventoryRecovery: true, liveWrites: false }));
} finally { await local.cleanup(); }
