import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import PrintRecoveryPage from '../app/admin/impresion/page';

const old={orderId:'00000000-0000-4000-8000-000000000002',audience:'customer',action:'retry',requestId:'00000000-0000-4000-8000-000000000009',reason:'Revisión pendiente anterior'};
async function harness(state='blocked'){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'}),saved=new Map<string,PropertyDescriptor|undefined>(),calls:unknown[]=[];
  const bodyKey='pos_print_recovery:v1:manager';
  const job={orderId:'00000000-0000-4000-8000-000000000001',ticket:'76',audience:'barista',queue:'Y813BT Sticker',state,cashierId:'cashier',message:'Impresión pendiente',attempts:1,updatedAt:'2026-11-02T17:00:00Z'};
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,navigator:dom.window.navigator,fetch:async(_url:string,options:RequestInit={})=>{
    if(options.method==='POST'){calls.push(JSON.parse(options.body as string));return Response.json({jobs:[job]});}
    return Response.json({mode:'mock',canManage:true,actorId:'manager',jobs:[job],history:[],cashiers:[{id:'cashier',full_name:'Ana'}]});
  }})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});}
  const {createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);await act(async()=>root.render(createElement(PrintRecoveryPage)));
  const button=(label:string)=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===label)!;
  const click=async(label:string)=>{assert.ok(button(label),label);assert.equal(button(label).disabled,false);await act(async()=>button(label).click());};
  return{dom,calls,button,click,inject:()=>dom.window.localStorage.setItem(bodyKey,JSON.stringify(old)),async clean(){await act(async()=>root.unmount());dom.window.close();for(const[key,d]of saved){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}}};
}

test('a new print retry cannot execute another window’s pending action',async()=>{
  const h=await harness();try{
    h.inject();await h.click('Reintentar esta copia');assert.equal(h.calls.length,0);assert.equal(h.dom.window.localStorage.getItem('pos_print_recovery:v1:manager'),JSON.stringify(old));
    await h.click('Comprobar revisión pendiente');assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],old);
    assert.doesNotMatch(h.dom.window.document.body.textContent!,/Impresión reanudada|Reposición enviada/);
  }finally{await h.clean();}
});

test('a late pending print action leaves the newly entered inspection unchanged',async()=>{
  const h=await harness('uncertain');try{
    await h.click('Comprobar impresión');const select=h.dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Resultado de revisión"]')!;
    await act(async()=>{select.value='replace_missing';select.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));});
    await act(async()=>h.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    const text=h.dom.window.document.querySelector<HTMLTextAreaElement>('textarea')!,setter=Object.getOwnPropertyDescriptor(h.dom.window.HTMLTextAreaElement.prototype,'value')!.set!;
    await act(async()=>{setter.call(text,'Revisé la bandeja y Windows');text.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));text.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));});
    h.inject();await h.click('Reponer esta copia');assert.equal(h.calls.length,0);assert.equal(text.value,'Revisé la bandeja y Windows');assert.equal(h.dom.window.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,true);
    await h.click('Comprobar revisión pendiente');assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],old);
  }finally{await h.clean();}
});
