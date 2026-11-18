import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createTestPostgres } from '../testing/postgres.mjs';
import { baselineStatements } from '../staging/safety.mjs';
import { sourceFiles } from '../staging/bootstrap.mjs';
import { claimDemo, seedDemo, actorRpc } from './seed.mjs';
import { menu, id } from './menu.mjs';
import { root } from './app.mjs';

const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const directory=await mkdtemp(path.join(tmpdir(),'generic-coffee-demo-')),password=randomUUID();
const server=createTestPostgres({databaseDir:path.join(directory,'data'),user:'postgres',password,port,persistent:true,onLog:()=>{},onError:()=>{}});
const db=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
try {
  await server.initialise();await server.start();await db.connect();
  await db.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema extensions;create table auth.users(id uuid primary key);
    create table auth.identities(id uuid primary key,user_id uuid,provider text,identity_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`);
  const source=await sourceFiles();
  for(const statement of baselineStatements(JSON.parse(source.snapshot)))await db.query(statement);
  const actors={};
  for(const role of ['admin','cashier','second']) {
    actors[role]={id:randomUUID()};
    await db.query('insert into auth.users values($1)',[actors[role].id]);
    await db.query('insert into profiles(id,full_name,username,role) values($1,$2,$2,$3)',[actors[role].id,`demo_${role}`,role==='admin'?'admin':'cashier']);
  }
  await db.query(source.migration);
  // Storage policy is covered by the real local API rehearsal. The SQL-only
  // harness does not pretend to supply Supabase Storage or Auth HTTP services.
  await db.query(await readFile(path.join(root,'supabase/migrations/202611050023_alternative_milk_choice.sql'),'utf8'));
  await assert.rejects(seedDemo(db,actors),/generic_demo_identity/);checks++;
  await claimDemo(db);
  const result=await seedDemo(db,actors),rpc=actorRpc(db),cashier=actors.cashier.id,admin=actors.admin.id;
  equal(await seedDemo(db,actors),result);
  equal((await db.query('select count(*)::int n from products')).rows[0].n,menu.products.length);
  equal((await db.query('select count(*)::int n from orders')).rows[0].n,19);
  equal((await db.query("select count(*)::int n from cash_registers where status='open'")).rows[0].n,1);
  equal((await db.query('select count(*)::int n from products where stock is not null')).rows[0].n,0);
  equal((await db.query("select quantity from pos_inventory_items where product_id=$1",[id('cake')])).rows[0].quantity,null);
  equal((await db.query("select available from pos_inventory_items where product_id=$1",[id('iced-seasonal')])).rows[0].available,false);
  equal((await rpc(cashier,'pos_phone_list',['pending',''])).length,2);
  const payload=(key='iced-miel de maple-16',extraKeys=['milk-oat'],quantity=1)=>({register_id:result.openShift,
    items:[{product_id:id(key),quantity,extra_ids:extraKeys.map(id),note:'Poco hielo'}],
    expected_total:quantity*(menu.products.find(p=>p.key===key).price+extraKeys.reduce((s,k)=>s+menu.extras.find(e=>e.key===k).price,0)),
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:30});
  // Every active, available product is quoted and sold using its original ID.
  // Required choices are a UI rule; seed valid choices for those demonstrations.
  for(const p of menu.products.filter(p=>p.is_active&&p.inventory.available!==false&&p.inventory.quantity!==0)) {
    const e=p.wizard_steps.includes('Helado gourmet')?['ice-vanilla']:p.wizard_steps.includes('Temperatura')?['temp-hot']:[];
    const input=payload(p.key,e);
    const sale=await rpc(cashier,'pos_checkout',[randomUUID(),input]);equal(sale.total,input.expected_total);
    for(const fn of ['clip_quote','phone_catalog_quote']) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[cashier]);
      const quote=(await db.query(`select cafe_private.${fn}($1,$2) result`,[randomUUID(),input])).rows[0].result;
      equal(quote.total,input.expected_total);
    }
  }
  const before=async()=>JSON.stringify((await db.query(`select jsonb_build_object('orders',(select count(*) from orders),'items',(select count(*) from order_items),'inventory',(select jsonb_agg(i order by product_id) from pos_inventory_items i),'holds',(select jsonb_agg(r) from cafe_private.inventory_reservations r)) value`)).rows[0].value);
  async function reject(input,pattern) {
    const state=await before();await assert.rejects(rpc(cashier,'pos_checkout',[randomUUID(),input]),pattern);equal(await before(),state);checks++;
  }
  for(const input of [
    {...payload(),expected_total:0.01},payload('retired',[]),payload('iced-seasonal',[]),payload('juice',[]),payload('cookie',[],1000),
    payload('iced-miel de maple-16',['milk-oat','milk-whole']),payload('matcha-16',['alt-oat','alt-whole']),
    payload('filter',['size-large','size-regular']),payload('espresso',['milk-oat']),
    payload('filter',['retired-extra']),payload('iced-miel de maple-16',['milk-oat','milk-oat']),
    payload('espresso',[],0),payload('espresso',[],1.5),{...payload(),pager_number:31},
  ]) await reject(input);
  // All three server price paths enforce phases, active extras and exact totals.
  for(const fn of ['clip_quote','phone_catalog_quote'])for(const input of [payload('matcha-16',['alt-oat','alt-whole']),payload('filter',['milk-oat']),{...payload(),expected_total:1}]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[cashier]);
    await assert.rejects(db.query(`select cafe_private.${fn}($1,$2)`,[randomUUID(),input]));checks++;
  }
  // Frozen phone quote survives a catalog price change; payment consumes one hold.
  const phone=await rpc(cashier,'pos_phone_get',[result.pendingPhones[0]]),snapshot=phone.snapshot;
  await db.query('update products set price=price+10 where id=$1',[id('matcha-16')]);
  const sale=await rpc(cashier,'pos_checkout',[randomUUID(),{register_id:result.openShift,items:[],expected_total:snapshot.total,customer_id:null,
    order_type:snapshot.order_type,order_note:snapshot.order_note,phone_order_id:phone.id,phone_order_revision:phone.revision,
    pager_number:null,payment_method:'tarjeta',tender_mxn:0,tender_usd:0}]);
  equal(sale.total,snapshot.total);equal(sale.pager_number,null);
  equal((await rpc(cashier,'pos_phone_get',[phone.id])).status,'paid');
  // Reject invalid catalog writes without adding fixtures or corrupting history.
  for(const fields of [{name:'',price:1,category:'Bebidas'},{name:'Inválido',price:-1,category:'Bebidas'},{name:'Inválido',price:1.001,category:'Bebidas'}]) {
    await assert.rejects(rpc(admin,'pos_save_catalog',[randomUUID(),{actor_id:admin,kind:'product',action:'save',id:null,fields:{customizable:false,wizard_steps:[],image_url:'',...fields}}]));checks++;
  }
  console.log(`PASS ${checks} generic demo database checks: fresh isolation, seed replay, all available products, three quote paths, atomic invalid sales, milk/size exclusivity, inventory and frozen phone prices.`);
} finally {await db.end().catch(()=>{});await server.stop();}
