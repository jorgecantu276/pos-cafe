import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {settings,work} from '../staging/runtime.mjs';
import {startApp} from '../staging/app.mjs';
import {createBackup} from '../recovery/backup.mjs';
import {restoreBackup} from '../recovery/restore.mjs';
import {databaseFingerprint} from '../recovery/fingerprint.mjs';
import {cashierFixture} from './fixture.mjs';

const runId=randomUUID(),directory=path.join(work,'cashiers'),checks=[],evidence=[],requests=[],clients=[];
await mkdir(directory,{recursive:true});
let restored,app,gateway,db,source,backup,actors,product,hold=false,dropNext=false,finished=false,outcome='running',gates=[],active=0;
let lastCommand=JSON.parse(await readFile(path.join(directory,'command.json'),'utf8').catch(()=>'{}')).id;
const pass=name=>{if(checks.includes(name))return;checks.push(name);console.log(`PASS ${name}`);};
const ok=(result)=>{assert.ifError(result.error&&Error(result.error.message));return result.data;};
const makeClient=(config,key=config.anon)=>{const c=createClient(config.api,key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(c);return c;};
async function save() {await writeFile(path.join(directory,'last-result.json'),JSON.stringify({runId,outcome,passed:checks.length,checks,evidence,requests,
  actors:actors&&Object.fromEntries(Object.entries(actors).map(([key,a])=>[key,{id:a.id,register:a.register.id}])),product,
  buildId:app&&(await readFile(path.join(app.app,'.next/BUILD_ID'),'utf8')).trim()},null,2));}
async function release() {hold=false;gates.splice(0).forEach(resolve=>resolve());for(let n=0;n<100&&active;n++)await new Promise(r=>setTimeout(r,100));assert.equal(active,0,'Local checkout response did not settle');await save();}
async function command(action) {
  switch(action) {
    case 'status':return {held:gates.length,requests:requests.length,active};
    case 'hold':hold=true;return {hold};
    case 'release':await release();return {released:true,requests:requests.length};
    case 'drop-next':dropNext=true;return {dropNext};
    case 'verify-cashiers': {
      const key=id=>`mi_cafe_cart_draft:v1:${id}`;
      const a=evidence.find(e=>e.userId===actors.a.id&&e.drafts[key(actors.a.id)]?.orderNote==='Caja A');
      const b=evidence.find(e=>e.userId===actors.b.id&&e.drafts[key(actors.b.id)]?.orderNote==='Caja B');
      assert.ok(a&&b&&a.locks&&b.locks,'Record both authenticated cashier drafts');
      const both=evidence.find(e=>e.userId===actors.a.id&&e.drafts[key(actors.a.id)]?.orderNote==='Caja A'&&e.drafts[key(actors.b.id)]?.orderNote==='Caja B');
      assert.ok(both,'Switch back to A and verify both saved drafts remain distinct');
      assert.notEqual(both.drafts[key(actors.a.id)].id,both.drafts[key(actors.b.id)].id);
      assert.equal(both.drafts[key(actors.a.id)].items[0].quantity,1);
      assert.equal(both.drafts[key(actors.b.id)].items[0].quantity,2);
      pass('Actual password sign-in A → B → A preserves separate draft IDs, notes and quantities');return {};
    }
    case 'verify-sale': {
      const first=requests.find(r=>r.receiptId&&r.register===actors.a.register.id);
      assert.ok(first,'A browser sale must reach the real local database');
      const rows=(await db.query('select id from public.orders where cashier_id=$1 and request_id=$2',[actors.a.id,first.requestId])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].id,first.receiptId);
          assert.equal(new Set(requests.filter(r=>r.requestId===first.requestId&&r.receiptId).map(r=>r.receiptId)).size,1);
      pass('Two cashier tabs produce one authoritative order and one stock decrement for the shared draft');
      return {orderId:first.receiptId,requestsForDraft:requests.filter(r=>r.requestId===first.requestId).length,stock:9};
    }
    case 'verify-switch': {
      const sales=(await db.query('select id,request_id from public.orders where register_id=$1 and total=37 order by created_at',[actors.a.register.id])).rows;
      assert.equal(sales.length,2);
          assert.equal((await db.query('select count(*)::int n from public.orders where register_id=$1 and total=37',[actors.b.register.id])).rows[0].n,0);
      const key=`mi_cafe_cart_draft:v1:${actors.b.id}`;
      const snapshots=evidence.filter(e=>e.userId===actors.b.id&&e.drafts[key]?.orderNote==='Caja B').map(e=>e.drafts[key]);
      assert.ok(snapshots.length>=2);assert.deepEqual(snapshots[0],snapshots.at(-1),'Delayed A response altered B draft');
      pass('Switching to B during A checkout preserves B draft; A commits/replays once under A ownership');return {ordersA:2,ordersB:0,stock:8};
    }
    case 'finish':
      assert.ok(checks.some(c=>c.startsWith('Actual password'))&&checks.some(c=>c.startsWith('Two cashier'))&&checks.some(c=>c.startsWith('Switching to B')));
      await source.query('begin isolation level repeatable read read only');
      assert.equal((await databaseFingerprint(source)).business,backup.payload.baseline.business);await source.query('rollback');
      pass('Source staging business fingerprint remains unchanged; all fixture writes stayed in disposable clone');
      finished=true;outcome='passed';return {finished};
    case 'abort':await release();finished=true;outcome='aborted';return {aborted:true};
    default:throw Error('Unknown cashier command');
  }
}
try {
  const config=await settings();backup=await createBackup(config,runId);restored=await restoreBackup(backup);await restored.startServices();
  db=new Client({connectionString:restored.config.database});await db.connect();
  source=new Client({connectionString:config.database});await source.connect();
  const admin=makeClient(restored.config,restored.config.service);actors={};
  for(const letter of ['a','b']) {
    const username=`tabs_${runId.slice(0,8)}_${letter}`,password=randomBytes(24).toString('base64url');
    const user=ok(await admin.auth.admin.createUser({email:`${username}@carinitomio.local`,password,email_confirm:true})).user;
    ok(await admin.from('profiles').insert({id:user.id,username,full_name:`Caja${letter.toUpperCase()} Prueba local`,role:'cashier',is_active:true}));
    const client=makeClient(restored.config);ok(await client.auth.signInWithPassword({email:`${username}@carinitomio.local`,password}));
    const register=ok(await client.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:0,p_rate:20}));
    actors[letter]={id:user.id,username,password,register,client};
  }
  await writeFile(path.join(directory,'access.json'),JSON.stringify(Object.fromEntries(Object.entries(actors).map(([k,a])=>[k,{id:a.id,username:a.username,password:a.password}])),null,2),{mode:0o600});
  pass('Two real local Auth cashiers and separately owned shifts created only in disposable clone');
  const raceProduct=randomUUID();product=randomUUID();
  await db.query('update public.products set is_active=false');
  ok(await admin.from('products').insert([{id:raceProduct,name:'RPC concurrency fixture',price:50,is_active:true,customizable:false},{id:product,name:'Café prueba pestañas',price:37,is_active:true,customizable:false}]));
  const customer=ok(await actors.a.client.rpc('pos_register_customer',{p_name:'Prueba concurrencia local',p_phone:null,p_birth_date:null,p_promos:false}));
  const payload={register_id:actors.a.register.id,items:[{product_id:raceProduct,quantity:1,extra_ids:[],note:''}],expected_total:50,payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:customer.id,order_type:'En Local',order_note:'20 concurrent retries'};
  const request=randomUUID();const receipts=await Promise.all(Array.from({length:20},()=>actors.a.client.rpc('pos_checkout',{p_request:request,p_payload:payload}).then(ok)));
  assert.equal(new Set(receipts.map(r=>r.id)).size,1);
  const loyalty=(await db.query('select points,total_spent from public.customers where id=$1',[customer.id])).rows[0];
  assert.equal(loyalty.points,55);assert.equal(Number(loyalty.total_spent),50);
  pass('20 simultaneous real Auth/PostgREST retries return one receipt, one loyalty award without inventory changes');
  assert.ok((await actors.a.client.rpc('pos_checkout',{p_request:request,p_payload:{...payload,order_note:'changed'}})).error);
  assert.ok((await actors.b.client.rpc('pos_checkout',{p_request:request,p_payload:payload})).error);
  assert.equal((await db.query('select count(*)::int n from public.orders where request_id=$1',[request])).rows[0].n,1);
  pass('Changed payload and another cashier replaying A register are rejected without an extra sale');
  await db.query('update public.products set is_active=false where id=$1',[raceProduct]);
  gateway=createServer(async(req,res)=>{
    let counted=false;
    try {
      if(req.url==='/__cashier-evidence'&&req.method==='POST') {
        assert.equal(req.headers.origin,'http://127.0.0.1:3110');
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        evidence.push(JSON.parse(Buffer.concat(chunks).toString()));await save();res.end('Recorded');return;
      }
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
      const backend=req.url.startsWith('/auth/v1/')||req.url.startsWith('/rest/v1/');
      const isCheckout=req.url==='/rest/v1/rpc/pos_checkout'&&req.method==='POST';
      let entry;
      if(isCheckout) {
        counted=true;active++;const sent=JSON.parse(bytes.toString());
        entry={requestId:sent.p_request,register:sent.p_payload.register_id,total:sent.p_payload.expected_total};requests.push(entry);await save();
        if(hold)await new Promise(resolve=>gates.push(resolve));
      }
      const headers={...req.headers};delete headers.host;delete headers.connection;
      const upstream=await fetch(`${backend?restored.config.api:'http://127.0.0.1:3111'}${req.url}`,{method:req.method,headers,redirect:'manual',signal:AbortSignal.timeout(15000),body:['GET','HEAD'].includes(req.method)?undefined:bytes});
      const result=Buffer.from(await upstream.arrayBuffer());
      if(entry) {
        const data=JSON.parse(result.toString());entry.status=upstream.status;
        if(upstream.ok){entry.receiptId=data.id;entry.ticket=data.ticket_number;}
        if(upstream.ok&&dropNext){dropNext=false;entry.dropped=true;await save();res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({message:'Simulated lost checkout response'}));return;}
        await save();
      }
      const outgoing=Object.fromEntries([...upstream.headers].filter(([key])=>!['transfer-encoding','content-encoding','content-length','set-cookie'].includes(key)));
      const cookies=upstream.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies;
      res.writeHead(upstream.status,outgoing);res.end(result);
    }catch{if(!res.headersSent)res.writeHead(503,{'cache-control':'no-store'});res.end('Local cashier test service unavailable');}
    finally{if(counted)active--;}
  });
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(3110,'127.0.0.1',resolve);});
  app=await startApp({...restored.config,api:'http://127.0.0.1:3110'},{port:3111,cashierFixture});await app.ready();
  const compiledRoutes=JSON.parse(await readFile(path.join(app.app,'.next/server/app-paths-manifest.json'),'utf8'));
  assert.ok(compiledRoutes['/cashier-check/page'],'Scratch fixture must be compiled as a public route segment');
  await save();console.log('READY cashier acceptance: http://127.0.0.1:3110/cashier-check (private synthetic credentials in .staging-local/cashiers/access.json)');
  while(!finished) {
    const input=JSON.parse(await readFile(path.join(directory,'command.json'),'utf8').catch(()=>'{}'));
    if(input.id&&input.id!==lastCommand){lastCommand=input.id;try{const result=await command(input.action);await save();await writeFile(path.join(directory,'command-result.json'),JSON.stringify({id:input.id,ok:true,...result}));}catch(e){await writeFile(path.join(directory,'command-result.json'),JSON.stringify({id:input.id,ok:false,error:e.message}));}}
    await new Promise(r=>setTimeout(r,300));
  }
}catch(error){outcome='failed';await save();throw error;}
finally {hold=false;gates.splice(0).forEach(resolve=>resolve());await app?.stop();if(gateway)await new Promise(r=>gateway.close(r));clients.forEach(c=>c.auth.stopAutoRefresh());await db?.end();await source?.end();await restored?.cleanup();}
