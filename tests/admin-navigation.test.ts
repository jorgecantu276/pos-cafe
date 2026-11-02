import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as ts from 'typescript';
import Administration from '../app/admin/page';

const nodeRequire = createRequire(import.meta.url);
function load(file: string, navigation: object) {
  const source = readFileSync(new URL(`../app/admin/${file}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports: { default?: ComponentType<{ children?: string; inventoryEnabled?: boolean }> } = {};
  new Function('require', 'exports', compiled)((name: string) =>
    name === 'next/navigation' ? navigation : name.endsWith('.css') ? {} : nodeRequire(name), exports);
  return exports.default!;
}

test('administration opens four workflows and keeps configuration separate from daily work', () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(Administration)));
  try {
    const links = [...dom.window.document.querySelectorAll('[aria-label="Herramientas principales"] a')];
    assert.deepEqual(links.map(link => link.querySelector('strong')?.textContent), ['Ventas', 'Caja', 'Catálogo', 'Clientes']);
    assert.deepEqual(links.map(link => link.getAttribute('href')), ['/admin/ventas', '/admin/cortes', '/admin/productos', '/admin/clientes']);
    assert.ok(dom.window.document.querySelector('a[href="/admin/configuracion"]'));
    assert.equal(dom.window.document.querySelector('details'), null);
  } finally { dom.window.close(); }
});

test('related screens retain their shared area navigation and a path back to administration', () => {
  for (const [path, area, sibling] of [
    ['/admin/favoritos', 'Catálogo', '/admin/productos'],
    ['/admin/productos', 'Catálogo', '/admin/favoritos'],
    ['/admin/inventario', 'Catálogo', '/admin/productos'],
    ['/admin/caja', 'Caja', '/admin/cortes'],
    ['/admin/cortes', 'Caja', '/admin/caja'],
  ]) {
    const Shell = load('AdminShell.tsx', { usePathname: () => path });
    const dom = new JSDOM(renderToStaticMarkup(createElement(Shell, { inventoryEnabled: path === '/admin/inventario' }, 'Workflow')));
    try {
      const nav = dom.window.document.querySelector(`[aria-label="Secciones de ${area}"]`)!;
      assert.ok(nav.querySelector(`a[href="${sibling}"]`));
      if (area === 'Catálogo') assert.equal(Boolean(nav.querySelector('a[href="/admin/inventario"]')), path === '/admin/inventario');
      assert.equal(nav.querySelector('[aria-current="page"]')?.getAttribute('href'), path);
      assert.ok(dom.window.document.querySelector('header a[href="/admin"]'));
    } finally { dom.window.close(); }
  }
});

test('old cancellation, coupon and informational settings bookmarks lead to working areas', () => {
  for (const [file, target] of [
    ['cancelaciones/page.tsx', '/admin/ventas'], ['cupones/page.tsx', '/admin/ventas'],
    ['ajustes/page.tsx', '/admin/configuracion'],
  ]) {
    const Retired = load(file, { redirect: (url: string) => { assert.equal(url, target); throw Error('redirected'); } });
    assert.throws(() => renderToStaticMarkup(createElement(Retired)), /redirected/);
  }
});
