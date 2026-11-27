import {chromium} from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,work,run} from '../staging/runtime.mjs';
import {seedQualityMenu} from './menu-fixture.mjs';

// Only called with the fresh disposable backend owned by the HTTP drill.
export async function browserQualityReview({url,actors,db,appDirectory}) {
  assert.ok(['http://127.0.0.1:3111','http://127.0.0.1:3112'].includes(url),'Only dedicated local quality app URLs are allowed');
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8'));
  await seedQualityMenu(db,menu);
  const executablePath=process.env.POS_QUALITY_BROWSER || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium',
  ].find(existsSync);
  assert.ok(executablePath,'An installed Chromium/Edge browser is required for the local quality review');
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
  const directory=path.join(work,'quality',randomUUID());await mkdir(directory,{recursive:true});
  const sourceCommit=(await run('git',['rev-parse','HEAD'])).trim();
  const sourceDirty=Boolean((await run('git',['status','--porcelain'])).trim());
  const buildId=appDirectory?(await readFile(path.join(appDirectory,'.next/BUILD_ID'),'utf8')).trim():null;
  const report={date:new Date().toISOString(),sourceCommit,sourceDirty,buildId,browser:browser.version(),scope:'Synthetic local production app. Desktop lab only; no cafe hardware, bank charge or physical printing.',products:menu.products.length,views:[]};
  const instrument=()=>{
    window.posQualityMetrics={lcpMs:null,layoutShiftSum:0,maxEventDurationMs:null};
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.posQualityMetrics.lcpMs=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.posQualityMetrics.layoutShiftSum+=e.value;}).observe({type:'layout-shift',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.posQualityMetrics.maxEventDurationMs=Math.max(window.posQualityMetrics.maxEventDurationMs||0,e.duration);}).observe({type:'event',buffered:true,durationThreshold:16});
  };
  async function login(page,role) {
    await page.goto(url+'/login');await page.getByRole('button',{name:'Prueba '+role,exact:true}).waitFor();
    if(role==='admin')await audit(page,'login');
    await page.getByRole('button',{name:'Prueba '+role,exact:true}).click();
    await page.getByRole('textbox',{name:'Contraseña'}).fill(actors[role].password);
    await page.getByRole('button',{name:'Acceder',exact:true}).click();await page.waitForURL(url+'/');
  }
  async function audit(page,name) {
    await page.waitForLoadState('networkidle');
    await page.locator('main').first().waitFor();
    await page.getByText('Cargando inventario…',{exact:true}).waitFor({state:'hidden'});
    const lab=await page.evaluate(()=>window.posQualityMetrics);
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    const layout=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!!e.getClientRects().length;};
      const controls=[...document.querySelectorAll('button,input:not([type=hidden]),textarea,select,summary,a[href]')].filter(visible).map(e=>{
        const target=e.matches('input[type=checkbox],input[type=radio],input[type=file]')?(e.closest('label')||e):e;
        const r=target.getBoundingClientRect();return {name:(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||e.tagName).trim().slice(0,90),width:Math.round(r.width),height:Math.round(r.height)};
      });
      const overflow=document.documentElement.scrollWidth>innerWidth+1;
      const overflowElements=overflow?[...document.querySelectorAll('body *')].filter(visible).filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})):[];
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,overflow,overflowElements,controls:controls.length,under44:controls.filter(c=>c.width<44||c.height<44),under24:controls.filter(c=>c.width<24||c.height<24)};
    });
    const screenshot=name.replaceAll('/','-')+'-'+layout.width+'x'+layout.height+'.png';
    await page.screenshot({path:path.join(directory,screenshot),fullPage:false});
    const loadFailures=await page.getByRole('alert').filter({has:page.getByRole('button',{name:'Volver a intentar',exact:true})}).allTextContents();
    const entry={name,layout,lab,loadFailures,violations:result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>v.id),screenshot};
    report.views.push(entry);console.log(`QUALITY ${name} ${layout.width}x${layout.height}: ${entry.violations.length} axe violations; ${layout.under44.length} targets below 44px; overflow=${layout.overflow}`);
    if(layout.overflow)console.log('Overflow diagnostics: '+JSON.stringify(layout.overflowElements));
    assert.deepEqual(loadFailures,[],`${name} rendered a load failure instead of its usable content`);
  }
  try {
    const context=await browser.newContext({viewport:{width:1366,height:768}});await context.addInitScript(instrument);const page=await context.newPage();
    await login(page,'admin');
    for(const route of ['/admin','/admin/productos','/admin/inventario','/admin/ventas','/admin/cortes','/admin/caja','/admin/clientes','/admin/configuracion','/admin/usuarios','/admin/respaldos','/admin/impresion','/admin/clip']) {
      await page.goto(url+route);await audit(page,route);
      if(route==='/admin/productos') assert.equal(await page.getByRole('link',{name:'Inventario',exact:true}).count(),0);
      if(route==='/admin/configuracion') assert.equal(await page.getByRole('link',{name:/Terminal CLIP/}).count(),0);
    }
    await page.goto(url+'/admin/caja');
    await page.getByRole('button',{name:'Editar tipo de cambio',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Tipo de cambio guardado MXN por USD'}).inputValue(),'16');
    await audit(page,'rate-editor-closed');
    await page.goto(url+'/admin/usuarios');await page.getByRole('button',{name:'Editar',exact:true}).first().click();
    await page.getByRole('dialog',{name:'Editar usuario',exact:true}).waitFor();await audit(page,'staff-editor');
    await page.goto(url+'/admin/productos');await page.getByRole('button',{name:'Editar Brownie tradicional',exact:true}).click();
    await page.getByRole('dialog').waitFor();await audit(page,'catalog-editor');
    await activationQualityReview({page,audit,db,actors,url});
    await page.goto(url+'/admin/clientes');await page.getByRole('button',{name:/Corregir datos de/}).first().click();await audit(page,'customer-editor');
    await page.goto(url+'/admin/ventas');
    const today=page.getByRole('button',{name:'Hoy',exact:true});
    const dates=page.getByRole('button',{name:'Fechas',exact:true});
    const history=page.getByRole('button',{name:'Histórico',exact:true});
    await today.waitFor();
    assert.equal(await today.getAttribute('aria-pressed'),'true');
    await dates.click();
    assert.equal(await dates.getAttribute('aria-expanded'),'true');
    assert.equal(await page.getByLabel('Desde',{exact:true}).isVisible(),true);
    await history.click();
    assert.equal(await history.getAttribute('aria-pressed'),'true');
    await page.locator('.workspace-sales-list > button').first().click();
    await page.getByRole('dialog').waitFor();await audit(page,'cancelled-sale-return');
    await page.goto(url+'/admin/inventario');
    await page.getByText('Activar inventario',{exact:true}).first().click();await audit(page,'inventory-activation');
    const activateInventory=page.getByRole('checkbox',{name:'Voy a registrar las existencias actuales.',exact:true});
    await page.setViewportSize({width:390,height:844});await audit(page,'inventory-activation-narrow');
    await page.setViewportSize({width:1366,height:768});await activateInventory.check();
    await page.getByRole('button',{name:'Activar inventario',exact:true}).click();
    await page.getByRole('link',{name:'Inventario',exact:true}).waitFor();
    assert.equal(await page.locator('details.settings-disclosure').evaluate(element=>element.open),false);
    await page.getByRole('button').filter({hasText:'Brownie tradicional'}).first().click();
    await page.getByText('Configurar producto',{exact:true}).click();
    await page.getByLabel('Control',{exact:true}).selectOption('counted');
    await page.getByRole('button',{name:'Guardar configuración',exact:true}).click();
    await page.getByRole('button',{name:'Contar stock',exact:true}).click();
    await page.getByLabel('Cantidad física total').fill('0');
    await page.getByRole('button',{name:'Guardar conteo',exact:true}).click();
    await page.getByText('Agotado',{exact:true}).first().waitFor();
    assert.equal((await db.query("select i.quantity from pos_inventory_items i join products p on p.id=i.product_id where p.name='Brownie tradicional'")).rows[0].quantity,0);
    await audit(page,'inventory-detail');
    const code=(await db.query("select i.code from pos_inventory_items i join products p on p.id=i.product_id where p.name='Brownie tradicional'")).rows[0].code;
    await page.getByLabel('Importar CSV',{exact:true}).setInputFiles({name:'conteo-prueba.csv',mimeType:'text/csv',buffer:Buffer.from(`codigo,producto,modo,unidad,cantidad,minimo,disponible\n${code},,conteo,pieza,2,,si`)});
    await page.getByRole('region',{name:'Vista previa del CSV'}).waitFor();
    await page.getByRole('region',{name:'Vista previa del CSV'}).scrollIntoViewIfNeeded();await audit(page,'inventory-csv-preview');
    await page.getByRole('region',{name:'Vista previa del CSV'}).getByRole('button',{name:'Cerrar',exact:true}).click();
    for(const viewport of [{width:1093,height:614},{width:1093,height:560},{width:1024,height:768},{width:390,height:844},{width:320,height:740}]) {
      await page.setViewportSize(viewport);await audit(page,'inventory-detail');
    }
    const cashierContext=await browser.newContext({viewport:{width:1366,height:768}});await cashierContext.addInitScript(instrument);const cashier=await cashierContext.newPage();
    await db.query("insert into cash_registers(opened_by,initial_balance,exchange_rate,status) select $1,100,18,'open' where not exists(select 1 from cash_registers where status='open')",[actors.cashier.id]);
    await page.setViewportSize({width:1366,height:768});await page.goto(url+'/admin/caja');
    await page.getByText('1 USD = 18 MXN',{exact:true}).waitFor();await page.getByText('1 USD = 16 MXN',{exact:true}).waitFor();
    await audit(page,'drawer-active-rate-18-next-16');
    assert.equal(await page.getByRole('button',{name:'Editar tipo de cambio',exact:true}).count(),0);
    await page.getByText('Podrás editarlo al cerrar la caja.',{exact:true}).waitFor();
    await login(cashier,'cashier');await cashier.locator('.workspace-product').first().waitFor();
    await audit(cashier,'register');
    await cashier.setViewportSize({width:1093,height:614});await audit(cashier,'register-scaled-125');
    await cashier.setViewportSize({width:1093,height:560});await audit(cashier,'register-short-screen');
    await printingStatusReview(cashier,audit);
    await cashier.setViewportSize({width:1366,height:768});
    await cashier.locator('.workspace-product').filter({hasText:'Agua natural'}).first().click();
    await cashier.getByRole('button',{name:'Editar Agua natural',exact:true}).waitFor();
    assert.equal(await cashier.getByRole('dialog').count(),0,'Packaged water enters the order directly');
    cashier.once('dialog',dialog=>dialog.accept());await cashier.getByRole('button',{name:'Vaciar orden',exact:true}).click();
    const icedCoffee=cashier.getByRole('region',{name:'Productos del menú'}).getByRole('button',{name:/^Iced Coffee,/i});
    assert.equal(await icedCoffee.count(),1);
    await icedCoffee.click();
    const flavors=cashier.getByRole('dialog',{name:'Iced Coffee',exact:true});
    await audit(cashier,'iced-coffee-flavors');
    const flavorSearch=flavors.getByRole('searchbox',{name:'Buscar sabor',exact:true});
    await flavorSearch.fill('sin coincidencias');
    await flavors.getByText('No hay opciones con ese nombre.',{exact:true}).waitFor();
    await flavorSearch.fill('CARAMELO');
    assert.equal(await flavors.getByRole('button',{name:/^Vainilla/i}).count(),0);
    await flavors.getByRole('button',{name:/^Caramelo\s*\$/}).click();
    const customization=flavors;
    await customization.getByRole('group',{name:'Tipo de Leche',exact:true}).waitFor();
    assert.equal(await customization.getByRole('group',{name:'Tipo de Leche',exact:true}).getByRole('button').count(),7);
    await customization.getByRole('button',{name:/^almendra/i}).click();
    assert.equal(await customization.locator('.workspace-custom-price').textContent(),'$110.00');
    await audit(cashier,'milk-customization');
    await cashier.setViewportSize({width:1093,height:560});await audit(cashier,'milk-customization-short-screen');
    await cashier.setViewportSize({width:1366,height:768});
    await customization.getByRole('button',{name:'Agregar a la orden',exact:true}).click();
    await cashier.locator('.workspace-order-line').filter({hasText:'Iced coffee caramelo'}).waitFor();
    await cashier.setViewportSize({width:1093,height:560});
    await cashier.getByRole('button',{name:/Cambiar cantidad de Iced coffee caramelo/}).click();
    const quantity=cashier.getByRole('dialog',{name:'Cantidad de Iced coffee caramelo',exact:true});
    await quantity.getByRole('button',{name:'Aumentar cantidad',exact:true}).click();
    assert.equal(await quantity.getByText('2',{exact:true}).isVisible(),true);
    await audit(cashier,'order-quantity-short-screen');
    await quantity.getByRole('button',{name:'Reducir cantidad',exact:true}).click();
    await quantity.getByRole('button',{name:'Listo',exact:true}).click();
    await cashier.getByRole('button',{name:'Nota de la orden',exact:true}).click();
    const note=cashier.getByRole('dialog',{name:'Nota de la orden',exact:true});
    await note.getByRole('textbox',{name:'Nota para el pedido completo'}).fill('Entregar todo junto.');
    await audit(cashier,'order-note-short-screen');
    await note.getByRole('button',{name:'Listo',exact:true}).click();
    await cashier.getByRole('button',{name:'Ver nota de la orden',exact:true}).click();
    assert.equal(await note.getByRole('textbox',{name:'Nota para el pedido completo'}).inputValue(),'Entregar todo junto.');
    await note.getByRole('button',{name:'Listo',exact:true}).click();
    await cashier.setViewportSize({width:1366,height:768});
    assert.equal(await cashier.getByRole('button',{name:'Cobrar',exact:true}).isDisabled(),true,'A new order needs a delivery control');
    await cashier.getByRole('button',{name:'Control de entrega: Elegir control',exact:true}).click();
    await audit(cashier,'required-pager');
    await cashier.setViewportSize({width:1093,height:560});await audit(cashier,'required-pager-short-screen');
    await cashier.getByRole('button',{name:'Control 30',exact:true}).click();
    await cashier.setViewportSize({width:1366,height:768});
    await cashier.getByRole('button',{name:'Cobrar',exact:true}).click();await audit(cashier,'checkout');
    await cashier.setViewportSize({width:1093,height:560});await audit(cashier,'checkout-short-screen');
    await cashier.getByRole('button',{name:'Mixto',exact:true}).click();
    const pay=cashier.getByRole('button',{name:'Confirmar pago',exact:true});
    assert.equal(await pay.isDisabled(),true);
    await audit(cashier,'checkout-split-empty-short-screen');
    await cashier.getByRole('textbox',{name:'Tarjeta MXN',exact:true}).fill('60');
    await cashier.getByRole('textbox',{name:'Recibido MXN',exact:true}).fill('100');
    assert.equal(await cashier.locator('.workspace-change').textContent(),'Cambio$50.00');
    assert.equal(await pay.isDisabled(),true,'Partial terminal payment needs approval');
    await cashier.getByRole('checkbox',{name:'Pago de $60.00 aprobado en la terminal',exact:true}).check();
    await audit(cashier,'checkout-split-ready-short-screen');
    await cashier.setViewportSize({width:1366,height:768});await audit(cashier,'checkout-split-ready');
    await pay.click();await cashier.getByRole('dialog',{name:'Venta guardada',exact:true}).waitFor();
    const splitSale=(await db.query("select * from orders where cashier_id=$1 and payment_method='efectivo_tarjeta' order by created_at desc limit 1",[actors.cashier.id])).rows[0];
    assert.ok(splitSale);assert.equal(Number(splitSale.total),110);assert.equal(Number(splitSale.card_amount_mxn),60);
    assert.equal(Number(splitSale.tender_mxn),100);assert.equal(Number(splitSale.change_mxn),50);
    assert.equal(splitSale.receipt_snapshot.card_amount_mxn,60);
    await cashier.getByRole('button',{name:'Nueva venta',exact:true}).click();
    await cashier.getByRole('button',{name:'Terminar turno',exact:true}).click();
    await cashier.getByRole('dialog',{name:'Cierre de caja'}).waitFor();await audit(cashier,'closing-scaled-125');
    await context.close();await cashierContext.close();
  } finally {
    await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await browser.close();
    console.log('Quality evidence: '+path.join(directory,'report.json'));
  }
  for(const view of report.views) {
    assert.equal(view.violations.filter(v=>v.impact==='serious'||v.impact==='critical').length,0,`${view.name}: serious/critical accessibility findings`);
    assert.equal(view.layout.overflow,false,`${view.name}: horizontal overflow`);
    assert.equal(view.layout.under44.length,0,`${view.name}: touch controls smaller than 44px: ${JSON.stringify(view.layout.under44)}`);
  }
  return report;
}

export async function printingStatusReview(cashier,audit) {
  // The warning must remain visible without taking over the sales area.
  // Intercept only this disposable browser's status GET; never submit paper.
  await cashier.route('**/api/printing',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Prueba: registro de impresión no disponible.'})}));
  await cashier.reload();
  await cashier.locator('.print-dispatch > summary').getByText('Estado sin comprobar',{exact:true}).waitFor();
  for(const viewport of [{width:1366,height:768},{width:1093,height:560}]) {
    await cashier.setViewportSize(viewport);await audit(cashier,'printing-status-unavailable');
    assert.equal(await cashier.locator('.print-dispatch').evaluate(e=>e.open),false);
    assert.ok((await cashier.locator('.print-dispatch').boundingBox()).height<=56,'A failed print check uses one compact row');
  }
  const menuTop=await cashier.locator('main').evaluate(e=>e.getBoundingClientRect().top);
  await cashier.locator('.print-dispatch > summary').click();await audit(cashier,'printing-status-expanded');
  assert.equal(await cashier.locator('main').evaluate(e=>e.getBoundingClientRect().top),menuTop,'Opening print details must not move the sale area');
  await cashier.unroute('**/api/printing');
  // This also fails if an ancestor clips the panel or another element covers it.
  await cashier.getByRole('button',{name:'Actualizar impresión',exact:true}).click();
  await cashier.locator('.print-dispatch > summary').getByText('Estado sin comprobar',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await cashier.locator('.print-dispatch').evaluate(e=>e.open),true,'A refresh preserves the user’s expanded state');
  await cashier.locator('.print-dispatch > summary').click();await audit(cashier,'printing-status-recovered');
}

// Reversing a mistaken deactivation must be a real UI operation, preserving
// identities, financial snapshots and stock rather than recreating records.
async function activationQualityReview({page,audit,db,actors,url}) {
  const ordersBefore=(await db.query('select coalesce(jsonb_agg(to_jsonb(o) order by id),\'[]\') rows from orders o')).rows[0].rows;
  const productBefore=(await db.query("select id,name,price,stock,is_active from products where name='Brownie tradicional'")).rows[0];
  const inventoryBefore=(await db.query('select * from pos_inventory_items where product_id=$1',[productBefore.id])).rows[0];
  const extraBefore=(await db.query("select id,name,price,phase,active from extras where lower(name)='almendra' and phase='Tipo de Leche'")).rows[0];
  const staffBefore=(await db.query('select id,username,full_name,role,avatar_url,is_active from profiles where id=$1',[actors.cashier.id])).rows[0];
  const bothSizes=async name=>{for(const viewport of [{width:1366,height:768},{width:1093,height:560}]){await page.setViewportSize(viewport);await audit(page,name);}await page.setViewportSize({width:1366,height:768});};
  await page.goto(url+'/admin/productos');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Desactivar Brownie tradicional',exact:true}).click();
  await page.getByRole('button',{name:'Desactivar Brownie tradicional',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('group',{name:'Estado del catálogo',exact:true}).getByRole('button',{name:'Inactivos',exact:true}).click();
  await page.getByRole('button',{name:'Reactivar Brownie tradicional',exact:true}).waitFor();await bothSizes('catalog-inactive-product');
  await page.getByRole('button',{name:'Reactivar Brownie tradicional',exact:true}).click();
  await page.getByRole('button',{name:'Reactivar Brownie tradicional',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('group',{name:'Estado del catálogo',exact:true}).getByRole('button',{name:'Activos',exact:true}).click();
  await page.getByRole('button',{name:'Editar Brownie tradicional',exact:true}).waitFor();
  assert.deepEqual((await db.query('select id,name,price,stock,is_active from products where id=$1',[productBefore.id])).rows[0],productBefore);
  assert.deepEqual((await db.query('select * from pos_inventory_items where product_id=$1',[productBefore.id])).rows[0],inventoryBefore);
  await page.getByRole('group',{name:'Tipo de catálogo',exact:true}).getByRole('button',{name:'Extras',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:`Desactivar ${extraBefore.name}`,exact:true}).click();
  await page.getByRole('button',{name:`Desactivar ${extraBefore.name}`,exact:true}).waitFor({state:'hidden'});
  await page.getByRole('group',{name:'Estado del catálogo',exact:true}).getByRole('button',{name:'Inactivos',exact:true}).click();
  await page.getByRole('button',{name:`Reactivar ${extraBefore.name}`,exact:true}).waitFor();await bothSizes('catalog-inactive-extra');
  await page.getByRole('button',{name:`Reactivar ${extraBefore.name}`,exact:true}).click();
  await page.getByRole('button',{name:`Reactivar ${extraBefore.name}`,exact:true}).waitFor({state:'hidden'});
  await page.getByRole('group',{name:'Estado del catálogo',exact:true}).getByRole('button',{name:'Activos',exact:true}).click();
  await page.getByRole('button',{name:`Editar ${extraBefore.name}`,exact:true}).waitFor();
  assert.deepEqual((await db.query('select id,name,price,phase,active from extras where id=$1',[extraBefore.id])).rows[0],extraBefore);
  await page.goto(url+'/admin/usuarios');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:`Desactivar a ${actors.cashier.username}`,exact:true}).click();
  await page.getByRole('button',{name:`Desactivar a ${actors.cashier.username}`,exact:true}).waitFor({state:'hidden'});
  await page.getByRole('group',{name:'Estado del equipo',exact:true}).getByRole('button',{name:'Inactivos',exact:true}).click();
  await page.getByRole('button',{name:`Reactivar a ${actors.cashier.username}`,exact:true}).waitFor();await bothSizes('staff-inactive');
  await page.getByRole('button',{name:`Reactivar a ${actors.cashier.username}`,exact:true}).click();
  await page.getByRole('button',{name:`Reactivar a ${actors.cashier.username}`,exact:true}).waitFor({state:'hidden'});
  await page.getByRole('group',{name:'Estado del equipo',exact:true}).getByRole('button',{name:'Activos',exact:true}).click();
  await page.getByRole('button',{name:`Desactivar a ${actors.cashier.username}`,exact:true}).waitFor();
  assert.deepEqual((await db.query('select id,username,full_name,role,avatar_url,is_active from profiles where id=$1',[actors.cashier.id])).rows[0],staffBefore);
  assert.deepEqual((await db.query('select coalesce(jsonb_agg(to_jsonb(o) order by id),\'[]\') rows from orders o')).rows[0].rows,ordersBefore);
}
