import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import PhoneOrders from '../app/register/PhoneOrders';
import type {PhoneOrder,PhoneReturn} from '../lib/phone-orders';

const sample:PhoneOrder={id:'phone',folio:1000,status:'pending',contact_name:'Ana',contact_phone:'8681234567',customer_id:null,created_by:'cashier',created_at:'2026-11-02T18:00:00Z',revision:0,paid_order_id:null,snapshot:{items:[{id:'line',quantity:2,product:{id:'coffee',name:'Café',price:50,category:'Bebidas'}}],total:100,customer_name:'Ana',order_type:'Para Llevar',order_note:'Sin tapa',created_at:'2026-11-02T18:00:00Z',source:'phone',inventory_reserved:true}};
async function render(run:(document:Document,click:(label:string)=>Promise<void>,fill:(selector:string,value:string)=>Promise<void>)=>Promise<void>,props:Parameters<typeof PhoneOrders>[0]) {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
  const{createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);
  const click=async(label:string)=>{const button=[...dom.window.document.querySelectorAll('button')].find(node=>(node.getAttribute('aria-label')??node.textContent?.trim())===label);assert.ok(button,`Missing ${label}`);assert.equal(button.disabled,false);await act(async()=>button.click());};
  const fill=async(selector:string,value:string)=>{const element=dom.window.document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;assert.ok(element);await act(async()=>{const prototype=element.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
  try{await act(async()=>root.render(createElement(PhoneOrders,props)));await run(dom.window.document,click,fill);}finally{await act(async()=>root.unmount());dom.window.close();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}

test('phone cancellation requires explicit vendible counts, states the waste, and retains inputs after an unsuccessful save',async()=>{
  let cancelled=false;const calls:Array<{reason:string;returns:PhoneReturn[]}>=[];
  const client={rpc:async(name:string)=>({data:name==='pos_phone_list'?(cancelled?[]:[sample]):sample,error:null})} as unknown as Pick<SupabaseClient,'rpc'>;
  await render(async(document,click,fill)=>{
    await click('Abrir pedido 1000');assert.match(document.body.textContent!,/Sin pagar/);await click('Cancelar pedido');
    const confirm=()=>[...document.querySelectorAll('button')].find(node=>node.textContent==='Confirmar cancelación')!;
    assert.equal(confirm().disabled,true);await fill('[aria-label="Motivo de cancelación del pedido"]','No recogió');assert.equal(confirm().disabled,true);
    const count=document.querySelector<HTMLInputElement>('[aria-label="Devueltos vendibles: Café"]')!;assert.equal(count.value,'','Never default unsold prepared drinks to a stock return');
    await fill('[aria-label="Devueltos vendibles: Café"]','0');assert.match(document.body.textContent!,/0 para volver a vender · 2 de merma/);
    await act(async()=>document.querySelector<HTMLInputElement>('.phone-order-confirm input')!.click());await click('Confirmar cancelación');
    assert.equal(calls.length,1);assert.equal(count.value,'0');assert.equal((document.querySelector('textarea') as HTMLTextAreaElement).value,'No recogió');
    await click('Confirmar cancelación');assert.deepEqual(calls,[{reason:'No recogió',returns:[{line_id:'line',return_quantity:0}]},{reason:'No recogió',returns:[{line_id:'line',return_quantity:0}]}]);assert.match(document.body.textContent!,/No hay pedidos por cobrar/);
  },{client,disabled:false,onClose:()=>{},onPay:()=>assert.fail('Cancellation cannot initiate a charge'),onCancel:async(_order,reason,returns)=>{calls.push({reason,returns});cancelled=calls.length===2;return cancelled;}});
});

test('phone queue retries the same older-page cursor and reloads when returning from a detail',async()=>{
  const first=Array.from({length:200},(_,index)=>({...sample,id:`phone-${1000-index}`,folio:1000-index})),calls:Array<unknown>=[];let olderCalls=0;
  const client={rpc:async(name:string,args:{p_before:string|null;p_id:string})=>{if(name!=='pos_phone_list')return{data:{...sample,id:args.p_id},error:null};calls.push(args.p_before);if(args.p_before){olderCalls++;return olderCalls===1?{data:null,error:{message:'Conexión interrumpida'}}:{data:[{...sample,id:'oldest',folio:800}],error:null};}return{data:first,error:null};}} as unknown as Pick<SupabaseClient,'rpc'>;
  await render(async(document,click)=>{
    assert.equal(document.querySelectorAll('.phone-order-list li').length,200);await click('Cargar anteriores');assert.match(document.body.textContent!,/Conexión interrumpida/);assert.equal(document.querySelectorAll('.phone-order-list li').length,200);
    await click('Reintentar');assert.equal(document.querySelectorAll('.phone-order-list li').length,201);assert.ok(document.querySelector('[aria-label="Abrir pedido 800"]'));
    await click('Abrir pedido 1000');await click('Volver a pedidos');assert.equal(document.querySelectorAll('.phone-order-list li').length,200);assert.deepEqual(calls,[null,'801','801',null]);
  },{client,disabled:false,onClose:()=>{},onPay:()=>{},onCancel:async()=>false});
});

test('paid phone orders retain preparation recovery, while a cancelled paid sale cannot send another preparation',async()=>{
  let saleStatus='completed',prints=0;
  const client={rpc:async(name:string,args:{p_status?:string})=>({data:name==='pos_phone_list'?(args.p_status==='paid'?[{...sample,status:'paid',paid_sale_status:saleStatus,paid_order_id:'sale'}]:[]):{...sample,status:'paid',paid_sale_status:saleStatus,paid_order_id:'sale'},error:null})} as unknown as Pick<SupabaseClient,'rpc'>;
  await render(async(document,click)=>{
    await click('Pagados');await click('Abrir pedido 1000');assert.match(document.body.textContent!,/Pagado/);await click('Comprobar comanda');assert.equal(prints,1);
    assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Cobrar pedido'),false);
    saleStatus='cancelled';await click('Volver a pedidos');await click('Abrir pedido 1000');assert.match(document.body.textContent!,/Venta cancelada/);
    assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Comprobar comanda'),false);assert.equal(prints,1);
  },{client,disabled:false,onClose:()=>{},onPay:()=>assert.fail('Paid orders cannot charge again'),onCancel:async()=>assert.fail('Paid orders cannot be cancelled as unpaid'),onPrint:async(order)=>{assert.equal(order.id,sample.id);prints++;return true;}});
});
