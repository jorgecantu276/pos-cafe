import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Only the isolated embedded PostgreSQL runner supplies these connections.
export async function recentTicketDatabaseCases(db, connection, ids) {
  let checks=0;const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const deny=async(client,sql,args=[])=>{await assert.rejects(client.query(sql,args));checks++;};
  const owner=randomUUID(),other=randomUUID(),empty=randomUUID();
  for(const [id,name,role] of [[owner,'Cajera actual','cashier'],[other,'Otro empleado','barista'],[empty,'Sin ventas','cashier']]) {
    await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into profiles(id,full_name,username,role) values($1,$2,$3,$4)',[id,name,`recent-${id}`,role]);
  }
  const cashier=await connection('authenticated',owner),barista=await connection('authenticated',other);
  const admin=await connection('authenticated',ids.admin),anon=await connection('anon');
  const outsider=await connection('authenticated',ids.outsider),noSales=await connection('authenticated',empty);
  const fixtures=[];
  for(let n=0;n<14;n++) {
    const id=randomUUID(),created_at=n>=11?'2099-10-30T18:00:00.000Z':`2099-10-30T17:${String(n).padStart(2,'0')}:00.000Z`;
    const status=n===13?'cancelled':n===12?'pending':'completed';
    const snapshot=n===13?{cashier_name:'Nombre en comprobante'}:{};
    const result=(await db.query(`insert into orders(id,cashier_id,subtotal,total,status,created_at,receipt_snapshot)
      values($1,$2,$3,$3,$4,$5,$6) returning id,ticket_number,total,created_at,status`,[id,owner,40+n,status,created_at,snapshot])).rows[0];
    fixtures.push({...result,cashier_name:n===13?'Nombre en comprobante':'Cajera actual'});
  }
  const foreign=[];
  for(let n=0;n<2;n++) foreign.push((await db.query(`insert into orders(cashier_id,subtotal,total,status,created_at)
    values($1,777,777,'completed',$2) returning id`,[other,`2099-10-30T19:0${n}:00.000Z`])).rows[0].id);
  const nullDate=(await db.query("insert into orders(cashier_id,subtotal,total,status,created_at) values($1,1,1,'completed',null) returning id",[owner])).rows[0].id;
  const read=async(client,limit=10)=>(await client.query('select * from pos_recent_tickets($1)',[limit])).rows;
  const state=async()=>JSON.stringify((await db.query('select jsonb_agg(to_jsonb(o) order by id) r from orders o')).rows[0].r);
  const before=await state();
  await deny(anon,'select * from pos_recent_tickets()');
  await deny(outsider,'select * from pos_recent_tickets()');
  for(const limit of [null,0,-1,11,2147483647]) await deny(cashier,'select * from pos_recent_tickets($1)',[limit]);
  equal(await read(noSales),[]);
  const sorted=fixtures.sort((a,b)=>b.created_at.getTime()-a.created_at.getTime() || b.id.localeCompare(a.id));
  equal(await read(cashier),sorted.slice(0,10));
  equal(await read(cashier,1),sorted.slice(0,1));
  equal((await cashier.query('select * from pos_recent_tickets()')).rows,sorted.slice(0,10));
  equal((await read(cashier)).some(row=>row.id===nullDate),false);
  equal((await read(barista)).map(row=>row.id),foreign.toReversed());
  equal((await read(admin)).slice(0,2).map(row=>row.id),foreign.toReversed());
  // Cancellation is visible and retained. No receipt payload, payment details,
  // customer identity or another employee's orders are exposed to a cashier.
  const rows=await read(cashier);
  equal(rows.filter(row=>row.status==='cancelled').length,1);
  equal(rows.filter(row=>row.status==='pending').length,1);
  equal(Object.keys(rows[0]).sort(),['cashier_name','created_at','id','status','ticket_number','total']);
  await cashier.query("select set_config('request.jwt.claim.role','admin',false)");
  equal(await read(cashier),sorted.slice(0,10));
  equal(await state(),before);
  await db.query('update profiles set is_active=false where id=$1',[owner]);
  await deny(cashier,'select * from pos_recent_tickets()');
  await db.query('update profiles set is_active=true where id=$1',[owner]);
  // Current profile fallback never replaces an original name in a snapshot.
  await db.query("update profiles set full_name='Nombre editado' where id=$1",[owner]);
  const renamed=await read(cashier);
  equal(renamed.find(row=>row.status==='cancelled').cashier_name,'Nombre en comprobante');
  equal(renamed.find(row=>row.status==='pending').cashier_name,'Nombre editado');
  console.log(`PASS ${checks} recent-ticket assertions: bounded/stable history, own/admin scope, inactive/anonymous denial, cancellation and read-only state`);
  return checks;
}
