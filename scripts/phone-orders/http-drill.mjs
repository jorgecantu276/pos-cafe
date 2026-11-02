import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {freshLocalApi} from '../testing/local-api.mjs';
import {startApp} from '../staging/app.mjs';
import {root,work} from '../staging/runtime.mjs';
import {seedQualityMenu} from '../quality/menu-fixture.mjs';

let local,app;const sessions=[];
const ok=result=>{assert.ifError(result.error&&Error(result.error.message));return result.data;};
try{
  local=await freshLocalApi({portBase:55501});const {config,db,service}=local;
  const actors={};
  for(const [role,username,name] of [['admin','phone_admin','Prueba admin'],['cashier','phone_cashier','Prueba cashier'],['secondCashier','phone_second','Prueba segundo']]){
    const password=randomUUID()+'!';
    const user=ok(await service.auth.admin.createUser({email:username+'@carinitomio.local',password,email_confirm:true})).user;
    await db.query('insert into profiles(id,username,full_name,role) values($1,$2,$3,$4)',[user.id,username,name,role==='admin'?'admin':'cashier']);
    actors[role]={id:user.id,username,password,name,full_name:name};
  }
  await local.install();
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8'));await seedQualityMenu(db,menu);
  async function login(actor){
    const jar=new Map(),client=createServerClient(config.api,config.anon,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>value?jar.set(name,value):jar.delete(name))},auth:{autoRefreshToken:false}});
    sessions.push(client);ok(await client.auth.signInWithPassword({email:actor.username+'@carinitomio.local',password:actor.password}));
    return {client,cookie:()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; ')};
  }
  const owner=await login(actors.admin),cashier=await login(actors.cashier);
  const anon=createClient(config.api,config.anon,{auth:{persistSession:false,autoRefreshToken:false}});sessions.push(anon);
  for(let attempt=0;attempt<40;attempt++){
    const [ready,phones]=await Promise.all([owner.client.rpc('pos_drawer_status'),owner.client.rpc('pos_phone_list')]);
    if(!ready.error&&!phones.error)break;
    if(attempt===39){ok(ready);ok(phones);}await new Promise(resolve=>setTimeout(resolve,100));
  }
  ok(await owner.client.rpc('pos_set_drawer_rate',{p_request:randomUUID(),p_payload:{rate:16}}));
  ok(await cashier.client.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:16}));
  assert.ok((await anon.rpc('pos_phone_list')).error);
  const printDirectory=await mkdtemp(path.join(work,'phone-printing-'));
  const issuer=path.join(printDirectory,'synthetic-issuer.json');
  const faultsFile=path.join(printDirectory,'mock-faults.json');await writeFile(faultsFile,'{}');
  await writeFile(issuer,JSON.stringify({legalName:'EMISOR FICTICIO',rfc:'AAA010101AAA',taxRegime:'601 - General de Ley Personas Morales',establishmentAddress:'Domicilio ficticio',postalCode:'87380',city:'Matamoros'}));
  app=await startApp(config,{port:3112,printing:{directory:printDirectory,issuer,faults:faultsFile}});await app.ready();
  const url='http://127.0.0.1:3112';
  const printing=await fetch(url+'/api/printing',{headers:{Cookie:cashier.cookie(),'X-Pos-Print':'1'}});
  assert.equal(printing.status,200);assert.deepEqual(await printing.json(),{mode:'mock',canManage:false,jobs:[]});
  assert.equal((await fetch(url+'/api/phone-printing?phoneOrderId='+randomUUID(),{headers:{'X-Pos-Print':'1'}})).status,401);
  const clip=await fetch(url+'/api/payments/clip',{headers:{Cookie:owner.cookie()}});assert.equal(clip.status,200);assert.equal((await clip.json()).enabled,false);
  console.log('PASS phone HTTP fixture: real staff sessions, complete schema, menu options, mock-only printing and CLIP off.');
  if(process.env.POS_BROWSER_QUALITY==='1'){
    const {phoneQualityReview}=await import('../quality/phone-review.mjs');
    await phoneQualityReview({url,actors,config,db,appDirectory:app.app,printDirectory,faultsFile});
  }
  if(process.env.POS_KEEP_PHONE_PREVIEW==='1'){
    const manifest=path.join(app.app,'phone-preview.private.json');
    await writeFile(manifest,JSON.stringify({url,actors,config,printDirectory},null,2));
    console.log('Synthetic phone preview ready; private manifest: '+manifest);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }
  console.log('PASS phone-order HTTP/browser acceptance; no hosted records, bank charges or physical paper.');
}finally{
  await app?.stop();for(const client of sessions)client.auth.stopAutoRefresh();await local?.cleanup();
}
