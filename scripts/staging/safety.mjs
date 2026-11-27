import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';

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

// This exception is available only to the explicitly enrolled fresh hosted VM.
// Ordinary developer/store checks still use localDocker's original endpoints.
/** @param {Record<string, string | undefined>} env */
export function hostedDockerContext(context, engine, receipt, env = process.env, platform = process.platform, now = Date.now(), localAddresses = Object.values(networkInterfaces()).flat().map(item => item?.address)) {
  assert.equal(platform, 'win32');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.RUNNER_OS, 'Windows'); assert.match(env.ImageOS || '', /^win25(?:-vs2026)?$/);
  assert.equal(env.POS_ACCEPTANCE_DISPOSABLE, '1'); assert.equal(env.POS_TEST_WSL_ENGINE, '1');
  assert.ok(!env.DOCKER_HOST && !env.DOCKER_CONTEXT, 'Docker environment redirects are refused.');
  assert.match(env.GITHUB_RUN_ID || '', /^[1-9][0-9]*$/); assert.ok(env.GITHUB_JOB);
  assert.equal(receipt.version, 3); assert.match(receipt.owner || '', /^[a-f0-9]{32}$/);
  assert.equal(receipt.runId, env.GITHUB_RUN_ID); assert.equal(receipt.job, env.GITHUB_JOB);
  assert.equal(receipt.distribution, 'Ubuntu-24.04'); assert.equal(engine.OSType, 'linux');
  assert.ok(typeof receipt.daemonId === 'string' && receipt.daemonId && receipt.daemonId === engine.ID);
  assert.ok(engine.Labels?.includes('mx.pos-hosted-rehearsal=' + receipt.owner));
  assert.equal(receipt.kernel, engine.KernelVersion); assert.match(receipt.kernel, /microsoft-standard-WSL2/);
  assert.equal(receipt.context, 'pos-hosted-' + receipt.owner); assert.equal(context.Name, receipt.context);
  const proxy = receipt.proxy;
  const privateAddress = value => {
    assert.match(value || '', /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/);
    const octets = value.split('.');
    assert.equal(octets.length, 4);
    assert.ok(octets.every(part => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255));
    return octets.reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
  };
  const guest = privateAddress(proxy?.guestAddress), gateway = privateAddress(proxy?.windowsGateway);
  assert.notEqual(guest, gateway); assert.ok(localAddresses.includes(proxy.windowsGateway));
  assert.ok(Number.isInteger(proxy.guestPrefixLength) && proxy.guestPrefixLength >= 1 && proxy.guestPrefixLength <= 30);
  const mask = (0xffffffff << (32 - proxy.guestPrefixLength)) >>> 0;
  assert.equal((guest & mask) >>> 0, (gateway & mask) >>> 0);
  assert.ok(Number.isInteger(proxy.gatewayInterfaceIndex) && proxy.gatewayInterfaceIndex > 0);
  assert.ok(Number.isInteger(proxy.pid) && proxy.pid > 0);
  assert.equal(proxy.unit, 'pos-transport-' + receipt.owner + '.service');
  assert.match(proxy.scriptSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(proxy.endpoint, 'tcp://' + proxy.guestAddress + ':2376');
  assert.equal(receipt.endpoint, proxy.endpoint); assert.equal(context.Endpoints?.docker?.Host, receipt.endpoint);
  const completed = Date.parse(receipt.completedAt);
  assert.ok(Number.isFinite(completed) && completed >= now - 60 * 60_000 && completed <= now + 5 * 60_000, 'Hosted Docker receipt is stale.');
  const parity = receipt.parity;
  assert.match(parity?.composeBindSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(parity.composeBindSha256, parity.rawBindSha256); assert.equal(parity.composeBindSha256, parity.binaryCopySha256);
  assert.deepEqual([...parity.loopbackPorts].sort(), [58000, 55432, 55541, 55542, 55543, 55544].sort());
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
