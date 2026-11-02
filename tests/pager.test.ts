import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement,useState} from 'react';
import PagerPicker from '../app/register/PagerPicker';
import {WorkspaceCheckout} from '../app/register/WorkspaceRegister';
import {PrototypeCheckout} from '../app/register/PrototypeRegister';
import {createCartStore} from '../store/useCartStore';
import {bindCartDraft,cartDraftKey,readCartDraft} from '../lib/cart-draft';
import {checkoutPayload} from '../lib/checkout';
import {saleDocuments} from '../lib/sale-printing';

test('pager choice survives draft restart, rejects numbers outside 1–30 and clears with its order',()=>{
  const memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>memory.delete(key)};
  const product={id:'coffee',name:'Café',price:50,category:'Bebidas',is_active:true};
  const store=createCartStore(),options={storage,userId:'cashier',registerId:'shift',products:[product],extras:[],onError:(message:string)=>assert.fail(message),onRepriced:()=>{}};
  const binding=bindCartDraft({...options,store});store.getState().addItem(product);store.getState().setPagerNumber(30);binding.disconnect();
  const restored=createCartStore(),next=bindCartDraft({...options,store:restored});assert.equal(restored.getState().pagerNumber,30);
  const fields={register_id:'shift',expected_total:50,payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'En Local',order_note:''};
  assert.equal(checkoutPayload(restored.getState().items,{...fields,pager_number:30}).pager_number,30);
  for(const pager_number of [null,undefined,0,31,1.2]) assert.throws(()=>checkoutPayload(restored.getState().items,{...fields,pager_number}),/Elige un control/);
  const raw=storage.getItem(cartDraftKey('cashier'))!;
  assert.throws(()=>readCartDraft(JSON.stringify({...JSON.parse(raw),pagerNumber:31}),'cashier','shift'));
  restored.getState().clearCart();assert.equal(restored.getState().pagerNumber,null);assert.equal(storage.getItem(cartDraftKey('cashier')),null);next.disconnect();
});
test('physical pager appears on the customer receipt and the repeated barista label identity; historical snapshots remain untouched',()=>{
  const order={id:'order',ticket_number:123,status:'completed',total:50,items:[{id:'line',quantity:1,product:{id:'coffee',name:'Café',price:50,category:'Bebidas'}}],customer_name:'Ana',order_type:'En Local',order_note:'',created_at:'2026-11-02T18:00:00Z',payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0};
  const previous=saleDocuments(order);const snapshot=JSON.stringify(previous);
  for(const pager_number of [1,12,30]) {
    const result=saleDocuments({...order,pager_number});
    assert.match(result.customer.sections.flat().join('\n'),new RegExp(`CONTROL: ${pager_number}`));
    assert.match(result.barista.sections.flat().join('\n'),new RegExp(`CONTROL: ${pager_number}`));
    assert.equal(result.barista.referenceLabels?.[0].folio,`CONTROL ${pager_number} · #0123`);
  }
  assert.equal(JSON.stringify(previous),snapshot);assert.doesNotMatch(previous.customer.sections.flat().join(' '),/CONTROL/);
});
test('touch picker offers exactly 1–30, retains its selection when busy, and CLIP checkout sends rather than manually confirms payment',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})) {saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
  const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);
  let selected:number|null=null,sent=0;
  function Picker(){const[value,setValue]=useState<number|null>(null);return createElement(PagerPicker,{value,onChange:value=>{selected=value;setValue(value);}});}
  const click=async(name:string)=>{const button=[...dom.window.document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent)===name);assert.ok(button);await act(async()=>button.click());};
  try {
    await act(async()=>root.render(createElement(Picker)));
    await click('Control de entrega: Elegir control');
    const controls=[...dom.window.document.querySelectorAll<HTMLButtonElement>('.pos-pager-dialog button[aria-label^="Control "]')];assert.equal(controls.length,30);assert.equal(controls[0].getAttribute('aria-label'),'Control 1');assert.equal(controls[29].getAttribute('aria-label'),'Control 30');
    assert.doesNotMatch(dom.window.document.body.textContent!,/Sin control/);
    await click('Control 12');assert.equal(selected,12);assert.match(dom.window.document.querySelector('.pos-pager-trigger')!.textContent!,/#12/);await click('Control de entrega: 12');await click('Cerrar selección de control');assert.equal(selected,12);
    await act(async()=>root.render(createElement(PagerPicker,{value:30,onChange:()=>assert.fail('Busy picker changed'),disabled:true})));assert.ok([...dom.window.document.querySelectorAll('button')].every(button=>button.matches(':disabled')));
    const props={total:50,method:'Tarjeta',mxn:'',usd:'',exchangeRate:20,orderType:'En Local',note:'',busy:false,insufficient:false,clipEnabled:true,onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{sent++;}};
    for(const Checkout of [WorkspaceCheckout,PrototypeCheckout]) {
      for(const method of ['Tarjeta','Efectivo','Mixto','Otro']) {
        await act(async()=>root.render(createElement(Checkout,{...props,method})));
        const confirm=[...dom.window.document.querySelectorAll('button')].find(button=>/^(Enviar a CLIP|Confirmar pago)$/.test(button.textContent??''))!;
        assert.equal(confirm.disabled,true,`${method} cannot charge without a control`);await act(async()=>confirm.click());assert.equal(sent,0);
      }
    }
    await act(async()=>root.render(createElement(WorkspaceCheckout,{...props,pagerNumber:1})));
    assert.equal(dom.window.document.querySelector('.workspace-card-confirm'),null);await click('Enviar a CLIP');assert.equal(sent,1);
  } finally {await act(async()=>root.unmount());dom.window.close();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
