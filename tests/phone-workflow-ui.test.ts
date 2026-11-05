import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {act,createElement,type ComponentType} from 'react';
import * as ts from 'typescript';
import * as cart from '../store/useCartStore';
import * as checkout from '../lib/checkout';
import * as phone from '../lib/phone-orders';
import * as drawer from '../lib/drawer';
import * as deadlines from '../lib/request-deadline';
import * as reprints from '../lib/receipt-reprint';
import * as printing from '../lib/printing';
import * as salePrinting from '../lib/sale-printing';
import * as shift from '../lib/shift';
import * as shiftState from '../lib/shift-state';
import * as types from '../lib/pos-types';
import * as resource from '../lib/use-resource';
import * as shortcuts from '../lib/register-shortcuts';
import * as catalog from '../lib/catalog-management';
import * as drafts from '../lib/cart-draft';
import ProductPhoto from '../components/ProductPhoto';
import DrawerGate from '../app/register/DrawerGate';
import PagerPicker from '../app/register/PagerPicker';
import PhoneOrders,{PhoneOrderContact} from '../app/register/PhoneOrders';
import PrototypeRegister,{PrototypeCheckout,PrototypeCustomization} from '../app/register/PrototypeRegister';
import WorkspaceRegister,{WorkspaceCheckout,WorkspaceCustomization,WorkspaceOpening,WorkspaceDialog} from '../app/register/WorkspaceRegister';

for(const appearance of ['owner','prototype','workspace'] as const)test(`actual ${appearance}: phone order saves unpaid, recovers lost acknowledgment and is collected without losing the counter draft`,async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>(),alerts:string[]=[];
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async(_key:string,_options:unknown,fn:(lock:object)=>Promise<unknown>)=>fn({})}});
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,alert:(message:string)=>alerts.push(message)})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
  const product={id:'coffee',name:'Café',price:50,category:'Bebidas',is_active:true,customizable:false,wizard_steps:[]},now='2026-11-02T18:00:00Z';
  let phoneOrder:phone.PhoneOrder|undefined,payment:checkout.CheckoutPayload|undefined;const saves:unknown[]=[];
  const tables:Record<string,unknown>={profiles:{full_name:'Cajera',role:'cashier',is_active:true},products:[product],extras:[],cash_registers:{id:'shift',opened_at:now,initial_balance:100,exchange_rate:16},customers:{id:'existing-member',name:'Ana socia',points:50,phone:'528681234567'}};
  const client={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:(table:string)=>{assert.ok(table in tables,table);const query=Object.assign(Promise.resolve({data:tables[table],error:null}),{select:()=>query,eq:()=>query,order:()=>query,abortSignal:()=>query,single:()=>query,maybeSingle:()=>query});return query;},rpc:(name:string,args:Record<string,unknown>)=>{const result=(async()=>{
    if(name==='pos_inventory_register')return{data:{enabled:false,items:[]},error:null};
    if(name==='get_register_shortcuts')return{data:{product_ids:[],revision:0},error:null};
    if(name==='pos_drawer_status')return{data:{rate:16,active:{id:'shift',cashier_id:'actor',cashier_name:'Cajera'},handoff:null,cashiers:[]},error:null};
    if(name==='pos_shift_summary')return{data:{register_id:'shift',status:'open',opened_at:now,starting_cash:100,exchange_rate:16,total_sales:0,cash_sales:0,expected_cash:100,expenses:[],expenses_revision:0,payments:{}},error:null};
    if(name==='pos_phone_save'){
      saves.push(args);const payload=args.p_payload as phone.PhonePayload;
      assert.equal(payload.customer_id,'existing-member');phoneOrder??={id:'phone-order',folio:1,status:'pending',contact_name:payload.contact_name,contact_phone:payload.contact_phone,customer_id:payload.customer_id,created_by:'actor',created_at:now,revision:0,paid_order_id:null,snapshot:{items:[{id:'phone-line',quantity:1,product}],total:50,customer_name:payload.contact_name,order_type:payload.order_type,order_note:payload.order_note,created_at:now,source:'phone',inventory_reserved:false}};
      return saves.length===1?{data:null,error:{code:'',message:'Conexión interrumpida'}}:{data:phoneOrder,error:null};
    }
    if(name==='pos_phone_list')return{data:phoneOrder?.status==='pending'?[phoneOrder]:[],error:null};
    if(name==='pos_phone_get')return{data:phoneOrder,error:null};
    if(name==='pos_checkout'){
      assert.ok(salePrinting.pendingSalePrints(dom.window.localStorage,'mi_cafe_checkout_review:actor').includes('phone:phone-order'),'Preparation intent must exist before payment RPC, including direct pickup');
      assert.equal(payment,undefined,'Only one sale may be collected');payment=args.p_payload as checkout.CheckoutPayload;
      assert.ok(phoneOrder);phoneOrder={...phoneOrder,status:'paid',paid_order_id:'paid-order',revision:1};
      return{data:{...phoneOrder.snapshot,id:'paid-order',ticket_number:1,status:'completed',phone_order_id:phoneOrder.id,phone_folio:1,source:'phone',customer_name:phoneOrder.contact_name,payment_method:payment.payment_method,tender_mxn:payment.tender_mxn,tender_usd:payment.tender_usd,change_mxn:0,exchange_rate:16,pager_number:null},error:null};
    }
    assert.fail(`Unexpected RPC ${name}`);
  })();return Object.assign(result,{abortSignal:()=>result});}};
  const router={replace(){},refresh(){}},imports:Record<string,unknown>={'@/lib/supabase':{supabase:client},'@/store/useCartStore':cart,'@/lib/checkout':checkout,'@/lib/phone-orders':phone,'@/lib/drawer':drawer,'@/lib/request-deadline':deadlines,'@/lib/receipt-reprint':reprints,'@/lib/printing':printing,'@/lib/sale-printing':salePrinting,'@/lib/shift':shift,'@/lib/shift-state':shiftState,'@/lib/pos-types':types,'@/lib/use-resource':resource,'@/lib/register-shortcuts':shortcuts,'@/lib/catalog-management':catalog,'@/lib/cart-draft':drafts,'next/navigation':{useRouter:()=>router},'@/components/ProductPhoto':{default:ProductPhoto,__esModule:true},'./DrawerGate':{default:DrawerGate,__esModule:true},'./PagerPicker':{default:PagerPicker,__esModule:true},'./PhoneOrders':{default:PhoneOrders,PhoneOrderContact,__esModule:true},'./PrintDispatch':{default:()=>null,__esModule:true},'./RecentTickets':{default:()=>null,__esModule:true},'./ClipPaymentStatus':{default:()=>null,__esModule:true},'./PrototypeRegister':{default:PrototypeRegister,PrototypeCheckout,PrototypeCustomization,__esModule:true},'./WorkspaceRegister':{default:WorkspaceRegister,WorkspaceCheckout,WorkspaceCustomization,WorkspaceOpening,WorkspaceDialog,__esModule:true},'./printing.css':{},'./prototype.css':{},'./workspace.css':{}};
  const source=readFileSync(new URL('../app/register/Register.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:{default?:ComponentType<{appearance:typeof appearance}>}={},nodeRequire=createRequire(import.meta.url);new Function('require','exports',compiled)((name:string)=>imports[name]??nodeRequire(name),exports);
  const{createRoot}=await import('react-dom/client');const root=createRoot(dom.window.document.getElementById('root')!);
  const button=(label:string,scope:ParentNode=dom.window.document)=>{const node=[...scope.querySelectorAll('button')].find(node=>(node.getAttribute('aria-label')??node.textContent?.trim())===label);assert.ok(node,`Missing ${label}`);return node;};
  const click=async(element:Element)=>{await act(async()=>{element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
  const fill=async(label:string,value:string)=>{const input=dom.window.document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;assert.ok(input);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
  const add=async()=>{const target=appearance==='owner'?[...dom.window.document.querySelectorAll('h3')].find(node=>node.textContent==='Café')!.parentElement!:dom.window.document.querySelector('.workspace-product,.prototype-product')!;await click(target);};
  cart.useCartStore.getState().clearCart();
  const seed=cart.createCartStore(),binding=drafts.bindCartDraft({storage:dom.window.localStorage,userId:'actor',registerId:'shift',products:[product],extras:[],store:seed,onError:message=>assert.fail(message),onRepriced:()=>{}});seed.getState().setCustomerId('existing-member');binding.disconnect();
  try{
    await act(async()=>root.render(createElement(exports.default!,{appearance})));await add();
    if(appearance==='workspace'){
      await click(button('Nota de la orden'));await click(button('Teclado'));
      const noteDialog=dom.window.document.querySelector('dialog[aria-label="Nota de la orden"]')!;
      for(const letter of 'puerta')await click(button(letter,noteDialog));
      await click(button('Listo',noteDialog));
    }
    await click(button('Control de entrega: Elegir control'));await click(button('Pedido por teléfono'));
    assert.equal(dom.window.document.querySelector('dialog[aria-label="Cobrar"]'),null);assert.equal(payment,undefined);
    const contact=()=>dom.window.document.querySelector('dialog[aria-label="Pedido por teléfono"]')!;
    assert.equal(button('Guardar pedido',contact()).disabled,true);await fill('Nombre del pedido','Ana');await fill('Teléfono del pedido','8681234567');await click(button('Para llevar',contact()));assert.equal(button('Guardar pedido',contact()).disabled,false);
    await click(button('Guardar pedido',contact()));assert.equal(saves.length,1);assert.equal(payment,undefined);assert.equal(cart.useCartStore.getState().getTotal(),50);assert.ok(dom.window.localStorage.getItem(phone.phoneRequestKey('actor')));
    assert.equal((contact().querySelector('[aria-label="Nombre del pedido"]') as HTMLInputElement).value,'Ana');await click(button('Comprobar pedido',contact()));assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);assert.equal(cart.useCartStore.getState().items.length,0);assert.equal(dom.window.localStorage.getItem(phone.phoneRequestKey('actor')),null);
    assert.equal(cart.useCartStore.getState().phoneOrder,false);assert.equal(cart.useCartStore.getState().phoneName,'');assert.ok(salePrinting.pendingSalePrints(dom.window.localStorage,'mi_cafe_checkout_review:actor').includes('phone:phone-order'));
    // Simulate a shared pending order whose saving PC left before recording the
    // local preparation intent. The queue must restore that intent before pay.
    salePrinting.forgetSalePrint(dom.window.localStorage,'mi_cafe_checkout_review:actor','phone:phone-order');
    await add();const counterDraft=dom.window.localStorage.getItem(drafts.cartDraftKey('actor'));await click(button('Pedidos por cobrar'));await click(button('Abrir pedido 1'));
    assert.match(dom.window.document.querySelector('dialog[aria-label="Pedidos por teléfono"]')?.textContent??'',/\$50\.00 MXN.*Pago al recoger/);
    assert.equal(salePrinting.pendingSalePrints(dom.window.localStorage,'mi_cafe_checkout_review:actor').length,0);
    if(appearance!=='workspace'){
    await click(button('Comprobar comanda'));
    assert.equal(payment,undefined);assert.deepEqual(salePrinting.pendingSalePrints(dom.window.localStorage,'mi_cafe_checkout_review:actor'),['phone:phone-order']);assert.match(dom.window.document.body.textContent!,/Comprueba el estado de impresión/);
    await click(button('Pedidos por cobrar'));await click(button('Abrir pedido 1'));await click(button('Comprobar comanda'));assert.deepEqual(salePrinting.pendingSalePrints(dom.window.localStorage,'mi_cafe_checkout_review:actor'),['phone:phone-order'],'Repeated checking must keep the original preparation identity');
    await click(button('Pedidos por cobrar'));await click(button('Abrir pedido 1'));
    }
    await click(button('Cobrar pedido'));
    assert.match(dom.window.document.body.textContent!,/Pedido por teléfono #1/);assert.equal((dom.window.document.querySelector('[aria-label="Tipo de pedido"]') as HTMLSelectElement).disabled,true);assert.equal(cart.useCartStore.getState().getTotal(),50);await click(button('Importe exacto'));await click(button('Confirmar pago'));
    const collected=payment as checkout.CheckoutPayload|undefined;assert.ok(collected);assert.equal(collected.phone_order_id,'phone-order');assert.equal(collected.pager_number,null);assert.equal(collected.expected_total,50);assert.equal(collected.tender_mxn,50);assert.equal(collected.phone_order_revision,0);assert.equal(collected.customer_id,'existing-member');assert.equal(collected.order_type,'Para Llevar');
    assert.equal(collected.order_note,appearance==='workspace'?'puerta':'');
    assert.equal(cart.useCartStore.getState().getTotal(),50);assert.equal(dom.window.localStorage.getItem(drafts.cartDraftKey('actor')),counterDraft,'Collecting a phone order must not retire the counter draft');
    await click(button('Nueva venta'));assert.equal(cart.useCartStore.getState().items.length,1);assert.equal(cart.useCartStore.getState().phoneOrder,false);assert.deepEqual(alerts,[]);
  }finally{await act(async()=>root.unmount());cart.useCartStore.getState().clearCart();dom.window.close();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
