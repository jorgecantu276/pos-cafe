import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const url='http://127.0.0.1:3127';
export async function verifyDemoHttp({config,actors,result,prepared}) {
  const sessions=[];let browser;
  const evidence=path.join(prepared.app,'demo-evidence');await mkdir(evidence);
  const forbidden=/cariñito|taller reposter|_carinitomio|868 305 4668|actv\.mx/i;
  async function login(actor) {
    const jar=new Map(),client=createServerClient(config.api,config.anon,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>value?jar.set(name,value):jar.delete(name))},auth:{autoRefreshToken:false}});
    sessions.push(client);
    const response=await client.auth.signInWithPassword({email:`${actor.username}@carinitomio.local`,password:actor.password});
    assert.ifError(response.error&&Error(response.error.message));
    return {client,cookie:()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; ')};
  }
  try {
    const cashier=await login(actors.cashier),owner=await login(actors.admin);
    const headers={'Cookie':cashier.cookie(),'X-Pos-Print':'1','Content-Type':'application/json'};
    async function request(endpoint,body,actorHeaders=headers) {
      const response=await fetch(url+endpoint,{headers:actorHeaders,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
      const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
    }
    const receipt=await request('/api/receipts?orderId='+result.sales[0]);
    assert.equal(forbidden.test(JSON.stringify(receipt)),false,'Customer details leaked into receipt');
    assert.match(JSON.stringify(receipt.document),/CAFÉ DEMO/);
    await writeFile(path.join(evidence,'customer-ticket.json'),JSON.stringify(receipt.document,null,2));
    for(const orderId of result.sales.slice(0,2)) {
      for(let n=0;n<2;n++) {
        const printing=await request('/api/printing',{orderId});
        assert.equal(printing.mode,'mock');assert.equal(printing.jobs.length,1);
        assert.equal(printing.jobs[0].audience,'customer');assert.equal(printing.jobs[0].state,'submitted');
      }
    }
    const phone=await request('/api/phone-printing',{phoneOrderId:result.pendingPhones[0]});
    assert.equal(phone.jobs.length,1);assert.equal(phone.jobs[0].audience,'customer');
    const clip=await request('/api/payments/clip',null,{...headers,Cookie:owner.cookie()});assert.equal(clip.enabled,false);
    const spool=(await readFile(path.join(prepared.printing,'mock-spool.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(spool.length,3,'Receipt replay must not submit again');
    assert.equal(spool.every(row=>row.audience==='customer'),true);
    assert.equal(forbidden.test(JSON.stringify(spool)),false);
    // Exercise real Storage, using the demo admin and a bundled generic photo.
    const photo=await readFile(path.join(prepared.app,'public/product-photos/cookie.webp'));
    const filename=`${actors.admin.id}/demo-${randomUUID()}.webp`;
    const upload=await owner.client.storage.from('catalog-photos').upload(filename,photo,{contentType:'image/webp'});
    assert.ifError(upload.error&&Error(upload.error.message));
    const publicUrl=owner.client.storage.from('catalog-photos').getPublicUrl(filename).data.publicUrl;
    assert.equal((await fetch(publicUrl)).status,200);
    const executablePath=[
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/usr/bin/chromium','/usr/bin/google-chrome',
    ].find(existsSync);
    assert.ok(executablePath,'Install Edge/Chrome/Chromium for browser verification');
    browser=await chromium.launch({executablePath,headless:true});
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    await context.route('**/*',route=>{
      const target=new URL(route.request().url());
      return ['127.0.0.1','localhost'].includes(target.hostname)||['data:','blob:','about:'].includes(target.protocol)?route.continue():route.abort();
    });
    const page=await context.newPage();
    await page.goto(url+'/login');await page.getByRole('button',{name:'Caja Demo',exact:true}).click();
    await page.getByLabel('Contraseña',{exact:true}).fill(actors.cashier.password);
    await page.getByRole('button',{name:'Acceder',exact:true}).click();
    await page.getByRole('textbox',{name:'Buscar producto',exact:true}).waitFor();
    await page.locator('.workspace-cashier').filter({hasText:'Caja Demo'}).waitFor();
    await page.getByRole('region',{name:'Productos del menú',exact:true}).getByRole('button').filter({hasText:'Iced Coffee'}).first().waitFor();
    await page.getByRole('region',{name:'Productos del menú',exact:true}).getByRole('button').filter({hasText:'Iced Coffee'}).first().waitFor();
    await page.locator('.workspace-cashier').filter({hasText:'Caja Demo'}).waitFor();
    assert.equal(forbidden.test(await page.locator('body').innerText()),false);
    await page.screenshot({path:path.join(evidence,'register.png'),fullPage:true});
    await page.getByRole('textbox',{name:'Buscar producto',exact:true}).fill('Iced Coffee');
    const product=page.getByRole('region',{name:'Productos del menú',exact:true}).getByRole('button').filter({hasText:'Iced Coffee'}).first();
    await product.click();
    await page.getByRole('button',{name:'20 oz',exact:true}).waitFor();
    await page.getByRole('button',{name:'20 oz',exact:true}).click();
    await page.screenshot({path:path.join(evidence,'drink-sizes.png'),fullPage:true});
    // Render the actual server-returned customer document with the baseline
    // renderer from the anonymized copy. No synthetic ticket arithmetic here.
    const {tsImport}=await import('tsx/esm/api');
    const {renderReceiptReprint}=await tsImport(pathToFileURL(path.join(prepared.app,'lib/receipt-reprint.ts')).href,import.meta.url);
    let html=renderReceiptReprint(receipt.document,receipt.status,receipt.source);
    const logo=(await readFile(path.join(prepared.app,'public/receipt-branding/carinito-logo-v1.jpg'))).toString('base64');
    html=html.replaceAll('/receipt-branding/carinito-logo-v1.jpg',`data:image/jpeg;base64,${logo}`);
    const standalone=`<!doctype html><html lang="es"><meta charset="utf-8"><title>Café Demo · Ticket</title><body style="margin:24px;background:#eee"><article style="width:72mm;padding:3mm;background:white;box-shadow:0 2px 12px #bbb">${html}</article></body></html>`;
    await writeFile(path.join(evidence,'customer-ticket.html'),standalone);
    const ticketPage=await context.newPage();await ticketPage.setContent(standalone);await ticketPage.locator('article').screenshot({path:path.join(evidence,'customer-ticket.png')});
    await writeFile(path.join(evidence,'verification.json'),JSON.stringify({baseline:'1204ca8b7470763da23ffd5881d545d10df2f8f4',http:true,realAuth:true,realStorageUpload:true,customerOnly:true,replaySubmissions:3,clipEnabled:false,browser:'1366x768 login, register, grouped sizes, customer ticket'},null,2));
    console.log('PASS demo HTTP/browser: real login and storage upload, generic ticket, customer-only sale/phone jobs, duplicate suppression, sizes and CLIP off. Evidence: '+evidence);
  } finally {await browser?.close();for(const session of sessions)session.auth.stopAutoRefresh();}
}
