import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const template = path.join(import.meta.dirname, 'supabase');
const configVersion = 1;
const keyPattern = /^[0-9a-f]{64}$/;

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Publish complete files without replacing an existing configuration, even if
// two installer windows are opened at the same time.
async function publish(file, content) {
  const staging = path.join(path.dirname(file), `setup-${randomUUID()}.tmp`);
  try {
    await writeFile(staging, content, { flag: 'wx', mode: 0o600 });
    await link(staging, file);
    return content;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readFile(file, 'utf8');
  } finally {
    await rm(staging, { force: true });
  }
}

function localKey(role, secret, issuedAt, instance) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    role, iss: 'supabase', ref: instance, iat: issuedAt, exp: issuedAt + 25 * 365 * 24 * 60 * 60,
  })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

export async function provisionSupabase(settingsFile, { apiPort = 58000, dbPort = 55432 } = {}) {
  assert.ok(typeof settingsFile === 'string' && path.isAbsolute(settingsFile)
    && !/^(?:\\\\|\/\/)/.test(settingsFile) && !/[\r\n"]/.test(settingsFile),
  'Usa un archivo de instalación con ruta absoluta en el disco local.');
  assert.ok([[58000,55432],[58580,58532]].some(([api, db]) => apiPort === api && dbPort === db),
    'Usa los puertos dedicados de POS Smoothies.');
  // Existing manual installations retain their original Compose and keys.
  if (await readOptional(settingsFile) !== undefined) return { existing: true };
  const directory = path.join(path.dirname(settingsFile), 'supabase');
  await mkdir(directory, { recursive: true });
  const secretFile = path.join(directory, 'instance.json');
  let stored = await readOptional(secretFile);
  if (stored === undefined) {
    stored = await publish(secretFile, JSON.stringify({
      version: configVersion, apiPort, dbPort, instance: randomUUID(),
      issuedAt: Math.floor(Date.now() / 1000),
      databasePassword: randomBytes(32).toString('hex'),
      jwtSecret: randomBytes(32).toString('hex'),
    }) + '\n');
  }
  const setup = JSON.parse(stored);
  assert.ok(setup.version === configVersion && setup.apiPort === apiPort && setup.dbPort === dbPort
    && keyPattern.test(setup.databasePassword) && keyPattern.test(setup.jwtSecret)
    && typeof setup.instance === 'string' && /^[0-9a-f-]{36}$/.test(setup.instance)
    && Number.isSafeInteger(setup.issuedAt), 'La configuración local existente requiere revisión.');
  const anon = localKey('anon', setup.jwtSecret, setup.issuedAt, setup.instance);
  const service = localKey('service_role', setup.jwtSecret, setup.issuedAt, setup.instance);
  const replacements = {
    API_PORT: String(apiPort), DB_PORT: String(dbPort), DB_PASSWORD: setup.databasePassword,
    JWT_SECRET: setup.jwtSecret, ANON_KEY: anon, SERVICE_KEY: service, INSTANCE: setup.instance,
  };
  for (const name of ['compose.yml', 'gateway.yml', 'roles.sql']) {
    const source = await readFile(path.join(template, name), 'utf8');
    const expected = source.replace(/__([A-Z_]+)__/g, (_match, key) => {
      assert.ok(Object.hasOwn(replacements, key), 'Variable desconocida en la configuración del POS.');
      return replacements[key];
    });
    const target = path.join(directory, name);
    if (await readOptional(target) === undefined) await publish(target, expected);
    assert.equal((await readFile(target, 'utf8')) === expected, true,
      'Hay una configuración local anterior. Conserva sus datos y revisa la instalación antes de continuar.');
  }
  const content = [
    '# Configuración privada de la PC. Mantén este archivo con sus datos locales.',
    `SMOOTHIES_API_URL=http://127.0.0.1:${apiPort}`,
    `SMOOTHIES_DATABASE_URL=postgresql://postgres:${setup.databasePassword}@127.0.0.1:${dbPort}/postgres`,
    `SMOOTHIES_ANON_KEY=${anon}`,
    `SMOOTHIES_SERVICE_KEY=${service}`,
    `SMOOTHIES_COMPOSE_FILE="${path.join(directory, 'compose.yml')}"`,
    'SMOOTHIES_MANAGED_SUPABASE=1',
    `SMOOTHIES_SUPABASE_INSTANCE=${setup.instance}`,
  ].join('\n') + '\n';
  await publish(settingsFile, content);
  return { existing: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const settings = process.argv[2];
    assert.equal(process.argv.length, 3, 'Uso: provision-supabase.mjs RUTA_ABSOLUTA_INSTALACION');
    await provisionSupabase(settings);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo preparar la base local.');
    process.exitCode = 1;
  }
}
