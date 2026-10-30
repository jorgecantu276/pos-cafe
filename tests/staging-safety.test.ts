import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// These checks exercise the runner's actual fail-closed target validation.
import { localSettings, localDocker, baselineStatements } from '../scripts/staging/safety.mjs';

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
  for (const endpoint of ['tcp://example.com:2375', 'ssh://host', 'unix:///tmp/other.sock']) assert.throws(() => localDocker(endpoint));
  const snapshot = JSON.parse(readFileSync(new URL('../supabase/schema.snapshot.json', import.meta.url), 'utf8'));
  const statements: string[] = baselineStatements(snapshot);
  assert.equal(statements.filter(sql => sql.startsWith('create table public.')).length, 18);
  assert.ok(!statements.some(sql => /\b(?:insert into|copy)\b/i.test(sql)));
  assert.ok(statements.some(sql => /references auth\.users/i.test(sql)));
});
