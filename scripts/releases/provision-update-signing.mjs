import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const [privateFile, publicFile] = process.argv.slice(2);
assert.ok(privateFile && publicFile && path.isAbsolute(privateFile) && path.isAbsolute(publicFile),
  'Use node provision-update-signing.mjs <private-key-outside-repository> <public-key-file>.');
const relative = path.relative(root, privateFile);
assert.ok(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep),
  'Keep the release signing key outside the repository.');
const privateDirectory = path.dirname(privateFile);
mkdirSync(privateDirectory, { recursive: true });
if (process.platform === 'win32') {
  const user = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim();
  execFileSync('icacls.exe', [privateDirectory, '/inheritance:r', '/grant:r', user + ':(OI)(CI)F', 'SYSTEM:(OI)(CI)F'],
    { windowsHide: true, stdio: 'ignore' });
}
if (!existsSync(privateFile)) {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
}
const privateKey = createPrivateKey(readFileSync(privateFile));
assert.equal(privateKey.asymmetricKeyType, 'ed25519');
const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
if (existsSync(publicFile)) assert.equal(createPublicKey(readFileSync(publicFile)).export({ type: 'spki', format: 'pem' }), publicPem,
  'Existing update trust does not match this signer.');
else {
  mkdirSync(path.dirname(publicFile), { recursive: true });
  writeFileSync(publicFile, publicPem, { flag: 'wx' });
}
console.log('Persistent release signing key and public update trust are ready.');
