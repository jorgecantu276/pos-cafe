import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menu } from '../scripts/demo/menu.mjs';
import { verifyBaseline, canonicalBaselineBytes } from '../scripts/demo/fidelity.mjs';
import { menuCards, menuCardAvailable, favoriteMenuCards } from '../lib/menu-cards';
import { catalogProduct } from '../lib/pos-types';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { prepareDemoApp, root } from '../scripts/demo/app.mjs';

test('generic demo remains pinned to the exact pre-dashboard application', async()=>{
  assert.ok(await verifyBaseline()>150);
});

test('baseline fingerprints normalize all text configurations across Windows and Linux',()=>{
  for(const file of ['config/clip-token.example.txt','config/clip.env.example','app/layout.tsx']) {
    assert.equal(canonicalBaselineBytes(file,Buffer.from('example\r\nvalue\r\n')),canonicalBaselineBytes(file,Buffer.from('example\nvalue\n')));
  }
  const binary=Buffer.from([0,13,10,255]);
  assert.deepEqual(canonicalBaselineBytes('image.jpg',binary),binary);
});
test('original demo menu exercises all five existing grouped drink families and sizes',()=>{
  const products=menu.products.map(p=>({...catalogProduct(p),inventory:p.inventory}));
  const cards=menuCards(products);
  const families=cards.filter(c=>c.variants);
  assert.equal(families.length,5);
  const iced=families.find(c=>c.id==='family:iced-coffee')!;
  assert.equal(iced.variants?.length,7);
  assert.deepEqual([...new Set(iced.variants?.map(v=>v.size))],['16 oz','20 oz']);
  assert.equal(iced.fromPrice,true);
  assert.equal(menuCardAvailable(iced),true);
  assert.equal(cards.some(c=>c.name==='Limonada de romero de temporada'),false);
  assert.equal(favoriteMenuCards(cards,menu.favorites).length,8);
  assert.equal(menuCardAvailable(cards.find(c=>c.name==='Jugo de manzana 250 ml')!),false);
  assert.equal(menuCardAvailable(cards.find(c=>c.name==='Rebanada de pastel de zanahoria')!),true);
  assert.equal(new Set(menu.products.map(p=>p.id)).size,menu.products.length);
  assert.equal(menu.extras.some(e=>!e.active),true);
  assert.equal(new Set(menu.products.map(p=>p.category)).size,5);
});

test('demo copy removes business branding/configuration and refuses a hosted API',async()=>{
  await mkdir(path.join(root,'.staging-local'),{recursive:true});
  const directory=await mkdtemp(path.join(root,'.staging-local','demo-overlay-check-'));
  await assert.rejects(prepareDemoApp({api:'https://example.supabase.co'},directory));
  const prepared=await prepareDemoApp({api:'http://127.0.0.1:55621',anon:'synthetic-local-anon',service:'synthetic-local-service'},directory);
  assert.equal((await readdir(prepared.app)).some(name=>name.startsWith('.env')),false);
  const machine=JSON.parse(await readFile(path.join(prepared.app,'config/cafe-printers.json'),'utf8'));
  assert.deepEqual(Object.keys(machine).sort(),['barista','customer']);
  assert.equal(/POS80|Y813BT|Nulltonex|Bluetooth|26100|October/i.test(JSON.stringify(machine)),false);
  assert.equal(prepared.env.POS_PRINT_MODE,'mock');
  assert.equal(prepared.env.POS_CLIP_ENABLED,'0');
  const receipt=await readFile(path.join(prepared.app,'lib/sale-printing.ts'),'utf8');
  assert.equal(/Cariñito|_carinitomio|868 305 4668/i.test(receipt),false);
  assert.match(receipt,/CAFÉ DEMO/);
  assert.match(receipt,/SIN VALOR FISCAL/);
  assert.equal(await verifyBaseline()>150,true,'Building the overlay must not modify baseline files');
});
