import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { localTarget } from './prepare-local.mjs';

const [packageId, directory] = process.argv.slice(2);
const localInstance = 'http://127.0.0.1:3180/api/local-instance';
assert.match(packageId, /^[a-f0-9]{16}$/);
assert.ok(path.isAbsolute(directory));
const instance = () => fetch(localInstance, { redirect: 'error', signal: AbortSignal.timeout(1500) });
const response = await instance().catch(() => null);
if (!response) process.exit(0);
assert.ok(response.ok, 'El puerto está ocupado por otra aplicación.');
const identity = await response.json();
assert.equal(identity.packageId, packageId);
const dbUrl = localTarget(process.env.SMOOTHIES_DATABASE_URL, 'postgresql:', 55432);
const db = new Client({ connectionString: dbUrl.href, connectionTimeoutMillis: 5000, query_timeout: 5000 });
await db.connect();
try {
  await db.query('begin');
  await db.query('select pg_advisory_xact_lock(60281030)');
  const { idle } = (await db.query(`
    select not exists(select 1 from public.cash_registers where status='open')
      and not exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null)
      and not exists(select 1 from cafe_private.clip_payments where state not in ('failed','completed')) as idle
  `)).rows[0];
  assert.ok(idle, 'Cierra el turno y confirma las entregas antes de detener la caja.');
  await mkdir(path.join(directory, 'actualizaciones'), { recursive: true });
  await writeFile(path.join(directory, 'actualizaciones/stop-requested'), identity.instanceToken);
  await writeFile(path.join(directory, 'detener-caja'), identity.instanceToken);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!await instance().catch(() => null)) {
      console.log('POS Smoothies detenido.');
      break;
    }
    if (attempt === 19) throw Error('La caja no se detuvo. Consulta el diagnóstico.');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally { await db.end(); }
