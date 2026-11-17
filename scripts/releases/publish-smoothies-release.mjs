import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { signSmoothiesUpdate } from './sign-smoothies-update.mjs';
import { fileHash } from '../smoothies/auto-update.mjs';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '../..');
const repo = 'jorgecantu276/pos-cafe';
const [privateKey, cafe, smoothies, papeleria, zip, envelope, notes] = process.argv.slice(2);
assert.ok(privateKey && cafe && smoothies && papeleria && zip && envelope && notes,
  'Use node publish-smoothies-release.mjs <signing-key> <cafe-folder> <smoothies-folder> <papeleria-folder> <smoothies-zip> <new-signed-manifest> <release-notes-file>.');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const gh = (args, input) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', windowsHide: true, input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
assert.equal(git(['status', '--porcelain']), '', 'Commit the reviewed final source before publishing.');
execFileSync(process.execPath, ['scripts/releases/versions.mjs', 'verify', cafe, smoothies, papeleria], { cwd: root, stdio: 'inherit', windowsHide: true });
const release = JSON.parse(readFileSync(path.join(smoothies, 'release.json'), 'utf8'));
assert.equal(release.sourceCommit, git(['rev-parse', 'HEAD']), 'Publish only the current reviewed source commit.');
assert.ok(readFileSync(notes, 'utf8').trim());
const tag = release.familyRelease;
const remoteTag = git(['ls-remote', 'github', 'refs/tags/' + tag]).split(/\s/)[0];
assert.equal(remoteTag, release.sourceCommit, 'Push the lightweight family tag for this exact commit first.');
await signSmoothiesUpdate({ keyFile: privateKey, packageDirectory: smoothies, zipFile: zip,
  zipUrl: 'https://github.com/' + repo + '/releases/download/' + tag + '/' + path.basename(zip), outputFile: envelope });
let existingRelease;
try { existingRelease = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,assets'])); }
catch (error) { if (!/not found|404/i.test(String(error.stderr))) throw error; }
if (!existingRelease) {
  gh(['release', 'create', tag, zip, envelope, '--repo', repo, '--verify-tag', '--prerelease', '--title', 'POS ' + release.appVersion,
    '--notes-file', notes]);
} else {
  assert.equal(existingRelease.tagName, tag);
  assert.equal(existingRelease.isDraft, false, 'Publish the verified release before promoting its feed.');
  for (const file of [zip, envelope]) {
    if (!existingRelease.assets.some(asset => asset.name === path.basename(file))) gh(['release', 'upload', tag, file, '--repo', repo]);
  }
}
const assetUrl = 'https://github.com/' + repo + '/releases/download/' + tag + '/' + path.basename(zip);
for (const file of [zip, envelope]) {
  const url = 'https://github.com/' + repo + '/releases/download/' + tag + '/' + path.basename(file);
  const asset = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  assert.ok(asset.ok && asset.body, 'The signed release must be publicly downloadable before promoting its feed.');
  const expectedBytes = (await stat(file)).size;
  const hash = createHash('sha256');
  let received = 0;
  for await (const bytes of asset.body) {
    received += bytes.length;
    assert.ok(received <= expectedBytes, 'The remote release asset differs from the verified artifact.');
    hash.update(bytes);
  }
  assert.equal(received, expectedBytes);
  assert.equal(hash.digest('hex'), await fileHash(file), 'The remote release asset differs from the verified artifact.');
}
const feedBranch = 'pos-family-feed';
try { gh(['api', 'repos/' + repo + '/git/ref/heads/' + feedBranch]); }
catch (error) {
  if (!String(error.stderr).includes('404')) throw error;
  gh(['api', '--method', 'POST', 'repos/' + repo + '/git/refs', '--input', '-'],
    JSON.stringify({ ref: 'refs/heads/' + feedBranch, sha: release.sourceCommit }));
}
let previous;
try { previous = JSON.parse(gh(['api', 'repos/' + repo + '/contents/smoothies/pilot.json?ref=' + feedBranch])); }
catch (error) { if (!String(error.stderr).includes('404')) throw error; }
const body = { message: 'Publish signed Smoothies ' + release.appVersion + ' pilot update', branch: feedBranch,
  content: readFileSync(envelope).toString('base64'), ...(previous ? { sha: previous.sha } : {}) };
const result = JSON.parse(gh(['api', '--method', 'PUT', 'repos/' + repo + '/contents/smoothies/pilot.json', '--input', '-'], JSON.stringify(body)));
writeFileSync(envelope + '.published.json', JSON.stringify({ familyRelease: tag, sourceCommit: release.sourceCommit,
  feedCommit: result.commit.sha, releaseUrl: 'https://github.com/' + repo + '/releases/tag/' + tag, zipUrl: assetUrl }, null, 2));
console.log('Published signed pilot update for ' + tag + '.');
