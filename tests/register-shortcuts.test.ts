import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import { act, createElement, useState, type ComponentProps, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceRegister, { WorkspaceCustomization } from '../app/register/WorkspaceRegister';
import { hasPreparationNote, loadRegisterShortcuts, readRegisterShortcutsRequest, recoverRegisterShortcuts, registerShortcutsKey, saveRegisterShortcuts, togglePreparationNote } from '../lib/register-shortcuts';

const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
type Args={p_request:string;p_payload:{actor_id:string;product_ids:string[];revision:number}};
const api=(run:(name:string,args:Args)=>Promise<unknown>)=>({rpc:(name:string,args:Args)=>{const response=run(name,args);return Object.assign(response,{abortSignal:()=>response});}} as unknown as Pick<SupabaseClient,'rpc'>);
function harness(){
  const values=new Map<string,string>(),locks=new Set<string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(key:string,_options:unknown,action:(lock:object|null)=>unknown)=>{
    if(locks.has(key))return action(null);locks.add(key);try{return await action({});}finally{locks.delete(key);}
  }}}});
  return{storage,values,restore(){if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}};
}

test('favorites retain the exact ordered request after a lost response and recover without inventing a new selection',async()=>{
  const h=harness(),calls:Args[]=[];let fail=true;
  const client=api(async(name,args)=>{assert.equal(name,'pos_set_register_shortcuts');assert.ok(h.storage.getItem(registerShortcutsKey('owner')));calls.push(args);
    return fail?{error:{message:'Respuesta perdida',code:''}}:{error:null,data:{request_id:args.p_request,product_ids:args.p_payload.product_ids,revision:args.p_payload.revision+1}};});
  try{
    await assert.rejects(saveRegisterShortcuts(client,h.storage,'owner',{product_ids:[second,first],revision:5}),/perdida/);
    assert.deepEqual(readRegisterShortcutsRequest(h.storage,'owner')?.payload.product_ids,[second,first]);
    await assert.rejects(saveRegisterShortcuts(client,h.storage,'owner',{product_ids:[],revision:5}),/Comprueba/);assert.equal(calls.length,1);
    fail=false;assert.deepEqual(await recoverRegisterShortcuts(client,h.storage,'owner'),{product_ids:[second,first],revision:6});
    assert.deepEqual(calls[0],calls[1]);assert.equal(h.values.size,0);
  }finally{h.restore();}
});

test('invalid selections never write; confirmed rejection clears only that request while malformed success retains recovery',async()=>{
  const h=harness();let calls=0;
  try{
    for(const product_ids of [[first,first],Array(9).fill(first),['bad']])await assert.rejects(saveRegisterShortcuts(api(async()=>{calls++;}),h.storage,'owner',{product_ids,revision:0}),/hasta 8/);
    await assert.rejects(saveRegisterShortcuts(api(async()=>{calls++;}),{...h.storage,setItem(){throw Error('Almacenamiento lleno');}},'owner',{product_ids:[first],revision:0}),/lleno/);assert.equal(calls,0);
    await assert.rejects(saveRegisterShortcuts(api(async()=>({error:{code:'P0001',message:'Producto inactivo'}})),h.storage,'owner',{product_ids:[first],revision:0}),/inactivo/);assert.equal(h.values.size,0);
    await assert.rejects(saveRegisterShortcuts(api(async(_name,args)=>({error:null,data:{request_id:args.p_request,product_ids:[second],revision:1}})),h.storage,'owner',{product_ids:[first],revision:0}),/No se confirmó el guardado/);assert.ok(readRegisterShortcutsRequest(h.storage,'owner'));
    await assert.rejects(recoverRegisterShortcuts(api(async()=>assert.fail()),h.storage,'another-owner'),/No hay/);
  }finally{h.restore();}
});

test('favorites reads preserve stored order and reject malformed results',async()=>{
  assert.deepEqual(await loadRegisterShortcuts(api(async()=>({error:null,data:{product_ids:[second,first],revision:3}}))),{product_ids:[second,first],revision:3});
  await assert.rejects(loadRegisterShortcuts(api(async()=>({error:null,data:{product_ids:[first,first],revision:3}}))),/hasta 8/);
});

test('quick preparation text preserves manual notes, toggles complete lines and refuses to truncate at 1000 characters',()=>{
  const manual='Entregar con Ana; sin popote';
  assert.equal(togglePreparationNote(manual,'Sin hielo'),`${manual}\nSin hielo`);
  assert.equal(togglePreparationNote(togglePreparationNote(`${manual}\n`,'Sin hielo'),'Sin hielo'),`${manual}\n`);
  assert.equal(togglePreparationNote(`${manual}\nSin hielo\nSin azúcar`,'Sin hielo'),`${manual}\nSin azúcar`);
  assert.equal(togglePreparationNote('Sin hielo, por favor','Sin hielo'),'Sin hielo, por favor\nSin hielo');
  assert.equal(togglePreparationNote('x'.repeat(995),'Sin hielo'),'x'.repeat(995));
  assert.equal(togglePreparationNote(manual,'Leche de almendra'),manual);
  assert.equal(hasPreparationNote('Sin hielo, por favor','Sin hielo'),false);
});

async function render(work:(screen:Document,click:(label:string)=>Promise<void>)=>Promise<void>,component:ReactNode){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});}
  const root=createRoot(dom.window.document.getElementById('root')!);
  const click=async(label:string)=>{const button=[...dom.window.document.querySelectorAll('button')].find(node=>(node.getAttribute('aria-label')??node.textContent?.trim())===label);assert.ok(button,`Missing ${label}`);assert.equal(button.disabled,false);await act(async()=>{button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
  try{await act(async()=>root.render(component));await work(dom.window.document,click);}finally{await act(async()=>root.unmount());dom.window.close();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
}

test('favorites display owner order, hide inactive items and keep the entire searchable menu',async()=>{
  let added='';
  const props:ComponentProps<typeof WorkspaceRegister>={products:[{id:first,name:'Americano',price:50,category:'Bebidas',is_active:true},{id:second,name:'Latte',price:70,category:'Bebidas',is_active:true},{id:'inactive',name:'Inactivo',price:20,category:'Bebidas',is_active:false}],favoriteProductIds:[second,'inactive',first],items:[],total:0,search:'',onSearch:()=>{},userName:'Cajera',isAdmin:false,disabled:false,onProduct:product=>{added=product.id;},onEdit:()=>{},onQuantity:()=>{},onRemove:()=>{},onClear:()=>{},onCheckout:()=>{},onCloseShift:()=>{},customer:null,customerSearch:'',onCustomerSearch:()=>{},suggestions:[],onCustomer:()=>{},onNewCustomer:()=>{},onRemoveCustomer:()=>{},orderType:'En Local',onOrderType:()=>{},orderNote:'',onOrderNote:()=>{},onReprint:()=>{},notices:null};
  await render(async(screen,click)=>{
    const favorites=screen.querySelector('[aria-label="Favoritos"]')!;assert.ok(favorites);
    assert.deepEqual([...favorites.querySelectorAll('.workspace-product strong')].map(node=>node.textContent),['Latte','Americano']);
    assert.equal(screen.querySelectorAll('.workspace-product').length,4);assert.equal(favorites.querySelector('a'),null);
    await click('Latte, $70.00');assert.equal(added,second);
  },createElement(WorkspaceRegister,props));
  await render(async(screen)=>{assert.equal(screen.querySelector('[aria-label="Favoritos"]'),null);assert.equal(screen.querySelectorAll('.workspace-product').length,1);assert.match(screen.body.textContent!,/Latte/);},createElement(WorkspaceRegister,{...props,search:'latte'}));
  let retries=0;
  await render(async(screen,click)=>{assert.match(screen.querySelector('[aria-label="Favoritos"]')!.textContent!,/No se pudieron cargar/);await click('Reintentar favoritos');assert.equal(retries,1);await click('Latte, $70.00');assert.equal(added,second);},createElement(WorkspaceRegister,{...props,favoriteProductIds:[],favoritesError:'No se pudieron cargar los favoritos.',onRetryFavorites:()=>{retries++;}}));
  await render(async(screen)=>{assert.match(screen.querySelector('[aria-label="Favoritos"]')!.textContent!,/Cargando favoritos/);assert.equal(screen.querySelectorAll('.workspace-product').length,2);},createElement(WorkspaceRegister,{...props,favoriteProductIds:[],favoritesLoading:true}));
  await render(async(screen,click)=>{
    assert.equal(screen.querySelector('[aria-label="Favoritos"]'),null);
    assert.equal(screen.querySelectorAll('.workspace-product img').length,0);
    assert.equal(screen.querySelector('[aria-label="Categorías del menú"] a')?.textContent,'Elegir favoritos');
    await click('Postres');
    assert.deepEqual([...screen.querySelectorAll('.workspace-product strong')].map(node=>node.textContent),['Brownie']);
    await click('Brownie, $30.00');assert.equal(added,'dessert');
    assert.equal(screen.querySelector('.workspace-total strong')?.textContent,'$0.00');
    await click('Todos');assert.equal(screen.querySelectorAll('.workspace-product').length,3);
  },createElement(WorkspaceRegister,{...props,isAdmin:true,favoriteProductIds:[],products:[...props.products,{id:'dessert',name:'Brownie',price:30,category:'Postres',is_active:true}]}));
});

test('preparation notes remain editable without universal shortcuts or changes to paid modifiers',async()=>{
  let selected=0,note='Para Ana\nSin hielo\nSin azúcar';
  function Customization(){const [value,setValue]=useState(note);return createElement(WorkspaceCustomization,{product:{id:first,name:'Latte',price:70,category:'Bebidas'},steps:[],index:0,extras:[{id:'milk',name:'Almendra',price:15,phase:'Leche'}],dbExtras:[],note:value,onNote:text=>{note=text;setValue(text);},onStep:()=>{},onOption:()=>{selected++;},onConfirm:()=>{},onClose:()=>{}});}
  await render(async(screen,click)=>{
    assert.equal(screen.querySelector('[aria-label="Notas rápidas de preparación"]'),null);
    assert.match(screen.querySelector('.workspace-custom-price')!.textContent!,/85\.00/);
    await click('Para Ana\nSin hielo\nSin azúcar');
    const editor=screen.querySelector<HTMLTextAreaElement>('[aria-label="Notas de preparación"]')!;
    assert.equal(editor.tagName,'TEXTAREA');assert.equal(editor.value,'Para Ana\nSin hielo\nSin azúcar');assert.equal(editor.maxLength,1000);
    assert.equal(note,'Para Ana\nSin hielo\nSin azúcar');assert.equal(selected,0);
  },createElement(Customization));
});
