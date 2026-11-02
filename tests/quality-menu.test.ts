import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qualityMenuCatalog} from '../scripts/quality/menu-fixture.mjs';

const menu = JSON.parse(readFileSync(new URL('./fixtures/real-menu.json',import.meta.url),'utf8'));

test('quality preview keeps the 82 menu products and their confirmed milk wizard', () => {
  const catalog = qualityMenuCatalog(menu);
  assert.equal(catalog.products.length,82);
  assert.equal(catalog.products.filter(product => product.customizable).length,17);
  for (const [index,product] of catalog.products.entries()) {
    const source = menu.products[index];
    assert.equal(product.price,source.price_mxn);
    assert.equal(product.category,source.category);
    assert.equal(product.customizable,source.milk_surcharge_scope === 'confirmed_15_mxn',product.name);
    assert.deepEqual(product.wizard_steps,product.customizable ? ['Tipo de Leche'] : [],product.name);
  }
  for (const name of ['Cappuccino','Te chai caliente','Frappe Oreo','Iced coffee caramelo']) {
    assert.equal(catalog.products.find(product => product.name === name)?.customizable,true,name);
  }
  assert.equal(catalog.products.find(product => product.name === 'Dirty chai')?.customizable,false);
  assert.equal(catalog.products.find(product => product.name === 'Brownie tradicional')?.customizable,false);
});

test('quality milk choices retain the owner-confirmed prices and no invented options', () => {
  const {extras} = qualityMenuCatalog(menu);
  assert.deepEqual(extras.map(extra => [extra.name,extra.price]),[
    ['entera',0],['deslactosada',0],['deslactosada light',0],
    ['avena',15],['coco',15],['almendra',15],['Lala 100',15],
  ]);
  assert.ok(extras.every(extra => extra.phase === 'Tipo de Leche' && extra.active));
  assert.deepEqual(extras.map(extra => extra.orden_opcion),[0,1,2,3,4,5,6]);
});
