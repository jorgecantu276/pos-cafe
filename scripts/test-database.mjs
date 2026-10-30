import { createTestPostgres } from './testing/postgres.mjs';
import { Client } from 'pg';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { shiftDatabaseCases } from './shift/database-cases.mjs';
import { reportDatabaseCases } from './reports/database-cases.mjs';
import { multiItemDatabaseCases } from './printing/multi-item-database-cases.mjs';

const root=resolve(import.meta.dirname,'..');
// User-owned TEMP survives PostgreSQL's restricted Windows token; a hosted
// runner's elevated D:\a checkout can have different inherited ACLs.
const dir=resolve(await mkdtemp(resolve(tmpdir(),'pos-cafe-pg17-')),'data');
const password=randomUUID();
const server=createTestPostgres({databaseDir:dir,user:'postgres',password,port:55439,persistent:true,
  postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const clients=[];
let assertions=0;
async function connection(role='postgres',uid='') {
  const c=new Client({host:'127.0.0.1',port:55439,user:'postgres',password,database:'postgres'});
  await c.connect(); clients.push(c);
  await c.query(`set role ${role}`);
  await c.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  return c;
}
async function denied(client,sql,args=[]) {await assert.rejects(client.query(sql,args)); assertions++;}
const ids=Object.fromEntries(['admin','cashier','barista','outsider','product','product2','supply','customer'].map(k=>[k,randomUUID()]));
try {
  await server.initialise(); await server.start();
  const db=await connection();
  console.log((await db.query('select version()')).rows[0].version);
  const snap=JSON.parse(await readFile(resolve(root,'supabase/schema.snapshot.json'),'utf8'));
  await db.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to public;
    create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`);
  for(const s of snap.sequences) await db.query(`create sequence public."${s.name}"`);
  for(const t of snap.tables) {
    const cols=t.columns.map(c=>`"${c.name}" ${c.type}${c.default?' default '+c.default:''}${c.not_null?' not null':''}`);
    await db.query(`create table public."${t.name}"(${cols.join(',')})`);
  }
  for(const t of snap.tables) for(const c of t.constraints.filter(c=>c.type!=='f')) await db.query(`alter table public."${t.name}" add constraint "${c.name}" ${c.definition}`);
  for(const t of snap.tables) for(const c of t.constraints.filter(c=>c.type==='f')) await db.query(`alter table public."${t.name}" add constraint "${c.name}" ${c.definition}`);
  for(const f of snap.functions) { const definition=f.definition??f.function_definition; assert.ok(definition,JSON.stringify(f).slice(0,300)); await db.query(definition); }
  await db.query(`grant all on all tables in schema public to anon,authenticated,service_role;
    grant all on all sequences in schema public to anon,authenticated,service_role;
    grant execute on all functions in schema public to anon,authenticated,service_role`);
  // Recreate the insecure defaults as well as current-object grants.
  await db.query(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for(const role of ['admin','cashier','barista','outsider']) {
    await db.query('insert into auth.users values($1)',[ids[role]]);
    await db.query('insert into public.profiles(id,full_name,username,role) values($1,$2,$2,$2)',[ids[role],role]);
  }
  const anon=await connection('anon');
  await anon.query("update public.profiles set role='admin' where id=$1",[ids.cashier]);
  assert.equal((await db.query('select role from profiles where id=$1',[ids.cashier])).rows[0].role,'admin');
  console.log('PASS baseline: anonymous profile privilege escalation reproduced on isolated snapshot'); assertions++;
  await db.query("update profiles set role='cashier' where id=$1",[ids.cashier]);
  const migration=await readFile(resolve(root,'supabase/migrations/202610280001_secure_pos.sql'),'utf8');
  await db.query(migration);
  await db.query(await readFile(resolve(root,'supabase/migrations/202610280002_shift_expenses.sql'),'utf8'));
  const cash=await connection('authenticated',ids.cashier),bar=await connection('authenticated',ids.barista),admin=await connection('authenticated',ids.admin),outsider=await connection('authenticated',ids.outsider);
  for(const t of snap.tables) await denied(anon,`select * from public."${t.name}"`);
  await denied(anon,'select pos_checkout($1,$2)',[randomUUID(),{}]);
  await denied(cash,"update profiles set role='admin' where id=$1",[ids.cashier]);
  await denied(cash,'select pin_code from profiles');
  await denied(cash,'truncate products');
  await denied(cash,'select decrement_stock($1,-50)',[ids.product]);
  await denied(cash,'select process_recipe_stock($1,-50)',[ids.product]);
  await denied(cash,"insert into products(name,price) values('Injected',1)");
  await denied(cash,"insert into supplies(name,unit) values('Injected','ml')");
  await db.query('create table public.future_permission_probe(id integer); create function public.future_permission_probe() returns integer language sql as $$select 1$$;');
  await denied(anon,'select * from public.future_permission_probe');
  await denied(cash,'select * from public.future_permission_probe');
  await denied(anon,'select public.future_permission_probe()');
  await denied(cash,'select public.future_permission_probe()');
  await db.query('drop table public.future_permission_probe; drop function public.future_permission_probe()');
  await denied(cash,'select * from cafe_private.abandoned_checkouts');
  await denied(anon,'select pos_abandon_checkout($1)',[randomUUID()]);
  await denied(outsider,'select pos_open_shift($1,0,20)',[randomUUID()]);
  assert.equal((await anon.query('select * from pos_login_profiles()')).rows.length,3); assertions++;
  assert.deepEqual(Object.keys((await anon.query('select * from pos_login_profiles()')).rows[0]).sort(),['avatar_url','full_name','id','username']);assertions++;
  await denied(cash,"select pos_manage_profile($1,'X','cashier','admin',null,true)",[ids.cashier]);
  await denied(admin,"select pos_manage_profile($1,'Admin','admin','barista',null,true)",[ids.admin]);
  await denied(cash,'insert into orders(subtotal,total) values(1,1)');
  await denied(cash,'update customers set points=99999');
  await db.query("insert into products(id,name,price,stock,is_active,customizable,wizard_steps) values($1,'Café',50,10,true,true,array['Tamaño']),($2,'Pan',20,0,true,false,null)",[ids.product,ids.product2]);
  await denied(admin,'update products set stock=999 where id=$1',[ids.product]);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('pos_adjust_inventory','pos_configure_inventory','pos_save_inventory_recipe','pos_import_inventory_counts','pos_cost_report')")).rows[0].n,0);assertions++;
  await db.query("insert into supplies(id,name,unit,current_stock) values($1,'Leche','ml',1000)",[ids.supply]);
  await db.query('insert into product_recipes(product_id,supply_id,quantity_required) values($1,$2,100),($1,$2,25)',[ids.product,ids.supply]);
  const extra=randomUUID();
  await admin.query("insert into extras(id,name,price,phase) values($1,'Grande',10,'Tamaño')",[extra]);
  const registered=(await cash.query("select pos_register_customer('Ana','555',null,true) result")).rows[0].result;
  assert.equal(registered.points,50); assertions++;
  const openId=randomUUID();
  const shift=(await cash.query('select pos_open_shift($1,100,20) result',[openId])).rows[0].result;
  assert.equal((await cash.query('select pos_open_shift($1,100,20) result',[openId])).rows[0].result.id,shift.id); assertions++;
  const barShift=(await bar.query('select pos_open_shift($1,0,20) result',[randomUUID()])).rows[0].result;
  const payload={register_id:shift.id,items:[{product_id:ids.product,quantity:2,extra_ids:[extra],note:'Sin hielo'}],expected_total:120,payment_method:'mixto',tender_mxn:20,tender_usd:5,customer_id:registered.id,order_type:'En Local',order_note:'Mesa 1'};
  const rpc=async(c,key,p)=>(await c.query('select pos_checkout($1,$2) result',[key,p])).rows[0].result;
  const state=async()=>JSON.stringify((await db.query("select jsonb_build_object('orders',(select jsonb_agg(o order by id) from orders o),'items',(select jsonb_agg(i order by id) from order_items i),'products',(select jsonb_agg(p order by id) from products p),'supplies',(select jsonb_agg(s order by id) from supplies s),'customers',(select jsonb_agg(c order by id) from customers c)) state")).rows[0].state);
  const abandoned=randomUUID();const unchanged=await state();
  await cash.query('select pos_abandon_checkout($1)',[abandoned]);
  await cash.query('select pos_abandon_checkout($1)',[abandoned]);
  await denied(cash,'select pos_checkout($1,$2)',[abandoned,payload]);
  assert.equal(await state(),unchanged);assertions++;
  for(const bad of [
    {...payload,expected_total:1}, {...payload,items:[{...payload.items[0],quantity:-1}]},
    {...payload,items:[{...payload.items[0],quantity:1.5}]}, {...payload,tender_usd:-1},
    {...payload,items:[{...payload.items[0],extra_ids:[extra,extra]}]},
    {...payload,register_id:barShift.id}, {...payload,tender_mxn:0,tender_usd:0},
    {...payload,customer_id:randomUUID()}, // fails after financial validation: must fully roll back
  ]) {
    const before=await state();await denied(cash,'select pos_checkout($1,$2)',[randomUUID(),bad]);assert.equal(await state(),before);assertions++;
  }
  const request=randomUUID();const receipt=await rpc(cash,request,payload);
  await denied(cash,'select pos_abandon_checkout($1)',[request]);
  assert.equal(receipt.total,120); assert.equal(receipt.items[0].product.price,60);assert.equal(receipt.change_mxn,0);assertions+=3;
  assert.equal((await db.query('select stock from products where id=$1',[ids.product])).rows[0].stock,10);assertions++;
  assert.equal(Number((await db.query('select current_stock from supplies where id=$1',[ids.supply])).rows[0].current_stock),1000);assertions++;
  const customer=(await db.query('select * from customers where id=$1',[registered.id])).rows[0];assert.equal(customer.points,62);assert.equal(Number(customer.total_spent),120);assertions+=2;
  assert.deepEqual(await rpc(cash,request,payload),receipt);assertions++;
  await denied(cash,'select pos_checkout($1,$2)',[request,{...payload,order_note:'different'}]);
  const parallel=await connection('authenticated',ids.cashier);
  const retryKey=randomUUID();
  const repeats=await Promise.all([rpc(cash,retryKey,payload),rpc(parallel,retryKey,payload)]);
  assert.equal(repeats[0].id,repeats[1].id);assertions++;
  const lastPayload={...payload,items:[{product_id:ids.product2,quantity:1,extra_ids:[],note:''}],expected_total:20,tender_mxn:20,tender_usd:0,customer_id:null};
  const race=await Promise.allSettled([rpc(cash,randomUUID(),lastPayload),rpc(bar,randomUUID(),{...lastPayload,register_id:barShift.id})]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,2);assert.equal(race.filter(x=>x.status==='rejected').length,0);assertions+=2;
  assert.equal((await db.query('select stock from products where id=$1',[ids.product2])).rows[0].stock,0);assertions++;
  await denied(cash,'select pos_cancel_sale($1)',[receipt.id]);
  await admin.query('select pos_cancel_sale($1)',[receipt.id]);await admin.query('select pos_cancel_sale($1)',[receipt.id]);
  assert.equal((await db.query('select points from customers where id=$1',[registered.id])).rows[0].points,62);assertions++;
  // Other employee cannot see cashier receipts or shift, but admin can.
  assert.equal((await bar.query('select * from orders where id=$1',[receipt.id])).rowCount,0);assertions++;
  const expenses=[{desc:'Compra',amount:5}];
  const expenseRequest=randomUUID();
  await cash.query('select pos_shift_expenses($1,$2,0,$3)',[shift.id,expenseRequest,JSON.stringify(expenses)]);
  const preview=(await cash.query('select pos_shift_summary($1) result',[shift.id])).rows[0].result;
  const close=(await cash.query('select pos_close_shift($1,215,$2,$3) result',[shift.id,JSON.stringify(expenses),preview])).rows[0].result;
  assert.equal(Number(close.total_sales),race[0].status==='fulfilled'?140:120);assertions++;
  assert.equal((await cash.query('select pos_close_shift($1,215,$2,$3) result',[shift.id,JSON.stringify(expenses),preview])).rows[0].result.id,close.id);assertions++;
  await denied(cash,'select pos_close_shift($1,1,$2,$3)',[shift.id,JSON.stringify(expenses),preview]);
  await denied(cash,'select pos_checkout($1,$2)',[randomUUID(),payload]);
  await denied(admin,'select pos_cancel_sale($1)',[repeats[0].id]);
  assert.deepEqual(await rpc(cash,request,payload),{...receipt,status:'cancelled'});assertions++;
  const barParallel=await connection('authenticated',ids.barista);
  const barPreview=(await bar.query('select pos_shift_summary($1) result',[barShift.id])).rows[0].result;
  const closingRace=await Promise.allSettled([
    rpc(bar,randomUUID(),{...payload,register_id:barShift.id}),
    barParallel.query('select pos_close_shift($1,0,$2,$3) result',[barShift.id,'[]',barPreview]),
  ]);
  let raceReport;
  if(closingRace[1].status==='rejected') {
    assert.match(closingRace[1].reason.message,/cambió desde la vista previa/);assertions++;
    const fresh=(await bar.query('select pos_shift_summary($1) result',[barShift.id])).rows[0].result;
    raceReport=(await bar.query('select pos_close_shift($1,0,$2,$3) result',[barShift.id,'[]',fresh])).rows[0].result;
  } else raceReport=closingRace[1].value.rows[0].result;
  const barTotals=(await db.query("select coalesce(sum(total),0) total from orders where register_id=$1 and status='completed'",[barShift.id])).rows[0].total;
  assert.equal(Number(raceReport.total_sales),Number(barTotals));assertions++;
  assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='public' and not rowsecurity")).rows[0].n,0);assertions++;
  const finalShift=(await bar.query('select pos_open_shift($1,0,20) result',[randomUUID()])).rows[0].result;
  const abandonRaceKey=randomUUID();
  const abandonRace=await Promise.allSettled([
    rpc(bar,abandonRaceKey,{...payload,register_id:finalShift.id}),
    barParallel.query('select pos_abandon_checkout($1)',[abandonRaceKey]),
  ]);
  assert.equal(abandonRace.filter(x=>x.status==='fulfilled').length,1);assertions++;
  const outcome=(await db.query('select (select count(*) from orders where cashier_id=$1 and request_id=$2)::int committed,(select count(*) from cafe_private.abandoned_checkouts where cashier_id=$1 and request_id=$2)::int abandoned',[ids.barista,abandonRaceKey])).rows[0];
  assert.equal(outcome.committed+outcome.abandoned,1);assertions++;
  assertions+=await shiftDatabaseCases(db,connection,ids);
  await db.query(await readFile(resolve(root,'supabase/migrations/202610280004_reports.sql'),'utf8'));
  assertions+=await reportDatabaseCases(db,connection,ids);
  assertions+=await multiItemDatabaseCases(db,connection,ids);
  console.log(`PASS ${assertions} database assertions: permissions, projected login, admin/staff controls, rollback, server pricing, duplicate/replayed requests, concurrent independent sales; legacy stock unchanged, loyalty, shift close/recovery, cancellation.`);
} finally {
  await Promise.allSettled(clients.map(c=>c.end()));
  await server.stop();
}
