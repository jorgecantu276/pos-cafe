import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Called only by the owned embedded PostgreSQL runner, never a configured URL.
export async function shiftDatabaseCases(db,connection,ids) {
  let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
  const deny=async(client,sql,args=[])=>{await assert.rejects(client.query(sql,args));checks++;};
  const owner=await connection('authenticated',ids.admin),other=await connection('authenticated',ids.barista),anon=await connection('anon');
  const register=(await owner.query('select pos_open_shift($1,100,20) result',[randomUUID()])).rows[0].result;
  const summary=async()=> (await owner.query('select pos_shift_summary($1) result',[register.id])).rows[0].result;
  const set=async(request,revision,expenses)=> (await owner.query('select pos_shift_expenses($1,$2,$3,$4) result',[register.id,request,revision,JSON.stringify(expenses)])).rows[0].result;
  await deny(anon,'select pos_shift_summary($1)',[register.id]);
  await deny(other,'select pos_shift_summary($1)',[register.id]);
  await deny(other,'select pos_shift_expenses($1,$2,0,$3)',[register.id,randomUUID(),'[]']);
  await deny(owner,'select * from cafe_private.shift_expense_requests');
  await deny(owner,"update cash_registers set expenses_detail='[]' where id=$1",[register.id]);
  await deny(owner,'select pos_close_shift($1,0,$2)',[register.id,'[]']);
  // Exactly one revision wins, even across two real database connections.
  const request=randomUUID(),expenses=[{desc:'Garrafón',amount:50}];
  equal((await set(request,0,expenses)).expenses_revision,1);
  equal((await set(request,0,expenses)).expenses_revision,1);
  equal(Number((await db.query('select count(*) from cafe_private.shift_expense_requests where request_id=$1',[request])).rows[0].count),1);
  await deny(owner,'select pos_shift_expenses($1,$2,0,$3)',[register.id,request,'[]']);
  await deny(owner,'select pos_shift_expenses($1,$2,0,$3)',[register.id,randomUUID(),'[]']);
  for(const invalid of [[{desc:'',amount:1}],[{desc:'X',amount:0}],[{desc:'X',amount:0.001}],[{desc:'X',amount:1,forged:true}]]){
    await deny(owner,'select pos_shift_expenses($1,$2,1,$3)',[register.id,randomUUID(),JSON.stringify(invalid)]);
  }
  const second=await connection('authenticated',ids.admin);
  const concurrent=await Promise.allSettled([
    owner.query('select pos_shift_expenses($1,$2,1,$3)',[register.id,randomUUID(),'[]']),
    second.query('select pos_shift_expenses($1,$2,1,$3)',[register.id,randomUUID(),JSON.stringify([{desc:'Otro',amount:35}])]),
  ]);
  equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  equal(concurrent.filter(r=>r.status==='rejected').length,1);
  let state=await summary();equal(state.expenses_revision,2);
  state=await set(randomUUID(),state.expenses_revision,[]);equal(state.expenses,[]);
  // A new authenticated connection is the database side of logout/login recovery.
  equal((await second.query('select pos_shift_summary($1) result',[register.id])).rows[0].result.expenses,[]);
  state=await set(randomUUID(),state.expenses_revision,[{desc:'Agua',amount:0.29}]);
  equal(state.expected_cash,99.71);
  const menu=JSON.parse(await readFile(new URL('../../tests/fixtures/real-menu.json',import.meta.url),'utf8'));
  equal(menu.products.length,82);
  const milk=randomUUID(),regular=randomUUID();
  await db.query("insert into extras(id,name,price,phase,active) values($1,'Almendra',15,'Tipo de Leche',true),($2,'Entera',0,'Tipo de Leche',true)",[milk,regular]);
  let total=0;const products=new Map();
  for(const entry of menu.products){
    const id=randomUUID(),custom=entry.milk_surcharge_scope==='confirmed_15_mxn';products.set(entry.name,{id,entry});
    await db.query('insert into products(id,name,price,stock,is_active,customizable,wizard_steps) values($1,$2,$3,5000,true,$4,$5)',[id,entry.name,entry.price_mxn,custom,custom?['Tipo de Leche']:[]]);
    const payload={register_id:register.id,items:[{product_id:id,quantity:1,extra_ids:[],note:''}],expected_total:entry.price_mxn,
      payment_method:'efectivo',tender_mxn:entry.price_mxn,tender_usd:0,customer_id:null,order_type:'En Local',order_note:''};
    const receipt=(await owner.query('select pos_checkout($1,$2) result',[randomUUID(),payload])).rows[0].result;
    equal(receipt.total,entry.price_mxn);total+=entry.price_mxn;
  }
  const selected=[['Iced coffee caramelo',2,110],['Iced coffe flan',1,145],['Iced coffee nevado',1,155],['Frappe Oreo',1,100],['Cappuccino',1,95],['Te chai caliente',1,110]];
  for(const [name,quantity,unit] of selected){
    const {id}=products.get(name);const payload={register_id:register.id,items:[{product_id:id,quantity,extra_ids:[milk],note:'Prueba de menú real'}],expected_total:quantity*unit,
      payment_method:'efectivo',tender_mxn:quantity*unit,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:''};
    const receipt=(await owner.query('select pos_checkout($1,$2) result',[randomUUID(),payload])).rows[0].result;
    equal(receipt.items[0].product.price,unit);equal(receipt.total,quantity*unit);total+=quantity*unit;
  }
  const americano=products.get('Cafe americano').id;
  await deny(owner,'select pos_checkout($1,$2)',[randomUUID(),{register_id:register.id,items:[{product_id:americano,quantity:1,extra_ids:[milk],note:''}],expected_total:75,payment_method:'efectivo',tender_mxn:75,tender_usd:0,customer_id:null,order_type:'En Local',order_note:''}]);
  // No PostgREST row cap can truncate a scalar server aggregate.
  await db.query("insert into orders(register_id,cashier_id,subtotal,total,payment_method,status) select $1,$2,30,30,'efectivo','completed' from generate_series(1,1101)",[register.id,ids.admin]);total+=1101*30;
  await db.query("insert into orders(register_id,cashier_id,subtotal,total,payment_method,status) values($1,$2,860,860,'tarjeta','completed'),($1,$2,950,950,'efectivo','cancelled'),($1,$2,950,950,'efectivo','pending')",[register.id,ids.admin]);
  state=await summary();equal(state.cash_sales,total);equal(state.total_sales,total+860);equal(state.expected_cash,Math.round((100+total-0.29)*100)/100);
  const stale=state;
  state=await set(randomUUID(),state.expenses_revision,[]);
  await deny(owner,'select pos_close_shift($1,0,$2,$3)',[register.id,JSON.stringify(stale.expenses),stale]);
  // A sale committed after preview requires a fresh preview instead of a hidden discrepancy.
  const before=state;
  await db.query("insert into orders(register_id,cashier_id,subtotal,total,payment_method,status) values($1,$2,15,15,'mixto','completed')",[register.id,ids.admin]);
  await deny(owner,'select pos_close_shift($1,0,$2,$3)',[register.id,'[]',before]);
  state=await summary();equal(state.cash_sales,total+15);
  const count=state.expected_cash;
  const closed=(await owner.query('select pos_close_shift($1,$2,$3,$4) result',[register.id,count,'[]',state])).rows[0].result;
  equal(Number(closed.total_sales),state.total_sales);equal(Number(closed.expected_cash),state.expected_cash);equal(Number(closed.difference),0);
  equal((await owner.query('select pos_close_shift($1,$2,$3,$4) result',[register.id,count,'[]',state])).rows[0].result.id,closed.id);
  await deny(owner,'select pos_shift_expenses($1,$2,$3,$4)',[register.id,randomUUID(),state.expenses_revision,'[]']);
  const replay=await set(request,0,expenses);equal(replay.status,'closed');equal(replay.expenses,[]);
  equal(Number((await db.query('select count(*) from shifts where register_id=$1',[register.id])).rows[0].count),1);
  return checks;
}
