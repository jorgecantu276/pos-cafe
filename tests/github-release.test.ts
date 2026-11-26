import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishVerifiedRelease } from '../scripts/releases/github-release.mjs';

type FixtureOptions = {
  exists?: boolean; draft?: boolean; corrupt?: boolean; missing?: boolean;
  publicFailure?: boolean; prerelease?: boolean; remotePrerelease?: boolean;
};

async function fixture(t: TestContext, { exists = false, draft = true, corrupt = false, missing = false, publicFailure = false, prerelease = true, remotePrerelease = prerelease }: FixtureOptions = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [path.join(directory, 'package.zip'), path.join(directory, 'manifest.json')];
  await Promise.all(files.map((file, index) => writeFile(file, 'approved-' + index)));
  const assets = new Map<string, Buffer>();
  if (exists) for (const file of files.slice(0, missing ? 1 : 2)) assets.set(path.basename(file), await readFile(file));
  const events: string[] = [];
  const gh = async (args: string[]) => {
    const action = args[1];
    events.push(action);
    if (action === 'view') {
      if (!exists) throw Object.assign(new Error('not found'), { stderr: 'release not found' });
      return JSON.stringify({ tagName: 'pos-v1.2.3', isDraft: draft, isPrerelease: remotePrerelease, assets: [...assets.keys()].map(name => ({ name })) });
    }
    if (action === 'create') {
      assert.ok(args.includes('--draft'));
      assert.ok(args.includes(`--prerelease=${prerelease}`));
      exists = true; draft = true; remotePrerelease = prerelease;
    } else if (action === 'upload') {
      assert.equal(draft, true, 'never upload to a published release');
      assets.set(path.basename(args[3]), await readFile(args[3]));
    } else if (action === 'download') {
      const name = args[args.indexOf('--pattern') + 1];
      const bytes = assets.get(name);
      assert.ok(bytes);
      await writeFile(args[args.indexOf('--output') + 1], corrupt ? 'altered' : bytes);
    } else if (action === 'edit') {
      assert.equal(events.filter(event => event === 'download').length, 2, 'both draft assets verified before publishing');
      assert.ok(args.includes('--draft=false'));
      assert.ok(args.includes(`--prerelease=${prerelease}`));
      assert.equal(args.includes('--latest=true'), !prerelease);
      remotePrerelease = prerelease;
      draft = false;
    } else throw Error('Unexpected gh action: ' + action);
    return '';
  };
  const run = () => publishVerifiedRelease({ gh, repo: 'owner/repo', tag: 'pos-v1.2.3', files, title: 'POS', notes: 'notes.txt', prerelease,
    verifyPublic: async () => { events.push('public'); if (publicFailure) throw Error('public asset mismatch'); },
    promote: async () => { events.push('feed'); return 'promoted'; } });
  return { run, events };
}

test('new release uploads and verifies draft assets before publish and public checks before feed', async t => {
  const { run, events } = await fixture(t);
  assert.equal(await run(), 'promoted');
  assert.deepEqual(events, ['view', 'create', 'view', 'upload', 'upload', 'download', 'download', 'edit', 'view', 'public', 'public', 'feed']);
});

test('an interrupted draft resumes missing uploads and publishes only after verification', async t => {
  const { run, events } = await fixture(t, { exists: true, missing: true });
  await run();
  assert.equal(events.filter(event => event === 'upload').length, 1);
  assert.equal(events.filter(event => event === 'edit').length, 1);
});

test('existing published exact assets are verified and reused without mutation', async t => {
  const { run, events } = await fixture(t, { exists: true, draft: false });
  await run();
  assert.equal(events.some(event => ['upload', 'create', 'edit'].includes(event)), false);
  assert.equal(events.at(-1), 'feed');
});

test('a published release missing an asset refuses without upload or feed update', async t => {
  const { run, events } = await fixture(t, { exists: true, draft: false, missing: true });
  await assert.rejects(run, /Published release is missing/);
  assert.deepEqual(events, ['view']);
});

for (const draft of [true, false]) test(`mismatched ${draft ? 'draft' : 'published'} bytes refuse publication and feed advance`, async t => {
  const { run, events } = await fixture(t, { exists: true, draft, corrupt: true });
  await assert.rejects(run, /GitHub release asset differs/);
  assert.equal(events.some(event => ['edit', 'public', 'feed'].includes(event)), false);
});

test('failed public verification after publication never advances the feed', async t => {
  const { run, events } = await fixture(t, { publicFailure: true });
  await assert.rejects(run, /public asset mismatch/);
  assert.equal(events.includes('edit'), true);
  assert.equal(events.includes('feed'), false);
});

test('stable release publishes with explicit stable channel and latest flag after asset verification', async t => {
  const { run, events } = await fixture(t, { prerelease: false });
  await run();
  assert.equal(events.at(-1), 'feed');
});

test('resumed draft channel is explicitly corrected before stable publication', async t => {
  const { run } = await fixture(t, { exists: true, draft: true, prerelease: false, remotePrerelease: true });
  assert.equal(await run(), 'promoted');
});

for (const prerelease of [true, false]) test(`published channel mismatch refuses before mutation (${prerelease})`, async t => {
  const { run, events } = await fixture(t, { exists: true, draft: false, prerelease, remotePrerelease: !prerelease });
  await assert.rejects(run, /Published release channel differs/);
  assert.deepEqual(events, ['view']);
});
