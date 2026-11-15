import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';
import { parseSmoothiesForm } from '../../lib/smoothies-import.ts';
import { freshLocalApi } from '../testing/local-api.mjs';
import { startApp } from '../staging/app.mjs';
import { prepareLocal } from './prepare-local.mjs';

const stack = await freshLocalApi({ portBase:55541, emptyWithStorage:true });
const config = { ...stack.config, apiPort:55541, dbPort:55542, password:randomBytes(24).toString('base64url') };
const auth = { persistSession:false, autoRefreshToken:false };
const api = createClient(config.api, config.anon, {auth});
const service = createClient(config.api, config.service, {auth});
let proxy,app,browser;
const ok = ({data,error}) => {
  if(error) throw Error(error.message);
  return data;
};
try {
  const {adminId} = await prepareLocal(config);
  await prepareLocal(config);
  ok(await api.auth.signInWithPassword({email:'admin@smoothies.local',password:config.password}));
  const ids = Object.fromEntries(['small','large','oat','soy','cup','fruit'].map(key=>[key,randomUUID()]));
  const file = {version:1,
    menu:[
      {id:ids.small,name:'Mango',size:'16 oz',price:85,notes:'Mango con leche'},
      {id:ids.large,name:'Mango',size:'20 oz',price:100,notes:''},
    ],
    extras:[
      {id:ids.oat,name:'Leche de avena',price:5,scope:'selected',productIds:[ids.small]},
      {id:ids.soy,name:'Leche de soya',price:7,scope:'all',productIds:[]},
    ],
    stock:[
      {id:ids.cup,name:'Vaso',unit:'pzas',quantity:null,pack:'',cost:null},
      {id:ids.fruit,name:'Mango',unit:'kg',quantity:2.5,pack:'Bolsa',cost:80},
    ],
  };
  if(process.argv.includes('--browser')){
    // Exercise the real import UI at its normal build-time backend URL.
    proxy=createServer((incoming,outgoing)=>{
      const upstream=request(new URL(incoming.url,config.api),{method:incoming.method,headers:incoming.headers},reply=>{
        outgoing.writeHead(reply.statusCode,reply.headers);
        reply.pipe(outgoing);
      });
      upstream.on('error',()=>{outgoing.writeHead(502);outgoing.end();});
      incoming.pipe(upstream);
    });
    await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(58000,'127.0.0.1',resolve);});
    const base = 'http://127.0.0.1:3180';
    app=await startApp({...config,api:'http://127.0.0.1:58000'},{port:3180,smoothies:true});
    await app.ready();
    const { protocol, instanceToken } = await (await fetch(`${base}/api/local-instance`)).json();
    assert.equal(protocol, 1);
    assert.ok(instanceToken);
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false });
    });
    const localOrigins = new Set([base, 'http://127.0.0.1:58000']);
    await page.route('**/*', route => localOrigins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${base}/login`);
    await page.getByRole('button',{name:'Administrador',exact:true}).click();
    await page.getByLabel('Contraseña',{exact:true}).fill(config.password);
    await page.getByRole('button',{name:'Acceder',exact:true}).click();
    await page.waitForURL(`${base}/`);
    await page.goto(`${base}/admin/productos`);
    await page.getByText('Importar formulario de smoothies',{exact:true}).click();
    await page.getByLabel('Archivo descargado del formulario').setInputFiles({
      name:'menu-smoothies.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file)),
    });
    await page.getByText('Ver productos y sus extras',{exact:true}).click();
    assert.match(await page.locator('li').filter({hasText:'Mango 16 oz'}).innerText(),/Leche de avena/);
    assert.doesNotMatch(await page.locator('li').filter({hasText:'Mango 20 oz'}).innerText(),/Leche de avena/);
    const response=page.waitForResponse(reply=>reply.url().endsWith('/api/smoothies-import')&&reply.request().method()==='POST');
    await page.getByRole('button',{name:'Confirmar importación'}).click();
    const imported=await response;
    assert.equal(imported.status(),200,await imported.text());
    await page.getByText('Plan de inventario · Pendiente del conteo de apertura',{exact:true}).click();
    await page.getByText(/Cantidad por definir/).waitFor();
    console.log('PASS: importación desde Catálogo con sesión de administrador y revisión del plan de apertura.');
  }
  const apply = async file => ok(await service.rpc('pos_import_smoothies',{p_actor:adminId,p_data:parseSmoothiesForm(file)}));
  assert.ok((await api.rpc('pos_import_smoothies',{p_actor:adminId,p_data:parseSmoothiesForm(file)})).error);
  const runs = await Promise.all([apply(file),apply(file)]);
  assert.deepEqual(runs.map(r=>r.unchanged).sort(),process.argv.includes('--browser')?[true,true]:[false,true]);
  assert.equal((await apply({...file,menu:[...file.menu].reverse()})).unchanged,true);
  const products = ok(await api.from('products').select('id,name,wizard_steps').order('name'));
  const [small,large] = products;
  const extras = ok(await api.from('extras').select('id,name,applicable_product_ids').order('name'));
  const [oat,soy] = extras;
  assert.deepEqual(oat.applicable_product_ids,[small.id]);
  assert.deepEqual(new Set(soy.applicable_product_ids),new Set([small.id,large.id]));
  const plan = ok(await api.rpc('pos_smoothies_opening_plan'));
  assert.equal(plan.find(row=>row.id===ids.cup).quantity,null);
  assert.equal(plan.find(row=>row.id===ids.fruit).quantity,2.5);
  assert.equal((await stack.db.query('select count(*)::int n from public.pos_inventory_items where quantity is not null')).rows[0].n,0);
  assert.equal((await stack.db.query('select count(*)::int n from public.pos_inventory_movements')).rows[0].n,0);

  ok(await api.rpc('pos_set_drawer_rate',{p_request:randomUUID(),p_payload:{rate:20}}));
  const shift=ok(await api.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:20}));
  const checkout=(product, extras, total)=>api.rpc('pos_checkout',{p_request:randomUUID(),p_payload:{
    register_id:shift.id,items:[{product_id:product,quantity:1,extra_ids:extras}],
    expected_total:total,payment_method:'efectivo',tender_mxn:120,tender_usd:0,
    order_type:'Para Llevar',pager_number:1,
  }});
  assert.match((await checkout(large.id,[oat.id],105)).error?.message??'',/extra/i);
  assert.match((await checkout(small.id,[oat.id,soy.id],97)).error?.message??'',/opción por fase/i);
  assert.equal(ok(await checkout(small.id,[oat.id],90)).total,90);
  assert.equal(ok(await checkout(large.id,[soy.id],107)).total,107);

  if (browser) {
    const [page] = browser.contexts()[0].pages();
    await page.goto('http://127.0.0.1:3180/');
    await page.getByRole('button', { name: /^Mango 16 oz,/ }).click();
    await page.getByRole('button', { name: /Leche de avena/ }).click();
    await page.getByRole('button', { name: 'Agregar a la orden' }).click();
    assert.equal(await page.getByRole('button', { name: /Control de entrega/ }).count(), 0);
    await page.getByRole('button', { name: 'Cobrar', exact: true }).click();
    await page.getByLabel('Recibido MXN').fill('100');
    const saved = page.waitForResponse(response => response.url().endsWith('/rpc/pos_checkout'));
    await page.getByRole('button', { name: 'Confirmar pago' }).click();
    const response = await saved;
    assert.equal(response.status(), 200, await response.text());
    const sale = await response.json();
    await page.getByRole('dialog', { name: 'Venta guardada' }).getByText(`Pedido #${sale.ticket_number}`).waitFor();
    assert.equal(sale.pager_number, null);
    assert.equal(sale.total, 90);
    assert.equal(sale.change_mxn, 10);
    await app.restart();
    await page.reload();
    assert.equal(ok(await api.from('orders').select('id').eq('id', sale.id).single()).id, sale.id);
    console.log('PASS: cobro desde la pantalla de caja, folio, cambio y persistencia con el navegador sin acceso a internet.');
  }

  await stack.db.query("insert into public.products(name,price,category) values('Otro',12,'Manual')");
  const collision = structuredClone(file);
  collision.menu[0].name='Cambio que debe revertirse';
  collision.menu.push({id:'zzzzzzzzzzzzzzzz',name:'Otro',size:'Único',price:12,notes:''});
  await assert.rejects(apply(collision),/Ya existe otro producto/);
  assert.equal(ok(await api.from('products').select('name').eq('id',small.id).single()).name,'Mango 16 oz');
  const revision=structuredClone(file);
  revision.menu[0].name='Mango con plátano';
  revision.extras[0].productIds=[ids.large];
  assert.equal((await apply(revision)).unchanged,false);
  assert.deepEqual(ok(await api.from('extras').select('applicable_product_ids').eq('id',oat.id).single()).applicable_product_ids,[large.id]);
  assert.equal((await apply(file)).unchanged,true);
  assert.equal(ok(await api.from('products').select('name').eq('id',small.id).single()).name,'Mango con plátano 16 oz');
  console.log('PASS: asignaciones por tamaño en caja, leches excluyentes, reimportación, correcciones sin duplicados, rollback e inventario previsto sin existencias.');
} finally {
  await browser?.close();
  await app?.stop();
  if(proxy?.listening) await new Promise(resolve=>proxy.close(resolve));
  await stack.cleanup();
}
