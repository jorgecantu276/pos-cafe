import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID, X509Certificate } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { lanOrigin } from '../customer/lan.mjs';
import { readSmoothiesLan } from './lan.mjs';

const execute = promisify(execFile);
const inside = (parent, child) => { const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const optionalStat = file => lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
const publicName = 'Smoothies-iPad-CA.cer';
const authorityNames = [publicName, 'Smoothies-iPad-CA.pem', 'authority.dpapi'];
export async function provisionSmoothiesLan({ origin, directory, renew = false, sourceRoot = path.resolve(import.meta.dirname, '../..'), interfaces = networkInterfaces() }) {
  const bind = lanOrigin(origin);
  assert.ok(path.isAbsolute(directory) && !/^(?:\\\\|\/\/)/.test(directory), 'Usa una carpeta HTTPS privada y local.');
  const actualRoot = await realpath(sourceRoot), parent = await realpath(path.dirname(directory));
  assert.ok(!inside(actualRoot, path.join(parent, path.basename(directory))), 'No generes claves HTTPS dentro del código ni del paquete.');
  const existingDirectory = await optionalStat(directory);
  assert.ok(!existingDirectory || existingDirectory.isDirectory() && !existingDirectory.isSymbolicLink(), 'La carpeta HTTPS debe ser privada y no un enlace.');
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const lockFile = path.join(directory, 'setup.lock');
  const lock = await open(lockFile, 'wx', 0o600);
  const stage = path.join(directory, `.prepare-${randomUUID()}`);
  const authority = path.join(directory, 'authority');
  const currentFile = path.join(directory, 'current.json');
  let staged = false;
  const validate = async (leaf, issuer) => {
    const config = await readSmoothiesLan({ SMOOTHIES_LAN_ORIGIN: bind.origin,
      SMOOTHIES_LAN_CERT_FILE: path.join(leaf, 'server.pem'), SMOOTHIES_LAN_KEY_FILE: path.join(leaf, 'server-key.pem') }, { sourceRoot, interfaces });
    const caFile = path.join(issuer, publicName), caInfo = await lstat(caFile);
    assert.ok(caInfo.isFile() && !caInfo.isSymbolicLink(), 'La autoridad HTTPS debe ser un archivo privado provisionado.');
    const ca = new X509Certificate(await readFile(caFile));
    const cert = new X509Certificate(await readFile(config.certFile));
    assert.ok(ca.ca && cert.verify(ca.publicKey), 'La autoridad HTTPS guardada no corresponde al certificado.');
    return { origin: config.origin, certFile: config.certFile, keyFile: config.keyFile,
      publicCertificate: path.join(authority, publicName), fingerprint: ca.fingerprint256 };
  };
  try {
    const issuer = await optionalStat(authority);
    if (issuer) {
      assert.ok(issuer.isDirectory() && !issuer.isSymbolicLink(), 'La autoridad privada no puede ser un enlace.');
      for (const name of authorityNames) {
        const info = await lstat(path.join(authority, name));
        assert.ok(info.isFile() && !info.isSymbolicLink(), 'La autoridad HTTPS existente está incompleta. No se reemplazó su confianza.');
      }
    }
    if (!renew && await optionalStat(currentFile)) {
      const info = await lstat(currentFile); assert.ok(info.isFile() && !info.isSymbolicLink());
      const current = JSON.parse(await readFile(currentFile, 'utf8'));
      assert.ok(current.version === 1 && /^leaf-[a-f0-9-]{36}$/.test(current.leaf), 'Revisa la selección HTTPS guardada.');
      return { ...await validate(path.join(directory, current.leaf), authority), existing: true };
    }
    assert.equal(process.platform, 'win32', 'La configuración inicial HTTPS se prepara en la PC Windows.');
    await mkdir(stage, { mode: 0o700 }); staged = true;
    const stagedAuthority = path.join(stage, 'authority'), leafName = `leaf-${randomUUID()}`, stagedLeaf = path.join(stage, leafName);
    await mkdir(stagedAuthority); await mkdir(stagedLeaf);
    if (issuer) for (const name of authorityNames) await copyFile(path.join(authority, name), path.join(stagedAuthority, name));
    const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    await execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(import.meta.dirname, 'New-LanCertificate.ps1'), '-Address', bind.address, '-Directory', stagedAuthority, '-LeafDirectory', stagedLeaf], { windowsHide: true });
    const result = await validate(stagedLeaf, stagedAuthority);
    if (issuer) assert.equal(result.fingerprint, new X509Certificate(await readFile(path.join(authority, publicName))).fingerprint256, 'La renovación no puede cambiar la confianza HTTPS.');
    else await rename(stagedAuthority, authority);
    const leaf = path.join(directory, leafName); await rename(stagedLeaf, leaf);
    const pending = path.join(stage, 'current.json');
    await writeFile(pending, JSON.stringify({ version: 1, leaf: leafName, origin: bind.origin, caFingerprint: result.fingerprint }) + '\n', { mode: 0o600 });
    await rename(pending, currentFile);
    return { ...result, certFile: path.join(leaf, 'server.pem'), keyFile: path.join(leaf, 'server-key.pem'), existing: false };
  } finally {
    await lock.close(); await unlink(lockFile);
    if (staged) {
      // Remove only fixed generated files in this invocation's owned staging.
      for (const name of authorityNames) await unlink(path.join(stage, 'authority', name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(path.join(stage, 'authority')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      // A failed validation preserves its leaf evidence for diagnosis; no source/data trees are removed.
      await rmdir(stage).catch(error => { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; });
    }
  }
}

async function main() {
  const [origin, directory, mode] = process.argv.slice(2);
  try { assert.ok(!mode || mode === '--renew'); console.log(JSON.stringify(await provisionSmoothiesLan({ origin, directory, renew: mode === '--renew' }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
