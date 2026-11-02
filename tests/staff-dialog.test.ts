import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {act,createElement,type ComponentType} from 'react';
import {createRoot} from 'react-dom/client';
import * as ts from 'typescript';
import AdminDialog from '../app/admin/AdminDialog';
import * as resource from '../lib/use-resource';
import * as types from '../lib/pos-types';
import * as avatars from '../lib/staff-avatars';
import * as active from '../lib/staff-active';

test('staff editor uses the shared dialog, keeps its avatar secondary and cannot close during an unconfirmed save',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
  // React's focus fallback probes legacy methods absent from the DOM fixture.
  Object.defineProperties(dom.window.HTMLElement.prototype,{attachEvent:{value(){}},detachEvent:{value(){}}});
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const user={id:'user',username:'ana',full_name:'Ana',role:'cashier',avatar_url:avatars.staffAvatars[0].src,is_active:true};
  const client={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},from:()=>{const q=Object.assign(Promise.resolve({data:[user],error:null}),{select:()=>q,eq:()=>q,order:()=>q,abortSignal:()=>q});return q;}};
  let resolve!:(value:unknown)=>void,writes=0;
  const pending=new Promise(ready=>{resolve=ready;});
  const imports:Record<string,unknown>={
    '../AdminDialog':{default:AdminDialog,__esModule:true},'@/lib/use-resource':resource,'@/lib/pos-types':types,'@/lib/staff-avatars':avatars,
    '@/lib/supabase':{supabase:client},'@/lib/staff-active':active,'@/lib/staff-requests':{readStaffPending:()=>null,acknowledgeStaffPending:()=>{},saveStaffChange:()=>{writes++;return pending;}},
    '@/components/StaffAvatar':{default:()=>null,__esModule:true},'@/app/LoadFailure':{default:()=>null,__esModule:true},
  };
  const code=ts.transpileModule(readFileSync(new URL('../app/admin/usuarios/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;
  const exports:{default?:ComponentType}={},require=createRequire(import.meta.url);
  new Function('require','exports',code)((name:string)=>imports[name]??require(name),exports);
  const root=createRoot(dom.window.document.getElementById('root')!);
  const edit=()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Editar')!;
  try{
    await act(async()=>root.render(createElement(exports.default!)));
    await act(async()=>edit().dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    const dialog=dom.window.document.querySelector('dialog')!;assert.ok(dialog.hasAttribute('open'));
    assert.equal(dom.window.document.activeElement?.getAttribute('aria-label'),'Nueva contraseña opcional');
    assert.equal(dialog.querySelector('details')?.open,false);
    await act(async()=>dialog.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(writes,1);assert.equal(dialog.querySelector<HTMLButtonElement>('button[form="staff-editor-form"]')?.disabled,true);
    await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{bubbles:true,cancelable:true})));
    assert.ok(dom.window.document.querySelector('dialog'),'An in-flight staff save must remain visible');
    await act(async()=>{resolve({password_changed:false});await pending;});
    assert.equal(dom.window.document.querySelector('dialog'),null);
    assert.match(dom.window.document.body.textContent!,/Cambios guardados/);
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
