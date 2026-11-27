import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const legacyCafeCommit = 'b776550a7a91ad1dafb21b2200a235dfe337bb6f';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const relativeFile = value => typeof value === 'string' && value.length > 0 &&
  !value.includes('\\') && !path.posix.isAbsolute(value) &&
  value.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]/.test(part));
const routePath = value => typeof value === 'string' && /^\/[A-Za-z0-9_.\/-]*$/.test(value) &&
  value.split('/').slice(1).every(part => part && part !== '.' && part !== '..');

// Only the known rc.6 predecessor can contain these Next 16.4.6 runtime seed
// promotions. Every allowed byte derives from its already indexed build seeds;
// no arbitrary .next cache, dynamic response or executable file is trusted.
export async function inspectLegacyRouteCache(directory, commit, expected, extras) {
  assert.equal(commit, legacyCafeCommit, 'Legacy cache handling is restricted to the observed rc.6 predecessor.');
  const index = new Map([...expected].map(([file, hash]) => [file.toLowerCase(), hash]));
  async function indexed(file) {
    assert.ok(relativeFile(file) && index.has(file.toLowerCase()), 'Legacy cache seed must be indexed.');
    const bytes = await readFile(path.join(directory, file));
    assert.equal(digest(bytes), index.get(file.toLowerCase()), 'Legacy cache seed changed.');
    return bytes;
  }
  const prerender = JSON.parse(await indexed('app/.next/prerender-manifest.json'));
  const appPaths = JSON.parse(await indexed('app/.next/server/app-paths-manifest.json'));
  const allowed = new Map();
  const server = 'app/.next/server/';
  for (const indexedFile of index.keys()) {
    if (!indexedFile.startsWith(server + 'app/') || !indexedFile.endsWith('.meta')) continue;
    const seed = JSON.parse(await indexed(indexedFile));
    const entry = seed.routeCache;
    if (!entry) continue;
    assert.equal(Object.hasOwn(seed, 'routeCacheLastModified'), false, 'Build seed cannot already contain a runtime timestamp.');
    assert.ok(entry.owner && ['APP_PAGE','APP_ROUTE'].includes(entry.owner.kind) && entry.isFallback === false, 'Unknown legacy response kind.');
    const {kind, sourceRoute} = entry.owner;
    assert.ok(typeof sourceRoute === 'string' && sourceRoute.startsWith('/') && !sourceRoute.includes('\\'), 'Unknown legacy source route.');
    const leaf = kind === 'APP_PAGE' ? '/page' : '/route';
    assert.ok(sourceRoute.endsWith(leaf), 'Legacy source route has the wrong kind.');
    const parts = sourceRoute.slice(0, -leaf.length).split('/').filter(part => part && !part.startsWith('@') && !(part.startsWith('(') && part.endsWith(')')));
    const pathname = '/' + parts.join('/');
    assert.ok(pathname === '/' || routePath(pathname), 'Only static legacy source routes are accepted.');
    const route = prerender.routes?.[pathname];
    assert.ok(route && route.compute === 'static' && route.response === 'complete' && route.initialRevalidateSeconds === false &&
      route.srcRoute === pathname && route.routeType === (kind === 'APP_PAGE' ? 'page' : 'route') &&
      route.dataRoute === (kind === 'APP_PAGE' ? (pathname === '/' ? '/index' : pathname) + '.rsc' : null), 'Legacy response is not an immutable prerender seed.');
    const sourceModule = appPaths[sourceRoute];
    assert.ok(relativeFile(sourceModule) && sourceModule.endsWith(kind === 'APP_PAGE' ? '/page.js' : '/route.js'), 'Unknown legacy source module.');
    await indexed(server + sourceModule);
    const normalized = pathname === '/' ? '/index' : /^\/index(?:\/|$)/.test(pathname) ? '/index' + pathname : pathname;
    const key = '/route-cache/' + kind + '/' + digest(sourceRoute) + '/$' + normalized;
    assert.equal(entry.key, key, 'Legacy cache route/source ownership differs.');
    const stem = indexedFile.slice(0, -'.meta'.length);
    const base = server + key.slice(1);
    const add = (file, seedFile, metadata = false) => {
      assert.ok(relativeFile(file) && relativeFile(seedFile) && index.has(seedFile.toLowerCase()), 'Legacy promotion seed is missing.');
      assert.equal(allowed.has(file.toLowerCase()), false, 'Ambiguous legacy promotion.');
      allowed.set(file.toLowerCase(), {file, seedFile, metadata, kind, sourceRoute});
    };
    add(base + '.meta', indexedFile, true);
    if (kind === 'APP_ROUTE') add(base + '.body', stem + '.body');
    else {
      add(base + '.html', stem + '.html');
      add(base + '.rsc', stem + '.rsc');
      assert.ok(Array.isArray(seed.segmentPaths), 'Legacy page segment inventory is missing.');
      for (const segment of seed.segmentPaths) {
        assert.ok(routePath(segment), 'Unknown legacy page segment.');
        add(base + '.segments' + segment + '.segment.rsc', stem + '.segments' + segment + '.segment.rsc');
      }
    }
  }
  const inventory = [];
  const seen = new Set();
  for (const file of extras) {
    assert.ok(relativeFile(file) && !seen.has(file.toLowerCase()), 'Invalid or repeated legacy cache path.');
    seen.add(file.toLowerCase());
    const rule = allowed.get(file.toLowerCase());
    assert.ok(rule, 'Unexpected file outside validated legacy seed copies: ' + file);
    const bytes = await readFile(path.join(directory, file)), seed = await indexed(rule.seedFile);
    if (rule.metadata) {
      const actual = JSON.parse(bytes), original = JSON.parse(seed);
      assert.ok(Object.hasOwn(actual, 'routeCacheLastModified') && Number.isFinite(actual.routeCacheLastModified) && actual.routeCacheLastModified > 0, 'Legacy metadata timestamp is invalid.');
      delete actual.routeCacheLastModified;
      assert.deepEqual(actual, original, 'Legacy runtime metadata differs from its immutable seed.');
    } else assert.equal(digest(bytes), digest(seed), 'Legacy runtime payload differs from its immutable seed.');
    inventory.push({file, sha256:digest(bytes), bytes:bytes.length, seedFile:rule.seedFile, seedSha256:digest(seed), kind:rule.kind, sourceRoute:rule.sourceRoute});
  }
  return inventory.sort((a,b)=>a.file.localeCompare(b.file));
}
