import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('replacement worker retires old POS caches without caching or intercepting financial requests', async () => {
  const handlers = new Map<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void>();
  const deleted: string[] = []; const events: string[] = [];
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener: (name: string, handler: typeof handlers extends Map<string, infer V> ? V : never) => handlers.set(name, handler),
      skipWaiting: async () => { events.push('installed'); },
      clients: { claim: async () => { events.push('claimed'); } },
    },
    caches: {
      keys: async () => ['start-url', 'apis', 'others', 'workbox-precache-v2-http://localhost/', 'unrelated-app-cache'],
      delete: async (name: string) => { deleted.push(name); return true; },
    },
  });
  assert.equal(handlers.has('fetch'), false);
  for (const name of ['install', 'activate']) {
    let done!: Promise<unknown>; handlers.get(name)!({ waitUntil: promise => { done = promise; } }); await done;
  }
  assert.deepEqual(events, ['installed', 'claimed']);
  assert.deepEqual(deleted.sort(), ['apis', 'others', 'start-url', 'workbox-precache-v2-http://localhost/'].sort());
});
