import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';

export function lanOrigin(value) {
  const url = new URL(value), octets = url.hostname.split('.').map(Number);
  assert.equal(url.protocol, 'https:', 'LAN access requires HTTPS');
  assert.ok(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Use an exact HTTPS shop origin');
  assert.ok(octets.length === 4 && octets.every((part, index) => Number.isInteger(part) && part >= 0 && part <= 255 && String(part) === url.hostname.split('.')[index]), 'Use an exact private IPv4 address');
  assert.ok(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168), 'Bind only the selected private LAN address');
  const port = Number(url.port || 443); assert.ok(port >= 1024 && port <= 65535, 'Use a nonprivileged LAN port');
  return { origin: url.origin, host: url.host, address: url.hostname, port };
}
export function lanPathAllowed(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n\u0000]/.test(raw)) return false;
  let pathname; try { pathname = decodeURIComponent(new URL(raw, 'https://private.invalid').pathname); } catch { return false; }
  return !/^\/(?:demo|ops-demo|api\/(?:demo|ops-demo|local-instance))(?:\/|$)/i.test(pathname);
}

/** HTTPS front only; Next, Supabase gateway, database and privileged keys remain on loopback. */
export async function startLanFront({ origin, appPort, certFile, keyFile }) {
  const bind = lanOrigin(origin);
  assert.ok(Number.isInteger(appPort) && appPort >= 1024 && appPort <= 65535 && appPort !== bind.port, 'Choose a separate loopback application port');
  for (const file of [certFile, keyFile]) { assert.ok(typeof file === 'string' && path.isAbsolute(file)); const info = await lstat(file); assert.ok(info.isFile() && !info.isSymbolicLink(), 'Use provisioned certificate/key files'); }
  const cert = await readFile(certFile), key = await readFile(keyFile), certificate = new X509Certificate(cert);
  assert.equal(certificate.checkIP(bind.address), bind.address, 'Certificate must cover the selected LAN IP');
  assert.ok(Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now(), 'LAN certificate is not currently valid');
  const server = createServer({ cert, key, minVersion: 'TLSv1.2' }, (incoming, outgoing) => {
    if (incoming.headers.host !== bind.host || !lanPathAllowed(incoming.url)) { outgoing.writeHead(404, { 'Cache-Control': 'no-store' }); outgoing.end(); return; }
    const headers = { ...incoming.headers, host: bind.host, 'x-forwarded-proto': 'https', 'x-forwarded-host': bind.host };
    delete headers.forwarded; delete headers['x-forwarded-for']; delete headers['x-pos-launch-token'];
    const backend = httpRequest({ hostname: '127.0.0.1', port: appPort, method: incoming.method, path: incoming.url, headers, timeout: 30_000 }, response => {
      const forwarded = { ...response.headers }; delete forwarded['transfer-encoding']; delete forwarded.connection;
      if (forwarded.location) {
        try { const target = new URL(forwarded.location, bind.origin); if (target.host === bind.host) { target.protocol = 'https:'; forwarded.location = target.href; } } catch { delete forwarded.location; }
      }
      outgoing.writeHead(response.statusCode || 502, forwarded); response.pipe(outgoing);
    });
    backend.on('timeout', () => backend.destroy());
    backend.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(503, { 'Cache-Control': 'no-store' }); outgoing.end('El servidor del negocio no respondió.'); });
    incoming.on('aborted', () => backend.destroy()); incoming.pipe(backend);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(bind.port, bind.address, resolve); });
  return { server, origin: bind.origin, fingerprint: certificate.fingerprint256,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}

async function main() {
  const option = flag => process.argv[process.argv.indexOf(flag) + 1];
  for (const flag of ['--origin', '--app-port', '--cert', '--key']) assert.ok(process.argv.includes(flag), `Missing ${flag}`);
  const front = await startLanFront({ origin: option('--origin'), appPort: Number(option('--app-port')), certFile: option('--cert'), keyFile: option('--key') });
  console.log(`PUNTO LAN HTTPS READY ${front.origin} · certificate ${front.fingerprint}`);
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); }); await front.close();
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) void main();
