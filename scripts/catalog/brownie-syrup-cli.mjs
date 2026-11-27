import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { planBrownieSyrup, applyBrownieSyrup, rollbackBrownieSyrup } from './brownie-syrup.mjs';

const [action, installation, backend, planFile] = process.argv.slice(2);
let db;
try {
  assert.ok(['Plan','Apply','Rollback'].includes(action), 'Acción inválida.');
  assert.ok(path.isAbsolute(installation) && path.isAbsolute(planFile), 'Se requieren rutas absolutas.');
  const origin = new URL(backend).origin;
  const project = new URL(origin).hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
  assert.ok(project, 'Verifica el proyecto Supabase del negocio.');
  const connectionString = process.env.POS_CATALOG_DATABASE_URL;
  delete process.env.POS_CATALOG_DATABASE_URL;
  const target = new URL(connectionString);
  assert.ok(target.protocol === 'postgresql:' || target.protocol === 'postgres:');
  assert.ok(target.hostname === `db.${project}.supabase.co` ||
    (target.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(target.username) === `postgres.${project}`), 'La conexión PostgreSQL no corresponde a la configuración instalada.');
  assert.ok([...target.searchParams].every(([key, value]) => key === 'sslmode' && ['require','verify-ca','verify-full'].includes(value)), 'La conexión no puede sobrescribir su destino ni desactivar TLS.');
  const require = createRequire(path.join(installation, 'backup-tools/package.json'));
  const { Client } = require('pg');
  // Use the validated authority explicitly; pg connection-string query parameters
  // must never override the project binding or TLS verification.
  db = new Client({ host: target.hostname, port: target.port ? Number(target.port) : 5432,
    user: decodeURIComponent(target.username), password: decodeURIComponent(target.password),
    database: decodeURIComponent(target.pathname.slice(1)), connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: true } });
  await db.connect();
  const save = async plan => {
    const temporary = planFile + '.tmp';
    await writeFile(temporary, JSON.stringify(plan, null, 2), { mode: 0o600 });
    await rename(temporary, planFile);
  };
  if (action === 'Plan') {
    await db.query('begin read only');
    const plan = { ...await planBrownieSyrup(db), backend: origin };
    await db.query('commit');
    await writeFile(planFile, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Plan guardado: ${plan.before.length} brownies; cuatro opciones incluidas en el precio.`);
  } else {
    const plan = JSON.parse(await readFile(planFile, 'utf8'));
    assert.equal(plan.backend, origin, 'El plan corresponde a otro negocio.');
    await db.query('begin');
    const updated = await (action === 'Apply' ? applyBrownieSyrup : rollbackBrownieSyrup)(db, plan);
    // Save exact before/after evidence before COMMIT; retry reconciles either outcome.
    await save(updated);
    await db.query('commit');
    console.log(action === 'Apply' ? 'Jarabes aplicados. Recarga Caja antes de tomar otra orden.' : 'Asignación de jarabes revertida. Se conservó el historial.');
  }
} catch (error) {
  if (db) await db.query('rollback').catch(() => {});
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'No se confirmó el cambio. Conserva el plan y comprueba la conexión antes de reintentar.');
  process.exitCode = 1;
} finally { if (db) await db.end(); }
