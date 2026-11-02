import {chromium} from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,work,run} from '../staging/runtime.mjs';

// Only called with the fresh disposable backend owned by the HTTP drill.
export async function browserQualityReview({url,actors,db,appDirectory}) {
  assert.equal(url,'http://127.0.0.1:3111');
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8'));
  for(const product of menu.products) await db.query('insert into products(name,price,category,is_active,customizable,wizard_steps) select $1,$2,$3,true,false,$4 where not exists(select 1 from products where name=$1)',[product.name,product.price_mxn,product.category,[]]);
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
    const entry={name,layout,lab,violations:result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>v.id),screenshot};
    report.views.push(entry);console.log(`QUALITY ${name} ${layout.width}x${layout.height}: ${entry.violations.length} axe violations; ${layout.under44.length} targets below 44px; overflow=${layout.overflow}`);
    if(layout.overflow)console.log('Overflow diagnostics: '+JSON.stringify(layout.overflowElements));
  }
  try {
    const context=await browser.newContext({viewport:{width:1366,height:768}});await context.addInitScript(instrument);const page=await context.newPage();
    await login(page,'admin');
    for(const route of ['/admin','/admin/productos','/admin/inventario','/admin/ventas','/admin/cortes','/admin/caja','/admin/clientes','/admin/configuracion','/admin/usuarios','/admin/respaldos','/admin/impresion','/admin/clip']) {
      await page.goto(url+route);await audit(page,route);
    }
    await page.goto(url+'/admin/caja');
    await page.getByRole('button',{name:'Editar tipo de cambio',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Tipo de cambio guardado MXN por USD'}).inputValue(),'16');
    await audit(page,'rate-editor-closed');
    await page.goto(url+'/admin/usuarios');await page.getByRole('button',{name:'Editar',exact:true}).first().click();
    await page.getByRole('dialog',{name:'Editar usuario',exact:true}).waitFor();await audit(page,'staff-editor');
    await page.goto(url+'/admin/productos');await page.getByRole('button',{name:'Editar Brownie tradicional',exact:true}).click();
    await page.getByRole('dialog').waitFor();await audit(page,'catalog-editor');
    await page.goto(url+'/admin/clientes');await page.getByRole('button',{name:/Corregir datos de/}).first().click();await audit(page,'customer-editor');
    await page.goto(url+'/admin/ventas');await page.locator('.workspace-sales-list > button').first().click();
    await page.getByRole('dialog').waitFor();await audit(page,'cancelled-sale-return');
    await page.goto(url+'/admin/inventario');
    await page.getByText('Activar inventario',{exact:true}).first().click();await audit(page,'inventory-activation');
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
    await page.getByRole('button',{name:'Editar tipo de cambio',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Tipo de cambio guardado MXN por USD'}).isDisabled(),true);
    await audit(page,'rate-editor-active');
    await login(cashier,'cashier');await cashier.locator('.workspace-product').first().waitFor();
    await audit(cashier,'register');
    await cashier.setViewportSize({width:1093,height:614});await audit(cashier,'register-scaled-125');
    await cashier.setViewportSize({width:1093,height:560});await audit(cashier,'register-short-screen');
    await printingStatusReview(cashier,audit);
    await cashier.setViewportSize({width:1366,height:768});
    await cashier.locator('.workspace-product').first().click();
    await cashier.getByRole('button',{name:'Cobrar',exact:true}).click();await audit(cashier,'checkout');
    await cashier.setViewportSize({width:1093,height:560});await audit(cashier,'checkout-short-screen');
    await cashier.getByRole('button',{name:'Cerrar Cobrar',exact:true}).click();
    cashier.once('dialog',dialog=>dialog.accept());await cashier.getByRole('button',{name:'Vaciar orden',exact:true}).click();
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
