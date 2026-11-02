import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { baselineStatements, fingerprint, project } from './safety.mjs';
import { root, work } from './runtime.mjs';

export async function sourceFiles() {
  const snapshot = await readFile(path.join(root, 'supabase/schema.snapshot.json'), 'utf8');
  const migration = (await Promise.all(['202610280001_secure_pos.sql','202610280002_shift_expenses.sql','202610280004_reports.sql','202610300005_single_drawer.sql','202610300006_loyalty_phone.sql','202610300007_safe_drawer_rate.sql','202610300008_employee_drawer_recovery.sql','202610300009_customer_correction.sql','202610300010_register_shortcuts.sql','202610300011_recent_tickets.sql','202610300012_business_backups.sql','202611020013_catalog_requests.sql','202611020014_customer_history.sql','202611020015_order_pager.sql','202611020016_clip_payments.sql','202611020017_inventory.sql']
    .map(file => readFile(path.join(root, 'supabase/migrations', file), 'utf8')))).join('\n');
  return { snapshot, migration, hash: fingerprint(snapshot, migration) };
}
export async function verifyIdentity(db) {
  const marker = await db.query("select to_regclass('cafe_private.staging_identity') present");
  assert.ok(marker.rows[0].present, 'Missing staging marker; run staging:start first');
  const { rows: [identity] } = await db.query('select * from cafe_private.staging_identity');
  const source = await sourceFiles();
  assert.equal(identity.project, project);
  assert.equal(identity.source_hash, source.hash, 'Candidate migration/snapshot changed: reconcile staging explicitly');
  assert.equal(identity.ready, true, 'Incomplete bootstrap; inspect local staging before retrying');
  return source;
}

export async function bootstrap(config) {
  const db = new Client({ connectionString: config.database });
  await db.connect();
  try {
    const marker = (await db.query("select to_regclass('cafe_private.staging_identity') present")).rows[0].present;
    if (marker) { await verifyIdentity(db); console.log('Existing synthetic staging identity verified.'); return; }
    assert.equal(Number((await db.query("select count(*) n from pg_tables where schemaname='public'")).rows[0].n), 0, 'Bootstrap requires an empty public schema');
    assert.equal(Number((await db.query('select count(*) n from auth.users')).rows[0].n), 0, 'Bootstrap requires an empty Auth directory');
    const source = await sourceFiles();
    await db.query('begin');
    try {
      await db.query(`create schema cafe_private;
        revoke all on schema cafe_private from public,anon,authenticated;
        create table cafe_private.staging_identity(project text primary key, source_hash text not null, ready boolean not null);
        revoke all on cafe_private.staging_identity from public,anon,authenticated;`);
      await db.query('insert into cafe_private.staging_identity values($1,$2,false)', [project, source.hash]);
      for (const statement of baselineStatements(JSON.parse(source.snapshot))) await db.query(statement);
      await db.query('commit');
    } catch (error) { await db.query('rollback'); throw error; }
    const service = createClient(config.api, config.service, { auth: { persistSession: false, autoRefreshToken: false } });
    const password = randomBytes(24).toString('base64url');
    const { data, error } = await service.auth.admin.createUser({ email: 'stage_admin@carinitomio.local', password, email_confirm: true });
    if (error) throw error;
    assert.ok(data.user);
    await db.query("insert into public.profiles(id,full_name,username,role) values($1,'Administrador de prueba local','stage_admin','admin')", [data.user.id]);
    await db.query(source.migration);
    await writeFile(path.join(work, 'credentials.json'), JSON.stringify({ admin: { id: data.user.id, username: 'stage_admin', password } }), { mode: 0o600 });
    await db.query('update cafe_private.staging_identity set ready=true where project=$1', [project]);
    await verifyIdentity(db);
    console.log('Synthetic baseline, real Auth administrator and candidate migration installed locally.');
  } finally { await db.end(); }
}
