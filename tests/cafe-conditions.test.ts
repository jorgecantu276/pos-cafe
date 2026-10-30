import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftSales, saveShiftBeforeExit } from '../lib/shift';
import { openPrintWindow, printStyles, renderStickers, writePrintDocument } from '../lib/printing';
import type { CartItem } from '../store/useCartStore';
const items: CartItem[] = [{ id:'line', quantity:3, product:{id:'coffee',name:'Café',price:60,category:'Bebidas',stock:10} }];
test('cash reconciliation excludes card and both cancellation spellings, includes mixed cash', () => {
  assert.deepEqual(shiftSales([
    {total:100,payment_method:'tarjeta',status:'completed'},
    {total:50,payment_method:'efectivo',status:'completed'},
    {total:25,payment_method:'mixto',status:'completed'},
    {total:80,payment_method:'efectivo',status:'cancelled'},
    {total:90,payment_method:'efectivo',status:'canceled'},
    {total:500,payment_method:'efectivo',status:'pending'},
  ]),{totalSales:175,cashSales:75});
});

test('failed or disconnected shift save does not print, clear, or log out', async () => {
  let exited=false;
  await assert.rejects(saveShiftBeforeExit(async()=>({error:{message:'offline'}}),async()=>{exited=true;}),/offline/);
  await assert.rejects(saveShiftBeforeExit(async()=>{throw new Error('network lost');},async()=>{exited=true;}),/network lost/);
  assert.equal(exited,false);
});

test('confirmed shift save runs exit only after the response', async () => {
  const events:string[]=[];
  await saveShiftBeforeExit(async()=>{events.push('saved');return {error:null};},async()=>{events.push('exit');});
  assert.deepEqual(events,['saved','exit']);
});

test('sticker output contains one page per cup and escapes preparation text', () => {
  const html=renderStickers([{...items[0],product:{...items[0].product,name:'Café <grande>',note:'Sin <hielo>'}}],'Ana & José','10:00');
  assert.equal((html.match(/class="sticker"/g) ?? []).length,3);
  assert.match(html,/Café &lt;grande&gt;/);
  assert.match(html,/Ana &amp; José/);
  assert.match(html,/Sin &lt;hielo&gt;/);
  assert.match(printStyles('receipt'),/72mm/);
  assert.match(printStyles('sticker'),/50mm 30mm/);
});

test('blocked popup gives feedback and never attempts a print', () => {
  let message='';
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{open:()=>null,alert:(value:string)=>message=value}});
  try {assert.equal(openPrintWindow(),null);assert.match(message,/ventanas emergentes/);}
  finally {if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});

test('manual printing uses the browser dialog with no silent device or bridge commands', () => {
  let html='';
  const target={document:{open:()=>{},write:(value:string)=>html=value,close:()=>{}}} as unknown as Window;
  writePrintDocument(target,'<div>Receipt</div>','receipt','Ticket <42>');
  assert.match(html,/window\.print\(\)/);
  assert.match(html,/afterprint/);
  assert.match(html,/Ticket &lt;42&gt;/);
  assert.doesNotMatch(html,/qz\.|COM3|CP001|window\.print\(\);window\.close/);
});
