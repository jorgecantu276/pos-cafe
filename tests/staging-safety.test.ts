import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// These checks exercise the runner's actual fail-closed target validation.
import { localSettings, localDocker, hostedDockerContext, baselineStatements } from '../scripts/staging/safety.mjs';

const local = { API_URL: 'http://127.0.0.1:55451', DB_URL: 'postgresql://postgres:test@127.0.0.1:55452/postgres',
  ANON_KEY: 'synthetic-local-anon-key-only', SERVICE_ROLE_KEY: 'synthetic-local-service-key-only' };

test('staging runner refuses all hosted, redirected, wrong-port and credential-bearing API targets', () => {
  assert.equal(localSettings(local).api, local.API_URL);
  for (const url of ['https://sddybmnlvsydvwsqgbvp.supabase.co', 'https://ndjqyootqtnygyzhbjrz.supabase.co',
    'http://localhost:55451', 'http://127.0.0.1:54321', 'http://127.0.0.1:55451/proxy',
    'http://user:pass@127.0.0.1:55451', 'http://127.0.0.1:55451?upstream=production']) {
    assert.throws(() => localSettings({ ...local, API_URL: url }));
  }
  for (const url of ['postgresql://postgres:pass@db.sddybmnlvsydvwsqgbvp.supabase.co/postgres',
    'postgresql://postgres:pass@127.0.0.1:55452/postgres?host=remote', 'postgresql://postgres:pass@127.0.0.1:54322/postgres']) {
    assert.throws(() => localSettings({ ...local, DB_URL: url }));
  }
  assert.throws(() => localSettings({ ...local, SERVICE_ROLE_KEY: '' }));
});

test('staging runner refuses remote Docker engines and reconstructs only catalog definitions', () => {
  localDocker('npipe:////./pipe/dockerDesktopLinuxEngine');
  for (const endpoint of ['tcp://example.com:2375', 'tcp://127.0.0.1:2375', 'ssh://host', 'unix:///tmp/other.sock']) assert.throws(() => localDocker(endpoint));
  const snapshot = JSON.parse(readFileSync(new URL('../supabase/schema.snapshot.json', import.meta.url), 'utf8'));
  const statements: string[] = baselineStatements(snapshot);
  assert.equal(statements.filter(sql => sql.startsWith('create table public.')).length, 18);
  assert.ok(!statements.some(sql => /\b(?:insert into|copy)\b/i.test(sql)));
  assert.ok(statements.some(sql => /references auth\.users/i.test(sql)));
});

test('only exact current-run hosted WSL context proof permits official loopback TCP transport', () => {
  const owner = 'a'.repeat(32), name = 'pos-hosted-' + owner, endpoint = 'tcp://127.0.0.1:2375';
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', ImageOS: 'win25',
    POS_ACCEPTANCE_DISPOSABLE: '1', POS_TEST_WSL_ENGINE: '1', GITHUB_RUN_ID: '1234', GITHUB_JOB: 'smoothies-installed-lan' };
  const context = { Name: name, Endpoints: { docker: { Host: endpoint } } };
  const engine = { ID: 'synthetic-daemon', OSType: 'linux', KernelVersion: '6.6.1-microsoft-standard-WSL2', Labels: ['mx.pos-hosted-rehearsal=' + owner] };
  const receipt = { version: 2, owner, runId: '1234', job: 'smoothies-installed-lan', distribution: 'Ubuntu-24.04',
    daemonId: engine.ID, kernel: engine.KernelVersion, context: name, endpoint, completedAt: new Date().toISOString(),
    parity: { composeBindSha256: 'b'.repeat(64), rawBindSha256: 'b'.repeat(64), binaryCopySha256: 'b'.repeat(64), loopbackPorts: [58000, 55432, 55541, 55542, 55543, 55544] } };
  const inspect = (change = {}) => hostedDockerContext(context, engine, { ...receipt, ...change }, env, 'win32');
  inspect();
  for (const field of Object.keys(env)) assert.throws(() => hostedDockerContext(context, engine, receipt, { ...env, [field]: '' }, 'win32'));
  for (const change of [{ owner: 'c'.repeat(32) }, { runId: '999' }, { job: 'another-job' }, { daemonId: 'foreign-daemon' },
    { version: 1 }, { endpoint: 'tcp://example.com:2375' }, { context: 'default' }, { completedAt: '2001-01-01T00:00:00Z' },
    { parity: { ...receipt.parity, binaryCopySha256: 'c'.repeat(64) } }, { parity: { ...receipt.parity, loopbackPorts: [58000] } }]) assert.throws(() => inspect(change));
  assert.throws(() => hostedDockerContext(context, { ...engine, Labels: [] }, receipt, env, 'win32'));
  assert.throws(() => hostedDockerContext(context, engine, receipt, { ...env, DOCKER_HOST: endpoint }, 'win32'));
  assert.throws(() => hostedDockerContext(context, engine, receipt, env, 'linux'));
  assert.throws(() => hostedDockerContext({ ...context, Name: 'default' }, engine, receipt, env, 'win32'));
});
