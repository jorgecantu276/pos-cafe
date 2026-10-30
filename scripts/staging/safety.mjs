import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const project = 'pos-cafe-staging-local';
export const ports = { api: 55451, db: 55452, app: 3101 };

// Deliberately no remote/override mode: both existing hosted projects are excluded
// by accepting only these exact loopback endpoints, even if a key is supplied.
export function localSettings(status) {
  const api = new URL(status.API_URL);
  const db = new URL(status.DB_URL);
  assert.equal(api.origin, `http://127.0.0.1:${ports.api}`, 'Staging API must be the dedicated loopback stack');
  assert.equal(api.pathname, '/');
  assert.ok(!api.username && !api.password && !api.search && !api.hash);
  assert.equal(db.protocol, 'postgresql:');
  assert.equal(db.hostname, '127.0.0.1', 'Staging database must be loopback');
  assert.equal(db.port, String(ports.db));
  assert.equal(db.pathname, '/postgres');
  assert.equal(db.username, 'postgres');
  assert.ok(!db.search && !db.hash, 'Database redirects/options are not accepted');
  for (const key of ['ANON_KEY', 'SERVICE_ROLE_KEY']) assert.ok(typeof status[key] === 'string' && status[key].length > 20, `Missing local ${key}`);
  return { api: api.origin, database: db.href, anon: status.ANON_KEY, service: status.SERVICE_ROLE_KEY };
}

export function localDocker(endpoint) {
  assert.ok(endpoint === 'npipe:////./pipe/docker_engine' || endpoint === 'npipe:////./pipe/dockerDesktopLinuxEngine'
    || endpoint === 'unix:///var/run/docker.sock', 'Refusing a remote/custom Docker endpoint');
}

export function fingerprint(snapshot, migration) {
  return createHash('sha256').update(snapshot).update('\0').update(migration).digest('hex');
}

export function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function baselineStatements(snapshot) {
  const statements = ['set search_path = public, extensions', 'create extension if not exists "uuid-ossp" with schema extensions'];
  for (const sequence of snapshot.sequences) statements.push(`create sequence public.${quoteIdentifier(sequence.name)}`);
  for (const table of snapshot.tables) {
    const columns = table.columns.map(c => `${quoteIdentifier(c.name)} ${c.type}${c.default ? ` default ${c.default}` : ''}${c.not_null ? ' not null' : ''}`);
    statements.push(`create table public.${quoteIdentifier(table.name)}(${columns.join(',')})`);
  }
  for (const foreign of [false, true]) for (const table of snapshot.tables) for (const constraint of table.constraints.filter(c => (c.type === 'f') === foreign)) {
    statements.push(`alter table public.${quoteIdentifier(table.name)} add constraint ${quoteIdentifier(constraint.name)} ${constraint.definition}`);
  }
  for (const fn of snapshot.functions) statements.push(fn.definition ?? fn.function_definition);
  // Reproduce captured grants before applying the real repair. No business rows.
  statements.push('grant all on all tables in schema public to anon,authenticated,service_role',
    'grant all on all sequences in schema public to anon,authenticated,service_role',
    'grant execute on all functions in schema public to anon,authenticated,service_role');
  return statements;
}
