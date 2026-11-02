import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function deliveryProjectionCases(db,connection,ids,migration) {
  let checks=0;
  const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const deny=async(p)=>{await assert.rejects(p,error=>error.code==='42501');checks++;};
  const actor=randomUUID(),other=randomUUID();
  for(const id of [actor,other]){
    await db.query('insert into auth.users values($1)',[id]);
    await db.query("insert into profiles(id,full_name,username,role) values($1,'Proyección de equipo',$2,'cashier')",[id,'projection-'+id]);
  }
  const admin=await connection('authenticated',ids.admin),cash=await connection('authenticated',actor),anon=await connection('anon');
  const fields='id,full_name,username,role,avatar_url,is_active,management_revision';
  // Exercise the exact projection used by Equipo, not a privileged owner query.
  await deny(admin.query(`select ${fields} from profiles order by username`));
  await deny(cash.query(`select ${fields} from profiles order by username`));
  for(const [relation,column] of [['products','catalog_revision'],['extras','catalog_revision'],['orders','phone_order_id'],['orders','order_source']]){
    equal((await db.query('select has_column_privilege($1,$2,$3,$4) allowed',['authenticated','public.'+relation,column,'SELECT'])).rows[0].allowed,true);
  }
  // Catalog/POS use SELECT *; existing table grants already cover new columns.
  for(const client of [admin,cash]){
    for(const relation of ['products','extras']){
      const rows=await client.query(`select * from ${relation} order by name limit 1`);
      equal(rows.rows.length,1);equal(Object.hasOwn(rows.rows[0],'catalog_revision'),true);
    }
    await client.query('select id,phone_order_id,order_source,receipt_snapshot from orders limit 1');checks++;
  }
  await db.query(migration);
  const visible=(await admin.query(`select ${fields} from profiles order by username`)).rows;
  equal(visible.some(profile=>profile.id===actor),true);equal(visible.some(profile=>profile.id===other),true);
  const own=(await cash.query(`select ${fields} from profiles order by username`)).rows;
  equal(own.length,1);equal(own[0].id,actor);equal(own[0].management_revision,'0');
  await deny(anon.query(`select ${fields} from profiles`));
  // The fix does not turn a column grant into blanket profile-table access.
  equal((await db.query("select has_table_privilege('authenticated','public.profiles','SELECT') allowed")).rows[0].allowed,false);
  const hidden=(await db.query(`select attname from pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
    and not has_column_privilege('authenticated','public.profiles',attname,'SELECT') order by attnum`)).rows;
  equal(hidden.length>0,true);
  for(const column of hidden)await deny(admin.query(`select "${column.attname.replaceAll('"','""')}" from profiles limit 1`));
  console.log(`PASS ${checks} authenticated UI-projection assertions: reproduced missing revision grant, restored Equipo admin/self reads, preserved hidden columns/RLS, catalog SELECT * and linked-order fields`);
  return checks;
}
