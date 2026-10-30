import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCheckoutLock } from '../lib/checkout';

test('checkout lock refuses another tab while a response is pending and releases after failure',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const held=new Set<string>();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{
    request:async (key:string,_options:unknown,action:(lock:object|null)=>Promise<unknown>)=>{
      if(held.has(key)) return action(null);held.add(key);
      try{return await action({});}finally{held.delete(key);}
    }}}});
  let release!:()=>void, secondCalled=false;
  try{
    const first=withCheckoutLock('cashier-a',()=>new Promise<void>(resolve=>{release=resolve;}));
    await assert.rejects(withCheckoutLock('cashier-a',async()=>{secondCalled=true;}),/Otra ventana/);
    assert.equal(secondCalled,false);
    assert.equal(await withCheckoutLock('cashier-b',async()=>7),7);
    release();await first;
    await assert.rejects(withCheckoutLock('cashier-a',async()=>{throw Error('Network failed');}),/Network/);
    assert.equal(await withCheckoutLock('cashier-a',async()=>8),8);
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
    await assert.rejects(withCheckoutLock('cashier-a',async()=>{secondCalled=true;}),/Actualiza el navegador/);
    assert.equal(secondCalled,false);
  }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else Reflect.deleteProperty(globalThis,'navigator');}
});
