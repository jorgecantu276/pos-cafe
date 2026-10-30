import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function businessBackupDatabaseCases(db,connection,ids) {
  let checks=0;const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const deny=async(client)=>{await assert.rejects(client.query('select pos_business_backup()'));checks++;};
  const admin=await connection('authenticated',ids.admin),cashier=await connection('authenticated',ids.cashier);
  const anon=await connection('anon'),service=await connection('service_role');
  // The synthetic schema runner has a deliberately minimal auth.users table;
  // create a matching isolated identity fixture, never hosted Auth records.
  await db.query('create table if not exists auth.identities(id uuid primary key,user_id uuid,provider text,identity_data jsonb)');
  const identity=randomUUID();
  await db.query("insert into auth.identities values($1,$2,'email',$3)",[identity,ids.cashier,{sub:ids.cashier,email:'backup-fixture@example.invalid'}]);
  await db.query('create table public.backup_precision_probe(value numeric(30,0)); insert into public.backup_precision_probe values(9007199254740993)');
  await deny(anon);await deny(cashier);await deny(admin);
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");await deny(admin);
  const before=(await db.query('select jsonb_agg(to_jsonb(o) order by id) r from orders o')).rows[0].r;
  const raw=(await service.query('select pos_business_backup() r')).rows[0].r;
  equal(typeof raw,'string');assert.match(raw,/9007199254740993/);checks++;
  const snapshot=JSON.parse(raw);
  equal(snapshot.format,'pos-cafe-business-snapshot-v1');
  equal(snapshot.tables['auth.users'].rows.length,(await db.query('select count(*)::int n from auth.users')).rows[0].n);
  equal(snapshot.tables['auth.identities'].rows.some(row=>row.id===identity),true);
  equal(snapshot.tables['public.orders'].rows.length,(await db.query('select count(*)::int n from orders')).rows[0].n);
  equal(Object.keys(snapshot.tables).some(name=>name.startsWith('cafe_private.')),true);
  equal(snapshot.tables['public.orders'].columns.some(column=>column.name==='receipt_snapshot'),true);
  equal(snapshot.tables['public.profiles'].rows.some(row=>row.id===ids.admin),true);
  equal(typeof snapshot.sequences['public.orders_ticket_number_seq'].last_value,'string');
  equal((await db.query('select jsonb_agg(to_jsonb(o) order by id) r from orders o')).rows[0].r,before);
  // STABLE functions retain a single statement snapshot; no VOLATILE helper
  // can take a newer visibility snapshot between the table exports.
  equal((await db.query("select provolatile,prosecdef from pg_proc where oid='pos_business_backup()'::regprocedure")).rows[0],{provolatile:'s',prosecdef:true});
  equal((await db.query("select has_function_privilege('authenticated','pos_business_backup()','execute') allowed")).rows[0].allowed,false);
  await db.query('drop table public.backup_precision_probe');
  console.log(`PASS ${checks} business-backup assertions: service-only privileges, complete business/private/Auth snapshot, exact numeric text and no writes`);
  return checks;
}
