import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Optional rehearsal of a reviewed catalog update on the disposable test DB.
export async function menuUpdateCases(db, connection, baselineFile, updateFile) {
  const catalog=JSON.parse(await readFile(baselineFile,'utf8'));
  await db.query('truncate public.products,public.extras,public.categories cascade');
  for(const table of ['categories','products','extras'])for(const row of catalog[table]){
    const names=Object.keys(row);assert(names.every(name=>/^[a-z_]+$/.test(name)));
    await db.query(`insert into public.${table}(${names.map(name=>`"${name}"`).join(',')}) values(${names.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
  }
  const admin=randomUUID(),cashier=randomUUID(),register=randomUUID();
  for(const [id,username,role] of [[admin,'administrador','admin'],[cashier,'menu-'+cashier,'cashier']]){
    await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into profiles(id,full_name,username,role) values($1,$2,$2,$3)',[id,username,role]);
  }
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query('update pos_inventory_settings set enabled=false');
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,0,16,'open')",[register,cashier]);
  const staff=await connection('authenticated',cashier);
  const matcha=catalog.products.find(p=>p.name==='Matcha cariño');
  const oldOat=catalog.extras.find(e=>e.phase==='Tipo de Leche'&&e.name==='avena');
  const input=(id,extras,total)=>({register_id:register,items:[{product_id:id,quantity:1,extra_ids:extras,note:'Sin hielo'}],expected_total:total,payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:1});
  const sale=(await staff.query('select pos_checkout($1,$2) result',[randomUUID(),input(matcha.id,[oldOat.id],120)])).rows[0].result;
  await db.query(await readFile(updateFile,'utf8'));
  let checks=0;
  const products=(await db.query('select * from products')).rows,extras=(await db.query('select * from extras')).rows;
  assert.equal(products.length,catalog.products.length+13);checks++;
  assert.equal(products.find(p=>p.id===matcha.id).name,'Matcha cariño 16 oz');checks++;
  assert.equal(products.find(p=>p.name==='Matcha ceremonial 16 oz').price,'140.00');checks++;
  assert.equal(products.some(p=>p.name==='Matcha ceremonial 20 oz'),false);checks++;
  assert.equal(products.find(p=>p.name==='Iced coffe flan 16 oz').price,'130.00');checks++;
  assert.equal(products.some(p=>p.name==='Iced coffe flan 20 oz'),false);checks++;
  const oats=extras.find(e=>e.name==='Leche de avena'&&e.phase==='Leche alternativa');
  const lala=extras.find(e=>e.name==='Lala 100'&&e.phase==='Leche alternativa');
  for(const product of products.filter(p=>p.name.startsWith('Matcha '))){
    for(const milk of [oats,lala]){
      const total=Number(product.price)+Number(milk.price);
      const result=(await staff.query('select pos_checkout($1,$2) result',[randomUUID(),input(product.id,[milk.id],total)])).rows[0].result;
      assert.equal(result.total,total);checks++;
    }
  }
  for(const size of ['16 oz','20 oz']){
    const product=products.find(p=>p.name==='Iced coffee caramelo '+size);
    assert.equal(Number(product.price),size==='16 oz'?95:125);checks++;
    const result=(await staff.query('select pos_checkout($1,$2) result',[randomUUID(),input(product.id,[oldOat.id],Number(product.price)+15)])).rows[0].result;
    assert.equal(result.total,size==='16 oz'?110:140);checks++;
  }
  const saved=(await db.query('select receipt_snapshot from orders where id=$1',[sale.id])).rows[0].receipt_snapshot;
  assert.equal(saved.total,120);assert.equal(saved.items[0].product.displayExtras[0].price,15);checks+=2;
  assert.equal(products.filter(p=>p.name.startsWith('Matcha ')).every(p=>p.wizard_steps.includes('Leche alternativa')&&!p.wizard_steps.includes('Tipo de Leche')),true);checks++;
  await assert.rejects(db.query(await readFile(updateFile,'utf8')),/El catálogo cambió/);await db.query('rollback');checks++;
  console.log(`PASS ${checks} approved menu-update checks: 13 new sized coffees, unchanged special Flan, Ceremonial16oz, free Matcha milk, Lala15, retained IDs and historical receipts`);
  return checks;
}
