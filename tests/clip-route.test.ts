import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as ts from 'typescript';
import * as server from '../lib/clip-server';
import {AccessError} from '../lib/user-management';

function harness({authenticated=true,admin=false}={}) {
  let privileged=0,prepared=0,started=0,lookups=0;
  const caller={};
  const gateway=class {
    start(){started++;return Promise.resolve({requestId:'request',state:'pending'});}
    status(_request:string,actor:string|null){lookups++;assert.equal(actor,admin?null:'cashier');return Promise.resolve({requestId:'request',state:'pending'});}
  };
  const imports:Record<string,unknown>={
    '@supabase/supabase-js':{createClient:()=>{privileged++;return{};}},'@/lib/supabase-server':{serverSupabase:async()=>caller},
    '@/lib/clip-server':{...server,ClipGateway:gateway,clipStaff:async()=>{if(!authenticated)throw new AccessError('Inicia sesión.',401);return{id:'cashier',admin};},
      clipRpc:async(client:unknown,name:string)=>{assert.equal(client,caller);if(name==='pos_clip_prepare')prepared++;else assert.equal(name,'pos_clip_pending');return[];}},
    '@/lib/clip-config':{clipSettings:()=>({enabled:true})},'@/lib/user-management':{AccessError},
  };
  const compiled=ts.transpileModule(readFileSync(new URL('../app/api/payments/clip/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const exports={} as {GET:(request:Request)=>Promise<Response>;POST:(request:Request)=>Promise<Response>};
  const require=createRequire(import.meta.url);new Function('require','exports',compiled)((name:string)=>imports[name]??require(name),exports);
  return {route:exports,get privileged(){return privileged;},get prepared(){return prepared;},get started(){return started;},get lookups(){return lookups;}};
}
const id='00000000-0000-4000-8000-000000000001';
const post=(body:unknown,origin='http://localhost')=>new Request('http://localhost/api/payments/clip',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('actual CLIP route authenticates before credentials/provider construction and rejects cross-origin charges',async()=>{
  const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='TEST_ONLY_SECRET';
  try {
    const denied=harness({authenticated:false});assert.equal((await denied.route.POST(post({requestId:id,payload:{payment_method:'tarjeta'}}))).status,401);assert.equal(denied.privileged,0);assert.equal(denied.started,0);
    const cross=harness();assert.equal((await cross.route.POST(post({requestId:id,payload:{payment_method:'tarjeta'}},'https://other.invalid'))).status,403);assert.equal(cross.privileged,0);assert.equal(cross.started,0);
    const valid=harness();const response=await valid.route.POST(post({requestId:id,payload:{payment_method:'tarjeta'}}));assert.equal(response.status,200);assert.equal(valid.prepared,1);assert.equal(valid.started,1);assert.match(response.headers.get('Cache-Control')!,/no-store/);assert.equal((await response.text()).includes('TEST_ONLY_SECRET'),false);
  } finally {if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
test('actual CLIP recovery checks cashier ownership, restricts external-ID reconciliation to admin and never starts a new charge',async()=>{
  const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='TEST_ONLY_SECRET';
  try {
    const cashier=harness();assert.equal((await cashier.route.GET(new Request(`http://localhost/api/payments/clip?request=${id}`))).status,200);assert.equal(cashier.lookups,1);assert.equal(cashier.started,0);
    assert.equal((await cashier.route.POST(post({action:'reconcile',requestId:id,providerId:'pinpad-123456789'}))).status,403);
    const owner=harness({admin:true});assert.equal((await owner.route.POST(post({action:'reconcile',requestId:id,providerId:'pinpad-123456789'}))).status,200);assert.equal(owner.lookups,1);assert.equal(owner.started,0);assert.equal(owner.prepared,0);
  } finally {if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
