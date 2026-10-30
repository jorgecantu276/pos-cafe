import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/local-instance/route';

test('launcher probe identifies its own runtime only when configured and remains uncached', async () => {
  const names = ['POS_LAUNCH_INSTANCE_TOKEN', 'POS_LAUNCH_RELEASE_ID', 'POS_LAUNCH_CONFIG_ID'] as const;
  const saved = names.map(name => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    assert.equal((await GET(new NextRequest('http://127.0.0.1/api/local-instance'))).status, 404);
    names.forEach((name, index) => { process.env[name] = `fixture-${index}`; });
    assert.equal((await GET(new NextRequest('https://example.com/api/local-instance'))).status, 404);
    const response = await GET(new NextRequest('http://127.0.0.1/api/local-instance'));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { protocol: 1, instanceToken: 'fixture-0', releaseId: 'fixture-1', configId: 'fixture-2', processId: process.pid });
  } finally { names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; }); }
});
