import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { createServer as netServer } from 'node:net';
import { X509Certificate, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { provisionSmoothiesLan } from '../scripts/smoothies/provision-lan.mjs';
import { readSmoothiesLan } from '../scripts/smoothies/lan.mjs';
import { lanPathAllowed, startLanFront } from '../scripts/customer/lan.mjs';

const ip = '192.168.245.10';
const syntheticInterfaces = { fixture: [{ address: ip, internal: false, family: 'IPv4' as const,
  netmask: '255.255.255.0', cidr: `${ip}/24`, mac: '00:00:00:00:00:00' }] };
const envFor = (config: { origin: string; certFile: string; keyFile: string }) => ({ SMOOTHIES_LAN_ORIGIN: config.origin,
  SMOOTHIES_LAN_CERT_FILE: config.certFile, SMOOTHIES_LAN_KEY_FILE: config.keyFile });

test('retained loopback settings remain supported, partial or nonprivate LAN settings refuse', async () => {
  assert.equal(await readSmoothiesLan({}), null);
  await assert.rejects(readSmoothiesLan({ SMOOTHIES_LAN_ORIGIN: `https://${ip}:3443` }), /incompleta/);
  await assert.rejects(readSmoothiesLan({ SMOOTHIES_LAN_ORIGIN: 'https://8.8.8.8:3443', SMOOTHIES_LAN_CERT_FILE: 'x', SMOOTHIES_LAN_KEY_FILE: 'y' }), /private/);
  for (const route of ['/ops-demo', '/api/ops-demo/access', '/api/local-instance', '/api/demo/reset']) assert.equal(lanPathAllowed(route), false);
  assert.equal(lanPathAllowed('/api/backend/rest/v1/products'), true);
});

test('actual PS5.1 setup reuses trust, renews immutable IP certificates and rejects altered keys',
  { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'smoothies-lan-setup-')), sourceRoot = path.join(base, 'app');
    await mkdir(sourceRoot);
    const options = { origin: `https://${ip}:3443`, directory: path.join(base, 'https'), sourceRoot, interfaces: syntheticInterfaces };
    const first = await provisionSmoothiesLan(options);
    const cert = new X509Certificate(await readFile(first.certFile)), key = createPrivateKey(await readFile(first.keyFile));
    assert.equal(cert.checkIP(ip), ip); assert.ok(cert.checkPrivateKey(key));
    assert.equal(cert.publicKey.asymmetricKeyDetails?.modulusLength, 2048);
    assert.ok(Date.parse(cert.validTo) - Date.parse(cert.validFrom) <= 366 * 86_400_000);
    const firstKey = await readFile(first.keyFile);
    const reused = await provisionSmoothiesLan(options);
    assert.equal(reused.existing, true); assert.equal(reused.certFile, first.certFile);
    const renewed = await provisionSmoothiesLan({ ...options, renew: true });
    assert.equal(renewed.fingerprint, first.fingerprint);
    assert.notEqual(renewed.certFile, first.certFile);
    assert.deepEqual(await readFile(first.keyFile), firstKey);
    await assert.rejects(readSmoothiesLan(envFor(first), { sourceRoot, interfaces: {} }), /no pertenece/);
    await assert.rejects(provisionSmoothiesLan({ ...options, origin: 'https://192.168.245.11:3443',
      interfaces: { fixture: [{ ...syntheticInterfaces.fixture[0], address: '192.168.245.11' }] } }), /IP/);
    await writeFile(renewed.keyFile, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await assert.rejects(readSmoothiesLan(envFor(renewed), { sourceRoot, interfaces: syntheticInterfaces }), /no corresponde/);
  });

test('real HTTPS front accepts the generated CA and forwards only the intended app surface',
  { skip: process.platform !== 'win32', timeout: 30_000 }, async t => {
    const address = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal &&
      /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address))?.address;
    if (!address) { t.skip('No private IPv4 interface is present in this test host.'); return; }
    const portReservation = netServer(); await new Promise<void>(resolve => portReservation.listen(0, address, resolve));
    const bound = portReservation.address(); assert.ok(bound && typeof bound === 'object');
    const port = bound.port; await new Promise<void>(resolve => portReservation.close(() => resolve()));
    const base = await mkdtemp(path.join(tmpdir(), 'smoothies-lan-front-'));
    const config = await provisionSmoothiesLan({ origin: `https://${address}:${port}`, directory: path.join(base, 'https') });
    const app = createServer((incoming, response) => { response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ path: incoming.url, host: incoming.headers.host, forwarded: incoming.headers['x-forwarded-proto'], launch: incoming.headers['x-pos-launch-token'] })); });
    await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
    const appAddress = app.address(); assert.ok(appAddress && typeof appAddress === 'object');
    const front = await startLanFront({ origin: config.origin, appPort: appAddress.port, certFile: config.certFile, keyFile: config.keyFile });
    const ca = new X509Certificate(await readFile(config.publicCertificate)).toString();
    const get = (url: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const response = request(url, { ca, headers: { 'x-pos-launch-token': 'must-not-forward' } }, stream => {
        let body = ''; stream.on('data', data => { body += data; }); stream.on('end', () => resolve({ status: stream.statusCode!, body }));
      }); response.on('error', reject); response.end();
    });
    try {
      const response = await get(`${config.origin}/api/backend/auth/v1/token`);
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.body), { path: '/api/backend/auth/v1/token', host: new URL(config.origin).host, forwarded: 'https' });
      assert.equal((await get(`${config.origin}/api/local-instance`)).status, 404);
      assert.equal((await get(`${config.origin}/ops-demo`)).status, 404);
    } finally { await front.close(); await new Promise<void>(resolve => app.close(() => resolve())); }
  });
