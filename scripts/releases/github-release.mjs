import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function fingerprint(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return { size: (await stat(file)).size, sha256: hash.digest('hex') };
}

// gh is injected so publication ordering and refusal paths can run offline.
export async function publishVerifiedRelease({ gh, repo, tag, files, title, notes, verifyPublic, promote, prerelease = true }) {
  assert.equal(typeof prerelease, 'boolean');
  const expected = await Promise.all(files.map(async file => ({ file, name: path.basename(file), ...await fingerprint(file) })));
  assert.ok(expected.length > 0 && new Set(expected.map(asset => asset.name)).size === expected.length, 'Release assets must have distinct names.');
  assert.ok(expected.every(asset => !/[?*\[\]]/.test(asset.name)), 'Release asset names cannot contain download glob characters.');
  const view = async () => JSON.parse(await gh(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,assets']));
  let release;
  try { release = await view(); }
  catch (error) { if (!/not found|404/i.test(String(error.stderr))) throw error; }
  if (!release) {
    await gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', `--prerelease=${prerelease}`, '--title', title, '--notes-file', notes]);
    release = await view();
  }
  assert.equal(release.tagName, tag, 'GitHub release tag differs.');
  assert.equal(typeof release.isDraft, 'boolean', 'GitHub release draft state is missing.');
  if (!release.isDraft) assert.equal(release.isPrerelease, prerelease, 'Published release channel differs; create a new release instead.');
  for (const asset of expected) {
    if (!release.assets.some(remote => remote.name === asset.name)) {
      assert.equal(release.isDraft, true, 'Published release is missing an expected asset; create a new release instead.');
      await gh(['release', 'upload', tag, asset.file, '--repo', repo]);
    }
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-release-verify-'));
  try {
    for (const [index, asset] of expected.entries()) {
      const downloaded = path.join(directory, String(index));
      await gh(['release', 'download', tag, '--repo', repo, '--pattern', asset.name, '--output', downloaded]);
      assert.deepEqual(await fingerprint(downloaded), { size: asset.size, sha256: asset.sha256 }, 'GitHub release asset differs: ' + asset.name);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  if (release.isDraft) await gh(['release', 'edit', tag, '--repo', repo, '--draft=false', `--prerelease=${prerelease}`, ...(prerelease ? [] : ['--latest=true'])]);
  const published = await view();
  assert.equal(published.tagName, tag);
  assert.equal(published.isDraft, false, 'Release was not published.');
  assert.equal(published.isPrerelease, prerelease, 'Published release channel differs.');
  for (const asset of expected) await verifyPublic(asset);
  return await promote();
}
