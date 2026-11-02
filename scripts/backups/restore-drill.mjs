import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createClient} from '@supabase/supabase-js';
import {Client} from 'pg';
import {freshLocalApi} from '../testing/local-api.mjs';
import {root,run} from '../staging/runtime.mjs';
import {seedQualityMenu} from '../quality/menu-fixture.mjs';
import {decryptBusinessArchive} from '../../lib/business-backup-format.mjs';
import {runBusinessBackup} from '../../lib/business-backup-server.ts';
import {restoreBusinessArchive,restoreTarget} from './restore-business.mjs';

let source,target,restoreDb;const clients=[];
const ok=result=>{assert.ifError(result.error&&Error(result.error.message));return result.data;};
const report={scope:'Two new disposable loopback Supabase projects; no hosted write, printer or bank charge',checks:[]};
const check=(name,value,expected)=>{assert.deepEqual(value,expected,name);report.checks.push(name);};
try{
  const directory=await mkdtemp(path.join(tmpdir(),'pos-business-restore-'));
  source=await freshLocalApi({portBase:55501});
  const actors={};
  for(const role of ['admin','cashier']){
    const username='restore_'+role,password=randomUUID()+'!';
    const user=ok(await source.service.auth.admin.createUser({email:username+'@carinitomio.local',password,email_confirm:true})).user;
    await source.db.query('insert into profiles(id,username,full_name,role) values($1,$2,$2,$3)',[user.id,username,role]);
    actors[role]={id:user.id,username,password};
  }
  await source.install();
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8'));await seedQualityMenu(source.db,menu);
  async function login(config,actor){
    const client=createClient(config.api,config.anon,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(client);
    ok(await client.auth.signInWithPassword({email:actor.username+'@carinitomio.local',password:actor.password}));return client;
  }
  const admin=await login(source.config,actors.admin),cashier=await login(source.config,actors.cashier);
  ok(await admin.rpc('pos_set_drawer_rate',{p_request:randomUUID(),p_payload:{rate:16}}));
  const register=ok(await cashier.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:16}));
  const customer=ok(await cashier.rpc('pos_enroll_customer',{p_request:randomUUID(),p_payload:{name:'Restauración sintética',phone:'8681112233',birthday:null,promos:false}})).customer;
  const product=(await source.db.query("select id,price from products where name='Coca cola'")).rows[0];
  ok(await admin.rpc('pos_inventory_set_enabled',{p_request:randomUUID(),p_enabled:true,p_revision:0}));
  await source.db.query("update pos_inventory_items set mode='counted',quantity=12 where product_id=$1",[product.id]);
  const payload={register_id:register.id,items:[{product_id:product.id,quantity:1,extra_ids:[],note:'Sin hielo'}],expected_total:Number(product.price),
    payment_method:'efectivo',tender_mxn:100,tender_usd:0,customer_id:customer.id,order_type:'Para Llevar',order_note:'Respaldo sintético',pager_number:30};
  const request=randomUUID(),sale=ok(await cashier.rpc('pos_checkout',{p_request:request,p_payload:payload}));
  const phone=ok(await cashier.rpc('pos_phone_save',{p_request:randomUUID(),p_payload:{items:payload.items,expected_total:payload.expected_total,contact_name:'Pedido restaurado',contact_phone:'8681112234',customer_id:customer.id,order_type:'Para Llevar',order_note:'Reservado'}}));
  const backupConfig={directory:path.join(directory,'archives'),keyFile:path.join(directory,'private','recovery.key'),contractDirectory:path.join(root,'supabase'),
    releaseCommit:(await run('git',['rev-parse','HEAD'])).trim(),url:source.config.api,serviceKey:source.config.service};
  const status=await runBusinessBackup(true,{config:()=>backupConfig});assert.ok(status.lastSuccess&&!status.lastError);
  const archiveFile=path.join(backupConfig.directory,status.lastSuccess.filename);
  const archive=decryptBusinessArchive(await readFile(archiveFile),await readFile(backupConfig.keyFile));
  check('Actual encrypted backup includes phone and inventory state',Object.keys(JSON.parse(archive.snapshotJson).tables).includes('public.pos_phone_orders'),true);
  const sourceBefore=(await source.service.rpc('pos_business_backup')).data;

  // Provision the same Auth/provider/schema through its normal migrations. A
  // temporary bootstrap owner is removed BEFORE restoring any archived data.
  target=await freshLocalApi({portBase:55521});
  const bootstrap=ok(await target.service.auth.admin.createUser({email:'bootstrap@carinitomio.local',password:randomUUID()+'!',email_confirm:true})).user;
  await target.db.query("insert into profiles(id,username,full_name,role) values($1,'restore_bootstrap','Bootstrap','admin')",[bootstrap.id]);
  await target.install();
  await target.db.query('delete from profiles where id=$1',[bootstrap.id]);
  ok(await target.service.auth.admin.deleteUser(bootstrap.id));
  const restoreConnection=new URL(target.config.database);restoreConnection.username='supabase_admin';
  restoreDb=new Client({connectionString:restoreConnection.href});await restoreDb.connect();
  const beforeSequences=(await target.db.query("select pos_business_backup() raw")).rows[0].raw;
  const targetConfig={database:restoreConnection.href,confirmEmptyTarget:'RESTORE EMPTY LOCAL POS'};
  assert.throws(()=>restoreTarget({...targetConfig,database:'postgresql://postgres:fake@example.invalid/postgres'}));
  await restoreDb.query('revoke select(management_revision) on public.profiles from authenticated');
  await assert.rejects(restoreBusinessArchive(restoreDb,archive),/migración 021/);
  await restoreDb.query('grant select(management_revision) on public.profiles to authenticated');
  check('Restore refuses an incomplete staff projection contract',Number((await target.db.query('select count(*)::text n from profiles')).rows[0].n),0);
  const invalid=structuredClone(archive);
  invalid.snapshotJson=(await source.db.query("select jsonb_set($1::jsonb,array['tables','public.orders','rows','0','customer_id'],to_jsonb($2::text))::text raw",[archive.snapshotJson,randomUUID()])).rows[0].raw;
  await assert.rejects(restoreBusinessArchive(restoreDb,invalid),error=>error.code==='23503');
  check('Foreign keys reject invalid archived relationships',Number((await target.db.query('select count(*)::text n from orders')).rows[0].n),0);
  await assert.rejects(restoreBusinessArchive(restoreDb,archive,{failBeforeCommit:()=>{throw Error('Simulated interruption before commit');}}),/Simulated interruption/);
  check('Interrupted restore leaves target empty',Number((await target.db.query('select count(*)::text n from profiles')).rows[0].n),0);
  check('Interrupted restore preserves original sequence states',JSON.parse((await target.db.query('select pos_business_backup() raw')).rows[0].raw).sequences,JSON.parse(beforeSequences).sequences);
  check('Failure leaves normal trigger behavior',(await target.db.query("select current_setting('session_replication_role') mode")).rows[0].mode,'origin');
  const configFile=path.join(directory,'private','empty-target.private.json');await writeFile(configFile,JSON.stringify(targetConfig),{mode:0o600});
  const restored=JSON.parse(await run(process.execPath,[path.join(root,'scripts/backups/restore-business.mjs'),archiveFile,backupConfig.keyFile,configFile]));
  check('Shipped restore CLI commits a real archived dataset',restored.restored,true);report.restored=restored;
  const targetRaw=ok(await target.service.rpc('pos_business_backup'));
  check('All original sequence states restored',JSON.parse(targetRaw).sequences,JSON.parse(archive.snapshotJson).sequences);
  check('All original rows and numeric values restored',(await target.db.query(`select ($1::jsonb->'tables')=($2::jsonb->'tables') same`,[archive.snapshotJson,targetRaw])).rows[0].same,true);
  await assert.rejects(restoreBusinessArchive(restoreDb,archive),/contiene datos/);
  check('Existing source business rows stay untouched',(await source.db.query('select ($1::jsonb->\'tables\')=(pos_business_backup()::jsonb->\'tables\') same',[sourceBefore])).rows[0].same,true);
  const recoveredAdmin=await login(target.config,actors.admin),recoveredCashier=await login(target.config,actors.cashier);
  check('Original staff credentials and roles authenticate',ok(await recoveredAdmin.rpc('pos_drawer_status')).active.cashier_id,actors.cashier.id);
  check('Existing sale replay returns identical receipt',ok(await recoveredCashier.rpc('pos_checkout',{p_request:request,p_payload:payload})),sale);
  const held=ok(await recoveredCashier.rpc('pos_phone_get',{p_id:phone.id}));check('Pending phone survives with its accepted quote',held.snapshot,phone.snapshot);
  const pickup={...payload,pager_number:null,phone_order_id:held.id,phone_order_revision:held.revision};
  const paid=ok(await recoveredCashier.rpc('pos_checkout',{p_request:randomUUID(),p_payload:pickup}));
  check('Recovered phone can be paid once',paid.phone_order_id,held.id);
  check('Restored stock deducts accepted phone exactly once',(await target.db.query('select quantity from pos_inventory_items where product_id=$1',[product.id])).rows[0].quantity,10);
  const next=ok(await recoveredCashier.rpc('pos_checkout',{p_request:randomUUID(),p_payload:payload}));
  check('New sale has a distinct increasing folio',Number(next.ticket_number)>Number(paid.ticket_number)&&next.id!==sale.id,true);
  const summary=ok(await recoveredCashier.rpc('pos_shift_summary',{p_register:register.id}));
  ok(await recoveredCashier.rpc('pos_close_shift',{p_register:register.id,p_counted:summary.expected_cash,p_expenses:summary.expenses,
    p_preview:{cash_sales:summary.cash_sales,total_sales:summary.total_sales,expenses_revision:summary.expenses_revision}}));
  check('Recovered drawer closes through normal RPC',ok(await recoveredAdmin.rpc('pos_drawer_status')).active,null);
  report.pass=true;report.sourceCommit=(await run('git',['rev-parse','HEAD'])).trim();report.sourceDirty=Boolean((await run('git',['status','--porcelain'])).trim());
  await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log('PASS '+report.checks.length+' operational restore checks: original encrypted archive, real FK/triggers, rollback, Auth login, sale replay, phone pickup, stock, new folio and drawer close.');
  console.log('Restore evidence: '+path.join(directory,'report.json'));
}finally{
  for(const client of clients)client.auth.stopAutoRefresh();
  await restoreDb?.end();
  await target?.cleanup();await source?.cleanup();
}
