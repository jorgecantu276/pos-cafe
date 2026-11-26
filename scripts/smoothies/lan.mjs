import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { lanOrigin, startLanFront } from '../customer/lan.mjs';

const inside = (parent, child) => { const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const local = value => typeof value === 'string' && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value);
export async function readSmoothiesLan(env, { sourceRoot = path.resolve(import.meta.dirname, '../..'), interfaces = networkInterfaces() } = {}) {
  const values = [env.SMOOTHIES_LAN_ORIGIN, env.SMOOTHIES_LAN_CERT_FILE, env.SMOOTHIES_LAN_KEY_FILE];
  if (values.every(value => !value)) return null;
  assert.ok(values.every(Boolean), 'La configuración HTTPS de Smoothies está incompleta. Repite la configuración de red.');
  const bind = lanOrigin(values[0]);
  assert.ok(bind.port !== 3180 && bind.port !== 58000 && bind.port !== 55432, 'Usa un puerto HTTPS distinto de los servicios internos.');
  assert.ok(Object.values(interfaces).flat().some(entry => entry && !entry.internal && entry.address === bind.address), 'La dirección privada configurada no pertenece a esta PC. Revisa su reserva de red.');
  const [certFile, keyFile] = values.slice(1);
  const actualRoot = await realpath(sourceRoot);
  for (const file of [certFile, keyFile]) {
    assert.ok(local(file) && !inside(sourceRoot, file), 'Conserva certificado y clave HTTPS en una carpeta privada fuera del código.');
    const info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Usa los archivos HTTPS privados provisionados.');
    assert.ok(!inside(actualRoot, await realpath(file)), 'Conserva certificado y clave HTTPS fuera del código y de los paquetes.');
  }
  const cert = new X509Certificate(await readFile(certFile));
  assert.equal(cert.checkIP(bind.address), bind.address, 'El certificado HTTPS no corresponde a la IP de esta PC.');
  assert.ok(Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(), 'El certificado HTTPS no está vigente. Requiere renovación y aceptación.');
  assert.ok(cert.checkPrivateKey(createPrivateKey(await readFile(keyFile))), 'La clave HTTPS no corresponde al certificado.');
  const identity = cert.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  return { ...bind, certFile, keyFile, fingerprint: cert.fingerprint256, identity };
}

export async function openSmoothiesLan(config) {
  if (!config) return null;
  return startLanFront({ origin: config.origin, appPort: 3180, certFile: config.certFile, keyFile: config.keyFile });
}
