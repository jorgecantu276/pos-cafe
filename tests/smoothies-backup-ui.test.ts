import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as settings from '../app/admin/Settings';

test('actual Smoothies backup page keeps local recovery available when external copying fails, then shows its verified recovery', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://192.168.1.25:3443/admin/respaldos' });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const archive = { createdAt: '2026-11-26T18:00:00Z', filename: 'encrypted-fixture.posbackup', bytes: 1024, sha256: 'a'.repeat(64) };
  let external: { configured: boolean; state: string; lastSuccess?: typeof archive; lastError?: string } = { configured: false, state: 'pending' };
  const requests: RequestInit[] = [];
  const fetcher = async (_input: unknown, init?: RequestInit) => {
    requests.push(init || {});
    return Response.json({ version: 1, enabled: true, running: false, lastSuccess: archive, externalCopy: external });
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const code = ts.transpileModule(readFileSync(new URL('../app/admin/respaldos/page.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const nodeRequire = createRequire(import.meta.url), imports: Record<string, unknown> = { '@/lib/pos-profile': { posProfile: { id: 'smoothies' } }, '../Settings': settings };
  const exports: { default?: ComponentType } = {};
  new Function('require', 'exports', code)((name: string) => imports[name] || nodeRequire(name), exports);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (name: string) => { const found = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === name); assert.ok(found); return found; };
  try {
    await act(async () => root.render(createElement(exports.default!)));
    assert.match(dom.window.document.body.textContent!, /falta elegir el dispositivo/);
    assert.ok(dom.window.document.querySelector('a[href="/api/backups?download=latest"]'));
    external = { configured: true, state: 'failed', lastError: 'El respaldo local se conserva.' };
    await act(async () => button('Actualizar').click());
    assert.match(dom.window.document.body.textContent!, /Requiere revisión/);
    assert.doesNotMatch(dom.window.document.body.textContent!, /El último respaldo no se completó/);
    assert.equal(button('Crear respaldo').disabled, false);
    assert.ok(dom.window.document.querySelector('a[href="/api/backups?download=latest"]'));
    external = { configured: true, state: 'copied', lastSuccess: archive };
    await act(async () => button('Crear respaldo').click());
    assert.match(dom.window.document.body.textContent!, /Verificada/);
    assert.doesNotMatch(dom.window.document.body.textContent!, /Requiere revisión/);
    const write = requests.find(request => request.method === 'POST'); assert.ok(write);
    assert.equal(new Headers(write.headers).get('X-Pos-Backup'), '1');
    assert.match(dom.window.document.body.textContent!, /clave se conserva por separado/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
