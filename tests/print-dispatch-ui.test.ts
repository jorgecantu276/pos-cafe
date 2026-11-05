import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import PrintDispatch from '../app/register/PrintDispatch';
import { PrintJournal } from '../lib/print-journal-server';
import { rememberSalePrint, rememberPhonePrint, pendingSalePrints, type PrintAudience, type SalePrintJob } from '../lib/sale-printing';
import type { SavedOrder } from '../lib/checkout';

test('actual retry controls and refresh recover only the missing copy, including a lost HTTP response', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-print-ui-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' });
  const key = 'mi_cafe_checkout_review:cashier', queues = { customer: 'POS80 Printer', barista: 'Y813BT Sticker' };
  let offline = true, loseResponse = false;
  const sent: PrintAudience[] = [];
  const order: SavedOrder = { id: randomUUID(), ticket_number: 1, status: 'completed', total: 80,
    items: [{ id: 'a', quantity: 1, product: { id: 'coffee', name: 'Cappuccino', price: 80, category: 'Bebidas'} }],
    customer_name: 'Sintético', order_type: 'Para Llevar', order_note: '', created_at: '2026-10-30T17:00:00Z',
    payment_method: 'tarjeta', tender_mxn: 0, tender_usd: 0, exchange_rate: 20, change_mxn: 0 };
  const journal = new PrintJournal(path.join(directory, 'jobs.sqlite'), { async prepare(job) {
    if (job.audience === 'barista' && offline) throw Error('Bluetooth desconectado');
    return { async submit() { sent.push(job.audience); }, dispose() {} };
  } });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/printing');
      if (options.method === 'POST') {
        const body = JSON.parse(options.body as string); assert.equal(body.orderId, order.id);
        journal.ensure('cashier', order, queues); await journal.dispatch('cashier', order.id, body.audience);
        if (loseResponse) { loseResponse = false; throw Error('Respuesta HTTP perdida'); }
      }
      return Response.json({ mode: 'mock', jobs: journal.list('cashier') });
    } })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let root = createRoot(dom.window.document.getElementById('root')!);
  const mount = () => act(async () => { root.render(createElement(PrintDispatch, { checkoutKey: key, latestOrderId: order.id })); });
  try {
    rememberSalePrint(dom.window.localStorage, key, order); await mount();
    assert.deepEqual(sent, ['customer']);
    assert.match(dom.window.document.body.textContent!, /Bluetooth desconectado/);
    const retry = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === 'Reintentar barra'); assert.ok(retry);
    offline = false;
    await act(async () => { retry.click(); retry.click(); });
    assert.deepEqual(sent, ['customer', 'barista']);
    assert.equal(dom.window.document.body.textContent?.includes('Reintentar barra'), false);
    // A browser that missed the successful response still retains the same sale marker.
    rememberSalePrint(dom.window.localStorage, key, order); loseResponse = true;
    await act(async () => { root.unmount(); }); root = createRoot(dom.window.document.getElementById('root')!); await mount();
    assert.equal(pendingSalePrints(dom.window.localStorage, key).length, 1);
    assert.match(dom.window.document.body.textContent!, /Respuesta HTTP perdida/);
    await act(async () => { root.unmount(); }); root = createRoot(dom.window.document.getElementById('root')!); await mount();
    assert.equal(pendingSalePrints(dom.window.localStorage, key).length, 0); assert.equal(sent.length, 2);
  } finally {
    await act(async () => root.unmount()); journal.close(); dom.window.close(); rmSync(directory, { recursive: true, force: true });
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
});

async function withPrintStatus(fetcher: typeof fetch, check: (document: Document, storage: Storage) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true, fetch: fetcher })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(createElement(PrintDispatch, { checkoutKey: 'compact-print:cashier' })));
    await check(dom.window.document, dom.window.localStorage);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
}

function updatePrinting(document: Document) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Actualizar impresión');
  assert.ok(button); return button;
}

test('mixed sale retires its three-copy outbox and retries only the grouped dessert preparation',async()=>{
  const orderId=randomUUID(),bodies:unknown[]=[],jobs:SalePrintJob[]=[];
  await withPrintStatus(async (_url,options)=>{
    if(options?.method==='POST'){
      const body=JSON.parse(options.body as string);bodies.push(body);
      if(!jobs.length)for(const audience of ['customer','barista','desserts'] as const)jobs.push({orderId,ticket:'42',audience,
        queue:audience==='barista'?'Y813BT Sticker':'POS80 Printer',state:audience==='desserts'?'blocked':'submitted',message:'',attempts:1,updatedAt:new Date().toISOString()});
      if(body.audience==='desserts')jobs.find(job=>job.audience==='desserts')!.state='submitted';
      return Response.json({mode:'mock',jobs,expectedCopies:3});
    }
    return Response.json({mode:'mock',jobs});
  },async(document,storage)=>{
    rememberSalePrint(storage,'compact-print:cashier',{id:orderId,ticket_number:42});
    await act(async()=>updatePrinting(document).click());
    assert.deepEqual(pendingSalePrints(storage,'compact-print:cashier'),[]);
    assert.match(document.body.textContent!,/Comanda de postres/);
    const retry=[...document.querySelectorAll('button')].find(button=>button.textContent==='Reintentar postres');assert.ok(retry);
    await act(async()=>retry.click());
    assert.deepEqual(bodies,[{orderId},{orderId,audience:'desserts'}]);
    assert.ok(jobs.every(job=>job.state==='submitted'));
  });
});

test('phone preparation and its later single-copy paid receipt retire separate outbox identities',async()=>{
  const phoneId=randomUUID(),saleId=randomUUID(),jobs:SalePrintJob[]=[],posts:string[]=[];
  await withPrintStatus(async (url,options)=>{
    if(options?.method==='POST'){
      const body=JSON.parse(options.body as string);posts.push(String(url));
      if(String(url)==='/api/phone-printing'){
        assert.deepEqual(body,{phoneOrderId:phoneId});
        for(const audience of ['customer','barista'] as const)jobs.push({orderId:`phone:${phoneId}`,ticket:'T1',audience,queue:audience,state:'submitted',message:'',attempts:1,updatedAt:new Date().toISOString()});
        return Response.json({mode:'mock',jobs:jobs.filter(job=>job.orderId===`phone:${phoneId}`)});
      }
      assert.deepEqual(body,{orderId:saleId});
      jobs.push({orderId:saleId,ticket:'2',audience:'customer',queue:'customer',state:'submitted',message:'',attempts:1,updatedAt:new Date().toISOString()});
      return Response.json({mode:'mock',jobs:jobs.filter(job=>job.orderId===saleId),expectedCopies:1});
    }
    return Response.json({mode:'mock',jobs});
  },async(document,storage)=>{
    await act(async()=>{rememberPhonePrint(storage,'compact-print:cashier',{id:phoneId,folio:1});});
    await act(async()=>updatePrinting(document).click());
    assert.deepEqual(pendingSalePrints(storage,'compact-print:cashier'),[]);
    rememberSalePrint(storage,'compact-print:cashier',{id:saleId,ticket_number:2});
    await act(async()=>updatePrinting(document).click());
    assert.deepEqual(pendingSalePrints(storage,'compact-print:cashier'),[]);
    assert.deepEqual(posts,['/api/phone-printing','/api/printing']);assert.equal(jobs.length,3);
  });
});

test('an unavailable print endpoint stays compact and recovers without opening the panel or sending a job', async () => {
  let unavailable = true, posts = 0;
  await withPrintStatus(async (_url, options) => {
    if (options?.method === 'POST') posts++;
    return unavailable ? Response.json({ error: 'Configuración local incompleta' }, { status: 503 })
      : Response.json({ mode: 'mock', jobs: [] });
  }, async document => {
    const panel = document.querySelector<HTMLDetailsElement>('.print-dispatch')!;
    assert.equal(panel.open, false);
    assert.match(panel.querySelector('summary')!.textContent!, /sin comprobar/i);
    assert.match(panel.textContent!, /Configuración local incompleta/);
    assert.doesNotMatch(panel.querySelector('summary')!.textContent!, /Enviado|Impreso/);
    unavailable = false;
    await act(async () => updatePrinting(document).click());
    assert.equal(panel.open, false);
    assert.match(panel.querySelector('summary')!.textContent!, /Prueba|Modo de prueba/);
    assert.doesNotMatch(panel.textContent!, /Configuración local incompleta|sin comprobar/i);
    assert.equal(posts, 0);
  });
});

test('a failed status check leaves the browser print outbox intact and sends no copy', async () => {
  let posts = 0;
  await withPrintStatus(async (_url, options) => {
    if (options?.method === 'POST') posts++;
    return Response.json({ error: 'Configuración local incompleta' }, { status: 503 });
  }, async (document, storage) => {
    const order = { id: randomUUID(), ticket_number: 100 };
    rememberSalePrint(storage, 'compact-print:cashier', order);
    await act(async () => updatePrinting(document).click());
    assert.deepEqual(pendingSalePrints(storage, 'compact-print:cashier'), [order.id]);
    assert.equal(document.querySelector<HTMLDetailsElement>('.print-dispatch')!.open, false);
    assert.equal(posts, 0);
  });
});

test('a later status failure keeps uncertain copies visible without offering a blind retry', async () => {
  let unavailable = false, posts = 0;
  const job: SalePrintJob = { orderId: randomUUID(), ticket: '0099', audience: 'barista', queue: 'Y813BT Sticker',
    state: 'uncertain', message: 'Acuse no recibido', attempts: 1, updatedAt: new Date().toISOString() };
  await withPrintStatus(async (_url, options) => {
    if (options?.method === 'POST') posts++;
    return unavailable ? Response.json({ error: 'Registro local no disponible' }, { status: 503 })
      : Response.json({ mode: 'windows', jobs: [job] });
  }, async document => {
    const panel = document.querySelector<HTMLDetailsElement>('.print-dispatch')!;
    assert.equal(panel.open, false);
    assert.match(panel.querySelector('summary')!.textContent!, /Por revisar/);
    assert.equal(panel.querySelector('.print-dispatch-count')!.textContent, '1');
    // Manual expansion survives polling; a failed check must not discard known jobs.
    panel.open = true; unavailable = true;
    await act(async () => updatePrinting(document).click());
    assert.equal(panel.open, true);
    assert.match(panel.textContent!, /0099/);
    assert.match(panel.textContent!, /Salida por comprobar/);
    assert.match(panel.textContent!, /papel/);
    assert.equal([...panel.querySelectorAll('button')].some(b => /Reintentar/.test(b.textContent!)), false);
    assert.equal(posts, 0);
  });
});
