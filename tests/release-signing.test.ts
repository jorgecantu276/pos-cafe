import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signSmoothiesUpdate } from '../scripts/releases/sign-smoothies-update.mjs';

test('release signer authenticates the exact product/version/archive and rejects dirty, mismatched or incomplete packages', { skip: process.platform !== 'win32' }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'pos-signing-'));
  const packageDirectory = path.join(folder, 'package');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyFile = path.join(folder, 'private.pem');
  const zipFile = path.join(folder, 'POS-Smoothies-1.0.0-rc.3.zip');
  const outputFile = path.join(folder, 'pilot.json');
  const release = { version: 1, product: 'smoothies', sourceDirty: false, familySourceDirty: false,
    sourceCommit: 'a'.repeat(40), familySourceCommit: 'a'.repeat(40), id: 'b'.repeat(16),
    databaseContract: 'c'.repeat(64), appVersion: '1.0.0-rc.3', familyRelease: 'pos-v1.0.0-rc.3', releaseLabel: 'smoothies-v1.0.0-rc.3' };
  const options = { keyFile, packageDirectory, zipFile, outputFile,
    zipUrl: 'https://github.com/jorgecantu276/pos-cafe/releases/download/pos-v1.0.0-rc.3/POS-Smoothies-1.0.0-rc.3.zip' };
  try {
    await mkdir(packageDirectory);
    await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await writeFile(path.join(packageDirectory, 'update-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    await writeFile(path.join(packageDirectory, 'release.json'), JSON.stringify(release));
    await writeFile(path.join(packageDirectory, 'update-policy.json'), JSON.stringify({ protocol: 1, enabled: true, product: 'smoothies', channel: 'pilot' }));
    for (const file of ['node.exe', 'app/server.js', 'app/scripts/smoothies/auto-update.mjs', 'app/scripts/smoothies/start-local.mjs', 'app/supabase/schema.snapshot.json']) {
      await mkdir(path.dirname(path.join(packageDirectory, file)), { recursive: true });
      await writeFile(path.join(packageDirectory, file), 'synthetic file');
    }
    const index: Array<{file: string; sha256: string}> = [];
    async function walk(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else index.push({ file: path.relative(packageDirectory, full).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
      }
    }
    await walk(packageDirectory);
    const indexedFiles = JSON.stringify(index);
    await writeFile(path.join(packageDirectory, 'SHA256.json'), indexedFiles);
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/releases/archive-package.ps1'),
      '-Mode', 'Create', '-Source', packageDirectory, '-Destination', zipFile], { windowsHide: true });
    await signSmoothiesUpdate(options);
    const envelope = JSON.parse(await readFile(outputFile, 'utf8'));
    const payload = Buffer.from(envelope.payload, 'base64');
    assert.ok(verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64')));
    assert.equal(JSON.parse(payload.toString()).sha256, createHash('sha256').update(await readFile(zipFile)).digest('hex'));
    assert.equal(verify(null, Buffer.from(payload.toString().replace('rc.3', 'rc.4')), publicKey, Buffer.from(envelope.signature, 'base64')), false);
    await signSmoothiesUpdate(options); // A publication interrupted after signing can resume.
    await rm(outputFile);
    await writeFile(path.join(packageDirectory, 'release.json'), JSON.stringify({ ...release, sourceDirty: true }));
    await assert.rejects(signSmoothiesUpdate(options));
    await writeFile(path.join(packageDirectory, 'release.json'), JSON.stringify({ ...release, product: 'cafe' }));
    await assert.rejects(signSmoothiesUpdate(options));
    await writeFile(path.join(packageDirectory, 'release.json'), JSON.stringify(release));
    await assert.rejects(signSmoothiesUpdate({ ...options, zipUrl: 'http://github.com/unsafe.zip' }));
    await writeFile(path.join(packageDirectory, 'SHA256.json'), '[]');
    await assert.rejects(signSmoothiesUpdate(options));
    await writeFile(path.join(packageDirectory, 'SHA256.json'), indexedFiles);
    await writeFile(path.join(packageDirectory, 'app/server.js'), 'different bytes from the ZIP');
    const changedIndex = index.map(row => row.file === 'app/server.js' ? { ...row, sha256: createHash('sha256').update('different bytes from the ZIP').digest('hex') } : row);
    await writeFile(path.join(packageDirectory, 'SHA256.json'), JSON.stringify(changedIndex));
    await assert.rejects(signSmoothiesUpdate(options), /Indice de archivos invalido/);
    const other = generateKeyPairSync('ed25519').publicKey;
    await writeFile(path.join(packageDirectory, 'update-public-key.pem'), other.export({ type: 'spki', format: 'pem' }));
    await assert.rejects(signSmoothiesUpdate(options), /another release signer/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
