import assert from 'node:assert/strict';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const action = process.argv[2];
assert.ok(['check','write'].includes(action), 'Usa el instalador de Windows.');
const root = path.resolve(import.meta.dirname, '../..');
const env = process.env;
const localDirectory = env.SMOOTHIES_DATA_HOME || path.join(env.LOCALAPPDATA, 'POS Smoothies');
const startup = {
  SMOOTHIES_API_URL: env.SMOOTHIES_API_URL,
  SMOOTHIES_ANON_KEY: env.SMOOTHIES_ANON_KEY,
  SMOOTHIES_SERVICE_KEY: env.SMOOTHIES_SERVICE_KEY,
  SMOOTHIES_COMPOSE_FILE: env.SMOOTHIES_COMPOSE_FILE,
  SMOOTHIES_PRINT_DIR: env.SMOOTHIES_PRINT_DIR || path.join(localDirectory, 'impresion'),
  SMOOTHIES_BACKUP_DIR: env.SMOOTHIES_BACKUP_DIR || path.join(localDirectory, 'respaldos'),
  SMOOTHIES_BACKUP_KEY_FILE: env.SMOOTHIES_BACKUP_KEY_FILE || path.join(localDirectory, 'clave', 'recuperacion.key'),
};
if (env.SMOOTHIES_PORTABLE === '1') startup.SMOOTHIES_PORTABLE = '1';
const localPath = value => value && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value);
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
assert.equal(new URL(startup.SMOOTHIES_API_URL).href, 'http://127.0.0.1:58000/', 'Usa la API local en el puerto 58000.');
const database = new URL(env.SMOOTHIES_DATABASE_URL);
assert.equal(`${database.protocol}//${database.host}${database.pathname}${database.search}${database.hash}`, 'postgresql://127.0.0.1:55432/postgres',
  'Usa PostgreSQL local en el puerto 55432.');
assert.ok(startup.SMOOTHIES_ANON_KEY && startup.SMOOTHIES_SERVICE_KEY &&
  startup.SMOOTHIES_ANON_KEY !== startup.SMOOTHIES_SERVICE_KEY, 'Configura las dos claves de Supabase.');
assert.ok(localPath(startup.SMOOTHIES_COMPOSE_FILE) && (await stat(startup.SMOOTHIES_COMPOSE_FILE)).isFile(),
  'Indica la ruta absoluta a un archivo Compose local.');
const journal = startup.SMOOTHIES_PRINT_DIR;
const backups = startup.SMOOTHIES_BACKUP_DIR;
const recovery = startup.SMOOTHIES_BACKUP_KEY_FILE;
assert.ok([journal, backups, recovery].every(value => localPath(value) && !contains(root, value))
  && !contains(backups, recovery) && !contains(journal, recovery)
  && !contains(journal, backups) && !contains(backups, journal),
  'Usa carpetas separadas para impresión, respaldos y clave, fuera del código.');
if (action === 'write') {
  const output = process.argv[3];
  assert.ok(localPath(output), 'Indica la ruta local del archivo de arranque.');
  const lines = Object.entries(startup).map(([key, value]) => {
    assert.ok(!/[\r\n"]/.test(value), 'Revisa las rutas y claves de instalación.');
    return `${key}="${value}"`;
  });
  const temporary = path.join(path.dirname(output), `caja-${randomUUID()}.tmp`);
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await writeFile(temporary, `${lines.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, output);
  } finally { await rm(temporary, { force: true }); }
}
