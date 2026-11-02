import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import PrintRecoveryPage from '../app/admin/impresion/page';

test('manager recovery page retries outgoing copy, persists lost response identity and exposes inspected resolution controls',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'}),saved=new Map<string,PropertyDescriptor|undefined>();
  const bodyKey='pos_print_recovery:v1:manager',calls:unknown[]=[];
  let lose=true,submitted=0,state='blocked';
  const job=()=>({orderId:'00000000-0000-4000-8000-000000000001',ticket:'76',audience:'barista',queue:'Y813BT Sticker',state,
    cashierId:'outgoing',message:state==='blocked'?'Bluetooth desconectado':state==='uncertain'?'Resultado incierto':'Enviado a Windows',attempts:1,updatedAt:'2026-10-30T17:00:00Z'});
  for(const [name,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,
    fetch:async(url:string,options:RequestInit)=>{
      if(options.method==='POST'){
        const body=JSON.parse(options.body as string);calls.push(body);
        assert.equal(dom.window.localStorage.getItem(bodyKey),options.body);assert.equal(body.audience,'barista');
        if(submitted===0){submitted++;state='submitted';}
        if(lose){lose=false;throw Error('Respuesta perdida');}
        return Response.json({mode:'mock',jobs:[job()]});
      }
      assert.equal(url,'/api/printing?scope=all');
      return Response.json({mode:'mock',canManage:true,actorId:'manager',jobs:[job()],history:[],cashiers:[{id:'outgoing',full_name:'Caja saliente'}]});
    }})){
    saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,value});
  }
  const root=createRoot(dom.window.document.getElementById('root')!);
  const button=(text:string)=>{const found=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(found,text);return found;};
  const click=async(text:string)=>{const b=button(text);assert.equal(b.disabled,false);await act(async()=>b.click());};
  try{
    await act(async()=>root.render(createElement(PrintRecoveryPage)));
    assert.match(dom.window.document.body.textContent!,/Caja saliente/);
    await click('Reintentar esta copia');
    assert.match(dom.window.document.body.textContent!,/Respuesta perdida/);assert.ok(dom.window.localStorage.getItem(bodyKey));
    await click('Revisar cambio pendiente');
    assert.deepEqual(calls[0],calls[1]);assert.equal(submitted,1);assert.equal(dom.window.localStorage.getItem(bodyKey),null);
    state='uncertain';await click('Actualizar');await click('Comprobar impresión');
    assert.equal(button('Marcar como impresa').disabled,true);
    const select=dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Resultado de revisión"]')!;
    await act(async()=>{select.value='replace_missing';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.match(dom.window.document.body.textContent!,/podría salir dos veces/);
    assert.equal(button('Reponer esta copia').disabled,true);
    await act(async()=>dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    assert.equal(button('Reponer esta copia').disabled,true,'A checked box without a written reason is insufficient');
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
  }
});
