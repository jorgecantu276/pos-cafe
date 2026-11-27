// Executes unchanged customer bytes ONLY after independently tested OS egress denial.
// Private configuration, Auth material, raw snapshots and logs never become artifacts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [mode, configurationFile]=process.argv.slice(2);
assert.ok(['prepare','run','cleanup'].includes(mode));
assert.equal(process.platform,'win32');assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.POS_ACCEPTANCE_DISPOSABLE,'1');
const root=path.resolve(import.meta.dirname,'../..'), require=createRequire(path.join(root,'package.json'));
const settings=JSON.parse(await readFile(configurationFile,'utf8'));
assert.ok(path.isAbsolute(configurationFile)&&path.isAbsolute(settings.work)&&path.isAbsolute(settings.evidence));
assert.ok(settings.work.toLowerCase().startsWith(path.resolve(process.env.RUNNER_TEMP).toLowerCase()+path.sep));
const {createClient}=require('@supabase/supabase-js'),{Client}=require('pg'),{chromium}=require('playwright-core');
const {freshLocalApi}=await import('./local-api.mjs');
const {verifyPackage}=await import('../windows/auto-update.mjs');
const {planBrownieSyrup,applyBrownieSyrup}=await import('../catalog/brownie-syrup.mjs');
const {decryptBusinessArchive}=await import('../../lib/business-backup-format.mjs');
const {restoreBusinessArchive}=await import('../backups/restore-business.mjs');
const {DatabaseSync,backup:sqliteBackup}=await import('node:sqlite');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const ok=result=>{assert.ifError(result.error&&Error('Synthetic backend request failed: '+result.error.code));return result.data;};
const privateFile=path.join(settings.work,'state.private.json');
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const base='http://127.0.0.1:3193';
async function contract(folder){return (await readdir(path.join(folder,'database-migrations'))).filter(n=>n.endsWith('.sql')&&n!=='202611020022_catalog_photos.sql').sort();}
async function install(db,folder,files=undefined){for(const file of files||await contract(folder))await db.query(await readFile(path.join(folder,'database-migrations',file),'utf8'));}
if(mode==='cleanup'){
  const state=await json(privateFile);
  assert.equal(execFileSync('docker.exe',['info','--format','{{.ID}}'],{encoding:'utf8',windowsHide:true}).trim(),settings.engineId);
  for(const fixture of [state.newInstall,state.retained,state.recovery]){
    const ids=fixture.isolation.containers.map(c=>c.id),observed=JSON.parse(execFileSync('docker.exe',['inspect',...ids],{encoding:'utf8',windowsHide:true}));
    for(const item of observed){const expected=fixture.isolation.containers.find(c=>c.id===item.Id);assert.ok(expected&&expected.image===item.Image);assert.ok(item.Name.endsWith('_'+fixture.isolation.project));assert.ok(item.NetworkSettings.Networks[fixture.isolation.network]);}
    execFileSync('docker.exe',['stop',...ids],{encoding:'utf8',windowsHide:true,stdio:'pipe'});
  }
  console.log(JSON.stringify({ownedBackendsStopped:true,volumesRetained:true}));process.exit(0);
}
async function createFixture(portBase,folder,name){
  const local=await freshLocalApi({portBase});
  const actor={username:'cafe_lab_'+name,password:randomBytes(24).toString('base64url'),name:'CAFÉ PRUEBA '+name};
  actor.id=ok(await local.service.auth.admin.createUser({email:actor.username+'@carinitomio.local',password:actor.password,email_confirm:true})).user.id;
  await local.db.query('insert into profiles(id,username,full_name,role) values($1,$2,$3,\'admin\')',[actor.id,actor.username,actor.name]);
  await install(local.db,folder);
  const product=randomUUID();
  await local.db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,'Brownie con nieve PRUEBA',110,'Postres',true,false,null)",[product]);
  const client=createClient(local.config.api,local.config.anon,{auth:{persistSession:false,autoRefreshToken:false}});
  ok(await client.auth.signInWithPassword({email:actor.username+'@carinitomio.local',password:actor.password}));
  for(let i=0;i<80;i++){const r=await client.rpc('pos_drawer_status');if(!r.error)break;if(i===79)ok(r);await new Promise(r=>setTimeout(r,150));}
  ok(await client.rpc('pos_set_drawer_rate',{p_request:randomUUID(),p_payload:{rate:16}}));
  const register=ok(await client.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:0,p_rate:16}));client.auth.stopAutoRefresh();
  return {...local,actor,product,register};
}
if(mode==='prepare'){
  const candidate=await json(path.join(settings.candidate,'release.json')),baseline=await json(path.join(settings.baseline,'release.json'));
  assert.equal(candidate.sourceCommit,settings.sourceCommit);assert.equal(baseline.sourceCommit,'b776550a7a91ad1dafb21b2200a235dfe337bb6f');
  assert.equal(candidate.fixtureOnly,false);assert.equal(baseline.fixtureOnly,false);assert.equal(candidate.supabaseUrl,baseline.supabaseUrl);
  assert.equal(candidate.publicKeySha256,baseline.publicKeySha256);
  const current=await createFixture(55541,settings.candidate,'nuevo');
  await current.db.query('begin');const plan=await applyBrownieSyrup(current.db,await planBrownieSyrup(current.db));await current.db.query('commit');
  const retained=await createFixture(55561,settings.baseline,'conservado');
  // Reproduce the separately observed reviewed idle RPC; app predecessor remains rc.6.
  await install(retained.db,settings.candidate,['202611250025_windows_update_idle.sql']);
  const recovery=await freshLocalApi({portBase:55521});
  const bootstrap=ok(await recovery.service.auth.admin.createUser({email:'cafe_recovery_bootstrap@carinitomio.local',password:randomBytes(24).toString('base64url'),email_confirm:true})).user;
  await recovery.db.query("insert into profiles(id,username,full_name,role) values($1,'cafe_recovery_bootstrap','Bootstrap','admin')",[bootstrap.id]);
  await install(recovery.db,settings.candidate);await recovery.db.query('delete from profiles where id=$1',[bootstrap.id]);ok(await recovery.service.auth.admin.deleteUser(bootstrap.id));
  const state={format:'cafe-exact-private-v1',newInstall:{config:current.config,isolation:current.isolation,actor:current.actor,product:current.product,register:current.register,plan},
    retained:{config:retained.config,isolation:retained.isolation,actor:retained.actor,product:retained.product,register:retained.register},recovery:{config:recovery.config,isolation:recovery.isolation}};
  await writeFile(privateFile,JSON.stringify(state),{flag:'wx',mode:0o600});
  for(const fixture of [current,retained,recovery]){await fixture.db.end();await fixture.disposeTools();}
  console.log(JSON.stringify({prepared:true,syntheticProjects:3}));
  process.exit(0);
}
const boundary=await json(settings.boundaryReceipt);assert.equal(boundary.state,'active');
assert.equal(settings.probesPassed,true,'Native and browser boundary probes must pass before customer launch.');
const state=await json(privateFile), sdkClients=[], databases=[];let app,browser,primary;
assert.ok(['newInstall','retainedUpgrade','recovery'].includes(settings.lifecyclePhase),'Select one bounded lifecycle phase.');
const reportFile=path.join(settings.evidence,'cafe-exact-result.json');
const previousReport=await json(reportFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const report=previousReport||{format:'cafe-exact-zip-acceptance-v1',state:'running',sourceCommit:settings.sourceCommit,harnessCommit:settings.harnessCommit,
  candidateZipSha256:settings.candidateZipSha256,baselineZipSha256:settings.baselineZipSha256,boundaryOwner:boundary.owner,hostInfrastructure:settings.hostInfrastructure,
  scope:'Unchanged customer-bound ZIP under separately enforced hosted-Windows egress denial and synthetic target transport; no production backend, device, paper or provider acceptance.',
  checks:[],phaseAttempts:[],lifecycle:{newInstall:'NOT_RUN',retainedUpgrade:'NOT_RUN',recovery:'NOT_RUN'},manualInstaller:'NOT_RUN',productionAcceptance:false};
assert.equal(report.sourceCommit,settings.sourceCommit);assert.equal(report.candidateZipSha256,settings.candidateZipSha256);
assert.ok(!report.phaseAttempts.includes(settings.lifecyclePhase),'Never repeat a partially executed money/recovery phase; preserve it and start a new owned workflow.');
report.phaseAttempts.push(settings.lifecyclePhase);report.state='running';
report.boundaryWindows??=[];report.boundaryWindows.push({phase:settings.lifecyclePhase,owner:boundary.owner,activeReceiptSha256:hash(await readFile(settings.boundaryReceipt))});
const save=()=>writeFile(reportFile,JSON.stringify(report,null,2));
await save();
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);report.checks.push(name);};
async function connectFixture(fixture){const db=new Client({connectionString:fixture.config.database});await db.connect();databases.push(db);return db;}
async function clientFor(fixture){const c=createClient(fixture.config.api,fixture.config.anon,{auth:{persistSession:false,autoRefreshToken:false}});sdkClients.push(c);ok(await c.auth.signInWithPassword({email:fixture.actor.username+'@carinitomio.local',password:fixture.actor.password}));return c;}
const identities=new Map();
async function identity(folder){if(!identities.has(folder)){const release=await json(path.join(folder,'release.json'));identities.set(folder,{commit:release.sourceCommit,filesSha256:hash(await readFile(path.join(folder,'SHA256.json'))),release});}return identities.get(folder);}
async function exact(folder){const i=await identity(folder);await verifyPackage(folder,i,folder,i.release);return i;}
async function start(folder,fixture,label,journalSource,existing){
  let runtime,config,configFile,transportFile;
  const release=await json(path.join(folder,'release.json'));
  if(existing){
    ({runtime,config,configFile,transportFile}=existing);
    assert.deepEqual(await json(configFile),config);assert.equal(config.RequireExistingPrintJournal,true);
    assert.equal(config.SupabaseUrl,release.supabaseUrl);
  }else{
  runtime=path.join(settings.work,'runtime-'+label);await mkdir(runtime);await mkdir(path.join(runtime,'printing'));await mkdir(path.join(runtime,'backups'));await mkdir(path.join(runtime,'keys'));
  if(journalSource){const src=new DatabaseSync(journalSource);try{await sqliteBackup(src,path.join(runtime,'printing/mock-jobs.sqlite'));}finally{src.close();}}
  const example=await json(path.join(folder,'pos-cafe-config.example.json'));
  config={...example,SupabaseUrl:release.supabaseUrl,SupabaseServiceRoleKey:fixture.config.service,Port:3193,PrintMode:'mock',ClipEnabled:false,AutoUpdate:false,
    PrintDataDirectory:path.join(runtime,'printing'),BackupDirectory:path.join(runtime,'backups'),BackupRecoveryKeyFile:path.join(runtime,'keys/recovery.key'),RequireExistingPrintJournal:!!journalSource};
  assert.equal(hash(Buffer.from(config.SupabaseAnonKey)),release.publicKeySha256);
  configFile=path.join(runtime,'config.private.json');transportFile=path.join(runtime,'transport.private.json');
  await writeFile(configFile,JSON.stringify(config),{flag:'wx',mode:0o600});
  await writeFile(transportFile,JSON.stringify({compiledOrigin:release.supabaseUrl,compiledAnon:config.SupabaseAnonKey,syntheticApi:fixture.config.api,syntheticAnon:fixture.config.anon,
    appOrigin:base,boundaryReceipt:settings.boundaryReceipt,boundaryOwner:boundary.owner}),{flag:'wx',mode:0o600});
  }
  assert.equal(hash(Buffer.from(config.SupabaseAnonKey)),release.publicKeySha256);
  const env={...process.env,NODE_OPTIONS:'--import='+pathToFileURL(path.join(root,'scripts/testing/cafe-runtime-transport.mjs')).href,POS_CAFE_TEST_TRANSPORT_FILE:transportFile};
  const child=spawn(ps,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(folder,'Start-POS.ps1'),'-ConfigPath',configFile,'-NoBrowser'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<120;i++){
    if(child.exitCode!==null){await writeFile(path.join(runtime,'launcher.private.log'),logs);throw Error('Packaged launcher exited before readiness');}
    try{const r=await fetch(base+'/api/local-instance',{signal:AbortSignal.timeout(1000),redirect:'error'});if(r.ok){const live=await r.json();const owner=await json(configFile+'.instance.json');assert.equal(live.instanceToken,owner.instanceToken);assert.equal(owner.launcherId,child.pid);return {child,folder,fixture,runtime,config,configFile,transportFile,live};}}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  child.kill();await writeFile(path.join(runtime,'launcher.private.log'),logs);throw Error('Packaged readiness timeout');
}
async function stop(){if(!app)return;const owned=app;app=null;owned.child.kill();await Promise.race([new Promise(r=>owned.child.once('close',r)),new Promise((_,reject)=>setTimeout(()=>reject(Error('Owned launcher did not stop')),15000))]);
  await assert.rejects(fetch(base+'/api/local-instance',{signal:AbortSignal.timeout(1200)}));return owned;}
async function context(fixture,transport){
  const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block'}),compiled=new URL(transport.compiledOrigin).origin;
  await context.routeWebSocket('**/*',socket=>socket.close());
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===base)return route.continue();
    if(url.origin!==compiled)return route.abort();
    const headers={...request.headers()};if(headers.apikey===transport.compiledAnon)headers.apikey=transport.syntheticAnon;
    if(headers.authorization==='Bearer '+transport.compiledAnon)headers.authorization='Bearer '+transport.syntheticAnon;
    const response=await route.fetch({url:new URL(url.pathname+url.search,transport.syntheticApi).href,headers,maxRedirects:0});
    assert.ok(response.status()<300||response.status()>=400);await route.fulfill({response});
  });
  const page=await context.newPage();await page.goto(base+'/login');await page.getByRole('button',{name:fixture.actor.name,exact:true}).click();
  await page.getByRole('textbox',{name:'Contraseña',exact:true}).fill(fixture.actor.password);await page.getByRole('button',{name:'Acceder',exact:true}).click();
  await page.waitForURL(base+'/',{timeout:45000});await page.getByRole('button',{name:/Brownie con nieve PRUEBA/}).waitFor();return {context,page};
}
async function pay(page){await page.getByRole('button',{name:'Control de entrega: Elegir control',exact:true}).click();await page.getByRole('button',{name:'Control 1',exact:true}).click();
  await page.getByRole('button',{name:'Cobrar',exact:true}).click();await page.getByRole('button',{name:'Importe exacto',exact:true}).click();await page.getByRole('button',{name:'Confirmar pago',exact:true}).click();await page.getByRole('dialog',{name:'Cobrar',exact:true}).waitFor({state:'hidden'});}
async function rowsAndSequences(db,raw){return (await db.query("select jsonb_build_object('tables',$1::jsonb->'tables','sequences',$1::jsonb->'sequences')::text value",[raw])).rows[0].value;}
function journalRows(file){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map(({name})=>({name,
  rows:db.prepare('select * from "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}));}finally{db.close();}}
try{
  await exact(settings.candidate);if(settings.lifecyclePhase!=='recovery')await exact(settings.baseline);
  browser=await chromium.launch({executablePath:settings.browser,headless:true,args:['--disable-background-networking','--disable-component-update']});
  if(settings.lifecyclePhase==='newInstall'){
  const fresh=state.newInstall,db=await connectFixture(fresh);app=await start(settings.candidate,fresh,'new');
  const ui=await context(fresh,await json(app.transportFile));
  await ui.page.getByRole('button',{name:/Brownie con nieve PRUEBA/}).click();
  const dialog=ui.page.getByRole('dialog',{name:'Brownie con nieve PRUEBA',exact:true});
  check('exact UI refuses missing syrup',await dialog.getByRole('button',{name:'Agregar a la orden',exact:true}).isDisabled(),true);
  for(const name of ['Caramelo','Caramelo salado','Chocolate','Sin jarabe'])check('exact UI displays '+name,await dialog.getByRole('button',{name,exact:true}).count(),1);
  await dialog.getByRole('button',{name:'Caramelo',exact:true}).click();await dialog.getByRole('button',{name:'Chocolate',exact:true}).click();
  check('selecting chocolate replaces caramel',await dialog.getByRole('button',{name:'Caramelo',exact:true}).getAttribute('aria-pressed'),'false');
  check('one included selection',await dialog.getByRole('button',{name:'Chocolate',exact:true}).getAttribute('aria-pressed'),'true');
  await ui.page.screenshot({path:path.join(settings.evidence,'brownie-single-choice.png')});
  await dialog.getByRole('button',{name:'Agregar a la orden',exact:true}).click();
  await ui.page.getByRole('button',{name:'Editar Brownie con nieve PRUEBA',exact:true}).click();
  await dialog.getByRole('button',{name:'Sin jarabe',exact:true}).click();await dialog.getByRole('button',{name:'Guardar cambios',exact:true}).click();
  await ui.page.reload();await ui.page.getByRole('button',{name:/Brownie con nieve PRUEBA/}).first().waitFor();
  check('edit and reload retain included no-syrup choice',(await ui.page.getByRole('region',{name:'Artículos del pedido',exact:true}).textContent()).includes('Sin jarabe'),true);
  await pay(ui.page);
  const sale=(await db.query('select receipt_snapshot from orders order by created_at desc limit 1')).rows[0].receipt_snapshot;
  check('actual UI sale keeps base price',Number(sale.total),110);check('actual UI saves one free syrup',sale.items[0].product.displayExtras.map(e=>[e.name,Number(e.price)]),[['Sin jarabe',0]]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[fresh.actor.id]);
  const extras=fresh.plan.extras,payload=ids=>({register_id:fresh.register.id,items:[{product_id:fresh.product,quantity:1,extra_ids:ids,note:''}],expected_total:110,
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:1});
  for(const fn of ['pos_checkout','cafe_private.clip_quote','cafe_private.phone_catalog_quote']){
    const valid=(await db.query(`select ${fn}($1,$2) value`,[randomUUID(),payload([extras[0].id])])).rows[0].value;
    check(fn+' accepts one included syrup',Number(valid.total),110);
    for(const ids of [[],extras.slice(0,2).map(e=>e.id),[extras[0].id,extras[0].id],[randomUUID()]]){
      await assert.rejects(db.query(`select ${fn}($1,$2)`,[randomUUID(),payload(ids)]));report.checks.push(fn+' rejects invalid syrup count/identity');
    }
  }
  await exact(settings.candidate);await ui.context.close();await stop();await exact(settings.candidate);report.lifecycle.newInstall='passed';await save();
  }
  if(settings.lifecyclePhase==='retainedUpgrade'){
  const retained=state.retained,oldDb=await connectFixture(retained),oldClient=await clientFor(retained);
  app=await start(settings.baseline,retained,'predecessor');const oldUi=await context(retained,await json(app.transportFile));
  await oldUi.page.getByRole('button',{name:/Brownie con nieve PRUEBA/}).click();await pay(oldUi.page);
  const oldSale=(await oldDb.query('select id,request_id,request_payload,receipt_snapshot from orders order by created_at desc limit 1')).rows[0];
  const predecessor=await stop();await oldUi.context.close();
  // Establish the existing-installation setting after the actual predecessor
  // produced its synthetic journal, then prove rc.6 reopens with that setting.
  predecessor.config.RequireExistingPrintJournal=true;await writeFile(predecessor.configFile,JSON.stringify(predecessor.config));
  app=await start(settings.baseline,retained,'predecessor-reopen',undefined,predecessor);await stop();
  const summary=ok(await oldClient.rpc('pos_shift_summary',{p_register:retained.register.id}));ok(await oldClient.rpc('pos_close_shift',{p_register:retained.register.id,p_counted:summary.expected_cash,p_expenses:summary.expenses,p_preview:summary}));
  await install(oldDb,settings.candidate,['202611230024_inventory_revision_rejection.sql','202611270026_brownie_syrup_choice.sql']);
  await oldDb.query('begin');await applyBrownieSyrup(oldDb,await planBrownieSyrup(oldDb));await oldDb.query('commit');
  retained.register=ok(await oldClient.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:0,p_rate:16}));
  const oldRows=await rowsAndSequences(oldDb,ok(await createClient(retained.config.api,retained.config.service,{auth:{persistSession:false,autoRefreshToken:false}}).rpc('pos_business_backup')));
  const journalBefore=journalRows(path.join(predecessor.runtime,'printing/mock-jobs.sqlite')),configBefore=hash(await readFile(predecessor.configFile));
  app=await start(settings.candidate,retained,'retained',undefined,predecessor);
  const afterRows=await rowsAndSequences(oldDb,ok(await createClient(retained.config.api,retained.config.service,{auth:{persistSession:false,autoRefreshToken:false}}).rpc('pos_business_backup')));
  check('opening candidate preserves every business row and sequence before staff sign-in',afterRows,oldRows);
  check('same external configuration remains unchanged',hash(await readFile(predecessor.configFile)),configBefore);
  check('same external journal remains unchanged without blind resend',journalRows(path.join(predecessor.runtime,'printing/mock-jobs.sqlite')),journalBefore);
  const upgraded=await context(retained,await json(app.transportFile));
  check('old paid receipt unchanged after package switch',(await oldDb.query('select receipt_snapshot from orders where id=$1',[oldSale.id])).rows[0].receipt_snapshot,oldSale.receipt_snapshot);
  check('old request replays original receipt',ok(await oldClient.rpc('pos_checkout',{p_request:oldSale.request_id,p_payload:oldSale.request_payload})).id,oldSale.id);
  report.retainedStateSha256=hash(Buffer.from(afterRows));
  const backupResponse=await upgraded.context.request.post(base+'/api/backups',{headers:{Origin:base,'X-Pos-Backup':'1'}});check('exact package backup endpoint',backupResponse.status(),200);
  const backupStatus=await backupResponse.json();assert.ok(backupStatus.lastSuccess&&!backupStatus.lastError);
  await exact(settings.candidate);
  const upgrade=await stop();await upgraded.context.close();await exact(settings.candidate);
  report.lifecycle.retainedUpgrade='application-state-passed'; // The production manual installer is a separate explicit gate.
  await writeFile(path.join(settings.work,'recovery-continuation.private.json'),JSON.stringify({backupFile:path.join(upgrade.config.BackupDirectory,backupStatus.lastSuccess.filename),
    backupSha256:backupStatus.lastSuccess.sha256,keyFile:upgrade.config.BackupRecoveryKeyFile,journalFile:path.join(upgrade.runtime,'printing/mock-jobs.sqlite')}),{flag:'wx',mode:0o600});
  }
  if(settings.lifecyclePhase==='recovery'){
  const continuation=await json(path.join(settings.work,'recovery-continuation.private.json')),bytes=await readFile(continuation.backupFile);
  assert.equal(hash(bytes),continuation.backupSha256);
  const archive=decryptBusinessArchive(bytes,await readFile(continuation.keyFile));
  const target=state.recovery,targetUrl=new URL(target.config.database);targetUrl.username='supabase_admin';const restore=new Client({connectionString:targetUrl.href});await restore.connect();databases.push(restore);
  const empty=(await restore.query('select pos_business_backup() raw')).rows[0].raw;
  await assert.rejects(restoreBusinessArchive(restore,archive,{failBeforeCommit:()=>{throw Error('synthetic interrupted restore');}}),/synthetic interrupted restore/);
  check('interrupted restore leaves exact empty state',await rowsAndSequences(restore,(await restore.query('select pos_business_backup() raw')).rows[0].raw),await rowsAndSequences(restore,empty));
  await restoreBusinessArchive(restore,archive);
  const restored=(await restore.query('select pos_business_backup() raw')).rows[0].raw;
  check('all archived business rows and sequences restored',await rowsAndSequences(restore,restored),await rowsAndSequences(restore,archive.snapshotJson));
  const recovered={...target,actor:state.retained.actor};app=await start(settings.candidate,recovered,'recovered',continuation.journalFile);
  const recoveredUi=await context(recovered,await json(app.transportFile));check('restored staff authenticates in exact package',new URL(recoveredUi.page.url()).pathname,'/');
  await exact(settings.candidate);await recoveredUi.context.close();await stop();await exact(settings.candidate);report.lifecycle.recovery='passed';
  }
  report.state=report.lifecycle.recovery==='passed'?'engineering-passed-manual-installer-pending':'phase-passed';
}catch(error){primary=error;report.state='failed';report.failedPhase=report.checks.at(-1)||'setup';report.errorClass=error.constructor.name;
  report.failure=error.message.split('\n')[0].replace(/https?:\/\/\S+/g,'[origin]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token]').slice(0,300);
  await writeFile(path.join(settings.work,'error.private.log'),String(error.stack||error));}
finally{
  report.cleanup=[];
  for(const[name,operation]of [['browser',()=>browser?.close()],['owned launcher',stop],['SDK timers',async()=>sdkClients.forEach(c=>c.auth.stopAutoRefresh())],['SQL clients',()=>Promise.allSettled(databases.map(d=>d.end()))]]){
    try{await operation();report.cleanup.push({name,passed:true});}catch{report.cleanup.push({name,passed:false});report.state='attention-required';}
  }
  await save();
}
console.log(JSON.stringify({state:report.state,checks:report.checks.length,lifecycle:report.lifecycle,manualInstaller:report.manualInstaller,qualified:false}));
if(primary||report.state==='attention-required')process.exitCode=1;
