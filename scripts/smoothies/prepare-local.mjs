import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { baselineStatements } from '../staging/safety.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const brand = 'pos-smoothies-local-v1';
const lock = 810192417;
const upgrades = ['202611140024_smoothies_import.sql', '202611140025_smoothies_weekly_special.sql',
  '202611140026_smoothies_recipe_book.sql', '202611140027_smoothies_counter.sql', '202611140028_smoothies_first_shift.sql',
  '202611140029_smoothies_setup.sql'];

export function localTarget(value, protocol, port) {
  const url = new URL(value);
  assert.equal(url.protocol, protocol);
  assert.equal(url.hostname, '127.0.0.1', 'Usa el Supabase de esta PC (127.0.0.1).');
  assert.equal(url.port, String(port));
  assert.equal(url.search + url.hash, '');
  return url;
}

export async function prepareLocal({ api, database, anon, service, password, apiPort, dbPort, restoreOnly = false }) {
  const apiUrl = localTarget(api, 'http:', apiPort);
  assert.equal(apiUrl.pathname, '/');
  assert.equal(apiUrl.username + apiUrl.password, '');
  assert.equal(localTarget(database, 'postgresql:', dbPort).pathname, '/postgres');
  assert.ok(anon && service && anon !== service, 'Configura las dos claves de Supabase.');
  const folder = path.join(root, 'supabase/migrations');
  const snapshot = await readFile(path.join(root, 'supabase/schema.snapshot.json'), 'utf8');
  const localFolder = path.join(root, 'supabase/smoothies');
  const files = [...(await readdir(folder)).filter(name => /^\d{12}_[a-z_]+\.sql$/.test(name)), ...upgrades].sort();
  assert.ok(files.includes('202611050023_alternative_milk_choice.sql'));
  const migrations = await Promise.all(files.map(async name => {
    const sql = await readFile(path.join(upgrades.includes(name) ? localFolder : folder, name), 'utf8');
    // Keep the baseline and all migrations in one outer transaction.
    return sql.replace(/^begin;\s*$/mi, '').replace(/^commit;\s*$/mi, '');
  }));
  const fingerprintFor = (names, sql) => createHash('sha256').update(JSON.stringify([snapshot, names, sql])).digest('hex');
  const fingerprint = fingerprintFor(files, migrations);
  const db = new Client({ connectionString: database, connectionTimeoutMillis: 5000 });
  const auth = { persistSession: false, autoRefreshToken: false };
  const privileged = createClient(apiUrl.origin, service, { auth });
  const cashier = createClient(apiUrl.origin, anon, { auth });
  await db.connect();
  try {
    await db.query('select pg_advisory_lock($1)', [lock]);
    const [{ marker, profile, orders, storage, legacy }] = (await db.query(`
      select to_regclass('smoothies_local.identity') marker, to_regclass('public.profiles') profile,
        to_regclass('public.orders') orders, to_regclass('storage.buckets') storage,
        to_regnamespace('cafe_private') legacy`)).rows;
    const email = 'admin@smoothies.local';
    if (marker) {
      assert.ok(!restoreOnly, 'La recuperación requiere una base de destino nueva y vacía.');
      const identities = (await db.query('select name, contract, ready from smoothies_local.identity')).rows;
      assert.equal(identities.length, 1);
      assert.equal(identities[0].name, brand);
      assert.equal(identities[0].ready, true);
      if (identities[0].contract !== fingerprint) {
        const first = files.findIndex((name, index) => upgrades.includes(name)
          && files.slice(index).every(file => upgrades.includes(file))
          && identities[0].contract === fingerprintFor(files.slice(0, index), migrations.slice(0, index)));
        assert.ok(first >= 0,
          'El esquema local requiere una actualización explícita.');
        await db.query('begin');
        try {
          for (const sql of migrations.slice(first)) await db.query(sql);
          await db.query('update smoothies_local.identity set contract=$1 where name=$2',[fingerprint,brand]);
          await db.query('commit');
        } catch (error) {
          await db.query('rollback');
          throw error;
        }
      }
      return;
    }
    let users;
    if (!marker) {
      if (!restoreOnly) assert.ok(password?.length >= 12, 'Indica una contraseña de al menos 12 caracteres para la primera instalación.');
      assert.ok(!profile && !orders && !legacy && storage, 'Se necesita un Supabase local nuevo con Storage activo.');
      const [{ empty }] = (await db.query("select not exists (select from pg_tables where schemaname='public') as empty")).rows;
      assert.equal(empty, true, 'La base ya contiene datos. Usa una instancia dedicada a smoothies.');
      users = (await db.query('select id,email from auth.users')).rows;
      assert.ok(users.length === 0 || (users.length === 1 && users[0].email === email), 'Acceso existente inesperado.');
      if (restoreOnly) password = randomBytes(24).toString('base64url');
      if (!users.length) {
        const { error } = await privileged.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) throw new Error('No se pudo crear el administrador local.', { cause: error });
      }
      let adminId;
      if (!restoreOnly) {
        const { data, error } = await cashier.auth.signInWithPassword({ email, password });
        if (error || !data.user) throw new Error('Revisa el acceso del administrador local.', { cause: error });
        adminId = data.user.id;
        const [{ matches }] = (await db.query('select exists(select from auth.users where id=$1 and email=$2) matches', [adminId,email])).rows;
        assert.ok(matches, 'La API y PostgreSQL deben corresponder a la misma instancia.');
      } else {
        const { data, error } = await privileged.auth.admin.listUsers({ page: 1, perPage: 2 });
        const [{ id }] = (await db.query('select id from auth.users where email=$1', [email])).rows;
        assert.ok(!error && data.users.length === 1 && data.users[0].id === id, 'La API y PostgreSQL deben corresponder a la misma instancia.');
        adminId = id;
      }
      await db.query('begin');
      try {
        for (const statement of baselineStatements(JSON.parse(snapshot))) await db.query(statement);
        if (adminId) await db.query(`insert into public.profiles(id,full_name,username,role)
          values($1,'Administrador','admin','admin')`, [adminId]);
        for (const sql of migrations) await db.query(sql);
        if (restoreOnly) {
          await db.query('delete from public.profiles where id=$1', [adminId]);
          await db.query('delete from auth.users where id=$1', [adminId]);
        }
        await db.query(`
          create schema smoothies_local;
          revoke all on schema smoothies_local from public, anon, authenticated;
          create table smoothies_local.identity (
            name text primary key, contract text not null, ready boolean not null default false
          )`);
        await db.query('insert into smoothies_local.identity values ($1,$2,true)', [brand, fingerprint]);
        await db.query("notify pgrst, 'reload schema'");
        await db.query('commit');
      } catch (error) {
        await db.query('rollback');
        throw error;
      }
      return { adminId: restoreOnly ? undefined : adminId };
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv[2] === '--needs-admin') {
    const target = localTarget(process.env.SMOOTHIES_DATABASE_URL, 'postgresql:', 55432);
    assert.equal(target.pathname, '/postgres');
    const db = new Client({ connectionString: target.href, connectionTimeoutMillis: 5000 });
    await db.connect();
    try {
      const { marker } = (await db.query("select to_regclass('smoothies_local.identity') marker")).rows[0];
      console.log(marker ? 'no' : 'yes');
    } finally { await db.end(); }
    process.exit(0);
  }
  const restoreOnly = process.argv[2] === '--restore-empty';
  assert.ok(process.argv.length === (restoreOnly ? 3 : 2), 'Usa --restore-empty solo para preparar un destino vacío.');
  await prepareLocal({
    api: process.env.SMOOTHIES_API_URL, database: process.env.SMOOTHIES_DATABASE_URL,
    anon: process.env.SMOOTHIES_ANON_KEY, service: process.env.SMOOTHIES_SERVICE_KEY,
    password: process.env.SMOOTHIES_ADMIN_PASSWORD, apiPort: 58000, dbPort: 55432, restoreOnly,
  });
  console.log(restoreOnly ? 'Destino vacío preparado para restaurar.' : 'Base local preparada. Entra al POS con el usuario admin.');
}
