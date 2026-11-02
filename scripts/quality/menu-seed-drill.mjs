import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {Client} from 'pg';
import {createTestPostgres} from '../testing/postgres.mjs';
import {seedQualityMenu} from './menu-fixture.mjs';

// A separate PostgreSQL instance: this test never connects to the preview,
// Supabase, the cafe or any existing print journal.
const probe=createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
const directory=await mkdtemp(resolve(tmpdir(),'pos-quality-menu-'));
const password=randomUUID();
const server=createTestPostgres({databaseDir:resolve(directory,'data'),user:'postgres',password,port,persistent:true,onLog:()=>{},onError:()=>{}});
const db=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
try {
  await server.initialise();await server.start();await db.connect();
  await db.query(`create table products(id uuid primary key default gen_random_uuid(),name text,price numeric check(price>=0),category text,stock numeric,is_active boolean,customizable boolean,wizard_steps text[]);
    create table extras(id uuid primary key default gen_random_uuid(),name text,price numeric check(price>=0),phase text,active boolean,orden_opcion integer);
    create table saved_orders(id uuid primary key,document jsonb);`);
  const product=randomUUID(),milk=randomUUID(),otherMilk=randomUUID(),order=randomUUID();
  await db.query(`insert into products(id,name,price,category,stock,is_active,customizable,wizard_steps)
    values($1,'Iced coffee caramelo',95,'Bebidas',null,true,false,'{}');`,[product]);
  await db.query(`insert into extras(id,name,price,phase,active,orden_opcion)
    values($1,'Almendra',15,'Tipo de Leche',false,99),($2,'Almendra',10,'Leche',true,0)`,[milk,otherMilk]);
  const document={product_id:product,price:95,note:'Historical saved order'};
  await db.query('insert into saved_orders values($1,$2)',[order,document]);
  const menu=JSON.parse(await readFile(new URL('../../tests/fixtures/real-menu.json',import.meta.url),'utf8'));
  await seedQualityMenu(db,menu);await seedQualityMenu(db,menu);
  const counts=(await db.query(`select count(*)::int total,count(*) filter(where customizable)::int customizable,
    count(*) filter(where stock is not null)::int known_stock from products`)).rows[0];
  assert.deepEqual(counts,{total:82,customizable:17,known_stock:0});
  const restored=(await db.query('select id,price,stock,wizard_steps from products where id=$1',[product])).rows[0];
  assert.deepEqual(restored,{id:product,price:'95',stock:null,wizard_steps:['Tipo de Leche']});
  assert.equal((await db.query('select count(*)::int n from extras')).rows[0].n,8);
  assert.deepEqual((await db.query('select id,active,price from extras where id=$1',[milk])).rows[0],{id:milk,active:true,price:'15'});
  assert.equal((await db.query('select price from extras where id=$1',[otherMilk])).rows[0].price,'10');
  assert.deepEqual((await db.query('select document from saved_orders where id=$1',[order])).rows[0].document,document);
  // A failed option update must roll back product changes as one unit.
  await db.query('update products set customizable=false,wizard_steps=$2 where id=$1',[product,[]]);
  const invalid=structuredClone(menu);invalid.rules.alternate_milk_surcharge_mxn=-15;
  await assert.rejects(seedQualityMenu(db,invalid));
  assert.equal((await db.query('select customizable from products where id=$1',[product])).rows[0].customizable,false);
  console.log('PASS: real-menu seed restores 17 milk wizards and 7 verified options, is idempotent, preserves identities/history/unknown stock, isolates phases, and rolls back failed updates.');
} finally {
  await db.end().catch(()=>{});await server.stop();
}
