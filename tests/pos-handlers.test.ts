import { ClipPaymentPending } from '../lib/checkout';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { CheckoutRejected, checkoutPayload, executeCheckout, readCheckoutReview, type CheckoutReview } from '../lib/checkout';
import { errorMessage, validPagerNumber } from '../lib/pos-types';
import {withDeadline} from '../lib/request-deadline';
import {isDefinitiveWriteRejection} from '../lib/write-outcome';
import {savedShiftHtml} from '../lib/shift-printing';
import {confirmClosingPrints} from '../lib/closing-print-check';
import { rememberSalePrint } from '../lib/sale-printing';
import {beginPhoneRequest,completePhoneRequest,getPhoneOrder,phoneRequestKey,readPhoneRequest,submitPhoneRequest,validPhoneContact,type PhoneOrder,type PhoneRequest} from '../lib/phone-orders';
import { createCartStore,customizeProduct, useCartStore, type CartItem } from '../store/useCartStore';
import {bindCartDraft,cartDraftKey} from '../lib/cart-draft';

test('quick loyalty enrollment selects the new customer for the current order with required phone and optional birthday',async()=>{
  const person={id:'new-member',name:'Ana',points:50};let selected:unknown,hidden=false,saving=false;
  await handler('handleRegisterCustomer',{
    registeringCustomer:{current:false},setCustomerRegisterError:(message:string)=>assert.equal(message,''),setIsRegistering:(value:boolean)=>saving=value,
    draftOwner:{current:'cashier'},supabase:{},localStorage:{},customerForm:{firstName:'Ana',lastName:'',birthDate:'',whatsapp:'8682345678',acceptPromos:false},
    enrollCustomer:async(_client:unknown,_storage:unknown,actor:string,payload:unknown)=>{assert.equal(actor,'cashier');assert.deepEqual(payload,{name:'Ana',birthday:null,phone:'8682345678',promos:false});return person;},
    selectCustomer:(value:unknown)=>selected=value,setShowCustomerModal:(value:boolean)=>hidden=!value,setCustomerForm:()=>{},
  })({preventDefault(){}});
  assert.equal(selected,person);assert.equal(hidden,true);assert.equal(saving,false);
});

test('phone lookup ignores a slow older response and sends punctuation as a parameter',async()=>{
  const pending:Array<(value:unknown)=>void>=[],calls:unknown[]=[];
  const revision={current:0};let suggestions:unknown=[];
  const search=handler('handleCustomerSearchInput',{
    customerSearchRevision:revision,setCustomerSearch:()=>{},setCustomerSuggestions:(value:unknown)=>suggestions=value,setShowSuggestions:()=>{},
    withDeadline:(action:()=>Promise<unknown>)=>action(),supabase:{rpc:(name:string,args:unknown)=>{calls.push([name,args]);return new Promise(resolve=>pending.push(resolve));}},
  });
  const old=search('868'),current=search('+52 (868) 234-5678');
  pending[1]({data:[{id:'correct'}],error:null});await current;
  pending[0]({data:[{id:'outdated'}],error:null});await old;
  assert.deepEqual(suggestions,[{id:'correct'}]);assert.deepEqual(calls[1],['pos_search_customers',{p_search:'+52 (868) 234-5678'}]);
  const later=search('234');await search('');pending[2]({data:[{id:'late'}],error:null});await later;
  assert.deepEqual(suggestions,[]);
});

test('Enter on an ambiguous loyalty lookup requires choosing a customer',async()=>{
  const matches=[{id:'a'},{id:'b'}];let suggestions:unknown,visible=false;
  await handler('handleSearchCustomer',{
    customerSearch:'868',customerSearchRevision:{current:0},withDeadline:(action:()=>Promise<unknown>)=>action(),
    supabase:{rpc:async()=>({data:matches,error:null})},selectCustomer:()=>assert.fail('Ambiguous search must not select the first person'),
    setCustomerSuggestions:(value:unknown)=>suggestions=value,setShowSuggestions:(value:boolean)=>visible=value,alert:()=>assert.fail(),
  })();
  assert.equal(suggestions,matches);assert.equal(visible,true);
});

test('either close operation stops before reading or saving when the employee has an unpaid order',async()=>{
  for(const action of ['close','handoff']){
    const alerts:string[]=[];
    await handler('handleOpenCierre',{registerId:'r',checkoutReview:null,checkoutInFlight:{current:false},expenseInFlight:{current:false},expenseError:null,
      items:[{id:'unpaid'}],alert:(message:string)=>alerts.push(message),loadShiftSummary:()=>assert.fail('Must resolve unpaid order first')})(action);
    assert.match(alerts[0],/orden actual/);
  }
});

test('an untouched zero count cannot be saved as a closing shortage',async()=>{
  const alerts:string[]=[];
  await handler('handleSaveAndClose',{closingShift:{current:false},expenseInFlight:{current:false},expenseError:null,shiftSummary:{current:{}},
    countedCash:0,breakdown:{100:0},parseAmount:Number,dollarsInBox:'',items:[],countConfirmed:false,
    alert:(message:string)=>alerts.push(message),openPrintWindow:()=>assert.fail('No close or printing before count confirmation')})();
  assert.match(alerts[0],/Confirma que terminaste/);
});

test('clearing an unpaid order clears both the visible and persisted loyalty selection',()=>{
  let active:unknown={id:'old'},customer:unknown='old',query='old',suggestions:unknown=[{}];const revision={current:1};
  handler('handleClearOrder',{clearCart:()=>{},setActiveCustomer:(v:unknown)=>active=v,setCustomerId:(v:unknown)=>customer=v,setCustomerRestoring:()=>{},setCustomerError:()=>{},
    customerSearchRevision:revision,setCustomerSearch:(v:string)=>query=v,setCustomerSuggestions:(v:unknown)=>suggestions=v})();
  assert.equal(active,null);assert.equal(customer,null);assert.equal(query,'');assert.deepEqual(suggestions,[]);assert.equal(revision.current,2);
});

test('a phone-search connection failure is visible and cannot look like an unregistered person',async()=>{
  let error='',searching=false;
  await handler('handleCustomerSearchInput',{customerSearchRevision:{current:0},setCustomerSearch:()=>{},setCustomerSuggestions:()=>{},setShowSuggestions:()=>{},
    setCustomerSearchError:(v:string)=>error=v,setCustomerSearching:(v:boolean)=>searching=v,
    supabase:{rpc:async()=>({data:null,error:{message:'offline'}})}})('8682345678');
  assert.match(error,/No se pudo buscar.*Reintentar/);assert.equal(searching,false);
});

test('opening timeout releases employee controls and preserves the exact opening request for retry',async()=>{
  const memory=new Map<string,string>(),inFlight={current:false};let busy=false,calls=0;
  const shift={id:'opened',status:'open',initial_balance:100,exchange_rate:18,opened_at:'2026-10-30T12:00:00Z'};
  const run=handler('handleStartShift',{openingInFlight:inFlight,loading:false,loadError:null,exchangeRate:'18',parseAmount:Number,calculateTotalCash:()=>100,breakdown:{100:1},dollarsInBox:'',
    setOpeningShift:(v:boolean)=>busy=v,shiftMemoryKey:{current:'opening:a'},localStorage:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)},
    withDeadline:(fn:()=>Promise<unknown>)=>withDeadline(fn,{timeoutMs:8}),supabase:{rpc:()=>++calls===1?new Promise(()=>{}):Promise.resolve({data:shift,error:null})},alert:()=>{},fetchData:async()=>{},
    setRegisterId:()=>{},setStartingCash:()=>{},setExchangeRate:()=>{},setShiftStartTime:()=>{},DENOMINATIONS:[100],setBreakdown:()=>{},setDollarsInBox:()=>{},setShowApertura:()=>{}});
  await run();const pending=memory.get('opening:a:opening');assert.ok(pending);assert.equal(busy,false);assert.equal(inFlight.current,false);
  await run();assert.equal(calls,2);assert.equal(memory.has('opening:a:opening'),false);
});

test('closing-slip reprints use the stored cashier, dates and count rather than current shift data',()=>{
  const html=savedShiftHtml({id:'closing-id',starting_cash:100,total_sales:50,total_expenses:5,expected_cash:145,counted_cash:140,difference:-5,
    expenses_detail:[{desc:'Caja <original>',amount:5}],user_name:'Ana <caja>',opened_at:'2026-01-15T12:00:00Z',closed_at:'2026-01-15T18:00:00Z'},true);
  assert.match(html,/REIMPRESIÓN/);assert.match(html,/Ana &lt;caja&gt;/);assert.match(html,/2026/);assert.match(html,/\$140\.00/);assert.match(html,/\$-5\.00/);
});

test('a cashier can stop closing when unfinished printing needs attention',async()=>{
  const original=globalThis.fetch;const notices:string[]=[];
  globalThis.fetch=async()=>new Response(JSON.stringify({jobs:[{state:'blocked'}]}),{status:200});
  try{assert.equal(await confirmClosingPrints(message=>{notices.push(message);return false;}),false);assert.match(notices[0],/1 copias.*No vuelvas a cobrar/);}
  finally{globalThis.fetch=original;}
});

// Exercise the actual page handlers with browser/network dependencies replaced;
// no request reaches Supabase and no print dialog is opened by these checks.
function handler(name: string, context: Record<string, unknown>, file='../app/register/Register.tsx'): (...args: unknown[]) => unknown {
  context = { clipEnabled:false,pagerNumber:1,validPagerNumber,phonePending:null,phoneBusy:false,phoneError:'',phoneOrder:false,selectedPhoneOrder:null,setSelectedPhoneOrder:()=>{},readPhoneRequest,readCheckoutReview,setCheckoutReview:()=>{},draftOwner:{current:'test-user'},ClipPaymentPending,catalogStale:false, withDeadline,isDefinitiveWriteRejection,setCountConfirmed:()=>{},setCustomerSearchError:()=>{},setCustomerSearching:()=>{},countConfirmed:true,confirm:()=>true,confirmClosingPrints:async()=>true, errorMessage, withCheckoutLock:async (_key:string, action:()=>Promise<unknown>)=>action(), ...context };
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

function checkoutHarness(storage=new Map<string,string>(), online=true, retire=()=>{}, timeoutMs=12_000, pagerNumber:number|null=1) {
  let calls=0,successful=false;
  let laterResponse:unknown;const requests:unknown[]=[];
  const alerts:string[]=[];
  let settle!: (value: unknown)=>void;
  const response=new Promise(resolve=>settle=resolve);
  const item:CartItem={id:'line',quantity:1,product:{id:'coffee',name:'Coffee',price:60,category:'Bebidas'}};
  const checkoutKey={current:'test-user'}, binding={current:{requestId:()=>crypto.randomUUID(),complete:retire}};
  const fn=handler('processCheckout',{
    checkoutInFlight:{current:false},checkoutReviewKey:checkoutKey,pagerNumber,
    cartDraft:binding,draftError:null,customerRestoring:false,customerId:null,
    localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},
    navigator:{onLine:online},setIsProcessingCheckout:()=>{},getTotal:()=>60,items:[item],isPaymentInsufficient:false,activeCustomer:null,
    registerId:'register',paymentMethod:'Efectivo',parseAmount:Number,amountReceivedMXN:100,amountReceivedUSD:0,orderType:'En Local',orderNote:'',
    CheckoutRejected,checkoutPayload,executeCheckout:(client:Parameters<typeof executeCheckout>[0],pending:CheckoutReview)=>executeCheckout(client,pending,timeoutMs),readCheckoutReview,rememberSalePrint,setCheckoutReview:()=>{},setSavedSale:()=>{},setLastOrderId:()=>{},setShowCheckoutModal:()=>{},setShowPostSaleModal:(v:boolean)=>successful=v,
    clearCart:()=>{},
    alert:(message:string)=>alerts.push(message),
    supabase:{rpc:(name:string,args:unknown)=>{assert.equal(name,'pos_checkout');calls++;requests.push(args);return laterResponse===undefined?response:Promise.resolve(laterResponse);}},
  });
  return {fn,storage,alerts,checkoutKey,binding,requests,reply:(value:unknown)=>{laterResponse=value;},get calls(){return calls;},get successful(){return successful;},settle};
}

test('unknown SQL completion keeps checkout recovery and reuses its original identity instead of charging a new sale',async()=>{
  for(const code of ['08006','08007','40003','PGRST002']){
    let retired=0;const h=checkoutHarness(undefined,true,()=>{retired++;});
    const first=h.fn(),raw=h.storage.get('test-user');assert.ok(raw);
    h.settle({data:null,error:{code,message:'Completion unknown'}});await first;
    assert.equal(h.storage.get('test-user'),raw,code);assert.equal(h.successful,false);assert.equal(retired,0);
    assert.equal(h.alerts.length,0);
    h.reply({data:{id:'already-committed-sale',ticket_number:12,total:60,items:[],status:'completed',pager_number:1},error:null});
    await h.fn();assert.equal(h.successful,true);assert.equal(retired,1);assert.equal(h.storage.has('test-user'),false);
    assert.equal(h.requests.length,2);assert.deepEqual(h.requests[1],h.requests[0],code);
  }
});

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
  assert.equal(h.alerts.length, 0);
  h.settle({ data: { id: 'one-sale', ticket_number: 12, total: 60, items: [], status: 'completed', pager_number:1 }, error: null });
  await h.fn(); assert.equal(h.successful, true); assert.equal(h.storage.has('test-user'), false);
});

test('refresh recovery preserves a historical no-control payload rather than using the new cart selection',async()=>{
  const pending={startedAt:'2026-10-27',total:90,requestId:'saved-key',payload:{expected_total:90,pager_number:null}};
  const h=checkoutHarness(new Map([['test-user',JSON.stringify(pending)]]),true,undefined,12_000,null);
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
  h.settle({data:{id:'order',ticket_number:12,total:60,items:[],status:'completed',pager_number:1},error:null}); await run;
  assert.equal(h.successful,false); assert.ok(JSON.parse(h.storage.get('test-user')!).requestId);
  assert.equal(h.alerts.length,0);
});

test('confirmed sale retains checkout recovery if the print outbox cannot be saved',async()=>{
  class FailedPrintStorage extends Map<string,string> {
    set(key:string,value:string) { if(key.includes(':print:v1:'))throw Error('Print outbox unavailable');return super.set(key,value); }
  }
  const h=checkoutHarness(new FailedPrintStorage());const run=h.fn();
  h.settle({data:{id:'order',ticket_number:12,total:60,items:[],status:'completed',pager_number:1},error:null});await run;
  assert.ok(h.storage.has('test-user'));assert.equal(h.successful,false);assert.equal(h.alerts.length,0);
});

test('a checkout response arriving after cashier switch only retires its original cashier record',async()=>{
  let retiredA=0,retiredB=0;
  const h=checkoutHarness(undefined,true,()=>{retiredA++;}); const run=h.fn();
  assert.equal(h.calls,1); h.checkoutKey.current='cashier-b';
  h.binding.current={requestId:()=>crypto.randomUUID(),complete:()=>{retiredB++;}};
  h.storage.set('cashier-b','B pending request');
  h.settle({data:{id:'order-a',ticket_number:12,total:60,items:[],status:'completed',pager_number:1},error:null}); await run;
  assert.equal(retiredA,1);assert.equal(retiredB,0);assert.equal(h.storage.has('test-user'),false);
  assert.equal(h.storage.get('cashier-b'),'B pending request'); assert.equal(h.successful,false);assert.equal(h.alerts.length,0);
});
test('offline before submission leaves the order unsent',async()=>{
  const h=checkoutHarness(undefined,false);await h.fn();assert.equal(h.calls,0);assert.equal(h.storage.size,0);assert.ok(h.alerts[0].includes('La venta no se envió'));
});

test('the actual checkout handler rejects a new sale without a valid control before persisting or sending it',async()=>{
  for(const number of [null,0,31,1.2]) {
    const h=checkoutHarness(undefined,true,undefined,12_000,number);await h.fn();
    assert.equal(h.calls,0);assert.equal(h.storage.size,0);assert.equal(h.successful,false);assert.match(h.alerts[0],/Elige un control del 1 al 30/);
  }
});

test('a phone request from another window blocks the new save; only explicit recovery sends its frozen payload and never retires another draft',async()=>{
  const actor='test-user',memory=new Map<string,string>(),request:PhoneRequest={actor,kind:'save',request:crypto.randomUUID(),payload:{items:[{product_id:'old',quantity:1,extra_ids:[],note:'Original'}],expected_total:40,contact_name:'Ana',contact_phone:'8681234567',customer_id:null,order_type:'Para Llevar',order_note:''}};
  const storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
  const order:PhoneOrder={id:'old-phone',folio:1,status:'pending',contact_name:'Ana',contact_phone:'528681234567',customer_id:null,created_by:actor,created_at:'2026-11-02T18:00:00Z',revision:0,paid_order_id:null,snapshot:{items:[{id:'line',quantity:1,product:{id:'old',name:'Original',price:40,category:'Bebidas'}}],total:40,customer_name:'Ana',order_type:'Para Llevar',order_note:'',created_at:'2026-11-02T18:00:00Z',source:'phone',inventory_reserved:false}};
  let pending:unknown,paymentReview:unknown,calls=0,retired=0,printed=0;const locks:string[]=[];
  const run=handler('handlePhoneRequest',{phoneInFlight:{current:false},checkoutInFlight:{current:false},checkoutReview:null,closingShift:{current:false},draftOwner:{current:actor},cartDraft:{current:{requestId:()=>assert.fail('Must not generate a new identity'),retireRequest:(id:string)=>{assert.equal(id,request.request);if(JSON.parse(memory.get('current-draft')!).id===id)retired++;}}},
    setPhoneBusy:()=>{},setPhoneError:()=>{},setCheckoutReview:(value:unknown)=>paymentReview=value,withCheckoutLock:async(key:string,action:()=>Promise<unknown>)=>{locks.push(key);return action();},withPhoneLock:async(_actor:string,action:()=>Promise<unknown>)=>action(),readPhoneRequest,localStorage:storage,setPhonePending:(value:unknown)=>pending=value,beginPhoneRequest,submitPhoneRequest,completePhoneRequest,
    getPhoneOrder,supabase:{rpc:async(name:string,args:unknown)=>{if(name==='pos_phone_get'){assert.deepEqual(args,{p_id:order.id});return{data:order,error:null};}calls++;assert.equal(name,'pos_phone_save');assert.deepEqual(args,{p_request:request.request,p_payload:request.payload});return{data:order,error:null};}},
    rememberPhonePrint:()=>{printed++;return'phone:old-phone';},cartDraftKey:()=> 'current-draft',setPhonePrintId:()=>{},setPhonePrintNotice:()=>{},setSavedPhone:()=>{},setShowPhoneContact:()=>{},setShowPhoneOrders:()=>{},
    validPhoneContact,items:[{id:'new-line',quantity:2}],phoneOrder:true,phoneName:'Bea',phoneContact:'8685551234',draftError:null,customerRestoring:false,customerError:null,getTotal:()=>80,customerId:null,orderType:'En Local',orderNote:'Nuevo',
  });
  // The page was rendered with no pending operation; another window writes it now.
  beginPhoneRequest(storage,request);memory.set('current-draft',JSON.stringify({id:'other-current-order'}));
  assert.equal(await run(),false);assert.equal(calls,0);assert.deepEqual(pending,request);assert.equal(retired,0);
  assert.equal(await run(true),true);assert.equal(calls,1);assert.equal(printed,1);assert.equal(retired,0);assert.ok(memory.has('current-draft'));assert.equal(memory.has(phoneRequestKey(actor)),false);
  const payment={startedAt:'2026-11-02',total:40,requestId:crypto.randomUUID(),payload:{expected_total:40}};memory.set(`mi_cafe_checkout_review:${actor}`,JSON.stringify(payment));
  assert.equal(await run(),false);assert.equal(calls,1);assert.deepEqual(paymentReview,payment);assert.equal(retired,0);assert.deepEqual(locks,Array(3).fill(`mi_cafe_checkout_review:${actor}`));
});
test('legacy uncertain sale cannot be converted into a new transaction by refresh',async()=>{
  const h=checkoutHarness(new Map([['test-user',JSON.stringify({startedAt:'old',total:60,orderId:'existing'})]]));await h.fn();assert.equal(h.calls,0);assert.equal(h.storage.size,1);
});

for(const status of ['paid','cancelled'] as const)for(const newerCart of [false,true])test(`phone save replay reads today's ${status} state in a new shift, with ${newerCart?'a newer counter draft':'the old phone draft'}, and never schedules preparation`,async()=>{
  const actor='test-user',request:PhoneRequest={actor,kind:'save',request:crypto.randomUUID(),payload:{items:[{product_id:'coffee',quantity:1,extra_ids:[],note:'Original'}],expected_total:40,contact_name:'Ana',contact_phone:'8681234567',customer_id:null,order_type:'Para Llevar',order_note:''}};
  const initial:PhoneOrder={id:'phone',folio:1,status:'pending',contact_name:'Ana',contact_phone:'528681234567',customer_id:null,created_by:actor,created_at:'2026-11-02T18:00:00Z',revision:0,paid_order_id:null,snapshot:{items:[{id:'line',quantity:1,product:{id:'coffee',name:'Café',price:40,category:'Bebidas'}}],total:40,customer_name:'Ana',order_type:'Para Llevar',order_note:'',created_at:'2026-11-02T18:00:00Z',source:'phone',inventory_reserved:false}};
  const current:PhoneOrder={...initial,status,revision:1,paid_order_id:status==='paid'?'paid-sale':null},memory=new Map<string,string>();
  const storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
  const store=createCartStore(),product={...initial.snapshot.items[0].product,is_active:true};
  const bind=(registerId:string)=>bindCartDraft({storage,userId:actor,registerId,products:[product],extras:[],store,onError:message=>assert.fail(message),onRepriced:()=>assert.fail()});
  const oldBinding=bind('old-shift');store.getState().addItem(customizeProduct(product,[],'Original'));store.getState().setPhoneOrder(true);request.request=oldBinding.requestId();oldBinding.disconnect();beginPhoneRequest(storage,request);
  const binding=bind('new-shift');assert.equal(store.getState().items.length,0);
  if(newerCart)store.getState().addItem({...product,id:'counter',price:70});
  const before=memory.get(cartDraftKey(actor));let readFails=true,shown:PhoneOrder|undefined,error='',pending:unknown;const saves:unknown[]=[];
  const run=handler('handlePhoneRequest',{phoneInFlight:{current:false},checkoutInFlight:{current:false},checkoutReview:null,closingShift:{current:false},draftOwner:{current:actor},cartDraft:{current:binding},
    setPhoneBusy:()=>{},setPhoneError:(value:string)=>error=value,setPhonePending:(value:unknown)=>pending=value,withPhoneLock:async(_actor:string,action:()=>Promise<unknown>)=>action(),localStorage:storage,readPhoneRequest,submitPhoneRequest,completePhoneRequest,getPhoneOrder,
    supabase:{rpc:async(name:string,args:unknown)=>{if(name==='pos_phone_save'){saves.push(args);return{data:initial,error:null};}assert.equal(name,'pos_phone_get');return readFails?{data:null,error:{message:'Lectura interrumpida'}}:{data:current,error:null};}},
    rememberPhonePrint:()=>assert.fail('A paid/cancelled order must not schedule a new preparation'),setPhonePrintId:()=>assert.fail(),setPhonePrintNotice:()=>{},setSavedPhone:(value:PhoneOrder)=>shown=value,setShowPhoneContact:()=>{},setShowPhoneOrders:()=>{},
  });
  // Saving committed on A; the acknowledgment was lost. B has now resolved it.
  assert.equal(await run(true),false);assert.match(error,/Lectura interrumpida/);assert.equal(memory.get(cartDraftKey(actor)),before);assert.deepEqual(pending,request);assert.equal(shown,undefined);
  readFails=false;assert.equal(await run(true),true);assert.equal(memory.has(phoneRequestKey(actor)),false);assert.deepEqual(shown,current);assert.deepEqual(saves[0],saves[1]);
  if(newerCart){assert.equal(memory.get(cartDraftKey(actor)),before);assert.equal(store.getState().getTotal(),70);}
  else{assert.equal(memory.has(cartDraftKey(actor)),false);assert.equal(store.getState().items.length,0);store.getState().addItem(product);assert.equal(JSON.parse(memory.get(cartDraftKey(actor))!).registerId,'new-shift');assert.notEqual(binding.requestId(),request.request);}
  binding.disconnect();
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

test('opening SQL completion uncertainty retains the same request through successful recovery',async()=>{
  for(const code of ['08006','08007','40003']){
    const storage=new Map<string,string>(),requests:unknown[]=[];let busy=false;
    const run=handler('handleStartShift',{
      openingInFlight:{current:false},loading:false,loadError:null,exchangeRate:'16',parseAmount:Number,
      calculateTotalCash:()=>100,breakdown:{100:1},dollarsInBox:'',shiftMemoryKey:{current:'uncertain-opening'},
      setOpeningShift:(value:boolean)=>{busy=value;},localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},
      supabase:{rpc:async(_name:string,args:unknown)=>{requests.push(args);return requests.length===1?{data:null,error:{code,message:'Completion unknown'}}:{data:{id:'existing-shift',status:'open',initial_balance:100,exchange_rate:16,opened_at:'2026-11-02T18:00:00Z'},error:null};}},
      alert:()=>{},fetchData:async()=>{},setRegisterId:()=>{},setStartingCash:()=>{},setExchangeRate:()=>{},setShiftStartTime:()=>{},DENOMINATIONS:[100],setBreakdown:()=>{},setDollarsInBox:()=>{},setShowApertura:()=>{},
    });
    await run();assert.ok(storage.get('uncertain-opening:opening'),code);assert.equal(busy,false);
    await run();assert.deepEqual(requests[1],requests[0],code);assert.equal(storage.has('uncertain-opening:opening'),false);
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
    products:[],buildWizardSteps:()=>[{}],setSelectedProduct:()=>{},setActiveExtras:()=>{},setProductNote:()=>{},setEditingItemId:()=>{},setEditingQuantity:(quantity:number)=>assert.equal(quantity,original.quantity),setDynamicSteps:()=>{},setCustomizationStep:()=>{},
  })(original);
  assert.deepEqual(useCartStore.getState().items,[original]);
});

test('editing an old draft uses current milk options while preserving the original line and price until saved',()=>{
  useCartStore.getState().clearCart();
  const extras=[{id:'almond',name:'Almendra',price:15,phase:'Tipo de Leche',active:true}];
  useCartStore.getState().addItem(customizeProduct({id:'coffee',name:'Café',price:50,category:'Bebidas',customizable:false,wizard_steps:[]},extras,'sin hielo'));
  const first=useCartStore.getState().items[0];useCartStore.getState().updateQuantity(first.id,2);
  const original=useCartStore.getState().items[0],snapshot=JSON.stringify(original);
  const products=[{...original.product,price:100,customizable:true,wizard_steps:['Tipo de Leche']}];
  let selected=original.product,steps:Array<{id:string}>=[];
  const buildWizardSteps=handler('buildWizardSteps',{useCallback:(fn:unknown)=>fn,dbExtras:extras});
  handler('handleEditItem',{products,buildWizardSteps,setSelectedProduct:(value:typeof selected)=>selected=value,
    setActiveExtras:(value:unknown)=>assert.deepEqual(value,extras),setProductNote:(value:string)=>assert.equal(value,'sin hielo'),
    setEditingItemId:(value:string)=>assert.equal(value,original.id),setEditingQuantity:(value:number)=>assert.equal(value,2),
    setDynamicSteps:(value:typeof steps)=>steps=value,setCustomizationStep:()=>{},})(original);
  assert.deepEqual(steps.map(step=>step.id),['Tipo de Leche','notes']);
  assert.equal(selected.price,65);assert.equal(selected.basePrice,50);assert.equal(JSON.stringify(useCartStore.getState().items[0]),snapshot);
  handler('handleConfirmAdd',{selectedProduct:selected,products,items:[original],editingItemId:original.id,editingQuantity:2,dynamicSteps:steps,
    customizeProduct,activeExtras:extras,productNote:'sin hielo',productAvailable:()=>true,replaceItem:useCartStore.getState().replaceItem,
    setEditingItemId:()=>{},setSelectedProduct:()=>{},setActiveExtras:()=>{},setProductNote:()=>{},alert:()=>assert.fail()})();
  const saved=useCartStore.getState().items[0];assert.equal(saved.quantity,2);assert.equal(saved.product.price,65);assert.equal(saved.product.note,'sin hielo');assert.deepEqual(saved.product.displayExtras,extras);
  useCartStore.getState().clearCart();
});

test('catalog name/price editing cannot reset stock consumed since the editor loaded',async()=>{
  let payload:Record<string,unknown>={};
  await handler('handleSave',{
    activeTab:'items',editingId:'product',editingRevision:0,formData:{name:'Café',price:'55',category:'Bebidas',customizable:true,image_url:'',wizard_steps:[]},
    saving:{current:false},pending:false,commitChange:async(change:{fields:Record<string,unknown>})=>{payload=change.fields;},setMessage:(message:string)=>assert.fail(message),
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
  const common={items:[],setCloseAction:()=>{},setHandoffTarget:()=>{},DENOMINATIONS:[100],setBreakdown:()=>{},setDollarsInBox:()=>{},registerId:'r',checkoutReview:null,checkoutInFlight:{current:false},expenseInFlight:{current:false},expenseError:null,
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
