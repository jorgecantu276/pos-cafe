import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [keyFile, packageDir, zip, output, ...from] = process.argv.slice(2);
const commit = /^[0-9a-f]{40}$/;
assert.ok(keyFile && packageDir && zip && output && from.length && from.every(id => commit.test(id)),
  'Use: node sign-update.mjs <private-pem> <package-folder> <zip> <pos-update.json> <previous-commit> [...]');
const release = JSON.parse(await readFile(path.join(packageDir, 'release.json'), 'utf8'));
assert.equal(release.fixtureOnly, false, 'Sign only the verified Windows package for this café.');
assert.equal(release.sourceDirty, false);
assert.ok(commit.test(release.sourceCommit) && !from.includes(release.sourceCommit));
const revision = release.sourceCommit.slice(0, 7);
assert.equal(path.basename(zip), 'POS-Cafe-' + revision + '.zip');
assert.equal(path.basename(output), 'pos-update.json');
const hash = createHash('sha256');
for await (const bytes of createReadStream(zip)) hash.update(bytes);
const files = await readFile(path.join(packageDir, 'SHA256.json'));
const payload = Buffer.from(JSON.stringify({
  protocol: 1, tag: 'pos-' + revision, commit: release.sourceCommit, from,
  sha256: hash.digest('hex'), filesSha256: createHash('sha256').update(files).digest('hex'),
}));
const key = createPrivateKey(await readFile(keyFile));
assert.equal(key.asymmetricKeyType, 'ed25519');
const signature = sign(null, payload, key);
await writeFile(output, JSON.stringify({
  payload: payload.toString('base64'), signature: signature.toString('base64'),
}), { flag: 'wx' });
