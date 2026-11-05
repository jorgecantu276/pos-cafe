import ClipPaymentStatus from '../app/register/ClipPaymentStatus';
import * as catalogManagement from '../lib/catalog-management';
import * as drawer from '../lib/drawer';
import DrawerGate from '../app/register/DrawerGate';
import * as deadline from '../lib/request-deadline';
import * as reprint from '../lib/receipt-reprint';
import ProductPhoto from '../components/ProductPhoto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import * as cart from '../store/useCartStore';
import * as checkout from '../lib/checkout';
import * as printing from '../lib/printing';
import * as salePrinting from '../lib/sale-printing';
import * as shift from '../lib/shift';
import * as types from '../lib/pos-types';
import * as resource from '../lib/use-resource';
import * as shortcuts from '../lib/register-shortcuts';
import RecentTickets from '../app/register/RecentTickets';
import * as drafts from '../lib/cart-draft';
import * as shiftState from '../lib/shift-state';
import PrintDispatch from '../app/register/PrintDispatch';
import PrototypeRegister, { PrototypeCheckout, PrototypeCustomization } from '../app/register/PrototypeRegister';
import WorkspaceRegister, { WorkspaceCheckout, WorkspaceCustomization, WorkspaceOpening, WorkspaceDialog } from '../app/register/WorkspaceRegister';
import PagerPicker from '../app/register/PagerPicker';
import PhoneOrders,{PhoneOrderContact} from '../app/register/PhoneOrders';
import * as phoneOrders from '../lib/phone-orders';

for(const role of ['cashier','admin']) test(`actual workspace ${role}: mixed drinks, distinct milk/notes and repeated cups produce one checkout and per-cup documents`,async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/multi-item-order.json',import.meta.url),'utf8'));
  const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1'});
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async(_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}});
  const saved=new Map<string,PropertyDescriptor|undefined>(),alerts:string[]=[];
  let receipt:checkout.SavedOrder|undefined,payload:checkout.CheckoutPayload|undefined,calls=0,dispatches=0;
  let jobs:salePrinting.SalePrintJob[]=[];
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,alert:(message:string)=>alerts.push(message),
    fetch:async(url:string,options:RequestInit)=>{
      assert.equal(url,'/api/printing');
      if(options.method==='POST'){
        assert.equal(JSON.parse(options.body as string).orderId,receipt?.id);dispatches++;
        jobs=(['customer','barista'] as const).map(audience=>({orderId:receipt!.id,ticket:'4321',audience,
          queue:audience==='customer'?'POS80 Printer':'Y813BT Sticker',state:'submitted',message:'Enviado a Windows',attempts:1,updatedAt:'2026-10-30'}));
      }
      return Response.json({mode:'mock',jobs});
    }})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const fixtures:Record<string,unknown>={profiles:{full_name:'Prueba local',role,is_active:true},products:fixture.products,extras:fixture.extras,
    cash_registers:{id:'local-shift',opened_at:'2026-10-30T12:00:00Z',initial_balance:100,exchange_rate:20},customers:[]};
  const client={auth:{getUser:async()=>({data:{user:{id:'mixed-user'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    from:(table:string)=>{
      assert.ok(table in fixtures,`Unexpected table ${table}`);
      const query=Object.assign(Promise.resolve({data:fixtures[table],error:null}),{select:()=>query,eq:()=>query,order:()=>query,abortSignal:()=>query,single:()=>query,maybeSingle:()=>query});return query;
    },rpc:(name:string,args:{p_payload:checkout.CheckoutPayload})=>{
      if(name==='pos_inventory_register'){const result=Promise.resolve({error:null,data:{enabled:false,items:[]}});return Object.assign(result,{abortSignal:()=>result});}
      if(name==='get_register_shortcuts'){const result=Promise.resolve({error:null,data:{product_ids:[],revision:0}});return Object.assign(result,{abortSignal:()=>result});}
      if(name==='pos_drawer_status'){const result=Promise.resolve({error:null,data:{rate:20,active:{id:'local-shift',cashier_id:'mixed-user',cashier_name:'Prueba'},handoff:null,cashiers:[]}});return Object.assign(result,{abortSignal:()=>result});}
      if(name==='pos_shift_summary'){
        const result=Promise.resolve({error:null,data:{register_id:'local-shift',status:'open',opened_at:'2026-10-30T12:00:00Z',starting_cash:100,
          exchange_rate:20,total_sales:0,cash_sales:0,expected_cash:100,expenses:[],expenses_revision:0,payments:{}}});return Object.assign(result,{abortSignal:()=>result});
      }
      assert.equal(name,'pos_checkout');calls++;payload=args.p_payload;
      receipt={id:'f0000000-0000-4000-8000-000000000001',ticket_number:4321,status:'completed',total:fixture.expectedTotal,
        items:payload.items.map((line,index)=>{
          const product=fixture.products.find((p:{id:string})=>p.id===line.product_id);
          const extras=fixture.extras.filter((e:{id:string})=>line.extra_ids.includes(e.id));
          return{id:String(index),quantity:line.quantity,product:{...product,basePrice:product.price,
            price:product.price+extras.reduce((sum:number,e:{price:number})=>sum+e.price,0),displayExtras:extras,note:line.note}};
        }),customer_name:'Invitado',created_at:'2026-10-30T17:00:00Z',order_type:payload.order_type,order_note:payload.order_note,
        payment_method:payload.payment_method,tender_mxn:payload.tender_mxn,tender_usd:payload.tender_usd,exchange_rate:20,change_mxn:0,pager_number:payload.pager_number};
      return{error:null,data:receipt};
    }};
  const router={replace(){},refresh(){}};
  const imports:Record<string,unknown>={ '@/lib/drawer':drawer,'./DrawerGate':{default:DrawerGate,__esModule:true},'@/lib/request-deadline':deadline, '@/lib/receipt-reprint':reprint, '@/lib/supabase':{supabase:client},'@/store/useCartStore':cart,'@/lib/checkout':checkout,
    '@/lib/printing':printing,'@/lib/sale-printing':salePrinting,'./PrintDispatch':{default:PrintDispatch,__esModule:true},'./printing.css':{},
    '@/lib/shift':shift,'@/lib/shift-state':shiftState,'./PrototypeRegister':{default:PrototypeRegister,PrototypeCheckout,PrototypeCustomization,__esModule:true},'./prototype.css':{},'./PagerPicker':{default:PagerPicker,__esModule:true},'./PhoneOrders':{default:PhoneOrders,PhoneOrderContact,__esModule:true},'@/lib/phone-orders':phoneOrders,
    './WorkspaceRegister':{default:WorkspaceRegister,WorkspaceCheckout,WorkspaceCustomization,WorkspaceOpening,WorkspaceDialog,__esModule:true},'./workspace.css':{},
    '@/lib/pos-types':types,'@/lib/use-resource':resource,'@/lib/cart-draft':drafts,'next/navigation':{useRouter:()=>router}};
  const source=readFileSync(new URL('../app/register/Register.tsx',import.meta.url),'utf8');
  imports['@/lib/register-shortcuts'] = shortcuts; imports['@/lib/catalog-management'] = catalogManagement;
  imports['./ClipPaymentStatus'] = { default: ClipPaymentStatus, __esModule: true };
  imports['./RecentTickets'] = { default: RecentTickets, __esModule: true };
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:{default?:ComponentType<{appearance:'workspace'}>}={},nodeRequire=createRequire(import.meta.url);
  new Function('require','exports',compiled)((name:string)=>name === '@/components/ProductPhoto' ? {default:ProductPhoto,__esModule:true} : imports[name]??nodeRequire(name),exports);
  const root=createRoot(dom.window.document.getElementById('root')!);
  const click=async(element:Element)=>{await act(async()=>{element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
  const button=(label:string,scope:ParentNode=dom.window.document)=>{
    const node=[...scope.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent?.trim())===label);
    assert.ok(node,`Missing button: ${label}`);assert.equal(node.disabled,false);return node;
  };
  const typeNote=async(note:string,selector='.workspace-customization .workspace-keyboard')=>{
    const keyboard=dom.window.document.querySelector(selector)!;assert.ok(keyboard);
    for(const character of note)await click(button(character===' '?'Espacio':character,keyboard));
  };
  async function add(flavor:string,milk:string,note:string){
    const cards=[...dom.window.document.querySelectorAll('.workspace-product')].filter(p=>p.querySelector('strong')?.textContent?.startsWith('Iced Coffee'));
    assert.equal(cards.length,1);
    await click(cards[0]);
    const dialog = dom.window.document.querySelector('dialog[aria-label="Iced Coffee"]')!;
    await click(button('Nota de preparación', dialog));
    await typeNote(note);
    await click(button(`${flavor}$95.00`, dialog));
    await click(button(milk, dialog));
    await click(button(`Cambiar variante: ${flavor}`, dialog));
    const other = flavor === 'Caramelo' ? 'Vainilla' : 'Caramelo';
    await click(button(`${other}$95.00`, dialog));
    assert.equal(button(milk, dialog).getAttribute('aria-pressed'), 'true');
    await click(button(`Cambiar variante: ${other}`, dialog));
    await click(button(`${flavor}$95.00`, dialog));
    assert.equal(dialog.querySelector('textarea')?.value, note);
    await click(button('Agregar a la orden', dialog));
  }
  cart.useCartStore.getState().clearCart();
  try{
    await act(async()=>root.render(createElement(exports.default!,{appearance:'workspace'})));
    await add('Caramelo','Leche de avena+$15.00','sin hielo');
    await add('Caramelo','Entera','extra hielo');
    await add('Caramelo','Leche de avena+$15.00','sin hielo');
    await add('Vainilla','Almendra+$15.00','sin tapa');
    assert.equal(cart.useCartStore.getState().items.length,3);assert.equal(cart.useCartStore.getState().getTotal(),425);
    assert.deepEqual(cart.useCartStore.getState().items.map(i=>i.quantity),[2,1,1]);
    await click(button('Cambiar cantidad de Iced coffee caramelo, 2 en la orden'));
    assert.equal(dom.window.document.querySelector('.workspace-customization'),null);
    await click(button('Aumentar cantidad'));
    assert.deepEqual(cart.useCartStore.getState().items.map(i=>i.quantity),[3,1,1]);
    await click(button('Reducir cantidad'));await click(button('Listo'));
    await click(button('Nota de la orden'));await click(button('Teclado'));
    await typeNote('entregar juntos','.workspace-order-note-dialog fieldset[aria-label="Teclado en pantalla"]');
    await click(button('Listo'));
    const pay=[...dom.window.document.querySelectorAll('button')].find(node=>node.textContent?.trim()==='Cobrar')!;assert.equal(pay.disabled,true);
    await click(button('Control de entrega: Elegir control'));await click(button('Control 1'));
    assert.equal(cart.useCartStore.getState().getTotal(),425);
    await click(button('Cobrar'));await click(button('Importe exacto'));await click(button('Efectivo'));
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[aria-label="Recibido MXN"]')?.value,'425');
    await click(button('Tarjeta'));
    const orderType=dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Tipo de pedido"]')!;
    await act(async()=>{orderType.value='Para Llevar';orderType.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.equal(dom.window.document.querySelector('.workspace-checkout [aria-label="Nota de la orden"]'),null);
    const confirmation=dom.window.document.querySelector<HTMLInputElement>('.workspace-card-confirm input')!;assert.ok(confirmation);await click(confirmation);
    await click(button('Tarjeta'));assert.equal(confirmation.checked,true);
    await click(button('Confirmar pago'));
    assert.equal(calls,1);assert.ok(payload);assert.equal(payload.expected_total,425);assert.deepEqual(payload.items,fixture.expectedLines);
    assert.equal(payload.order_type,'Para Llevar');assert.equal(payload.order_note,'entregar juntos');
    assert.equal(payload.pager_number,1);
    assert.ok(receipt);const documents=salePrinting.saleDocuments(receipt,{testOnly:true});
    assert.equal(documents.customer.sections.length,1);assert.equal(documents.barista.sections.length,4);
    assert.deepEqual(documents.barista.sections.map(lines=>lines[1]),['Iced coffee caramelo','Iced coffee caramelo','Iced coffee caramelo','Iced coffee vainilla']);
    assert.deepEqual(documents.barista.sections.map(lines=>lines.find(line=>['sin hielo','extra hielo','sin tapa'].includes(line))),['sin hielo','sin hielo','extra hielo','sin tapa']);
    assert.equal(jobs.length,2);assert.ok(dispatches>=1);assert.equal(cart.useCartStore.getState().items.length,0);assert.deepEqual(alerts,[]);
    if(role==='cashier'&&process.env.POS_MULTI_ITEM_EVIDENCE)writeFileSync(process.env.POS_MULTI_ITEM_EVIDENCE,JSON.stringify({scope:'Actual register UI with synthetic local catalog and mocked services',payload,receipt,documents},null,2));
  }finally{
    await act(async()=>root.unmount());cart.useCartStore.getState().clearCart();dom.window.close();
    for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
