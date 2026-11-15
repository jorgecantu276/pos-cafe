import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bindCartDraft, cartDraftKey, readCartDraft } from '../lib/cart-draft';
import { createCartStore, customizeProduct, useCartStore } from '../store/useCartStore';
import type { CatalogProduct, ExtraRow } from '../lib/pos-types';

const coffee: CatalogProduct = { id:'coffee',name:'Café',price:50,category:'Bebidas',is_active:true,customizable:true,wizard_steps:['Leche'] };
const milk: ExtraRow = { id:'milk',name:'Avena',price:10,phase:'Leche',active:true };
function fixture() {
  const values = new Map<string,string>(), errors: string[] = [];
  let quota = false, deleteBlocked = false, notices = 0;
  const storage = {getItem:(k:string)=>values.get(k)??null,
    setItem:(k:string,v:string)=>{if(quota) throw Error('Quota exceeded'); values.set(k,v);},
    removeItem:(k:string)=>{if(deleteBlocked) throw Error('Storage unavailable'); values.delete(k);}};
  return {values,errors,storage,set quota(v:boolean){quota=v;},set deleteBlocked(v:boolean){deleteBlocked=v;},get notices(){return notices;},
    bind:(userId='alice', registerId='shift', products=[coffee],extras=[milk])=>bindCartDraft({storage,userId,registerId,products,extras,
      onError:e=>errors.push(e),onRepriced:()=>notices++})};
}
beforeEach(()=>useCartStore.getState().clearCart());

test('draft survives a fresh store with quantities, extras, both notes and order type; catalog reprices it',()=>{
  const f=fixture(); let binding=f.bind();
  useCartStore.getState().addItem(customizeProduct(coffee,[{...milk,price:10}],'Sin hielo'));
  const line=useCartStore.getState().items[0].id;
  useCartStore.getState().updateQuantity(line,2);
  useCartStore.getState().setOrderType('Para Llevar'); useCartStore.getState().setOrderNote('Puerta');
  useCartStore.getState().setCustomerId('member-id');
  const request=binding.requestId(); binding.disconnect(); useCartStore.getState().clearCart();
  binding=f.bind('alice','shift',[{...coffee,price:55}],[{...milk,price:15}]);
  assert.equal(binding.requestId(),request); assert.equal(useCartStore.getState().getTotal(),140);
  assert.equal(useCartStore.getState().items[0].id,line); assert.equal(useCartStore.getState().items[0].quantity,2);
  assert.equal(useCartStore.getState().items[0].product.note,'Sin hielo');
  assert.equal(useCartStore.getState().items[0].product.displayExtras?.[0].price,15);
  assert.equal(useCartStore.getState().orderType,'Para Llevar'); assert.equal(useCartStore.getState().orderNote,'Puerta');
  assert.equal(useCartStore.getState().customerId,'member-id'); assert.equal(f.notices,1);
  const raw=f.values.get(cartDraftKey('alice'))!;
  assert.ok(!raw.includes('customer_name'));assert.equal(JSON.parse(raw).phoneName,'');assert.equal(JSON.parse(raw).phoneContact,'');binding.disconnect();
});

test('phone contact and source survive a draft restart, while payment of a saved phone order preserves a separate counter draft',()=>{
  const f=fixture();let binding=f.bind();useCartStore.getState().addItem(coffee);useCartStore.getState().setPhoneOrder(true);useCartStore.getState().setPhoneName('Ana');useCartStore.getState().setPhoneContact('8681234567');binding.disconnect();
  binding=f.bind();assert.equal(useCartStore.getState().phoneOrder,true);assert.equal(useCartStore.getState().phoneName,'Ana');assert.equal(useCartStore.getState().phoneContact,'8681234567');
  useCartStore.getState().setPagerNumber(1);assert.equal(useCartStore.getState().phoneOrder,false);const identity=binding.requestId();binding.disconnect();
  f.values.set('mi_cafe_checkout_review:alice',JSON.stringify({requestId:crypto.randomUUID(),payload:{phone_order_id:'saved-phone'}}));
  binding=f.bind();assert.equal(useCartStore.getState().getTotal(),50);assert.equal(useCartStore.getState().pagerNumber,1);assert.equal(binding.requestId(),identity);
  useCartStore.getState().clearCart();assert.equal(useCartStore.getState().phoneOrder,false);assert.equal(useCartStore.getState().phoneName,'');assert.equal(useCartStore.getState().phoneContact,'');binding.disconnect();
});

test('cashier switches and closed shifts never inherit another user or shift draft',()=>{
  const f=fixture(); let b=f.bind(); useCartStore.getState().addItem(coffee); b.disconnect();
  const original=f.values.get(cartDraftKey('alice'));
  b=f.bind('bob'); assert.equal(useCartStore.getState().items.length,0); b.disconnect();
  assert.equal(f.values.get(cartDraftKey('alice')),original);
  b=f.bind('alice','another-shift'); assert.equal(useCartStore.getState().items.length,0); b.disconnect();
  b=f.bind(); assert.equal(useCartStore.getState().getTotal(),50); b.disconnect();
  assert.throws(()=>readCartDraft(original!,'bob','shift'),/No se pudo abrir el pedido/);
});

test('retiring a confirmed phone draft from a prior shift preserves the new binding identity and later counter order',()=>{
  const f=fixture();let binding=f.bind('alice','old-shift');useCartStore.getState().addItem(coffee);useCartStore.getState().setPhoneOrder(true);useCartStore.getState().setPhoneName('Ana');useCartStore.getState().setPhoneContact('8681234567');
  const oldRequest=binding.requestId();binding.disconnect();binding=f.bind('alice','new-shift');assert.equal(useCartStore.getState().items.length,0);assert.ok(f.values.has(cartDraftKey('alice')));
  binding.retireRequest(oldRequest);assert.equal(f.values.has(cartDraftKey('alice')),false);assert.equal(useCartStore.getState().items.length,0);
  useCartStore.getState().addItem(coffee);const newRequest=binding.requestId(),newRaw=f.values.get(cartDraftKey('alice'))!;assert.notEqual(newRequest,oldRequest);assert.equal(JSON.parse(newRaw).registerId,'new-shift');assert.deepEqual(f.errors,[]);
  binding.retireRequest(oldRequest);assert.equal(f.values.get(cartDraftKey('alice')),newRaw);assert.equal(useCartStore.getState().getTotal(),50);assert.equal(binding.requestId(),newRequest);binding.disconnect();
});

test('a prior-shift phone draft already retired in another window does not leave the new binding storage expectation stale',()=>{
  const f=fixture();let binding=f.bind('alice','old-shift');useCartStore.getState().addItem(coffee);const oldRequest=binding.requestId();binding.disconnect();binding=f.bind('alice','new-shift');
  f.values.delete(cartDraftKey('alice'));binding.retireRequest(oldRequest);useCartStore.getState().addItem(coffee);
  assert.deepEqual(f.errors,[]);assert.equal(JSON.parse(f.values.get(cartDraftKey('alice'))!).registerId,'new-shift');binding.disconnect();
});

test('corrupt drafts, invalid quantities and missing catalog choices are blocked without overwriting the saved draft',()=>{
  const f=fixture(); const b=f.bind(); useCartStore.getState().addItem(customizeProduct(coffee,[{...milk,price:10}],'')); b.disconnect();
  const raw=f.values.get(cartDraftKey('alice'))!;
  assert.throws(()=>f.bind('alice','shift',[]),/producto/); assert.equal(f.values.get(cartDraftKey('alice')),raw);
  assert.throws(()=>f.bind('alice','shift',[coffee],[]),/extra/);
  assert.throws(()=>f.bind('alice','shift',[coffee],[{ ...milk, applicable_product_ids: ['otro-producto'] }]),/extra/);
  assert.equal(f.values.get(cartDraftKey('alice')),raw);
  for (const quantity of [0,-1,1.5,Infinity,1001]) {
    const damaged=JSON.parse(raw); damaged.items[0].quantity=quantity;
    assert.throws(()=>readCartDraft(JSON.stringify(damaged),'alice','shift'),/necesita revisión/);
  }
  f.values.set(cartDraftKey('alice'),'{broken'); assert.throws(()=>f.bind());
  assert.equal(f.values.get(cartDraftKey('alice')),'{broken');
});

test('storage failure is visible, retains the in-memory cart and can save again after recovery',()=>{
  const f=fixture(); const b=f.bind(); f.quota=true;
  useCartStore.getState().addItem(coffee);
  assert.equal(useCartStore.getState().getTotal(),50); assert.equal(f.errors.length,1);
  assert.throws(()=>b.requestId(),/Quota/); f.quota=false; b.flush();
  assert.ok(f.values.get(cartDraftKey('alice'))); b.disconnect();
  const restored=f.bind(); assert.equal(useCartStore.getState().getTotal(),50); restored.disconnect();
});

test('a stale tab cannot overwrite another revision or submit it as a fresh transaction',()=>{
  const f=fixture(); let b=f.bind(); useCartStore.getState().addItem(coffee);
  const request=b.requestId(), current=JSON.parse(f.values.get(cartDraftKey('alice'))!);
  current.revision=crypto.randomUUID(); current.items[0].quantity=2;
  f.values.set(cartDraftKey('alice'),JSON.stringify(current));
  useCartStore.getState().updateQuantity(useCartStore.getState().items[0].id,3);
  assert.equal(b.conflicted,true); assert.throws(()=>b.requestId(),/otra ventana/);
  assert.equal(JSON.parse(f.values.get(cartDraftKey('alice'))!).items[0].quantity,2);
  b.disconnect(); b=f.bind(); assert.equal(b.requestId(),request); assert.equal(useCartStore.getState().getTotal(),100); b.disconnect();
});

test('pending checkout takes precedence; confirmed cleanup cannot resurrect its unpaid snapshot',()=>{
  const f=fixture(); let b=f.bind(); useCartStore.getState().addItem(coffee);
  const request=b.requestId(), pendingKey='mi_cafe_checkout_review:alice';
  f.values.set(pendingKey,JSON.stringify({requestId:request})); b.disconnect();
  b=f.bind(); assert.equal(useCartStore.getState().items.length,0);
  f.deleteBlocked=true; assert.throws(()=>b.complete(),/Storage/); assert.ok(f.values.get(pendingKey));
  f.deleteBlocked=false; b.complete(); assert.equal(f.values.get(cartDraftKey('alice')),undefined);
  f.values.delete(pendingKey); b.disconnect(); b=f.bind();
  assert.equal(useCartStore.getState().items.length,0);
  useCartStore.getState().addItem(coffee); assert.notEqual(b.requestId(),request); b.disconnect();
});

test('independent tab stores cannot overwrite a newer revision, while cashier bindings stay separate',()=>{
  const f=fixture(), tabA=createCartStore(),tabB=createCartStore();
  const bind=(store:typeof tabA,userId='alice')=>bindCartDraft({storage:f.storage,userId,registerId:'shift',products:[coffee],extras:[milk],store,onError:e=>f.errors.push(e),onRepriced:()=>{}});
  const first=bind(tabA);tabA.getState().addItem(coffee);const identity=first.requestId();
  const second=bind(tabB); assert.equal(second.requestId(),identity);
  assert.throws(()=>first.requestId(),/otra ventana/);
  tabA.getState().updateQuantity(tabA.getState().items[0].id,3);
  assert.equal(JSON.parse(f.values.get(cartDraftKey('alice'))!).items[0].quantity,1);
  first.disconnect();second.disconnect();
  const bob=bind(tabB,'bob');tabB.getState().addItem({...coffee,price:20});
  const bobSaved=f.values.get(cartDraftKey('bob')); const bobItems=tabB.getState().items;
  first.complete(); // Delayed success for disconnected Alice binding.
  assert.equal(f.values.get(cartDraftKey('alice')),undefined);
  assert.equal(f.values.get(cartDraftKey('bob')),bobSaved);assert.deepEqual(tabB.getState().items,bobItems);
  bob.disconnect();
});
