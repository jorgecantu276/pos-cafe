import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as settings from '../app/admin/Settings';
import * as resource from '../lib/use-resource';

function backupPage() {
  const code = ts.transpileModule(readFileSync(new URL('../app/admin/respaldos/page.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const nodeRequire = createRequire(import.meta.url), imports: Record<string, unknown> = {
    '@/lib/pos-profile': { posProfile: { id: 'smoothies' } }, '../Settings': settings, '@/lib/use-resource': resource,
  };
  const exports: { default?: ComponentType } = {};
  new Function('require', 'exports', code)((name: string) => imports[name] || nodeRequire(name), exports);
  return exports.default!;
}

test('actual Smoothies backup page keeps local recovery available when external copying fails, then shows its verified recovery', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://192.168.1.25:3443/admin/respaldos' });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const archive = { createdAt: '2026-11-26T18:00:00Z', filename: 'encrypted-fixture.posbackup', bytes: 1024, sha256: 'a'.repeat(64) };
  let external: { configured: boolean; state: string; lastSuccess?: typeof archive; lastError?: string } = { configured: false, state: 'pending' };
  const requests: RequestInit[] = [];
  let failRead = false;
  const fetcher = async (_input: unknown, init?: RequestInit) => {
    requests.push(init || {});
    if (failRead && init?.method !== 'POST') { failRead = false; throw Error('synthetic read failure'); }
    return Response.json({ version: 1, enabled: true, running: false, lastSuccess: archive, externalCopy: external });
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (name: string) => { const found = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === name); assert.ok(found); return found; };
  try {
    await act(async () => root.render(createElement(backupPage())));
    assert.match(dom.window.document.body.textContent!, /falta elegir el dispositivo/);
    assert.ok(dom.window.document.querySelector('a[href="/api/backups?download=latest"]'));
    external = { configured: true, state: 'failed', lastError: 'El respaldo local se conserva.' };
    await act(async () => button('Actualizar').click());
    assert.match(dom.window.document.body.textContent!, /Requiere revisión/);
    assert.doesNotMatch(dom.window.document.body.textContent!, /El último respaldo no se completó/);
    assert.equal(button('Crear respaldo').disabled, false);
    assert.ok(dom.window.document.querySelector('a[href="/api/backups?download=latest"]'));
    failRead = true;
    await act(async () => button('Actualizar').click());
    assert.match(dom.window.document.body.textContent!, /No se pudieron cargar los respaldos/);
    external = { configured: true, state: 'copied', lastSuccess: archive };
    await act(async () => button('Crear respaldo').click());
    assert.match(dom.window.document.body.textContent!, /Verificada/);
    assert.doesNotMatch(dom.window.document.body.textContent!, /Requiere revisión/);
    assert.doesNotMatch(dom.window.document.body.textContent!, /No se pudieron cargar los respaldos/);
    const write = requests.find(request => request.method === 'POST'); assert.ok(write);
    assert.equal(new Headers(write.headers).get('X-Pos-Backup'), '1');
    assert.match(dom.window.document.body.textContent!, /clave se conserva por separado/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('a background backup finishes without manual refresh; polling survives a read failure, stays serial and stops on unmount', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://192.168.1.25:3443/admin/respaldos' });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const timers = new Map<number, () => Promise<void>>();
  let timerId = 0, reads = 0, inFlight: AbortSignal | undefined;
  let complete: ((response: Response) => void) | undefined;
  dom.window.setTimeout = ((callback: () => Promise<void>) => { timers.set(++timerId, callback); return timerId; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof dom.window.clearTimeout;
  const archive = { createdAt: '2026-11-26T18:00:00Z', filename: 'completed.posbackup', bytes: 1024, sha256: 'a'.repeat(64) };
  const status = (running: boolean) => Response.json({ version: 1, enabled: true, running, ...(running ? {} : { lastSuccess: archive }) });
  const fetcher = async (_input: unknown, init?: RequestInit) => {
    assert.notEqual(init?.method, 'POST', 'Observing a background backup must never start another one.');
    reads++;
    if (reads === 1 || reads === 4) return status(true);
    if (reads === 2) throw Error('synthetic temporary read failure');
    inFlight = init?.signal ?? undefined;
    return new Promise<Response>(resolve => { complete = resolve; });
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (name: string) => { const found = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === name); assert.ok(found); return found; };
  const tick = () => {
    assert.equal(timers.size, 1);
    const [id, callback] = [...timers][0]; timers.delete(id); return callback();
  };
  let mounted = true;
  try {
    await act(async () => root.render(createElement(backupPage())));
    assert.equal(button('Crear respaldo').disabled, true);
    await act(async () => { await tick(); });
    assert.match(dom.window.document.body.textContent!, /No se pudieron cargar los respaldos/);
    assert.equal(button('Crear respaldo').disabled, true);
    let pending: Promise<void> | undefined;
    await act(async () => { pending = tick(); });
    assert.equal(reads, 3);
    assert.equal(timers.size, 0, 'A slow status request must finish before another poll is scheduled.');
    await act(async () => { complete!(status(false)); await pending; });
    assert.equal(button('Crear respaldo').disabled, false);
    assert.doesNotMatch(dom.window.document.body.textContent!, /No se pudieron cargar los respaldos|En curso/);
    assert.ok(dom.window.document.querySelector('a[href="/api/backups?download=latest"]'));
    assert.equal(timers.size, 0, 'Polling stops after the observed operation finishes.');

    // A later background operation starts a new read cycle. Leaving that page
    // aborts the in-flight read and must never schedule another poll.
    await act(async () => button('Actualizar').click());
    assert.equal(button('Crear respaldo').disabled, true);
    await act(async () => { pending = tick(); });
    assert.equal(reads, 5);
    assert.equal(inFlight?.aborted, false);
    await act(async () => { root.unmount(); mounted = false; await pending; });
    assert.equal(inFlight?.aborted, true);
    complete!(status(false));
    await act(async () => { await Promise.resolve(); });
    assert.equal(timers.size, 0);
    assert.equal(reads, 5);
  } finally {
    if (mounted) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
