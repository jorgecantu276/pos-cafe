// Publish already accepted packages; never build, migrate a backend or install a device.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { publishVerifiedRelease } from './github-release.mjs';
import { readSignedUpdate, extractWindowsZip, verifyPackage } from '../windows/auto-update.mjs';

const root = path.resolve(import.meta.dirname, '../..'), repo = 'jorgecantu276/pos-cafe';
const [key, cafe, smoothies, native, zip, envelope, notes, ...from] = process.argv.slice(2);
assert.ok([key, cafe, smoothies, native, zip, envelope, notes].every(value => value && path.isAbsolute(value))
  && from.length && from.every(value => /^[a-f0-9]{40}$/.test(value)),
'Use publish-cafe-release.mjs <private-key> <cafe> <smoothies> <native> <zip> <pos-update.json> <notes> <accepted-predecessor-sha> [...]');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const gh = (args, input) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', windowsHide: true, input }).trim();
assert.equal(git(['status', '--porcelain']), '', 'Commit the independently reviewed final source first.');
execFileSync(process.execPath, ['scripts/releases/versions.mjs', 'verify', cafe, smoothies, native], { cwd: root, windowsHide: true, stdio: 'inherit' });
const release = JSON.parse(readFileSync(path.join(cafe, 'release.json'), 'utf8'));
assert.equal(release.product, 'cafe');
assert.equal(release.fixtureOnly, false);
assert.equal(release.sourceCommit, git(['rev-parse', 'HEAD']));
assert.ok(!from.includes(release.sourceCommit));
assert.ok(readFileSync(notes, 'utf8').trim(), 'Release notes are required.');
const tag = 'pos-' + release.sourceCommit.slice(0, 7);
assert.equal(path.basename(zip), `POS-Cafe-${release.sourceCommit.slice(0, 7)}.zip`);
assert.equal(path.basename(envelope), 'pos-update.json');
const remote = JSON.parse(gh(['api', `repos/${repo}/git/ref/tags/${tag}`]));
assert.equal(remote.object.type, 'commit', 'Use a lightweight technical tag for the exact accepted source.');
assert.equal(remote.object.sha, release.sourceCommit);
async function hash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
if (!existsSync(envelope)) execFileSync(process.execPath,
  ['scripts/windows/sign-update.mjs', key, cafe, zip, envelope, ...from], { cwd: root, windowsHide: true, stdio: 'inherit' });
// Retries reuse only the exact signed envelope, including its predecessor allowlist.
const signedBytes = readFileSync(envelope), signed = JSON.parse(signedBytes);
const payload = Buffer.from(signed.payload, 'base64');
assert.ok(verify(null, payload, createPublicKey(readFileSync(key)), Buffer.from(signed.signature, 'base64')));
assert.deepEqual(JSON.parse(payload), { protocol: 1, tag, commit: release.sourceCommit, from,
  sha256: await hash(zip), filesSha256: await hash(path.join(cafe, 'SHA256.json')) });
// Verify the actual ZIP, not only the independently accepted source folders.
const scratch = await mkdtemp(path.join(tmpdir(), 'cafe-publication-check-'));
try {
  const unpacked = path.join(scratch, 'package');
  await extractWindowsZip(zip, unpacked, AbortSignal.timeout(180_000));
  await verifyPackage(unpacked, readSignedUpdate(signed, createPublicKey(readFileSync(key))), cafe, release);
} finally { await rm(scratch, { recursive: true, force: true }); }
await publishVerifiedRelease({ gh, repo, tag, files: [zip, envelope], title: `Café ${release.appVersion}`, notes,
  prerelease: false,
  verifyPublic: async ({ name, size, sha256 }) => {
    const response = await fetch(`https://github.com/${repo}/releases/download/${tag}/${name}`,
      { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
    assert.ok(response.ok && response.body, 'Published asset unavailable.');
    const digest = createHash('sha256'); let received = 0;
    for await (const bytes of response.body) { received += bytes.length; assert.ok(received <= size); digest.update(bytes); }
    assert.equal(received, size); assert.equal(digest.digest('hex'), sha256);
  },
  promote: async () => {
    assert.equal(await hash(envelope), createHash('sha256').update(signedBytes).digest('hex'), 'Signed envelope changed during publication.');
    console.log(JSON.stringify({ state: 'accepted-cafe-update-published', tag,
    familyRelease: release.familyRelease, sourceCommit: release.sourceCommit, installed: false,
    limits: 'Only enrolled compatible Café machines can consume this signed update. Schema changes require separate maintenance.' }));
  },
});
