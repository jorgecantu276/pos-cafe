// Exact-installed-package browser acceptance. The outer acceptance harness owns this synthetic instance.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { freshLocalApi } from '../testing/local-api.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const base = 'http://127.0.0.1:3180';
const localApi = 'http://127.0.0.1:58000';
const viewport = { width:1366, height:768 };
const auth = { autoRefreshToken:false, persistSession:false };
const audit = true;
const portableHome = process.env.POS_TEST_PORTABLE_HOME;
assert.ok(portableHome && path.isAbsolute(portableHome));
const artifacts = process.env.POS_ACCEPTANCE_ARTIFACTS;
assert.ok(artifacts && path.isAbsolute(artifacts));
await mkdir(artifacts, {recursive:true});
const release = JSON.parse((await readFile(path.join(portableHome,'release.json'),'utf8')).replace(/^\uFEFF/,''));
const installedApp = path.join(portableHome,'versiones',release.id,'app');
const {decryptBusinessArchive,sha256} = await import(pathToFileURL(path.join(installedApp,'lib/business-backup-format.mjs')));
const {restoreSmoothiesArchive} = await import(pathToFileURL(path.join(installedApp,'scripts/smoothies/restore-local.mjs')));
const {prepareLocal} = await import(pathToFileURL(path.join(installedApp,'scripts/smoothies/prepare-local.mjs')));
let stack, browser;
function ok({data,error}) {if(error) throw Error(error.message); return data;}
async function raw(url,encoding) {
  return new Promise((resolve,reject)=>{
    const outgoing=get(url,{headers:{'accept-encoding':encoding}},response=>{
      const parts=[];
      response.on('data',chunk=>parts.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(parts)}));
      response.on('error',reject);
    });
    outgoing.on('error',reject);
  });
}
try {
  const settings = parseEnv(await readFile(path.join(portableHome,'instalacion.env'),'utf8'));
  const config = {api:localApi,database:settings.SMOOTHIES_DATABASE_URL,anon:settings.SMOOTHIES_ANON_KEY,
    service:settings.SMOOTHIES_SERVICE_KEY,password:process.env.SMOOTHIES_ADMIN_PASSWORD};
  const db=new Client({connectionString:config.database});
  await db.connect();
  stack={db,cleanup:()=>db.end()};
  const publicConfig=await fetch(`${base}/smoothies-config.js`);
  assert.equal(publicConfig.status,200);
  const publicScript=await publicConfig.text();
  assert.ok(publicScript.includes(config.anon)&&!publicScript.includes(config.service));
  const login=await (await fetch(`${base}/login`)).text();
  const asset=login.match(/src="([^"]*\/_next\/static\/[^" ]+\.js[^" ]*)"/)[1].replaceAll('&amp;','&');
  const identity=await raw(new URL(asset,base),'identity');
  const compressed=await raw(new URL(asset,base),'gzip');
  assert.equal(identity.status,200); assert.equal(compressed.status,200);
  const decoded=compressed.headers['content-encoding']==='gzip'?gunzipSync(compressed.bytes):compressed.bytes;
  assert.deepEqual(decoded,identity.bytes);
  console.log('PASS: production JavaScript bytes match for gzip and identity requests.');
  const admin=createClient(config.api,config.anon,{auth});
  const service=createClient(config.api,config.service,{auth});
  ok(await admin.auth.signInWithPassword({email:'admin@smoothies.local',password:config.password}));
  for(let attempt=0;;attempt++) {
    const response=await admin.rpc('pos_smoothies_special');
    if(response.error?.code!=='PGRST202'||attempt===40){ok(response);break;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  const menu = [
    ['Mango con plátano', '16 oz', 85], ['Fresa con plátano', '16 oz', 80],
    ['Piña con coco', '16 oz', 85], ['Frutos rojos', '16 oz', 95],
    ['Cacao y plátano', '20 oz', 105], ['Verde con manzana', '20 oz', 95],
  ].map(([name, size, price]) => ({ id: randomUUID(), name, size, price, notes: '' }));
  const oat = { id: randomUUID(), name: 'Leche de avena', kind: 'milk', price: 5, scope: 'selected', productIds: [menu[0].id, menu[1].id, menu[4].id] };
  const soy = { id: randomUUID(), name: 'Leche de soya', kind: 'milk', price: 5, scope: 'selected', productIds: menu.slice(0, -1).map(product => product.id) };
  const chia = { id: randomUUID(), name: 'Chía', kind: 'add-on', price: 8, scope: 'all', productIds: [] };
  const stock = [{ id: randomUUID(), name: 'Vaso de 16 oz', unit: 'pzas', quantity: null, pack: '', cost: null },
    { id: randomUUID(), name: 'Mango congelado', unit: 'kg', quantity: 8, pack: '', cost: null }];
  const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = { version: 1, menu, extras: [oat, soy, chia], stock };
  const backupRoot=portableHome;
  const backups={directory:path.join(backupRoot,'respaldos'),keyFile:path.join(backupRoot,'clave','recuperacion.key')};
  assert.equal((await (await fetch(`${base}/api/local-instance`)).json()).protocol, 1);
  const recipeDemo = true;
  browser = await chromium.launch({ channel: 'msedge', headless: audit || process.argv.includes('--headless'), args: ['--window-size=1420,860'] });

  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  const localOrigins = new Set([base, localApi]);
  await page.route('**/*', route => localOrigins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  if (portableHome) {
    await page.route(`${localApi}/auth/v1/**`, route => {
      assert.equal(route.request().headers().apikey, config.anon);
      return route.continue();
    });
  }
  await page.goto(`${base}/login`);
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  assert.equal(await page.getByLabel('Contraseña', { exact: true }).evaluate(input => input === document.activeElement), true);
  await page.screenshot({ path: path.join(artifacts, 'POS Smoothies - Acceso.png') });
  await page.getByLabel('Contraseña', { exact: true }).fill(config.password);
  await page.getByRole('button', { name: 'Acceder', exact: true }).click();
  await page.waitForURL(`${base}/`);
  if (audit) {
    const opening = page.getByRole('dialog', { name: 'Abrir caja' });
    await opening.getByRole('spinbutton', { name: 'Piezas de 100 pesos' }).fill('3');
    assert.equal(await opening.getByLabel('Dólares iniciales').count(), 0);
    await opening.getByRole('button', { name: 'Abrir caja', exact: true }).click();
    await opening.waitFor({ state: 'hidden' });
    assert.equal(ok(await admin.rpc('pos_drawer_status')).rate, null);
    console.log('PASS: primera apertura real con $300 MXN y sin configurar dólares.');
    await page.goto(`${base}/admin/productos`);
    await page.getByText('Importar formulario de smoothies', { exact: true }).click();
    const importFile = { name: 'menu-smoothies.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(form)) };
    const picker = page.getByLabel('Archivo descargado del formulario');
    for (const message of [/Formulario importado/, /Este archivo ya se importó/]) {
      await picker.setInputFiles(importFile);
      await page.getByRole('button', { name: 'Confirmar importación' }).click();
      await page.getByText(message).waitFor();
    }
    assert.equal(ok(await admin.from('products').select('id')).length, menu.length);
    assert.ok(ok(await admin.rpc('pos_smoothies_opening_plan')).every(row => row.counted === null));
    console.log('PASS: importación desde pantalla, reintento sin duplicar y conteo de apertura pendiente.');
    await page.getByText(/^Conteo de apertura/).click();
    for (const [name, quantity] of [['Vaso de 16 oz', '0'], ['Mango congelado', '2,375']]) {
      await page.getByRole('button', {name: `Contar ${name}`}).click();
      await page.getByLabel(/Cantidad contada/).fill(quantity);
      await page.getByRole('button', {name: 'Guardar conteo'}).click();
      await page.getByText(`Conteo de ${name} guardado.`).waitFor();
    }
    await page.getByText('Conteo de apertura · 2 de 2 insumos').waitFor();
    assert.deepEqual(ok(await admin.rpc('pos_smoothies_opening_plan')).map(row => [row.quantity,row.counted]), [[8,2.375],[null,0]]);
    const corrected = structuredClone(form);
    corrected.stock[1].quantity = 10;
    await picker.setInputFiles({ ...importFile, buffer: Buffer.from(JSON.stringify(corrected)) });
    await page.getByRole('button', { name: 'Confirmar importación' }).click();
    await page.getByText(/Formulario importado/).waitFor();
    await page.reload();
    await page.getByText('Conteo de apertura · 2 de 2 insumos').waitFor();
    assert.deepEqual(ok(await admin.rpc('pos_smoothies_opening_plan')).map(row => [row.quantity,row.counted]), [[10,2.375],[null,0]]);
    console.log('PASS: conteo de cero y decimal, corrección del formulario y reapertura de página.');
    await page.getByRole('button', { name: 'Editar Mango con plátano 16 oz' }).click();
    await page.getByLabel('Subir foto').setInputFiles({ name: 'mango.png', mimeType: 'image/png', buffer: photo });
    await page.getByRole('button', {name: 'Quitar foto'}).waitFor();
    await page.getByRole('button', {name: 'Guardar cambios'}).click();
    await page.getByText('Cambios guardados.', {exact: true}).waitFor();
  }
  if (recipeDemo) {
    const recipeName = 'Mango con coco';
    const privateNote = 'Probar con menos hielo para que quede más cremoso.';
    await page.goto(`${base}/admin/productos`);
    await page.getByRole('link', { name: 'Recetario privado', exact: true }).click();
    await page.getByRole('button', { name: 'Nueva receta' }).click();
    await page.getByLabel('Nombre de la receta').fill(recipeName);
    await page.getByLabel('Ingredientes y cantidades').fill('150 g de mango\n120 ml de leche de coco\n40 g de hielo');
    await page.getByLabel('Cómo la preparaste').fill('Licuar primero el mango con la leche de coco. Agregar hielo al final.');
    await page.getByLabel('Qué cambiarías').fill(privateNote);
    if (audit) {
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('link', { name: 'Volver a caja' }).click();
      assert.match(page.url(), /\/admin\/recetario/);
      assert.equal(await page.getByLabel('Qué cambiarías').inputValue(), privateNote);
      console.log('PASS: navegar fuera del recetario avisa y permite conservar el borrador.');
    }
    await page.getByRole('button', { name: 'Guardar prueba' }).click();
    await page.getByText('Prueba 1', { exact: true }).waitFor();
    const [card] = ok(await admin.rpc('pos_smoothies_recipes'));
    assert.equal(card.product_id, null);
    assert.equal(ok(await admin.from('products').select('id').eq('name', recipeName)).length, 0);

    await page.getByRole('button', { name: 'Nueva prueba' }).click();
    assert.match(await page.getByLabel('Ingredientes y cantidades').inputValue(), /40 g de hielo/);
    await page.getByLabel('Ingredientes y cantidades').fill('150 g de mango\n120 ml de leche de coco\n25 g de hielo');
    await page.getByLabel('Qué cambiarías').fill('Me gustó la textura. La próxima vez probaría una pizca de canela.');
    await page.getByRole('button', { name: 'Guardar prueba' }).click();
    await page.getByText('Prueba 2', { exact: true }).waitFor();


    await page.reload();
    await page.getByRole('button', { name: /Mango con coco.*2 pruebas/ }).click();
    await page.getByText('Prueba 1', { exact: true }).click();
    await page.getByText(privateNote, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Comparar pruebas' }).click();
    assert.match(await page.getByLabel('Primera versión').locator('option:checked').innerText(), /Prueba 1/);
    assert.match(await page.getByLabel('Segunda versión').locator('option:checked').innerText(), /Prueba 2/);
    assert.equal(await page.locator('.recipe-difference').count(), 4);
    await page.screenshot({ path: path.join(artifacts, 'POS Smoothies - Comparar pruebas.png') });

    const secondPassword = randomBytes(20).toString('hex');
    async function otherAccount(username, role) {
      const email = `${username}@smoothies.local`;
      const { user } = ok(await service.auth.admin.createUser({ email, password: secondPassword, email_confirm: true }));
      ok(await service.from('profiles').insert({ id: user.id, full_name: username, username, role, is_active: true }));
      const client = createClient(config.api, config.anon, { auth });
      ok(await client.auth.signInWithPassword({ email, password: secondPassword }));
      return client;
    }
    const otherAdmin = await otherAccount('otracuenta', 'admin');
    const staff = await otherAccount('cajaprueba', 'cashier');
    assert.deepEqual(ok(await otherAdmin.rpc('pos_smoothies_recipes')), []);
    assert.equal((await otherAdmin.rpc('pos_smoothies_recipe_trials', { p_recipe: card.id })).error?.code, '42501');
    assert.equal((await staff.rpc('pos_smoothies_recipes')).error?.code, '42501');
    assert.ok((await createClient(config.api, config.anon, { auth }).rpc('pos_smoothies_recipes')).error);

    await page.getByRole('button', { name: 'Preparar para venta', exact: true }).click();
    await page.getByLabel('Nombre en el menú').fill(`${recipeName} 16 oz`);
    await page.getByLabel('Precio de venta (MXN)').fill('89.50');
    await page.getByRole('button', { name: 'Guardar en catálogo' }).click();
    await page.getByText(/Bebida preparada en Catálogo/).waitFor();
    const trials = ok(await admin.rpc('pos_smoothies_recipe_trials', { p_recipe: card.id }));
    const productId = ok(await admin.rpc('pos_publish_smoothies_recipe', { p_recipe: card.id, p_trial: trials[0].id, p_name: `${recipeName} 16 oz`, p_price: 89.5 }));
    const products = ok(await admin.from('products').select('id, name, price, description, is_active').eq('name', `${recipeName} 16 oz`));
    assert.equal(products.length, 1);
    assert.equal(products[0].id, productId);
    assert.equal(Number(products[0].price), 89.5);
    assert.ok(!products[0].description);
    assert.equal(products[0].is_active, false);
    await page.getByRole('link', { name: 'Revisar en catálogo' }).click();
    if (audit) {
      await page.getByRole('button', { name: 'Extras', exact: true }).click();
      await page.getByRole('button', { name: 'Nuevo extra', exact: true }).click();
      await page.getByLabel('Nombre', {exact:true}).fill('Coco tostado');
      await page.getByLabel('Precio (MXN)').fill('5');
      await page.getByRole('checkbox', {name: 'Mango con coco 16 oz (inactivo)'}).check();
      await page.getByRole('button', {name: 'Guardar nuevo'}).click();
      await page.getByText('Cambios guardados.', {exact: true}).waitFor();
      const savedScope = ok(await admin.from('extras').select('applicable_product_ids').eq('name', 'Coco tostado').single());
      assert.deepEqual(savedScope.applicable_product_ids,[productId]);
      await page.getByRole('button', { name: 'Productos', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Inactivos', exact: true }).click();
    await page.getByRole('button', { name: `Editar ${recipeName} 16 oz` }).waitFor();
    await page.getByRole('button', { name: `Reactivar ${recipeName} 16 oz` }).click();
    await page.getByText('Cambios guardados.', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Volver a caja' }).click();
    await page.getByRole('button', { name: /Mango con coco 16 oz,.*89\.50/ }).waitFor();
    const featured = ok(await admin.from('products').select('id').eq('name', 'Mango con plátano 16 oz').single());
    ok(await admin.rpc('pos_set_smoothies_special', { p_product: featured.id, p_revision: 0 }));
    await page.reload();
    await page.getByRole('button', { name: /^Especial de la semana: Mango/ }).click();
    const builder = page.getByRole('dialog', { name: 'Arma tu smoothie' });
    assert.equal(await builder.getByRole('button', { name: /Coco tostado/ }).count(), 0);
    await builder.getByRole('button', { name: /Leche de avena/ }).click();
    await builder.getByRole('button', { name: /Chía/ }).click();
    assert.equal(await builder.locator('[data-creamy=true][data-toppings=true]').count(), 1);
    assert.match(await builder.locator('footer').innerText(), /\$98\.00/);
    await page.screenshot({ path: path.join(artifacts, 'POS Smoothies - Arma tu bebida.png') });
    await builder.getByRole('button', { name: 'Cambiar smoothie' }).click();
    await builder.getByRole('button', { name: 'Verde con manzana 20 oz' }).click();
    assert.equal(await builder.locator('[data-tone=green]').count(), 1);
    assert.equal(await builder.getByRole('button', { name: /Leche de avena|Leche de soya/ }).count(), 0);
    await builder.getByRole('button', { name: 'Cerrar Arma tu smoothie' }).click();
    await page.getByRole('button', { name: /Mango con coco 16 oz,.*89\.50/ }).click();
    if (audit) {
      await builder.getByRole('button', { name: /Coco tostado/ }).waitFor();
      console.log('PASS: extra creado en Catálogo para un producto inactivo; en caja aparece únicamente en el producto asignado tras reactivarlo.');
    }
    await page.getByRole('button', { name: 'Agregar a la orden' }).click();
    await page.getByRole('button', { name: `Aumentar cantidad de ${recipeName} 16 oz` }).click();
    await page.locator('.workspace-total').getByText('$179.00', { exact: true }).waitFor();
    await page.getByRole('button', { name: `Reducir cantidad de ${recipeName} 16 oz` }).click();
    assert.equal(await page.getByRole('button', { name: /Control de entrega/ }).count(), 0);
    await page.getByRole('button', { name: 'Cobrar', exact: true }).click();
    await page.getByRole('group', { name: 'Billetes recibidos' }).getByRole('button', { name: '$100', exact: true }).click();
    await page.getByText('$10.50', { exact: true }).waitFor();
    const savedSale = page.waitForResponse(response => response.url().endsWith('/rpc/pos_checkout'));
    await page.getByRole('button', { name: 'Confirmar pago' }).click();
    const saleReply = await savedSale;
    assert.equal(saleReply.status(), 200, await saleReply.text());
    const sale = await saleReply.json();
    assert.equal(sale.pager_number, null);
    assert.equal(sale.change_mxn, 10.5);
    await page.getByText(`Pedido #${sale.ticket_number}`).waitFor();
    if (audit) {
      const deadline = Date.now() + 15_000;
      for (;;) {
        let count = 0;
        let journal;
        try {
          journal = new DatabaseSync(path.join(portableHome, portableHome ? 'impresion' : '.print-data', 'mock-jobs.sqlite'), {readOnly:true});
          count = journal.prepare("select count(*) as total from jobs where order_id=? and state='submitted'").get(sale.id).total;
        } catch {} finally { journal?.close(); }
        if (count === 2) break;
        assert.ok(Date.now() < deadline, 'Ambas copias deben quedar registradas en impresión simulada');
        await new Promise(resolve => setTimeout(resolve,250));
      }
    }
    await page.screenshot({ path: path.join(artifacts, 'POS Smoothies - Cobro por folio.png') });
    await page.getByRole('button', { name: 'Nueva venta' }).click();
    if (audit) {
      await page.getByRole('button', { name: 'Terminar turno' }).click();
      const closing = page.getByRole('dialog', { name: 'Cierre de caja' });
      await closing.getByLabel('Concepto del gasto').fill('Vasos de prueba');
      await closing.getByLabel('Importe del gasto').fill('9.50');
      await closing.getByRole('button', { name: 'Registrar gasto' }).click();
      await closing.getByText('Vasos de prueba', { exact: true }).waitFor();
      assert.equal(await closing.getByLabel('Dólares finales').count(), 0);
      await closing.getByLabel('Piezas de 100 pesos al cierre').fill('3');
      await closing.getByLabel('Piezas de 20 pesos al cierre').fill('4');
      await closing.getByRole('checkbox', { name: /Terminé de contar/ }).check();
      assert.ok(await closing.getByText('Caja Cuadrada').isVisible());
      const closeResponse = page.waitForResponse(response => response.url().endsWith('/rpc/pos_close_shift'));
      page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
      await closing.getByRole('button', { name: 'Confirmar cierre' }).click();
      assert.equal((await closeResponse).status(), 200);
      await closing.waitFor({ state: 'hidden' });
      assert.equal(ok(await admin.rpc('pos_drawer_status')).active, null);
      await page.goto(`${base}/admin/cortes`);
      await page.getByText('No hay un turno abierto', { exact: true }).waitFor();
      assert.equal((await stack.db.query('select count(*)::int as n from public.shifts')).rows[0].n, 1);
      console.log('PASS: gasto, conteo de $380 MXN, cierre e historial de turno.');
      await page.goto(`${base}/admin/respaldos`);
      const createBackup = page.getByRole('button', { name: 'Crear respaldo' });
      const backupResponse = page.waitForResponse(response => response.url().endsWith('/api/backups') && response.request().headers()['x-pos-backup'] === '1');
      await createBackup.click();
      const backupReply = await backupResponse;
      assert.equal(backupReply.status(), 200, await backupReply.text());
      const status = await backupReply.json();
      assert.ok(status.lastSuccess?.filename);
      const storedBytes = await readFile(path.join(backups.directory, status.lastSuccess.filename));
      const attachment = await page.request.get(`${base}/api/backups?download=latest`, {headers:{'accept-encoding':'gzip'}});
      assert.equal(attachment.status(), 200);
      assert.equal(attachment.headers()['content-type'], 'application/octet-stream');
      assert.equal(attachment.headers()['content-disposition'], `attachment; filename="${status.lastSuccess.filename}"`);
      assert.equal(sha256(await attachment.body()), sha256(storedBytes));
      console.log('PASS: authenticated backup attachment preserves its exact encrypted bytes and filename.');
      const archive = decryptBusinessArchive(storedBytes, await readFile(backups.keyFile));
      const target = await freshLocalApi({ portBase: 55541, emptyWithStorage: true });
      try {
        await prepareLocal({ ...target.config, apiPort: 55541, dbPort: 55542, restoreOnly: true });
        const restoreUrl = new URL(target.config.database);
        restoreUrl.username = 'supabase_admin';
        const restoreDb = new Client({ connectionString: restoreUrl.href });
        await restoreDb.connect();
        const printDirectory = path.join(backupRoot, 'recovered-print');
        try {
          const result = await restoreSmoothiesArchive(restoreDb, archive, {api:target.config.api,serviceKey:target.config.service,printDirectory});
          assert.equal(result.photos,1);
          assert.equal(result.printJournals,1);
          assert.ok(result.restored);
        }
        finally { await restoreDb.end(); }
        const restoredJournal = new DatabaseSync(path.join(printDirectory, 'mock-jobs.sqlite'), { readOnly: true });
        try {
          assert.equal(restoredJournal.prepare("select count(*) as total from jobs where order_id=? and state='submitted'").get(sale.id).total,2);
        } finally { restoredJournal.close(); }
        const recovered = createClient(target.config.api, target.config.anon, { auth });
        ok(await recovered.auth.signInWithPassword({ email: 'admin@smoothies.local', password: config.password }));
        const file = archive.assets.files.find(file => file.kind === 'photos');
        const restoredPhoto = await fetch(`${target.config.api}/storage/v1/object/public/catalog-photos/${file.name}`);
        assert.equal(restoredPhoto.status,200);
        assert.equal(sha256(Buffer.from(await restoredPhoto.arrayBuffer())),sha256(photo));
        assert.deepEqual(ok(await recovered.rpc('pos_smoothies_opening_plan')).map(row => row.counted),[2.375,0]);
        assert.equal((await target.db.query('select count(*)::int as n from cafe_private.smoothies_recipe_trials')).rows[0].n, 2);
        assert.equal((await target.db.query('select count(*)::int as n from public.orders')).rows[0].n, 1);
        assert.equal((await target.db.query("select count(*)::int as n from public.cash_registers where status='closed'")).rows[0].n, 1);
      } finally { await target.cleanup(); }
      console.log('PASS: respaldo cifrado restaurado en otra base, con acceso, venta, corte, recetas, conteos, foto idéntica y dos impresiones registradas.');
    }
    await page.goto(`${base}/admin`);
    const today = page.getByRole('region', { name: 'Hoy en la barra' });
    await today.getByText('$89.50', { exact: true }).waitFor();
    await today.getByRole('button', { name: 'Actualizar' }).click();
    await today.getByText('$89.50', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'POS Smoothies - Hoy en la barra.png') });
    await today.getByRole('link', { name: /Especial de la semana/ }).click();
    await page.getByLabel('Smoothie destacado').waitFor();
    console.log('PASS: exact installed package completed import, catalog, recipe, sale, closing, and full backup restoration with external browser requests blocked.');
  }
} finally {
  await browser?.close();
  await stack?.cleanup();
}
