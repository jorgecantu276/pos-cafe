import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestOriginMatches } from '../lib/request-origin';
import { requireLocalPrintRequest } from '../lib/print-dispatch-server';

const visible = 'https://192.168.1.25:3443';
const env = { POS_LAN_MODE: '1', POS_PUBLIC_ORIGIN: visible };
const input = (method = 'POST', headers: Record<string, string> = {}) => new Request('http://localhost:3180/api/printing', {
  method, headers: { host: '192.168.1.25:3443', origin: visible, 'x-pos-print': '1', ...headers },
});

test('one visible HTTPS origin validates LAN routes despite Next loopback normalization', () => {
  assert.ok(requestOriginMatches(input(), { env, loopbackOnly: true }));
  for (const headers of [{ origin: 'http://192.168.1.25:3443' }, { origin: 'null' }, { host: 'evil.invalid' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
    assert.equal(requestOriginMatches(input('POST', headers), { env }), false);
  }
  const absent = input(); absent.headers.delete('origin');
  assert.equal(requestOriginMatches(absent, { env }), false);
  const get = input('GET'); get.headers.delete('origin');
  assert.equal(requestOriginMatches(get, { env }), true);
  assert.equal(requestOriginMatches(input(), { env: { ...env, POS_PUBLIC_ORIGIN: 'https://8.8.8.8:3443' } }), false);
  assert.equal(requestOriginMatches(input(), { env: { ...env, POS_PUBLIC_ORIGIN: visible + '/elsewhere' } }), false);
  const spoofed = new Request('http://evil.invalid/api/printing', { headers: { host: new URL(visible).host, origin: visible } });
  assert.equal(requestOriginMatches(spoofed, { env }), false);
});

test('legacy loopback checkpoint requests remain valid without Origin; forwarded headers confer no trust', () => {
  assert.ok(requestOriginMatches(new Request('http://localhost:3180/api/backups', { method: 'POST' }), { env: {}, loopbackOnly: true }));
  assert.equal(requestOriginMatches(input(), { env: {}, loopbackOnly: true }), false);
  const spoofed = input('POST', { host: 'evil.invalid', 'x-forwarded-host': new URL(visible).host, 'x-forwarded-proto': 'https' });
  assert.equal(requestOriginMatches(spoofed, { env }), false);
});

test('existing PC print handler accepts the configured LAN but retains its explicit request marker', () => {
  const previous = { POS_LAN_MODE: process.env.POS_LAN_MODE, POS_PUBLIC_ORIGIN: process.env.POS_PUBLIC_ORIGIN };
  Object.assign(process.env, env);
  try {
    assert.doesNotThrow(() => requireLocalPrintRequest(input()));
    const missing = input(); missing.headers.delete('x-pos-print');
    assert.throws(() => requireLocalPrintRequest(missing));
    assert.throws(() => requireLocalPrintRequest(input('POST', { origin: 'https://evil.invalid' })));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
