import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ProductPhoto from '../components/ProductPhoto';
import { stockProductPhoto } from '../lib/product-photos';

test('all 82 menu products have bundled, bounded stock assets with licensed sources', () => {
  const menu = JSON.parse(readFileSync(new URL('./fixtures/real-menu.json', import.meta.url), 'utf8'));
  const sources = JSON.parse(readFileSync(new URL('../public/product-photos/sources.json', import.meta.url), 'utf8'));
  assert.equal(menu.products.length, 82);
  for (const product of menu.products) {
    const photo = stockProductPhoto(product.name, product.category);
    assert.ok(sources.photos.some((entry: { file: string }) => photo.endsWith('/' + entry.file)), product.name);
    const file = new URL('../public' + photo, import.meta.url);
    const header = readFileSync(file);
    assert.equal(header.toString('ascii', 0, 4), 'RIFF');
    assert.equal(header.toString('ascii', 8, 12), 'WEBP');
    assert.ok(statSync(file).size < 40_000, product.name);
  }
  assert.ok(sources.photos.reduce((size: number, entry: { file: string }) =>
    size + statSync(new URL('../public/product-photos/' + entry.file, import.meta.url)).size, 0) < 350_000);
});

test('a broken merchant photo recovers locally and a different product can load its own photo', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = async (name: string, image_url?: string) => act(async () => {
    root.render(createElement(ProductPhoto, { product: { name, image_url }, width: 72, height: 72 }));
  });
  const image = () => dom.window.document.querySelector('img')!;
  try {
    await render('Brownie tradicional', 'https://example.test/broken.jpg');
    assert.equal(image().getAttribute('src'), 'https://example.test/broken.jpg');
    await act(async () => { image().dispatchEvent(new dom.window.Event('error')); });
    assert.equal(image().getAttribute('src'), '/product-photos/brownie.webp');
    await render('Matcha cariño', 'https://example.test/matcha.jpg');
    assert.equal(image().getAttribute('src'), 'https://example.test/matcha.jpg');
    await render('Matcha cariño', 'not a URL');
    assert.equal(image().getAttribute('src'), '/product-photos/matcha.webp');
    await render('Brownie tradicional');
    assert.equal(image().getAttribute('src'), '/product-photos/brownie.webp');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
