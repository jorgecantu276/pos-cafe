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
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import * as ts from 'typescript';
import * as cart from '../store/useCartStore';
import * as checkout from '../lib/checkout';
import * as printing from '../lib/printing';
import * as salePrinting from '../lib/sale-printing';
import PrintDispatch from '../app/register/PrintDispatch';
import * as shift from '../lib/shift';
import * as types from '../lib/pos-types';
import * as resource from '../lib/use-resource';
import * as shortcuts from '../lib/register-shortcuts';
import RecentTickets from '../app/register/RecentTickets';
import * as drafts from '../lib/cart-draft';
import * as shiftState from '../lib/shift-state';
import PrototypeRegister, {PrototypeCheckout,PrototypeCustomization} from '../app/register/PrototypeRegister';
import WorkspaceRegister, {WorkspaceCheckout,WorkspaceCustomization,WorkspaceOpening,WorkspaceDialog} from '../app/register/WorkspaceRegister';

for(const [appearance, role, clipEnabled] of [['owner','cashier',false],['prototype','cashier',false],['workspace','cashier',false],['workspace','admin',false],['workspace','admin',true]] as const) test(`the actual ${appearance} ${role} POS ${clipEnabled?'with CLIP ':''}preserves recovery and automatically dispatches both synthetic copies`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' });
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async (_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}});
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const alerts: string[] = [];
  let printJobs: salePrinting.SalePrintJob[] = [];
  const dispatches: string[] = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    alert: (message: string) => alerts.push(message), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url:string, options:RequestInit) => {
      if(url.startsWith('/api/payments/clip?')) return Response.json({error:'No encontrado'},{status:404});
      if(url==='/api/payments/clip') {
        assert.equal(clipEnabled,true);assert.equal(options.method,'POST');const body=JSON.parse(options.body as string);
        assert.equal(body.payload.payment_method,'tarjeta');
        const result=await client.rpc('pos_checkout',{p_payload:body.payload});
        return Response.json({state:'completed',requestId:body.requestId,order:result.data});
      }
      assert.equal(url, '/api/printing');
      if(options.method==='POST') {
        const body=JSON.parse(options.body as string);assert.equal(body.orderId,'fixture-order');dispatches.push(body.orderId);
        printJobs=(['customer','barista'] as const).map(audience=>({orderId:body.orderId,ticket:'1234',audience,queue:audience==='customer'?'POS80 Printer':'Y813BT Sticker',state:'submitted',message:'Enviado a Windows',attempts:1,updatedAt:'2026-10-30'}));
      }
      return Response.json({mode:'mock',jobs:printJobs});
    } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  cart.useCartStore.getState().clearCart();
  let root = createRoot(dom.window.document.getElementById('root')!);
  const fixtureProduct = { id: '00000000-0000-4000-8000-000000000001', name: 'Cappuccino', price: 80, category: 'Bebidas', image_url: null, is_active: true, customizable: false, wizard_steps: [] };
  const fixtures: Record<string, unknown> = {
    profiles: { full_name: 'Prueba local', role, is_active: true },
    products: [fixtureProduct], extras: [],
    cash_registers: { id: 'local-shift', opened_at: '2026-10-27T12:00:00Z', initial_balance: 100, exchange_rate: 20 },
    customers: {id:'local-member',name:'Cliente de prueba',phone:'000',customer_code:'LOCAL',birth_date:null,points:50,total_spent:0,accept_promos:false},
  };
  let release!: () => void;
  const delayedAuth = new Promise<void>(resolve => { release = resolve; });
  let submitted: checkout.CheckoutPayload | undefined;
  let authenticatedUser='fixture-user';
  let favoriteReads=0;
  let authChanged!: (_event:string, session:{user:{id:string}}|null)=>void;
  const client = {
    auth: { getUser: async () => { await delayedAuth; return { data: { user: { id: authenticatedUser } }, error: null }; },
      onAuthStateChange: (callback:typeof authChanged) => {authChanged=callback;return {data:{subscription:{unsubscribe:()=>{}}}};} },
    from: (table: string) => {
      assert.ok(table in fixtures, `Unexpected read: ${table}`);
      const result = Promise.resolve({ data: fixtures[table], error: null });
      const query = Object.assign(result, { select: () => query, eq: () => query, order: () => query,
        abortSignal: () => query, single: () => query, maybeSingle: () => query });
      return query;
    },
    rpc: (name: string, args: { p_payload: checkout.CheckoutPayload }) => {
      if(name==='pos_inventory_register'){const result=Promise.resolve({error:null,data:{enabled:false,items:[]}});return Object.assign(result,{abortSignal:()=>result});}
      if(name==='get_register_shortcuts'){favoriteReads++;const result=Promise.resolve(favoriteReads===1?{error:{message:'Synthetic favorites connection failure'},data:null}:{error:null,data:{product_ids:[fixtureProduct.id],revision:1}});return Object.assign(result,{abortSignal:()=>result});}
      if(name==='pos_drawer_status'){const result=Promise.resolve({error:null,data:{rate:20,active:{id:'local-shift',cashier_id:authenticatedUser,cashier_name:'Prueba'},handoff:null,cashiers:role==='admin'?[{id:'next-cashier',name:'Ana'},{id:'other-cashier',name:'Luis'}]:[]}});return Object.assign(result,{abortSignal:()=>result});}
      if(name==='pos_shift_summary') {
        const result=Promise.resolve({error:null,data:{register_id:'local-shift',status:'open',opened_at:'2026-10-27T12:00:00Z',
          starting_cash:100,exchange_rate:20,total_sales:0,cash_sales:0,expected_cash:100,expenses:[],expenses_revision:0,payments:{}}});
        return Object.assign(result,{abortSignal:()=>result});
      }
      assert.equal(name, 'pos_checkout'); submitted = args.p_payload;
      return { error: null, data: { id: 'fixture-order', ticket_number: 1234, status: 'completed', total: fixtureProduct.price,
        items: [{ id: 'fixture-line', quantity: 1, product: { ...fixtureProduct, category: 'Bebidas', image_url: undefined } }],
        customer_name: 'Invitado', created_at: '2026-10-27T12:10:00Z', order_type: 'En Local', order_note: '',
        payment_method: 'tarjeta', tender_mxn: 0, tender_usd: 0, exchange_rate: 20, change_mxn: 0 } };
    },
  };
  const nodeRequire = createRequire(import.meta.url);
  const router = { replace: () => {}, refresh: () => {} };
  const imports: Record<string, unknown> = { '@/lib/drawer':drawer,'./DrawerGate':{default:DrawerGate,__esModule:true}, '@/lib/request-deadline':deadline, '@/lib/receipt-reprint':reprint, '@/lib/supabase': { supabase: client }, '@/store/useCartStore': cart,
    '@/lib/checkout': checkout, '@/lib/printing': printing, '@/lib/sale-printing':salePrinting, './PrintDispatch':{default:PrintDispatch,__esModule:true}, './printing.css':{}, '@/lib/shift': shift, '@/lib/shift-state':shiftState,
    './PrototypeRegister':{default:PrototypeRegister,PrototypeCheckout,PrototypeCustomization,__esModule:true}, './prototype.css':{},
    './WorkspaceRegister':{default:WorkspaceRegister,WorkspaceCheckout,WorkspaceCustomization,WorkspaceOpening,WorkspaceDialog,__esModule:true}, './workspace.css':{}, '@/lib/pos-types': types, '@/lib/use-resource': resource, '@/lib/cart-draft': drafts, 'next/navigation': { useRouter: () => router } };
  const source = readFileSync(new URL('../app/register/Register.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { default?: ComponentType<{appearance:'owner'|'prototype'|'workspace';clipEnabled?:boolean}> } = {};
  imports['@/lib/register-shortcuts'] = shortcuts; imports['@/lib/catalog-management'] = catalogManagement;
  imports['./ClipPaymentStatus'] = { default: ClipPaymentStatus, __esModule: true };
  imports['./RecentTickets'] = { default: RecentTickets, __esModule: true };
  new Function('require', 'exports', compiled)((name: string) => name === '@/components/ProductPhoto' ? { default: ProductPhoto, __esModule: true } : imports[name] ?? nodeRequire(name), exports);
  const button = (text: string) => {
    const element = [...dom.window.document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')??b.textContent?.trim()) === text);
    assert.ok(element, `Missing button: ${text}`); return element;
  };
  const click = async (element: Element) => { await act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  try {
    await act(async () => root.render(createElement(exports.default!,{appearance,clipEnabled})));
    assert.equal(button(appearance==='owner'?'Pagar Ahora':'Cobrar').disabled, true);
    await act(async () => { release(); });
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
    let screen = dom.window.document.getElementById('root')!.firstElementChild!;
    assert.ok(screen.classList.contains('bg-[#F5F5F7]'));
    if(appearance==='owner') assert.ok([...screen.children].some(e => e.classList.contains('w-[420px]')));
    else assert.ok(screen.querySelector(appearance==='workspace'?'.workspace-body':'.prototype-workspace'));
    assert.match(screen.textContent!, /Orden [Aa]ctual/);
    if(appearance==='workspace') {
      const gateway=screen.querySelector<HTMLAnchorElement>('.workspace-admin-gateway');
      if(role==='admin') { assert.equal(gateway?.textContent,'Administración'); assert.equal(gateway?.getAttribute('href'),'/admin'); }
      else assert.equal(gateway,null);
    }
    const product = appearance==='workspace' ? screen.querySelector('.workspace-product')! : [...screen.querySelectorAll('h3')].find(e => e.textContent === fixtureProduct.name)!;
    assert.ok(product); await click(appearance==='workspace'?product:product.parentElement!);
    assert.equal(cart.useCartStore.getState().getTotal(), 80);
    if (appearance === 'workspace') {
      assert.match(screen.textContent!, /No se pudieron cargar los favoritos/);
      const cartBeforeFavorites = dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user'));
      await click(button('Reintentar favoritos'));
      assert.equal(favoriteReads, 2);
      assert.equal(cart.useCartStore.getState().getTotal(), 80);
      assert.equal(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user')), cartBeforeFavorites);
      assert.equal(screen.querySelectorAll('.workspace-favorites-group .workspace-product').length, 1);
      assert.doesNotMatch(screen.textContent!, /No se pudieron cargar los favoritos/);
      assert.ok(screen.querySelector('[aria-label="Categorías del menú"]'));
      assert.equal(screen.querySelector('[aria-label="Aumentar cantidad"]'), null);
      await click(button('Editar Cappuccino'));
      const draftBeforeEdit = dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user'));
      await click(button('Aumentar cantidad'));
      await click(button('Nota de preparación'));
      await click(button('a'));
      assert.equal(cart.useCartStore.getState().getTotal(), 80);
      assert.equal(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user')), draftBeforeEdit);
      await click(button('Cerrar Cappuccino'));
      assert.equal(cart.useCartStore.getState().getTotal(), 80);
      assert.equal(cart.useCartStore.getState().items[0].product.note ?? '', '');
      await click(button('Editar Cappuccino'));
      await click(button('Aumentar cantidad'));
      await click(button('Nota de preparación'));
      await click(button('a'));
      await click(button('Guardar cambios'));
      assert.equal(cart.useCartStore.getState().getTotal(), 160);
      assert.equal(cart.useCartStore.getState().items[0].product.note, 'a');
      const savedEdit = JSON.parse(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user'))!);
      assert.notEqual(JSON.stringify(savedEdit), draftBeforeEdit);
      await click(button('Editar Cappuccino'));
      await click(button('Reducir cantidad'));
      await click(button('Guardar cambios'));
      assert.equal(cart.useCartStore.getState().getTotal(), 80);
      await click(button('Editar Cappuccino'));
      await click(button('Quitar'));
      assert.equal(cart.useCartStore.getState().items.length, 0);
      assert.equal(button('Cobrar').disabled, true);
      await click(product);
    }
    await act(async () => {
      cart.useCartStore.getState().setOrderType('Para Llevar');
      cart.useCartStore.getState().setOrderNote('Entrega en puerta');
      cart.useCartStore.getState().setCustomerId('local-member');
    });
    assert.ok(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user')));
    await act(async () => root.unmount());
    assert.equal(cart.useCartStore.getState().items.length, 0);
    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => root.render(createElement(exports.default!,{appearance,clipEnabled})));
    screen = dom.window.document.getElementById('root')!.firstElementChild!;
    assert.equal(cart.useCartStore.getState().getTotal(), 80);
    assert.equal(cart.useCartStore.getState().orderNote, 'Entrega en puerta');
    assert.match(screen.textContent!, /Cliente de prueba/);
    const beforeSwitch=dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user'));
    authenticatedUser='another-cashier';
    await act(async()=>authChanged('SIGNED_IN',{user:{id:authenticatedUser}}));
    assert.equal(cart.useCartStore.getState().items.length,0);
    assert.equal(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user')),beforeSwitch);
    authenticatedUser='fixture-user';
    await act(async()=>root.unmount()); root=createRoot(dom.window.document.getElementById('root')!);
    await act(async()=>root.render(createElement(exports.default!,{appearance,clipEnabled})));
    screen=dom.window.document.getElementById('root')!.firstElementChild!;
    assert.equal(cart.useCartStore.getState().getTotal(),80);
    assert.equal(Boolean(submitted),false, 'Restoring a draft must never submit a payment');
    let expectedTotal=80;
    if (appearance==='workspace') {
      const unchangedDraft=dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user'));
      await click(button('Editar Cappuccino'));
      fixtureProduct.price=85;
      await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('focus'));});
      assert.match(screen.textContent!,/El menú cambió/);
      assert.equal(button('Actualizar menú').disabled,true,'Catalog replacement waits for the open editor');
      assert.equal(cart.useCartStore.getState().getTotal(),80);
      assert.equal(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user')),unchangedDraft);
      await click(button('Cerrar Cappuccino'));
      await click(button('Cobrar'));
      assert.equal(screen.querySelector('dialog[aria-label="Cobrar"]'),null,'Known changed catalog cannot open a new checkout');
      await click(button('Actualizar menú'));
      expectedTotal=85;
      assert.equal(cart.useCartStore.getState().getTotal(),85);
      assert.equal(cart.useCartStore.getState().customerId,'local-member');
      assert.equal(cart.useCartStore.getState().orderNote,'Entrega en puerta');
      assert.equal(cart.useCartStore.getState().orderType,'Para Llevar');
      assert.doesNotMatch(screen.textContent!,/El menú cambió/);
      assert.ok(alerts.some(message=>/Los precios cambiaron/.test(message))); alerts.length=0;
    }
    if (process.env.POS_UI_PREVIEW) writeFileSync(process.env.POS_UI_PREVIEW, screen.outerHTML);
    await click(button(appearance==='owner'?'Pagar Ahora':'Cobrar'));
    if(appearance==='owner'){assert.match(screen.textContent!,/Detalles de Orden/);await click(button('Continuar'));assert.match(screen.textContent!,/Finalizar Venta/);}
    else if(appearance==='prototype') assert.match(screen.textContent!,/Cobrar orden/);
    else assert.ok(screen.querySelector('dialog[aria-label="Cobrar"]'));
    await click(button('Tarjeta'));
    if(appearance!=='owner'&&!clipEnabled){assert.equal(button('Confirmar pago').disabled,true);await click(screen.querySelector(appearance==='workspace'?'.workspace-card-confirm input':'.prototype-card-confirm input')!);}
    await click(button(clipEnabled?'Enviar a CLIP':'Confirmar pago'));
    assert.equal(submitted?.payment_method, 'tarjeta'); assert.equal(submitted?.expected_total, expectedTotal);
    assert.equal(submitted?.order_type, 'Para Llevar'); assert.equal(submitted?.order_note, 'Entrega en puerta');
    assert.equal(submitted?.customer_id, 'local-member');
    assert.match(dom.window.document.body.textContent!, appearance==='workspace'?/Venta guardada/:/Venta guardada/);
    assert.equal(dom.window.localStorage.getItem(drafts.cartDraftKey('fixture-user')), null);
    assert.equal(cart.useCartStore.getState().items.length, 0);
    assert.equal(printJobs.length,2);assert.ok(dispatches.length>=1);
    assert.match(dom.window.document.body.textContent!,/Ticket del cliente/);assert.match(dom.window.document.body.textContent!,/Etiquetas del barista/);
    assert.equal(salePrinting.pendingSalePrints(dom.window.localStorage,'mi_cafe_checkout_review:fixture-user').length,0);
    assert.equal(alerts.length, 0);
    if(appearance==='workspace') {
      await click(button('Nueva venta'));
      await click(button('Terminar turno'));
      const closing = screen.querySelector<HTMLDialogElement>('dialog[aria-label="Cierre de caja"]')!;
      assert.ok(closing?.open);
      const content = closing.querySelector('.pos-closing-content')!;
      assert.equal(content.firstElementChild?.tagName,'FIELDSET','The first step precedes expenses and counting');
      assert.equal(closing.querySelectorAll('select').length,0,'Touch choices do not use small select menus');
      const confirm = closing.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      assert.ok(closing.querySelector('footer')?.contains(confirm),'Count confirmation stays with the fixed actions');
      assert.equal(button('Confirmar cierre').disabled,true);
      await click(confirm);
      assert.equal(button('Confirmar cierre').disabled,false,'Zero counts still require explicit confirmation');
      await click(button('Entregar a otro cajero'));
      assert.equal(confirm.checked,false,'Changing the operation requires a fresh confirmation');
      await click(confirm);
      assert.equal(button('Confirmar entrega').disabled,true,'A handoff requires a recipient');
      if(role==='admin') {
        await click(button('Ana'));
        assert.equal(confirm.checked,false);
        await click(confirm);
        assert.equal(button('Confirmar entrega').disabled,false);
        await click(button('Luis'));
        assert.equal(button('Ana').getAttribute('aria-pressed'),'false');
        assert.equal(button('Luis').getAttribute('aria-pressed'),'true');
        assert.equal(button('Confirmar entrega').disabled,true,'Changing recipients resets the confirmation');
      } else assert.match(closing.textContent!,/No hay otro cajero disponible/);
      await click(button('Volver a caja'));
      assert.equal(screen.querySelector('dialog[aria-label="Cierre de caja"]'),null);
      assert.equal(alerts.length,0);
    }
    // Only the simulated dispatch endpoint was called; no physical printer or live service.
  } finally {
    await act(async () => root.unmount()); cart.useCartStore.getState().clearCart(); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
