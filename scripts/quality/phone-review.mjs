import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import {createClient} from '@supabase/supabase-js';
import {work,run} from '../staging/runtime.mjs';

// Independent quality tests only. The owning runner supplies a fresh local
// backend and mock printer directory; this function never selects Windows.
export async function phoneQualityReview({url,actors,db,appDirectory,printDirectory,faultsFile,config}) {
  assert.equal(url,'http://127.0.0.1:3112');
  assert.equal(new URL(config.api).hostname,'127.0.0.1');
  assert.equal(new URL(config.api).port,'55501');
  const relative=path.relative(work,path.resolve(printDirectory));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Mock journal must be inside the disposable workspace');
  const executablePath=process.env.POS_QUALITY_BROWSER||[
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome','/usr/bin/chromium',
  ].find(existsSync);
  assert.ok(executablePath,'An installed Chromium/Edge browser is required');
  const directory=path.join(work,'quality-phone',randomUUID());await mkdir(directory,{recursive:true});
  const report={date:new Date().toISOString(),sourceCommit:(await run('git',['rev-parse','HEAD'])).trim(),
    sourceDirty:Boolean((await run('git',['status','--porcelain'])).trim()),
    buildId:(await readFile(path.join(appDirectory,'.next/BUILD_ID'),'utf8')).trim(),
    scope:'Fresh synthetic loopback backend55501, production app3112 and isolated mock journal. No hosted data, bank charge or physical paper.',views:[],checks:[]};
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});report.browser=browser.version();
  const clients=[],contexts=[];
  const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);report.checks.push(name);};
  const poll=async(action,predicate,message)=>{
    for(let attempt=0;attempt<80;attempt++){const value=await action();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}
    throw new Error(message);
  };
  const ok=result=>{assert.ifError(result.error&&Error(result.error.message));return result.data;};
  const loginClient=async actor=>{const client=createClient(config.api,config.anon,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(client);
    ok(await client.auth.signInWithPassword({email:`${actor.username}@carinitomio.local`,password:actor.password}));return client;};
  const login=async actor=>{const context=await browser.newContext({viewport:{width:1366,height:768}});contexts.push(context);const page=await context.newPage();
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(url+'/login');await page.getByRole('button',{name:actor.name||actor.full_name,exact:true}).click();
    await page.getByRole('textbox',{name:'Contraseña',exact:true}).fill(actor.password);await page.getByRole('button',{name:'Acceder',exact:true}).click();
    await page.waitForURL(url+'/');await page.locator('.workspace-product').first().waitFor();return page;};
  const spool=async()=>{try{return(await readFile(path.join(printDirectory,'mock-spool.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
    catch(error){if(error.code==='ENOENT')return[];throw error;}};
  const journal=()=>{const file=path.join(printDirectory,'mock-jobs.sqlite');if(!existsSync(file))return[];
    const sqlite=new DatabaseSync(file,{readOnly:true});try{return sqlite.prepare('select order_id,audience,state,document from jobs order by order_id,audience').all();}finally{sqlite.close();}};
  const financial=async()=>{
    const orders=(await db.query("select count(*)::int n,coalesce(sum(total) filter(where status='completed'),0)::text total from orders")).rows[0];
    const customers=(await db.query('select count(*)::int n,coalesce(sum(points),0)::text points,coalesce(sum(total_spent),0)::text spent from customers')).rows[0];
    return{orders,customers};
  };
  async function audit(page,name){
    await page.waitForLoadState('networkidle');
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    const layout=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
      const controls=[...document.querySelectorAll('button,input:not([type=hidden]),textarea,select,summary,a[href]')].filter(visible).map(e=>{
        const target=e.matches('input[type=checkbox],input[type=radio],input[type=file]')?(e.closest('label')||e):e,r=target.getBoundingClientRect();
        return{name:(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,100),width:Math.round(r.width),height:Math.round(r.height)};
      });
      return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,
        controls:controls.length,under44:controls.filter(c=>c.width<44||c.height<44)};
    });
    const screenshot=`${name}-${layout.width}x${layout.height}.png`;await page.screenshot({path:path.join(directory,screenshot)});
    report.views.push({name,layout,screenshot,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),
      incomplete:axe.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))});
    check(`${name}: no automatic accessibility violations`,axe.violations.length,0);
    check(`${name}: touch targets >=44px`,layout.under44,[]);check(`${name}: no horizontal overflow`,layout.overflow,false);
    console.log(`PHONE QUALITY ${name} ${layout.width}x${layout.height}: PASS`);
  }
  const twoSizes=async(page,name)=>{for(const viewport of [{width:1366,height:768},{width:1093,height:560}]){await page.setViewportSize(viewport);await audit(page,name);}};
  const openQueue=async page=>{await page.getByRole('button',{name:'Pedidos por cobrar',exact:true}).click();return page.getByRole('dialog',{name:'Pedidos por cobrar',exact:true});};
  const findPhone=async(page,phone)=>{const queue=await openQueue(page);await queue.getByRole('textbox',{name:'Buscar pedido por cobrar',exact:true}).fill(String(phone.folio));
    await queue.getByRole('button',{name:'Buscar',exact:true}).click();await queue.getByRole('button',{name:`Abrir pedido ${phone.folio}`,exact:true}).click();return queue;};
  async function startPhone(page,name,quantity=1){
    await page.locator('.workspace-product').filter({hasText:'Iced coffee caramelo'}).first().click();
    const dialog=page.getByRole('dialog',{name:'Iced coffee caramelo',exact:true});await dialog.getByRole('button',{name:/^almendra/i}).click();
    await dialog.getByRole('button',{name:'Agregar a la orden',exact:true}).click();
    if(quantity>1){await page.getByRole('button',{name:'Editar Iced coffee caramelo',exact:true}).click();
      for(let n=1;n<quantity;n++)await dialog.getByRole('button',{name:'Aumentar cantidad',exact:true}).click();
      await dialog.getByRole('button',{name:'Guardar cambios',exact:true}).click();}
    await page.getByRole('button',{name:'Control de entrega: Elegir control',exact:true}).click();
    const picker=page.getByRole('dialog',{name:'Control de entrega',exact:true});
    await twoSizes(page,'phone-option');
    check('Picker retains all30delivery controls',await picker.getByRole('button',{name:/^Control \d+$/}).count(),30);
    const sequence=await picker.evaluate(dialog=>[...dialog.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label'),text:button.textContent.trim()})));
    report.pickerSequence=sequence;
    check('Phone option follows all delivery controls',sequence.findIndex(button=>button.text==='Pedido por teléfono')>sequence.findIndex(button=>button.label==='Control 30'),true);
    await picker.getByRole('button',{name:'Pedido por teléfono',exact:true}).click();
    const contact=page.getByRole('dialog',{name:'Pedido por teléfono',exact:true});
    check('Phone contact required before saving',await contact.getByRole('button',{name:'Guardar pedido',exact:true}).isDisabled(),true);
    await contact.getByRole('textbox',{name:'Nombre del pedido',exact:true}).fill(name);
    await contact.getByRole('textbox',{name:'Teléfono del pedido',exact:true}).fill('1');
    check('Invalid phone keeps save disabled',await contact.getByRole('button',{name:'Guardar pedido',exact:true}).isDisabled(),true);
    await contact.getByRole('textbox',{name:'Teléfono del pedido',exact:true}).fill('8681112233');
    await contact.getByRole('button',{name:'Para llevar',exact:true}).click();
    return contact;
  }
  try{
    const actorA=await loginClient(actors.cashier),actorB=await loginClient(actors.secondCashier),admin=await loginClient(actors.admin);
    const member=randomUUID();await db.query("insert into customers(id,name,phone,points,total_spent) values($1,'Socio de prueba','8681112233',50,0)",[member]);
    // Inventory values are explicit synthetic fixtures, not inferred opening balances.
    await db.query('update pos_inventory_settings set enabled=true');
    const product=(await db.query("select id from products where name='Iced coffee caramelo'")).rows[0].id;
    await db.query("update pos_inventory_items set mode='counted',quantity=10,available=true where product_id=$1",[product]);
    const initial=await financial(),initialRegister=(await db.query("select * from cash_registers where opened_by=$1 and status='open'",[actors.cashier.id])).rows[0];
    assert.ok(initialRegister,'Runner must open the first synthetic shift');check('Initial shift rate16',Number(initialRegister.exchange_rate),16);
    const pageA=await login(actors.cashier);
    await pageA.getByRole('button',{name:'Cliente (opcional)',exact:true}).click();
    const customer=pageA.getByRole('dialog',{name:'Cliente',exact:true});await customer.getByRole('textbox',{name:'Buscar cliente',exact:true}).fill('8681112233');
    await customer.getByRole('button',{name:/Socio de prueba/}).click();
    const contact=await startPhone(pageA,'QA teléfono cobro');await twoSizes(pageA,'phone-contact');
    let lostSave=false;
    await pageA.route('**/rest/v1/rpc/pos_phone_save',async route=>{if(!lostSave){lostSave=true;await route.fetch();return route.abort('failed');}return route.continue();});
    await contact.getByRole('button',{name:'Guardar pedido',exact:true}).evaluate(button=>{button.click();button.click();});
    const phone=await poll(async()=> (await db.query("select * from pos_phone_orders where contact_name='QA teléfono cobro'")).rows,
      rows=>rows.length===1,'Phone save did not commit exactly once').then(rows=>rows[0]);
    await contact.getByRole('button',{name:'Comprobar pedido',exact:true}).waitFor();await audit(pageA,'phone-save-uncertain');
    check('Unpaid phone has no financial effects',await financial(),initial);
    check('Unpaid phone preserves linked member',phone.customer_id,member);
    check('Phone service is chosen before saving',phone.snapshot.order_type,'Para Llevar');
    check('Save reserves one unit without consumption',(await db.query('select i.quantity,(select sum(quantity)::int from cafe_private.inventory_reservations where phone_order_id=$2) held from pos_inventory_items i where product_id=$1',[product,phone.id])).rows[0],{quantity:10,held:1});
    const prepId=`phone:${phone.id}`;
    check('Lost save response has not yet created preparation',(await spool()).filter(row=>row.orderId===prepId).length,0);
    await pageA.reload();await pageA.getByRole('button',{name:'Comprobar pedido',exact:true}).waitFor();await audit(pageA,'phone-saved-reloaded');
    check('Reload does not silently resubmit or print an unknown save',(await spool()).filter(row=>row.orderId===prepId).length,0);
    check('Save request commits once',(await db.query("select count(*)::int n from pos_phone_orders where contact_name='QA teléfono cobro'")).rows[0].n,1);
    const firstContext=pageA.context();await firstContext.close();contexts.splice(contexts.indexOf(firstContext),1);
    const summary=ok(await actorA.rpc('pos_shift_summary',{p_register:initialRegister.id}));
    ok(await actorA.rpc('pos_close_shift',{p_register:initialRegister.id,p_counted:summary.expected_cash,p_expenses:summary.expenses,
      p_preview:{cash_sales:summary.cash_sales,total_sales:summary.total_sales,expenses_revision:summary.expenses_revision}}));
    const newRegister=ok(await actorB.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:16}));
    check('Pending phone survives shift change',(await db.query('select status from pos_phone_orders where id=$1',[phone.id])).rows[0].status,'pending');
    const pageB=await login(actors.secondCashier);
    await pageB.locator('.workspace-product').filter({hasText:'Agua natural'}).first().click();
    await pageB.getByRole('button',{name:'Control de entrega: Elegir control',exact:true}).click();await pageB.getByRole('button',{name:'Control 7',exact:true}).click();
    const beforeDraft=await pageB.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.includes('cart_draft'))));
    let queue=await findPhone(pageB,phone);await twoSizes(pageB,'phone-queue-details');
    assert.ok(faultsFile,'The owning runner must configure an isolated mock fault file');
    assert.equal(path.dirname(path.resolve(faultsFile)),path.resolve(printDirectory));
    await writeFile(faultsFile,JSON.stringify({barista:'uncertain'}));
    await queue.getByRole('button',{name:'Comprobar comanda',exact:true}).click();
    await poll(spool,rows=>rows.filter(row=>row.orderId===prepId).length===2,'Shared preparation copies were not dispatched to mock spool');
    const prepared=(await spool()).filter(row=>row.orderId===prepId);check('Preparation sends customer and barista',prepared.map(row=>row.audience).sort(),['barista','customer']);
    assert.match(JSON.stringify(prepared),/PENDIENTE DE PAGO/);assert.doesNotMatch(JSON.stringify(prepared),/TICKET DE VENTA|Recibido MXN|CONTROL:/);
    for(const document of prepared)assert.match(JSON.stringify(document.document),/Para Llevar/,'The selected service appears on each preparation document');
    await poll(async()=>journal().find(row=>row.order_id===prepId&&row.audience==='barista')?.state,state=>state==='uncertain','Lost mock spool acknowledgment was not retained');
    await poll(()=>pageB.locator('.print-dispatch-body > button').last().isEnabled(),enabled=>enabled,'Preparation status check did not finish');
    await queue.waitFor({state:'hidden'});
    await pageB.locator('.print-dispatch > summary').click();
    await pageB.getByText('Salida por comprobar',{exact:true}).waitFor();await audit(pageB,'phone-shared-preparation-uncertain');
    await pageB.locator('.print-dispatch > summary').click();
    await writeFile(faultsFile,'{}');
    queue=await findPhone(pageB,phone);
    const repeated=pageB.waitForResponse(response=>new URL(response.url()).pathname==='/api/phone-printing'&&response.request().method()==='POST');
    await queue.getByRole('button',{name:'Comprobar comanda',exact:true}).click();await repeated;
    check('Repeated shared preparation does not blindly resend uncertain paper',(await spool()).filter(row=>row.orderId===prepId).length,2);
    check('Unknown barista acknowledgment stays uncertain',journal().find(row=>row.order_id===prepId&&row.audience==='barista').state,'uncertain');
    await queue.waitFor({state:'hidden'});queue=await findPhone(pageB,phone);
    await queue.getByRole('button',{name:'Cobrar pedido',exact:true}).click();
    const checkout=pageB.getByRole('dialog',{name:'Cobrar',exact:true});check('Pickup has no pager picker',await checkout.locator('.pos-pager-trigger').count(),0);
    check('Pickup service stays fixed',await checkout.getByRole('combobox',{name:'Tipo de pedido',exact:true}).isDisabled(),true);
    check('Pickup service matches accepted order',await checkout.getByRole('combobox',{name:'Tipo de pedido',exact:true}).inputValue(),'Para Llevar');
    await checkout.getByRole('button',{name:'MXN + USD',exact:true}).click();await checkout.getByRole('textbox',{name:'Recibido USD',exact:true}).fill('10');
    await checkout.getByText('1 USD = 16 MXN',{exact:true}).waitFor();check('Pickup uses saved price and current rate',await checkout.locator('.workspace-change strong').textContent(),'$50.00');
    await twoSizes(pageB,'phone-pickup-payment');
    let lostPayment=false;await pageB.route('**/rest/v1/rpc/pos_checkout',async route=>{if(!lostPayment){lostPayment=true;await route.fetch();return route.abort('failed');}return route.continue();});
    await checkout.getByRole('button',{name:'Confirmar pago',exact:true}).evaluate(button=>{button.click();button.click();});
    const paid=await poll(async()=> (await db.query('select * from orders where phone_order_id=$1',[phone.id])).rows,rows=>rows.length===1,'Pickup did not create exactly one sale').then(rows=>rows[0]);
    await pageB.getByRole('button',{name:'Comprobar venta',exact:true}).waitFor();await audit(pageB,'phone-payment-uncertain');
    await pageB.unroute('**/rest/v1/rpc/pos_checkout');await pageB.getByRole('button',{name:'Comprobar venta',exact:true}).click();
    const saved=pageB.getByRole('dialog',{name:'Venta guardada',exact:true});await saved.waitFor();
    await poll(spool,rows=>rows.filter(row=>row.orderId===paid.id).length===1,'Paid customer receipt was not dispatched');
    check('Paid phone sends only customer receipt',(await spool()).filter(row=>row.orderId===paid.id).map(row=>row.audience),['customer']);
    check('Settlement does not repeat preparation',(await spool()).filter(row=>row.orderId===prepId).length,2);
    check('Phone sale is attributed to collecting cashier/register',[paid.cashier_id,paid.register_id,paid.pager_number,Number(paid.exchange_rate)],[actors.secondCashier.id,newRegister.id,null,16]);
    check('Explicit member earns points only at payment',(await db.query('select points,(total_spent*100)::integer spent_cents from customers where id=$1',[member])).rows[0],{points:61,spent_cents:11000});
    check('One stock consumption',(await db.query('select quantity from pos_inventory_items where product_id=$1',[product])).rows[0].quantity,9);
    check('Settlement releases phone hold',(await db.query('select count(*)::int n from cafe_private.inventory_reservations where phone_order_id=$1',[phone.id])).rows[0].n,0);
    await audit(pageB,'phone-paid');await saved.getByRole('button',{name:'Nueva venta',exact:true}).click();
    check('Separate walk-in draft survives phone payment',await pageB.getByRole('button',{name:'Editar Agua natural',exact:true}).count(),1);
    check('Separate pager remains7',await pageB.getByRole('button',{name:'Control de entrega: 7',exact:true}).count(),1);
    check('Separate persisted walk-in draft unchanged',await pageB.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.includes('cart_draft')))),beforeDraft);
    await pageB.reload();await pageB.getByRole('button',{name:'Editar Agua natural',exact:true}).waitFor();
    check('Refresh does not duplicate sale',(await db.query('select count(*)::int n from orders where phone_order_id=$1',[phone.id])).rows[0].n,1);
    check('Refresh does not repeat paid receipt',(await spool()).filter(row=>row.orderId===paid.id).length,1);
    const reportSales=ok(await admin.rpc('pos_sales_report',{p_period:'all'}));check('Sales report counts paid phone exactly once',Number(reportSales.summary.sales),Number(initial.orders.total)+110);
    const paidSummary=ok(await actorB.rpc('pos_shift_summary',{p_register:newRegister.id}));check('Drawer contains only payment, not saved order',Number(paidSummary.total_sales),110);
    await pageB.getByRole('button',{name:'Vaciar orden',exact:true}).click();
    const cancelContact=await startPhone(pageB,'QA teléfono cancelar',2);await cancelContact.getByRole('button',{name:'Guardar pedido',exact:true}).click();await cancelContact.waitFor({state:'hidden'});
    const cancellable=(await db.query("select * from pos_phone_orders where contact_name='QA teléfono cancelar'")).rows[0];
    check('A matching contact phone does not automatically attach a member',cancellable.customer_id,null);
    await poll(spool,rows=>rows.filter(row=>row.orderId===`phone:${cancellable.id}`).length===2,'Second phone preparation missing');
    const cancelQueue=await findPhone(pageB,cancellable);await cancelQueue.getByRole('button',{name:'Cancelar pedido',exact:true}).click();
    await cancelQueue.getByRole('textbox',{name:'Motivo de cancelación del pedido',exact:true}).fill('Cliente canceló. Una bebida ya estaba preparada.');
    check('Cancellation requires explicit per-line decision',await cancelQueue.getByRole('button',{name:'Confirmar cancelación',exact:true}).isDisabled(),true);
    await cancelQueue.getByRole('textbox',{name:'Devueltos vendibles: Iced coffee caramelo',exact:true}).fill('1');
    await cancelQueue.getByRole('checkbox').check();await twoSizes(pageB,'phone-cancellation');
    await cancelQueue.getByRole('button',{name:'Confirmar cancelación',exact:true}).click();
    await poll(async()=> (await db.query('select status from pos_phone_orders where id=$1',[cancellable.id])).rows[0].status,status=>status==='cancelled','Phone cancellation did not commit');
    check('One resalable unit returns; one unit is waste',(await db.query('select quantity from pos_inventory_items where product_id=$1',[product])).rows[0].quantity,8);
    check('Cancellation never creates a paid sale',(await db.query('select count(*)::int n from orders where phone_order_id=$1',[cancellable.id])).rows[0].n,0);
    check('Cancellation does not modify member loyalty',(await db.query('select points,(total_spent*100)::integer spent_cents from customers where id=$1',[member])).rows[0],{points:61,spent_cents:11000});
    await cancelQueue.getByRole('button',{name:'Cerrar Pedidos por cobrar',exact:true}).click();
    await pageB.route('**/rest/v1/rpc/pos_phone_list',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Prueba: no se pudo cargar la lista.'})}));
    const errorQueue=await openQueue(pageB);await errorQueue.getByRole('alert').filter({hasText:/Prueba/}).waitFor();await audit(pageB,'phone-list-error');
    await pageB.unroute('**/rest/v1/rpc/pos_phone_list');await errorQueue.getByRole('button',{name:'Actualizar pedidos',exact:true}).click();await errorQueue.getByText('No hay pedidos por cobrar.',{exact:true}).waitFor();
    await errorQueue.getByRole('button',{name:'Cerrar Pedidos por cobrar',exact:true}).click();
    const pages=[];await pageB.route('**/rest/v1/rpc/pos_phone_list',route=>{
      const before=route.request().postDataJSON().p_before??null;pages.push(before);
      const folios=before?[9999]:Array.from({length:200},(_,i)=>10199-i);
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(folios.map(folio=>({...phone,id:randomUUID(),folio,status:'pending',paid_order_id:null,contact_name:`QA página ${folio}`})))});
    });
    const paged=await openQueue(pageB);await paged.getByRole('button',{name:'Cargar anteriores',exact:true}).click();await paged.getByRole('button',{name:'Abrir pedido 9999',exact:true}).waitFor();
    check('Pagination sends previous folio cursor',pages.map(value=>value===null?null:String(value)),[null,'10000']);
    check('Pagination retains all distinct loaded orders',await paged.getByRole('button',{name:/^Abrir pedido /}).count(),201);
    await audit(pageB,'phone-list-pagination');await pageB.unroute('**/rest/v1/rpc/pos_phone_list');
    report.journalRows=journal().length;report.mockSpoolRows=(await spool()).length;report.pass=true;
  }catch(error){report.pass=false;report.error=error.message;throw error;}
  finally{await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));for(const context of contexts)await context.close();for(const client of clients)client.auth.stopAutoRefresh();await browser.close();console.log('Phone quality evidence: '+path.join(directory,'report.json'));}
  return report;
}
