import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkedExpenses, closeRequestKey, closeShift, expenseRequestKey, loadShiftSummary,
  recoverPendingExpenses, recoverShiftClose, restoreShiftExpenses, saveShiftExpenses, type ShiftSummary } from '../lib/shift-state';
import { createCartStore, customizeProduct } from '../store/useCartStore';

let navigatorDescriptor: PropertyDescriptor | undefined;
beforeEach(()=>{
  navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const held=new Set<string>();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(key:string,_:unknown,action:(lock:object|null)=>Promise<unknown>)=>{
    if(held.has(key))return action(null);
    held.add(key);try{return await action({});}finally{held.delete(key);}
  }}}});
});
afterEach(()=>{if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else Reflect.deleteProperty(globalThis,'navigator');});
const initial=():ShiftSummary=>({register_id:'synthetic-register',status:'open',opened_at:'2026-10-28T12:00:00Z',
  starting_cash:100,exchange_rate:20,total_sales:1145,cash_sales:1145,expected_cash:1245,expenses:[],expenses_revision:0,payments:{efectivo:1145}});
function storage(){const map=new Map<string,string>();const value:Storage={get length(){return map.size;},clear:()=>map.clear(),
  key:(index:number)=>[...map.keys()][index]??null,getItem:(k:string)=>map.get(k)??null,
  setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};return {map,value};}
type Result={data:unknown;error:null|{message:string;code?:string}};
function client(run:(name:string,args:Record<string,unknown>)=>Promise<Result>|Result){return {rpc:(name:string,args:Record<string,unknown>)=>{
  const result=Promise.resolve().then(()=>run(name,args));return Object.assign(result,{abortSignal:()=>result});
}} as unknown as Pick<SupabaseClient,'rpc'>;}

test('confirmed expense additions and deletion restore from server after refresh and browser storage loss',async()=>{
  const s=storage();let server=initial();
  const api=client((name,p)=>{
    if(name==='pos_shift_expenses')server={...server,expenses:p.p_expenses as ShiftSummary['expenses'],expenses_revision:server.expenses_revision+1};
    return {data:structuredClone(server),error:null};
  });
  server=await saveShiftExpenses(api,s.value,'cashier-a',server,[{desc:'Retiro',amount:50}]);
  assert.equal((await restoreShiftExpenses(api,s.value,'cashier-a',server.register_id)).expenses[0].amount,50);
  await saveShiftExpenses(api,s.value,'cashier-a',server,[]);
  s.map.clear();
  assert.deepEqual((await restoreShiftExpenses(api,s.value,'cashier-a',server.register_id)).expenses,[]);
});

test('lost expense response replays the exact stored request, not a new amount, and survives cashier separation',async()=>{
  const s=storage();let server=initial(),calls=0;const requests:Record<string,unknown>[]=[];
  const api=client((name,p)=>{
    if(name==='pos_shift_summary')return {data:server,error:null};
    calls++;requests.push(structuredClone(p));
    if(calls===1){server={...server,expenses:[{desc:'Retiro',amount:50}],expenses_revision:1};return {data:null,error:{message:'Lost response'}};}
    return {data:server,error:null};
  });
  await assert.rejects(saveShiftExpenses(api,s.value,'cashier-a',server,[{desc:'Retiro',amount:50}]),/Lost response/);
  assert.ok(s.value.getItem(expenseRequestKey('cashier-a')));
  assert.equal(s.value.getItem(expenseRequestKey('cashier-b')),null);
  const recovered=await restoreShiftExpenses(api,s.value,'cashier-a',server.register_id);
  assert.deepEqual(requests[1],requests[0]);assert.equal(recovered.expenses_revision,1);
  assert.equal(s.map.size,0);
});

test('SQL conflict retires only its request; browser-storage failure sends no expense write',async()=>{
  const s=storage();let calls=0;
  const api=client(()=>{calls++;return {data:null,error:{message:'Los gastos cambiaron',code:'P0001'}};});
  await assert.rejects(saveShiftExpenses(api,s.value,'a',initial(),[{desc:'R',amount:0.29}]),/cambiaron/);
  assert.equal(s.map.size,0);assert.equal(calls,1);
  const broken={...s.value,setItem:()=>{throw Error('storage unavailable');}} as Storage;
  await assert.rejects(saveShiftExpenses(api,broken,'a',initial(),[]),/storage unavailable/);assert.equal(calls,1);
  assert.throws(()=>checkedExpenses([{desc:'R',amount:0.001}]),/válidos/);
});

test('unknown SQL completion preserves an expense identity and a closing count for exact recovery',async()=>{
  for(const code of ['08006','08007','40003']){
    const s=storage(),requests:Record<string,unknown>[]=[];
    const expenses=[{desc:'Retiro',amount:35}],saved={...initial(),expenses,expenses_revision:1,expected_cash:1210};
    const api=client((name,args)=>{
      if(name==='pos_shift_summary')return {data:saved,error:null};
      requests.push(args);return requests.length===1?{data:null,error:{code,message:'Completion unknown'}}:{data:saved,error:null};
    });
    await assert.rejects(saveShiftExpenses(api,s.value,'uncertain',initial(),expenses),/Completion unknown/);
    const raw=s.value.getItem(expenseRequestKey('uncertain'));assert.ok(raw,code);
    await recoverPendingExpenses(api,s.value,'uncertain');assert.deepEqual(requests[1],requests[0],code);assert.equal(s.map.size,0);
    const closeRequests:Record<string,unknown>[]=[];
    const report={id:'existing-close',starting_cash:100,total_sales:1145,total_expenses:0,expected_cash:1245,counted_cash:1245,difference:0,expenses_detail:[]};
    const closing=client((_name,args)=>{closeRequests.push(args);return closeRequests.length===1?{data:null,error:{code,message:'Completion unknown'}}:{data:report,error:null};});
    await assert.rejects(closeShift(closing,s.value,'uncertain',initial(),1245),/Completion unknown/);
    assert.ok(s.value.getItem(closeRequestKey('uncertain')),code);
    const recovered=await closeShift(closing,s.value,'uncertain',initial(),1000);
    assert.equal(recovered.id,report.id);assert.deepEqual(closeRequests[1],closeRequests[0],code);assert.equal(s.map.size,0);
  }
});

test('legacy expense import preserves the old journal until acknowledgment and rejects conflicting server history',async()=>{
  const s=storage();const legacy=JSON.stringify({registerId:initial().register_id,expenses:[{desc:'Anterior',amount:35}]});
  s.value.setItem('mi_cafe_shift:a',legacy);let fail=true;
  const api=client((name,p)=>name==='pos_shift_summary'?{data:initial(),error:null}:fail?
    {data:null,error:{message:'offline'}}:{data:{...initial(),expenses:p.p_expenses,expenses_revision:1},error:null});
  await assert.rejects(restoreShiftExpenses(api,s.value,'a',initial().register_id));assert.equal(s.value.getItem('mi_cafe_shift:a'),legacy);
  fail=false;
  const restored=await restoreShiftExpenses(api,s.value,'a',initial().register_id);assert.equal(restored.expenses[0].amount,35);assert.equal(s.map.size,0);
  s.value.setItem('mi_cafe_shift:a',legacy);
  const conflicting=client(()=>({data:{...initial(),expenses_revision:2,expenses:[]},error:null}));
  await assert.rejects(restoreShiftExpenses(conflicting,s.value,'a',initial().register_id),/difieren/);
  assert.equal(s.value.getItem('mi_cafe_shift:a'),legacy);
});

test('closing timeout preserves the exact count and preview; refresh recovers it without another close identity',async()=>{
  const s=storage();const requests:Record<string,unknown>[]=[];let lost=true;
  const report={id:'synthetic-close',starting_cash:100,total_sales:1145,total_expenses:0,expected_cash:1245,counted_cash:1245,difference:0,expenses_detail:[]};
  const api=client((name,p)=>{assert.equal(name,'pos_close_shift');requests.push(structuredClone(p));return lost?{data:null,error:{message:'Lost close response'}}:{data:report,error:null};});
  await assert.rejects(closeShift(api,s.value,'a',initial(),1245),/Lost close response/);
  const original=s.value.getItem(closeRequestKey('a'));assert.ok(original);
  lost=false;await recoverShiftClose(api,s.value,'a');assert.deepEqual(requests[0],requests[1]);assert.equal(s.map.size,0);
  s.value.setItem(expenseRequestKey('a'),'pending');await assert.rejects(closeShift(api,s.value,'a',initial(),1245),/gasto pendiente/);
});

test('simultaneous tabs cannot replace an in-flight expense request',async()=>{
  const s=storage();let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);let calls=0;
  const api=client(async()=>{calls++;await hold;return {data:initial(),error:null};});
  const first=saveShiftExpenses(api,s.value,'a',initial(),[]);
  await assert.rejects(saveShiftExpenses(api,s.value,'a',initial(),[{desc:'Other',amount:20}]),/Otra ventana/);
  release();await first;assert.equal(calls,1);
});

test('real-menu quantities, special prices, milk surcharge and packs total 1145 without editing double-charge',()=>{
  const menu=JSON.parse(readFileSync(new URL('fixtures/real-menu.json',import.meta.url),'utf8'));
  const product=(name:string)=>{const row=menu.products.find((p:{name:string})=>p.name===name);assert.ok(row);return {id:row.reference,name:row.name,price:row.price_mxn,category:row.category};};
  const milk={id:'synthetic-milk',phase:'Tipo de Leche',name:'Almendra',price:15};
  for(const [name,expected] of [['Iced coffee caramelo',110],['Iced coffe flan',145],['Iced coffee nevado',155],['Frappe Oreo',100],['Cappuccino',95],['Te chai caliente',110]] as const){
    const prepared=customizeProduct(product(name),[milk],'');assert.equal(prepared.price,expected);assert.equal(customizeProduct(prepared,[milk],'').price,expected);
  }
  const cart=createCartStore();const iced=customizeProduct(product('Iced coffee caramelo'),[milk],'');
  cart.getState().addItem(iced);cart.getState().addItem(iced);cart.getState().addItem(product('Tortuguitas 5pz'));cart.getState().addItem(product('Cheesecake grande tortuga'));
  assert.equal(cart.getState().getTotal(),1145);assert.equal(menu.products.length,82);
});

test('server shift reader surfaces failure instead of substituting zero sales',async()=>{
  await assert.rejects(loadShiftSummary(client(()=>({data:null,error:{message:'network unavailable'}})),'r'),/network unavailable/);
});

test('an expense response lost before another tab closes is recovered before opening a new register',async()=>{
  const s=storage();const request={p_register:initial().register_id,p_request:'same-request',p_revision:0,p_expenses:[{desc:'R',amount:35}]};
  s.value.setItem(expenseRequestKey('a'),JSON.stringify(request));let replays=0;
  const api=client((name,p)=>{if(name==='pos_shift_expenses'){replays++;assert.deepEqual(p,request);}return {data:{...initial(),status:'closed',expenses_revision:1,expenses:request.p_expenses},error:null};});
  await recoverPendingExpenses(api,s.value,'a');assert.equal(replays,1);assert.equal(s.map.size,0);
});

test('a stalled SDK/Auth promise cannot keep a cancelled shift read waiting',async()=>{
  const controller=new AbortController();let requested=false;
  const api=client(()=>{requested=true;return new Promise<Result>(()=>{});});
  const load=loadShiftSummary(api,'r',controller.signal);
  await Promise.resolve();assert.equal(requested,true);controller.abort();
  await assert.rejects(load,/No se confirmó/);
});
