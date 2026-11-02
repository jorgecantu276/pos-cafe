import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {act,createElement,type ComponentType} from 'react';
import * as ts from 'typescript';
import AdminDialog from '../app/admin/AdminDialog';
import * as resource from '../lib/use-resource';
import * as types from '../lib/pos-types';
import * as avatars from '../lib/staff-avatars';
import * as requests from '../lib/staff-requests';
import * as active from '../lib/staff-active';

test('inactive staff reactivation preserves the ID and replays a lost acknowledgment through the current team UI',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),saved=new Map<string,PropertyDescriptor|undefined>();
  Object.defineProperty(dom.window.navigator,'locks',{value:{request:async(_key:string,_options:unknown,action:(lock:object)=>Promise<unknown>)=>action({})}});
  for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
  const user={id:'same-user',username:'ana',full_name:'Ana',role:'cashier',avatar_url:avatars.staffAvatars[0].src,is_active:false,management_revision:4};
  const calls:Record<string,unknown>[]=[];let result:unknown;
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from:()=>{const query=Object.assign(Promise.resolve({data:[{...user}],error:null}),{select:()=>query,order:()=>query,abortSignal:()=>query});return query;},rpc:async(name:string,args:Record<string,unknown>)=>{assert.equal(name,'pos_set_staff_active');calls.push(args);if(!result){user.is_active=true;user.management_revision=5;result={request_id:args.p_request,id:user.id,is_active:true,management_revision:5};return{data:null,error:{code:'',message:'Respuesta perdida'}};}return{data:result,error:null};}};
  const imports:Record<string,unknown>={'../AdminDialog':{default:AdminDialog,__esModule:true},'@/lib/use-resource':resource,'@/lib/pos-types':types,'@/lib/staff-avatars':avatars,'@/lib/staff-requests':requests,'@/lib/staff-active':active,'@/lib/supabase':{supabase:client},'@/components/StaffAvatar':{default:()=>null,__esModule:true},'@/app/LoadFailure':{default:()=>null,__esModule:true}};
  const code=ts.transpileModule(readFileSync(new URL('../app/admin/usuarios/page.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports:{default?:ComponentType}={},require=createRequire(import.meta.url);new Function('require','exports',code)((name:string)=>imports[name]??require(name),exports);
  const{createRoot}=await import('react-dom/client');let root=createRoot(dom.window.document.getElementById('root')!);
  const button=(label:string)=>{const found=[...dom.window.document.querySelectorAll('button')].find(button=>(button.getAttribute('aria-label')??button.textContent?.trim())===label);assert.ok(found,`Missing ${label}`);return found;};
  const click=async(label:string)=>{assert.equal(button(label).disabled,false);await act(async()=>button(label).click());};
  try{
    await act(async()=>root.render(createElement(exports.default!)));await click('Inactivos');await click('Reactivar a ana');assert.equal(calls.length,1);assert.match(dom.window.document.body.textContent!,/Respuesta perdida/);assert.ok(active.readStaffActivation(dom.window.localStorage,'owner'));assert.equal(button('Reactivar a ana').disabled,true);
    await act(async()=>root.unmount());root=createRoot(dom.window.document.getElementById('root')!);await act(async()=>root.render(createElement(exports.default!)));await click('Comprobar acceso');assert.deepEqual(calls[0],calls[1]);assert.equal(active.readStaffActivation(dom.window.localStorage,'owner'),null);assert.match(dom.window.document.body.textContent!,/Acceso guardado/);assert.equal(user.id,'same-user');assert.equal(user.management_revision,5);assert.ok(button('Editar'));
    assert.deepEqual(Object.keys(calls[0]).sort(),['p_active','p_id','p_request','p_revision']);assert.equal(calls[0].p_revision,4);assert.equal(calls[0].p_active,true);
  }finally{await act(async()=>root.unmount());dom.window.close();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
