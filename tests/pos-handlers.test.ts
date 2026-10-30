import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { CheckoutRejected, checkoutPayload, executeCheckout, readCheckoutReview, type CheckoutReview } from '../lib/checkout';
import { errorMessage } from '../lib/pos-types';
import { rememberSalePrint } from '../lib/sale-printing';
import { customizeProduct, useCartStore, type CartItem } from '../store/useCartStore';

// Exercise the actual page handlers with browser/network dependencies replaced;
// no request reaches Supabase and no print dialog is opened by these checks.
function handler(name: string, context: Record<string, unknown>, file='../app/register/Register.tsx'): (...args: unknown[]) => unknown {
  context = { errorMessage, withCheckoutLock:async (_key:string, action:()=>Promise<unknown>)=>action(), ...context };
  const source=ts.createSourceFile('page.tsx',readFileSync(new URL(file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let body='';
  function visit(node: ts.Node) {
    if(ts.isVariableDeclaration(node) && node.name.getText(source)===name) body=node.initializer!.getText(source);
    ts.forEachChild(node,visit);
  }
  visit(source);
  assert.ok(body,`Missing handler ${name}`);
  const compiled=ts.transpileModule(`const extracted=${body}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  return new Function(...Object.keys(context),compiled+';return extracted;')(...Object.values(context));
}

function checkoutHarness(storage=new Map<string,string>(), online=true, retire=()=>{}, timeoutMs=12_000) {
  let calls=0,successful=false;
  const alerts:string[]=[];
  let settle!: (value: unknown)=>void;
  const response=new Promise(resolve=>settle=resolve);
  const item:CartItem={id:'line',quantity:1,product:{id:'coffee',name:'Coffee',price:60,category:'Bebidas'}};
  const checkoutKey={current:'test-user'}, binding={current:{requestId:()=>crypto.randomUUID(),complete:retire}};
  const fn=handler('processCheckout',{
    checkoutInFlight:{current:false},checkoutReviewKey:checkoutKey,
    cartDraft:binding,draftError:null,customerRestoring:false,customerId:null,
    localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},
    navigator:{onLine:online},setIsProcessingCheckout:()=>{},getTotal:()=>60,items:[item],isPaymentInsufficient:false,activeCustomer:null,
    registerId:'register',paymentMethod:'Efectivo',parseAmount:Number,amountReceivedMXN:100,amountReceivedUSD:0,orderType:'En Local',orderNote:'',
    CheckoutRejected,checkoutPayload,executeCheckout:(client:Parameters<typeof executeCheckout>[0],pending:CheckoutReview)=>executeCheckout(client,pending,timeoutMs),readCheckoutReview,rememberSalePrint,setCheckoutReview:()=>{},setSavedSale:()=>{},setLastOrderId:()=>{},setShowCheckoutModal:()=>{},setShowPostSaleModal:(v:boolean)=>successful=v,
    clearCart:()=>{},refreshInventory:async()=>{},
    alert:(message:string)=>alerts.push(message),
    supabase:{rpc:(name:string)=>{assert.equal(name,'pos_checkout');calls++;return response;}},
  });
  return {fn,storage,alerts,checkoutKey,binding,get calls(){return calls;},get successful(){return successful;},settle};
}

test('double-click on a slow transaction sends one RPC; lost response retains its exact identity',async()=>{
  const h=checkoutHarness(); const first=h.fn(); await h.fn();assert.equal(h.calls,1);
  const pending=JSON.parse(h.storage.get('test-user')!);assert.ok(pending.requestId);assert.equal(pending.payload.expected_total,60);
  h.settle({data:null,error:{message:'Failed to fetch',code:''}});await first;
  assert.equal(h.successful,false);assert.equal(h.storage.get('test-user'),JSON.stringify(pending));
});
test('actual checkout handler releases a stalled confirmation and keeps its persisted recovery identity', async () => {
  const h = checkoutHarness(undefined, true, undefined, 10);
  const first = h.fn(); assert.equal(h.calls, 1);
  const pending = h.storage.get('test-user'); await first;
  assert.equal(h.storage.get('test-user'), pending); assert.equal(h.successful, false);
  assert.match(h.alerts[0], /tardó demasiado.*\nNo vuelvas a cobrar/);
  h.settle({ data: { id: 'one-sale', ticket_number: 12, total: 60, items: [], status: 'completed' }, error: null });
  await h.fn(); assert.equal(h.successful, true); assert.equal(h.storage.has('test-user'), false);
});

test('refresh recovery sends the persisted payload rather than the new cart',async()=>{
  const pending={startedAt:'2026-10-27',total:90,requestId:'saved-key',payload:{expected_total:90}};
  const h=checkoutHarness(new Map([['test-user',JSON.stringify(pending)]]));
  const run=h.fn();assert.equal(h.calls,1);
  h.settle({data:{id:'order',ticket_number:12,total:90,items:[],status:'completed'},error:null});await run;
  assert.equal(h.storage.has('test-user'),false);assert.ok(h.storage.has('test-user:print:v1:order'));assert.equal(h.successful,true);
});
test('confirmed first-attempt database rejection leaves the cart editable and needs no review',async()=>{
  const h=checkoutHarness();const run=h.fn();h.settle({data:null,error:{message:'Stock insuficiente',code:'P0001'}});await run;
  assert.equal(h.storage.size,0);assert.equal(h.successful,false);assert.ok(h.alerts[0].includes('Stock insuficiente'));
});

test('confirmed sale cannot clear its recovery guard if unpaid-draft retirement fails',async()=>{
  const h=checkoutHarness(undefined,true,()=>{throw Error('Storage unavailable');});
  const run=h.fn();
  h.settle({data:{id:'order',ticket_number:12,total:60,items:[],status:'completed'},error:null}); await run;
  assert.equal(h.successful,false); assert.ok(JSON.parse(h.storage.get('test-user')!).requestId);
  assert.match(h.alerts[0],/No vuelvas a cobrar/);
});

test('confirmed sale retains checkout recovery if the print outbox cannot be saved',async()=>{
  class FailedPrintStorage extends Map<string,string> {
    set(key:string,value:string) { if(key.includes(':print:v1:'))throw Error('Print outbox unavailable');return super.set(key,value); }
  }
  const h=checkoutHarness(new FailedPrintStorage());const run=h.fn();
  h.settle({data:{id:'order',ticket_number:12,total:60,items:[],status:'completed'},error:null});await run;
  assert.ok(h.storage.has('test-user'));assert.equal(h.successful,false);assert.match(h.alerts[0],/No vuelvas a cobrar/);
});

test('a checkout response arriving after cashier switch only retires its original cashier record',async()=>{
  let retiredA=0,retiredB=0;
  const h=checkoutHarness(undefined,true,()=>{retiredA++;}); const run=h.fn();
  assert.equal(h.calls,1); h.checkoutKey.current='cashier-b';
  h.binding.current={requestId:()=>crypto.randomUUID(),complete:()=>{retiredB++;}};
  h.storage.set('cashier-b','B pending request');
  h.settle({data:{id:'order-a',ticket_number:12,total:60,items:[],status:'completed'},error:null}); await run;
  assert.equal(retiredA,1);assert.equal(retiredB,0);assert.equal(h.storage.has('test-user'),false);
  assert.equal(h.storage.get('cashier-b'),'B pending request'); assert.equal(h.successful,false);assert.equal(h.alerts.length,0);
});
test('offline before submission leaves the order unsent',async()=>{
  const h=checkoutHarness(undefined,false);await h.fn();assert.equal(h.calls,0);assert.equal(h.storage.size,0);assert.ok(h.alerts[0].includes('La venta no se envió'));
});
test('legacy uncertain sale cannot be converted into a new transaction by refresh',async()=>{
  const h=checkoutHarness(new Map([['test-user',JSON.stringify({startedAt:'old',total:60,orderId:'existing'})]]));await h.fn();assert.equal(h.calls,0);assert.equal(h.storage.size,1);
});
test('a cancelled committed sale resolves its recovery marker without reporting a new sale',async()=>{
  const h=checkoutHarness(new Map([['test-user',JSON.stringify({startedAt:'old',total:60,requestId:'saved',payload:{}})]]));
  const run=h.fn();h.settle({data:{id:'order',ticket_number:12,total:60,items:[],status:'cancelled'},error:null});await run;
  assert.equal(h.storage.size,0);assert.equal(h.successful,false);assert.match(h.alerts[0],/cancelada/);
});
test('rejected shift opening can be corrected; unknown transport failure retains its original request',async()=>{
  for(const code of ['P0001','']) {
    const storage=new Map<string,string>();let reloaded=0;
    const fn=handler('handleStartShift',{
      openingInFlight:{current:false},loading:false,loadError:null,exchangeRate:'20',parseAmount:Number,
      calculateTotalCash:()=>100,breakdown:{20:5},dollarsInBox:0,shiftMemoryKey:{current:'shift:test'},
      setOpeningShift:()=>{},localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)},
      supabase:{rpc:async()=>({data:null,error:{code,message:'rejected'}})},alert:()=>{},fetchData:async()=>{reloaded++;},
    });
    await fn();assert.equal(storage.has('shift:test:opening'),code==='');assert.equal(reloaded,code?1:0);
  }
});
test('discard never clears a request until the database confirms abandonment',async()=>{
  for(const failed of [true,false]) {
    let cleared=false;
    const fn=handler('handleDiscardCheckout',{
      checkoutInFlight:{current:false},checkoutReview:{requestId:'pending'},confirm:()=>true,setIsProcessingCheckout:()=>{},
      supabase:{rpc:async(name:string)=>{assert.equal(name,'pos_abandon_checkout');return {error:failed?{message:'La venta existe'}:null};}},
      localStorage:{removeItem:()=>{cleared=true;}},checkoutReviewKey:{current:'test'},setCheckoutReview:()=>{},clearCart:()=>{},setShowCheckoutModal:()=>{},alert:()=>{},
      cartDraft:{current:null},
    });
    await fn();assert.equal(cleared,!failed);
  }
});
test('opening a customization edit leaves the original line intact until confirmation',()=>{
  useCartStore.getState().clearCart();
  useCartStore.getState().addItem(customizeProduct({id:'coffee',name:'Coffee',price:50,category:'Bebidas'},[{name:'Vainilla',price:10}],''));
  const original=useCartStore.getState().items[0];
  handler('handleEditItem',{
    buildWizardSteps:()=>[{}],setSelectedProduct:()=>{},setActiveExtras:()=>{},setProductNote:()=>{},setEditingItemId:()=>{},setDynamicSteps:()=>{},setCustomizationStep:()=>{},
  })(original);
  assert.deepEqual(useCartStore.getState().items,[original]);
});

test('catalog name/price editing cannot reset stock consumed since the editor loaded',async()=>{
  let payload:Record<string,unknown>={};
  await handler('handleSave',{
    activeTab:'items',editingId:'product',formData:{name:'Café',price:'55',category:'Bebidas',customizable:true,image_url:'',wizard_steps:[]},
    supabase:{from:()=>({update:(v:Record<string,unknown>)=>{payload=v;return {eq:async()=>({error:null})};}})},
    setShowForm:()=>{},setEditingId:()=>{},setFormData:()=>{},initialFormState:{},fetchData:()=>{},alert:(message:string)=>assert.fail(message),
  },'../app/admin/productos/page.tsx')({preventDefault:()=>{}});
  assert.equal(payload.price,55);assert.equal('stock' in payload,false);
});

test('direct logout preserves expense and uncertain closing records for the same cashier',async()=>{
  const memory=new Map([['mi_cafe_shift:a','legacy expenses'],['mi_cafe_expense_request:v1:a','pending expense'],['mi_cafe_close_request:v1:a','pending close']]);
  let signedOut=false;
  await handler('handleLogout',{
    supabase:{auth:{signOut:async()=>{signedOut=true;return {error:null};}}},
    localStorage:{removeItem:(key:string)=>memory.delete(key)},shiftMemoryKey:{current:'mi_cafe_shift:a'},
    cartDraft:{current:null},clearCart:()=>{},router:{replace:()=>{},refresh:()=>{}},alert:(message:string)=>assert.fail(message),
  })();
  assert.equal(signedOut,true);assert.equal(memory.size,3);
});

test('actual closing handler loads one authoritative summary and preserves the dialog on failed reads',async()=>{
  let queryCalls=0,opened=false,cash=0,expenses:unknown;const notices:string[]=[];
  const snapshot={register_id:'r',status:'open',cash_sales:33030,expenses:[],expenses_revision:2,total_sales:33890};
  const common={registerId:'r',checkoutReview:null,checkoutInFlight:{current:false},expenseInFlight:{current:false},expenseError:null,
    draftOwner:{current:'a'},shiftSummary:{current:null},supabase:{},
    localStorage:{getItem:()=>null},expenseRequestKey:()=>'',setExpenses:(value:unknown)=>expenses=value,
    setCashSales:(value:number)=>cash=value,setShowCierre:(value:boolean)=>opened=value,alert:(value:string)=>notices.push(value)};
  await handler('handleOpenCierre',{...common,loadShiftSummary:async()=>{queryCalls++;return snapshot;}})();
  assert.equal(queryCalls,1);assert.equal(cash,33030);assert.equal(opened,true);assert.deepEqual(expenses,[]);
  opened=false;
  await handler('handleOpenCierre',{...common,loadShiftSummary:async()=>{throw Error('offline');}})();
  assert.equal(opened,false);assert.match(notices[0],/turno sigue abierto/);
});

test('an expense acknowledgment arriving after cashier switch cannot overwrite the next cashier',async()=>{
  let settle!:(value:unknown)=>void;const response=new Promise(resolve=>settle=resolve);
  const actor={current:'a'},snapshot={current:{register_id:'r'}};let published=false;
  const fn=handler('updateExpenses',{
    expenseInFlight:{current:false},closingShift:{current:false},shiftSaved:{current:false},shiftSummary:snapshot,draftOwner:actor,
    setSavingExpense:()=>{},setExpenseError:()=>{},saveShiftExpenses:()=>response,supabase:{},localStorage:{},
    setExpenses:()=>published=true,setCashSales:()=>published=true,
  });
  const pending=fn([{desc:'A',amount:35}]);actor.current='b';snapshot.current={register_id:'b-register'};
  settle({register_id:'r',expenses:[],cash_sales:100});await pending;assert.equal(published,false);assert.equal(snapshot.current.register_id,'b-register');
});
