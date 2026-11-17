import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { extractWindowsZip, verifyPackage } from '../smoothies/auto-update.mjs';

export async function signSmoothiesUpdate({ keyFile, packageDirectory, zipFile, zipUrl, outputFile }) {
  const readJson = async name => JSON.parse((await readFile(path.join(packageDirectory, name), 'utf8')).replace(/^\uFEFF/, ''));
  const release = await readJson('release.json');
  const policy = await readJson('update-policy.json');
  assert.equal(release.version, 1);
  assert.equal(release.product, 'smoothies');
  assert.equal(release.sourceDirty, false);
  assert.equal(release.familySourceDirty, false);
  assert.match(release.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(release.familySourceCommit, release.sourceCommit);
  assert.match(release.id, /^[a-f0-9]{16}$/);
  assert.match(release.databaseContract, /^[a-f0-9]{64}$/);
  assert.match(release.appVersion, /^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/);
  assert.equal(release.familyRelease, 'pos-v' + release.appVersion);
  assert.equal(release.releaseLabel, 'smoothies-v' + release.appVersion);
  assert.equal(policy.protocol, 1);
  assert.equal(policy.enabled, true);
  assert.equal(policy.product, 'smoothies');
  assert.equal(policy.channel, 'pilot');
  const url = new URL(zipUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.username + url.password + url.hash + url.search, '');
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.pathname, '/jorgecantu276/pos-cafe/releases/download/' + release.familyRelease + '/POS-Smoothies-' + release.appVersion + '.zip');
  assert.equal(path.basename(zipFile), 'POS-Smoothies-' + release.appVersion + '.zip');
  const key = createPrivateKey(await readFile(keyFile));
  assert.equal(key.asymmetricKeyType, 'ed25519');
  assert.equal(createPublicKey(key).export({ type: 'spki', format: 'pem' }),
    createPublicKey(await readFile(path.join(packageDirectory, 'update-public-key.pem'))).export({ type: 'spki', format: 'pem' }),
    'The package trusts another release signer.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(zipFile)) hash.update(bytes);
  const files = await readFile(path.join(packageDirectory, 'SHA256.json'));
  const metadata = { protocol: 1, product: 'smoothies', channel: policy.channel,
    appVersion: release.appVersion, familyRelease: release.familyRelease, sourceCommit: release.sourceCommit,
    packageId: release.id, databaseContract: release.databaseContract, zipUrl: url.href,
    sha256: hash.digest('hex'), filesSha256: createHash('sha256').update(files).digest('hex'),
    publishedAt: new Date().toISOString(),
  };
  await verifyPackage(packageDirectory, metadata, release);
  const scratch = await mkdtemp(path.join(tmpdir(), 'smoothies-signing-'));
  try {
    const unpacked = path.join(scratch, 'package');
    await extractWindowsZip(zipFile, unpacked, AbortSignal.timeout(180_000));
    await verifyPackage(unpacked, metadata, release);
  } finally { await rm(scratch, { recursive: true, force: true }); }
  // Reuse an already verified envelope after a publication interruption.
  const payload = Buffer.from(JSON.stringify(metadata));
  const signature = sign(null, payload, key);
  assert.ok(verify(null, payload, createPublicKey(key), signature));
  try {
    const previous = JSON.parse(await readFile(outputFile, 'utf8'));
    const bytes = Buffer.from(previous.payload, 'base64');
    assert.ok(verify(null, bytes, createPublicKey(key), Buffer.from(previous.signature, 'base64')));
    const priorMetadata = JSON.parse(bytes.toString('utf8'));
    const { publishedAt: _priorDate, ...prior } = priorMetadata;
    const { publishedAt: _nextDate, ...next } = metadata;
    assert.deepEqual(prior, next, 'The existing signed envelope belongs to another package.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(outputFile, JSON.stringify({ payload: payload.toString('base64'), signature: signature.toString('base64') }), { flag: 'wx' });
  }
  console.log('Signed ' + release.releaseLabel + ' for the ' + policy.channel + ' update channel.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [keyFile, packageDirectory, zipFile, zipUrl, outputFile] = process.argv.slice(2);
  assert.ok(keyFile && packageDirectory && zipFile && zipUrl && outputFile,
    'Use node sign-smoothies-update.mjs <private-key> <package-folder> <zip-file> <https-zip-url> <signed-manifest>.');
  signSmoothiesUpdate({ keyFile, packageDirectory, zipFile, zipUrl, outputFile }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
