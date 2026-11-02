import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {restoreBackup} from '../recovery/restore.mjs';
import {unseal,sha256} from '../recovery/artifacts.mjs';
import {work,root} from '../staging/runtime.mjs';
import {sourceFiles,verifyIdentity} from '../staging/bootstrap.mjs';
import {fingerprint,project} from '../staging/safety.mjs';

// Restore a verified LOCAL SYNTHETIC archive into owned disposable containers.
// Source staging and every hosted database remain unmodified and unqueried.
const runId=randomUUID(),checks=[],started=Date.now();let restored,db;
const sessions=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const ok=(response,name)=>{assert.ifError(response.error&&new Error(name+': '+response.error.message));return response.data;};
try {
  const current=await sourceFiles();
  const migrations=await Promise.all(['202610280001_secure_pos.sql','202610280002_shift_expenses.sql','202610280004_reports.sql','202610300005_single_drawer.sql','202610300006_loyalty_phone.sql','202610300007_safe_drawer_rate.sql','202610300008_employee_drawer_recovery.sql','202610300009_customer_correction.sql','202610300010_register_shortcuts.sql','202610300011_recent_tickets.sql','202610300012_business_backups.sql','202611020013_catalog_requests.sql','202611020014_customer_history.sql'].map(f=>readFile(path.join(root,'supabase/migrations',f),'utf8')));
  const hashes=migrations.map((_,i)=>fingerprint(current.snapshot,migrations.slice(0,i+1).join('\n')));
  const directory=path.join(work,'recovery');let selected;
  for(const entry of (await readdir(directory,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name!=='keys').reverse()){
    try {
      const manifest=JSON.parse(await readFile(path.join(directory,entry.name,'manifest.json'),'utf8'));
      if(!hashes.includes(manifest.contract))continue;
      const bytes=await readFile(path.join(directory,entry.name,'backup.aes-gcm.json'));
      assert.equal(sha256(bytes),manifest.encryptedSha256);
      const payload=unseal(JSON.parse(bytes),await readFile(path.join(directory,'keys',`${manifest.runId}.key`)));
      assert.equal(payload.contract,manifest.contract);
      // Older experimental archives predate locale/ACL-complete recovery.
      if(!payload.locale || !payload.databaseAcl || !payload.bootstrapRole || !payload.dbSettings)continue;
      assert.equal(payload.config.api,'http://127.0.0.1:55451');
      const oldDb=new URL(payload.config.database);assert.equal(oldDb.hostname,'127.0.0.1');assert.equal(oldDb.port,'55452');
      selected={payload,bytes,file:path.join(directory,entry.name,'backup.aes-gcm.json')};break;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  assert.ok(selected,'A verified encrypted local synthetic recovery archive is required. No hosted fallback exists.');
  const payload={...selected.payload,runId};
  console.log('Restoring an owned disposable local Auth/PostgREST database for shift acceptance…');
  restored=await restoreBackup({payload});
  assert.equal(restored.config.api,'http://127.0.0.1:55460');
  const target=new URL(restored.config.database);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55462');assert.equal(target.pathname,'/restored_pos');
  db=new Client({connectionString:restored.config.database});await db.connect();
  const marker=(await db.query('select * from cafe_private.staging_identity')).rows[0];
  assert.equal(marker.project,project);assert.equal(marker.source_hash,selected.payload.contract);assert.equal(marker.ready,true);
  for(let i=hashes.indexOf(selected.payload.contract)+1;i<migrations.length;i++)await db.query(migrations[i]);
  await db.query('update cafe_private.staging_identity set source_hash=$1 where project=$2',[current.hash,project]);
  await verifyIdentity(db);await restored.startServices();
  pass('New migration applied only to an owned disposable restore; real Auth/PostgREST started');
  const config=restored.config;
  const service=createClient(config.api,config.service,{auth:{persistSession:false,autoRefreshToken:false}});
  const api=createClient(config.api,config.anon,{auth:{persistSession:false,autoRefreshToken:false}});sessions.push(api);
  const anonymous=createClient(config.api,config.anon,{auth:{persistSession:false,autoRefreshToken:false}});sessions.push(anonymous);
  const email=`shift-${runId}@local.invalid`,password=randomBytes(24).toString('base64url');
  const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true}),'create isolated cashier').user;
  ok(await service.from('profiles').insert({id:user.id,full_name:'Prueba aislada de gastos',username:`shift_${runId.slice(0,8)}`,role:'cashier',is_active:true}),'cashier profile');
  ok(await api.auth.signInWithPassword({email,password}),'real cashier sign-in');
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query('update cafe_private.drawer_settings set rate=20');
  const register=ok(await api.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:20}),'opening');
  const summary=async()=>ok(await api.rpc('pos_shift_summary',{p_register:register.id}),'server summary');
  assert.ok((await anonymous.rpc('pos_shift_summary',{p_register:register.id})).error);
  assert.ok((await api.rpc('pos_close_shift',{p_register:register.id,p_counted:0,p_expenses:[]})).error);
  pass('Anonymous summary and unchecked legacy closing are denied over HTTP');
  const request=randomUUID(),expense=[{desc:'Garrafón',amount:50}];
  const p={p_register:register.id,p_request:request,p_revision:0,p_expenses:expense};
  assert.equal(ok(await api.rpc('pos_shift_expenses',p),'expense').expenses_revision,1);
  assert.equal(ok(await api.rpc('pos_shift_expenses',p),'expense lost-response replay').expenses_revision,1);
  assert.equal(Number((await db.query('select count(*) from cafe_private.shift_expense_requests where request_id=$1',[request])).rows[0].count),1);
  pass('Expense request retries produce one durable journal revision');
  const parallel=await Promise.all([
    api.rpc('pos_shift_expenses',{...p,p_request:randomUUID(),p_revision:1,p_expenses:[]}),
    api.rpc('pos_shift_expenses',{...p,p_request:randomUUID(),p_revision:1,p_expenses:[{desc:'Otro',amount:35}]}),
  ]);
  assert.equal(parallel.filter(r=>!r.error).length,1);assert.equal(parallel.filter(r=>r.error).length,1);
  let state=await summary();state=ok(await api.rpc('pos_shift_expenses',{...p,p_request:randomUUID(),p_revision:state.expenses_revision,p_expenses:[]}),'delete expense');
  await api.auth.signOut({scope:'local'});ok(await api.auth.signInWithPassword({email,password}),'sign back in');
  assert.deepEqual((await summary()).expenses,[]);
  pass('Stale HTTP writer denied; deleted expense stays deleted through a new real login');
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8'));
  const milk=randomUUID();ok(await service.from('extras').insert({id:milk,name:'Almendra',price:15,phase:'Tipo de Leche',active:true}),'milk');
  let expected=0;const cases=[['Iced coffee caramelo',2,true,220],['Iced coffe flan',1,true,145],['Iced coffee nevado',1,true,155],['Frappe Oreo',1,true,100],['Cappuccino',1,true,95],['Te chai caliente',1,true,110],['Tortuguitas 5pz',1,false,65],['Cheesecake grande tortuga',1,false,860]];
  for(const [name,quantity,custom,total] of cases){
    const entry=menu.products.find(e=>e.name===name);assert.ok(entry);const id=randomUUID();
    ok(await service.from('products').insert({id,name:entry.name,price:entry.price_mxn,stock:5000,is_active:true,customizable:custom,wizard_steps:custom?['Tipo de Leche']:[]}),'synthetic real-menu item');
    const payload={register_id:register.id,items:[{product_id:id,quantity,extra_ids:custom?[milk]:[],note:'Datos sintéticos'}],expected_total:total,payment_method:'efectivo',tender_mxn:total,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:''};
    const receipt=ok(await api.rpc('pos_checkout',{p_request:randomUUID(),p_payload:payload}),'real-menu checkout');
    assert.equal(receipt.total,total);expected+=total;
  }
  pass('Eight real-menu quantity/pack/special-price/milk cases pass through real checkout HTTP');
  await db.query("insert into orders(register_id,cashier_id,subtotal,total,payment_method,status) select $1,$2,30,30,'efectivo','completed' from generate_series(1,1101)",[register.id,user.id]);expected+=1101*30;
  const capped=ok(await api.from('orders').select('id,total').eq('register_id',register.id),'capped history');assert.equal(capped.length,1000);
  state=await summary();assert.equal(state.total_sales,expected);assert.equal(state.cash_sales,expected);assert.equal(state.expected_cash,expected+100);
  pass('Real PostgREST returns1000 rows while server closing summary includes all1109 sales');
  const old=state;
  state=ok(await api.rpc('pos_shift_expenses',{...p,p_request:randomUUID(),p_revision:state.expenses_revision,p_expenses:[{desc:'Compra',amount:35}]}),'updated expense');
  assert.ok((await api.rpc('pos_close_shift',{p_register:register.id,p_counted:old.expected_cash,p_expenses:old.expenses,p_preview:old})).error);
  const close={p_register:register.id,p_counted:state.expected_cash,p_expenses:state.expenses,p_preview:state};
  const report=ok(await api.rpc('pos_close_shift',close),'checked close');
  assert.equal(report.expected_cash,state.expected_cash);assert.equal(report.total_sales,expected);assert.equal(report.difference,0);
  assert.equal(ok(await api.rpc('pos_close_shift',close),'lost-close-response replay').id,report.id);
  assert.equal(Number((await db.query('select count(*) from shifts where register_id=$1',[register.id])).rows[0].count),1);
  pass('Stale preview rejected; final total agrees and repeated closing returns the same report');
  assert.equal(sha256(await readFile(selected.file)),sha256(selected.bytes));
  pass('Retained encrypted source archive unchanged; source staging never connected');
  const result={runId,date:'2026-10-28',scope:'Fresh owned disposable restore only; real GoTrue/PostgREST and8 menu cases; no live café or source-staging access',checks,passed:checks.length,menuCheckoutCases:cases.length,completedSales:1109,expectedSales:expected,expectedCash:state.expected_cash,reportId:report.id,elapsedSeconds:Math.round((Date.now()-started)/1000),cleanup:'Owned temporary containers removed in finally'};
  await mkdir(path.join(work,'shift-acceptance'),{recursive:true});await writeFile(path.join(work,'shift-acceptance','http-result.json'),JSON.stringify(result,null,2));
  console.log('Shift HTTP acceptance complete; sanitized result in .staging-local/shift-acceptance/http-result.json');
} finally {
  for(const session of sessions)await session.auth.signOut({scope:'local'}).catch(()=>{});
  if(db)await db.end();if(restored)await restored.cleanup();
}
