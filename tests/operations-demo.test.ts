import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { webDemoContract, demoEnvironment, configurationIdentity, assertDemoStopped, demoBuildIdentity, localDemoAccess, writeDemoJson } from '../lib/operations-demo.mjs';
import { operationsDemoFile } from '../scripts/operations/package-policy.mjs';
import { middleware } from '../middleware';
import { GET } from '../app/api/ops-demo/identity/route';
import { operationsDemoAuth } from '../lib/operations-demo-auth';

async function fixture(product='cafe') {
  const directory=await mkdtemp(path.join(tmpdir(),'pos-web-demo-test-')),app=path.join(directory,'app');
  await mkdir(path.join(app,'.next/static/chunks'),{recursive:true});await mkdir(path.join(app,'.next/server'),{recursive:true});
  for(const [file,text]of Object.entries({'BUILD_ID':'synthetic-build','build-manifest.json':'{}','server/app-paths-manifest.json':'{}','static/chunks/client.js':'synthetic immutable client'}))await writeFile(path.join(app,'.next',file),text);
  const contract=webDemoContract(product);
  const record={format:'pos-web-demo-runtime-v1',phase:'ready',app,directory,token:'a'.repeat(64),appPid:process.pid,launcherPid:process.pid,
    identity:{product,preset:product,tier:1,runId:'synthetic-unit-run',sourceCommit:'b'.repeat(40),sourceTree:'c'.repeat(40),contentSha256:'d'.repeat(64),databaseContractSha256:'e'.repeat(64),packager:'pos-web-demo-v1',configSha256:'',buildIdentity:await demoBuildIdentity(app)},
    isolation:{project:'pos-cafe-admin-12345678',network:'supabase_network_pos-cafe-admin-12345678',containers:[]}};
  const config={api:contract.api,database:`postgresql://postgres:synthetic@127.0.0.1:${contract.databasePort}/postgres`,anon:'synthetic-anon',service:'synthetic-service'};
  const env=demoEnvironment(record,config,{});
  const access={...record,config,env};record.identity.configSha256=configurationIdentity(record,access);
  await writeDemoJson(path.join(directory,'access.private.json'),access);
  return {record,access,env};
}
test('Café and Smoothies contracts are distinct closed product instances',()=>{
  assert.equal(webDemoContract('cafe').app,'http://127.0.0.1:3151');assert.equal(webDemoContract('smoothies').api,'http://127.0.0.1:55921');
  assert.throws(()=>webDemoContract('punto'));assert.throws(()=>webDemoContract('unknown'));
});
test('concurrent demo databases use distinct cookies without changing installed customer namespaces',()=>{
  const previous=process.env.NEXT_PUBLIC_POS_OPS_DEMO;
  try{
    delete process.env.NEXT_PUBLIC_POS_OPS_DEMO;assert.deepEqual(operationsDemoAuth('https://customer.invalid'),{});assert.deepEqual(operationsDemoAuth('http://127.0.0.1:58000'),{});
    process.env.NEXT_PUBLIC_POS_OPS_DEMO='1';
    assert.notEqual(operationsDemoAuth('http://127.0.0.1:55901').cookieOptions?.name,operationsDemoAuth('http://127.0.0.1:55921').cookieOptions?.name);
    assert.throws(()=>operationsDemoAuth('https://customer.invalid'));assert.throws(()=>operationsDemoAuth('http://localhost:55901'));
  }finally{if(previous===undefined)delete process.env.NEXT_PUBLIC_POS_OPS_DEMO;else process.env.NEXT_PUBLIC_POS_OPS_DEMO=previous;}
});
test('demo environment strips inherited provider/client controls and refuses retained config drift',async()=>{
  const {record,access}=await fixture();
  const env=demoEnvironment(record,access.config,{PATH:'synthetic-path',POS_CLIP_ENABLED:'1',POS_CLIP_TOKEN:'foreign',STRIPE_SECRET_KEY:'foreign',NODE_OPTIONS:'--require=foreign',NEXT_PUBLIC_POS_PROFILE:'smoothies'});
  assert.equal(env.PATH,'synthetic-path');assert.equal(env.POS_CLIP_ENABLED,'0');assert.equal(env.NEXT_PUBLIC_POS_PROFILE,'cafe');assert.equal(env.STRIPE_SECRET_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);
  assert.equal(configurationIdentity(record,access,env),record.identity.configSha256);
  for(const patch of [{POS_CLIP_ENABLED:'1'},{NEXT_PUBLIC_SUPABASE_URL:'https://foreign.invalid'},{NEXT_PUBLIC_POS_PROFILE:'smoothies'},{POS_PRINT_DATA_DIR:'C:/foreign'},{POS_CLIP_TOKEN:'foreign'}])assert.throws(()=>configurationIdentity(record,access,{...env,...patch}));
});
test('identity requires exact host/origin/token and current compiled output; no access secrets are returned',async()=>{
  const {record,env}=await fixture(),saved={...process.env},cwd=process.cwd();
  try{
    for(const key of Object.keys(process.env))if(/^(POS_|SMOOTHIES_|NEXT_PUBLIC_|SUPABASE_|STRIPE_|NODE_OPTIONS$|NODE_ENV$|NEXT_TELEMETRY_DISABLED$)/i.test(key))delete process.env[key];
    Object.assign(process.env,env);process.chdir(record.app);
    const request=(token=record.token,host='127.0.0.1:3151',origin?:string)=>new Request('http://127.0.0.1:3151/api/ops-demo/identity',{headers:{host,'X-Pos-Ops-Token':token,...(origin?{origin}:{})}});
    const response=await GET(request());assert.equal(response.status,200);const body=await response.json();assert.equal(body.product,'cafe');assert.equal(body.token,undefined);assert.equal(body.config,undefined);
    assert.equal((await GET(request('0'.repeat(64)))).status,403);assert.equal((await GET(request(record.token,'localhost:3151'))).status,403);
    await assert.rejects(localDemoAccess(request(record.token,'127.0.0.1:3151','https://foreign.invalid'),{token:true}));
    await writeFile(path.join(record.app,'.next/BUILD_ID'),'another-build');assert.equal((await GET(request())).status,403);
  }finally{process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test('middleware opens only exact operational demo routes when configured; customer/ordinary mode stays closed',async()=>{
  const names=['POS_OPS_DEMO_ACCESS_FILE','POS_OPS_DEMO_TOKEN','POS_RELEASE_BUILD'],saved=Object.fromEntries(names.map(key=>[key,process.env[key]]));
  try{
    for(const key of names)delete process.env[key];
    const req=(route:string)=>new NextRequest('http://127.0.0.1:3151'+route);
    for(const route of ['/ops-demo','/api/ops-demo/login','/api/ops-demo/identity'])assert.equal((await middleware(req(route))).status,404);
    process.env.POS_OPS_DEMO_ACCESS_FILE='synthetic-private-file';process.env.POS_OPS_DEMO_TOKEN='a'.repeat(64);
    assert.equal((await middleware(req('/api/ops-demo/identity'))).headers.get('x-middleware-next'),'1');
    process.env.POS_RELEASE_BUILD='1';assert.equal((await middleware(req('/api/ops-demo/identity'))).status,404);
  }finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('resume refuses any live or uncertain original process without issuing a stop',()=>{
  const record={launcherPid:11,appPid:12};assert.throws(()=>assertDemoStopped(record,()=>true));assert.throws(()=>assertDemoStopped(record,()=>{throw Error('uncertain');}));assert.doesNotThrow(()=>assertDemoStopped(record,()=>false));
});
test('customer stage excludes operational routes, helpers and their import-dependent test',async()=>{
  for(const file of ['app/ops-demo/page.tsx','app/api/ops-demo/identity/route.ts','scripts/operations/start.mjs','lib/operations-demo.mjs','tests/operations-demo.test.ts'])assert.equal(operationsDemoFile(file),true,file);
  for(const file of ['app/api/users/route.ts','lib/pos-profile.ts','scripts/printing/windows-print.ps1','scripts/smoothies/start-local.mjs'])assert.equal(operationsDemoFile(file),false,file);
  for(const file of ['scripts/windows/package-release.mjs','scripts/smoothies/package-windows.mjs']){
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');assert.ok(source.includes('operationsDemoFile'));assert.ok(source.includes('Operational demo routes must be physically absent'));
  }
});
