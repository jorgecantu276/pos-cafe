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
  // Rehydrate the ORIGINAL JSON text into isolated typed table clones. LIKE
  // without INCLUDING defaults/identity/generated expressions preserves column
  // types and NOT NULL checks without source sequences, triggers or FK writes.
  // This verifies data recovery fidelity, not hosted Auth/platform restoration.
  const quote=name=>`"${name.replaceAll('"','""')}"`;
  const suffix=randomUUID().replaceAll('-','');
  let restoredTables=0,restoredRows=0;
  await db.query('begin');
  try {
    for(const [name,table] of Object.entries(snapshot.tables)) {
      assert.match(name,/^(public|cafe_private|auth)\.[a-zA-Z_][a-zA-Z0-9_]*$/);
      const [schema,relation]=name.split('.'),source=`${quote(schema)}.${quote(relation)}`;
      const temporary=`backup_restore_${restoredTables}_${suffix}`,clone=`pg_temp.${quote(temporary)}`;
      await db.query(`create temp table ${quote(temporary)} (like ${source}) on commit drop`);
      // Never JSON.stringify(snapshot): that would round the precision probe
      // before PostgreSQL can restore its original numeric(30,0) value.
      await db.query(`insert into ${clone} select * from jsonb_populate_recordset(null::${clone},$1::jsonb #> array['tables',$2,'rows'])`,[raw,name]);
      const fidelity=(await db.query(`with
        expected as (select value from jsonb_array_elements($1::jsonb #> array['tables',$2,'rows'])),
        restored as (select to_jsonb(t) value from ${clone} t),
        current_source as (select to_jsonb(t) value from ${source} t)
        select (select count(*)::int from expected) expected_count,
          (select count(*)::int from restored) restored_count,
          (select count(*)::int from (
            (select value from expected except all select value from restored)
            union all (select value from restored except all select value from expected)
          ) difference) snapshot_differences,
          (select count(*)::int from (
            (select value from current_source except all select value from restored)
            union all (select value from restored except all select value from current_source)
          ) difference) source_differences`,[raw,name])).rows[0];
      equal(fidelity,{expected_count:table.rows.length,restored_count:table.rows.length,snapshot_differences:0,source_differences:0});
      if(name==='public.backup_precision_probe') equal((await db.query(`select value::text value from ${clone}`)).rows,[{value:'9007199254740993'}]);
      restoredTables++;restoredRows+=table.rows.length;
    }
    equal(restoredTables,Object.keys(snapshot.tables).length);
    for(const [name,sequence] of Object.entries(snapshot.sequences)) {
      const [schema,relation]=name.split('.');
      equal((await db.query(`select last_value::text last_value,is_called from ${quote(schema)}.${quote(relation)}`)).rows[0],sequence);
    }
  } finally { await db.query('rollback'); }
  equal((await db.query('select jsonb_agg(to_jsonb(o) order by id) r from orders o')).rows[0].r,before);
  await db.query('drop table public.backup_precision_probe');
  console.log(`PASS ${checks} business-backup assertions: service-only privileges, ${restoredTables} tables/${restoredRows} rows rehydrated in temporary typed clones, exact numeric text and unchanged source rows/counters`);
  return checks;
}
