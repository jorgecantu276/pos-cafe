import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Called only by test-database's disposable local PostgreSQL.
export async function milkChoiceCases(db, connection) {
  let checks = 0;
  const actor = randomUUID(), register = randomUUID(), matcha16 = randomUUID(), matcha20 = randomUUID(), iced = randomUUID();
  await db.query('insert into auth.users values($1)', [actor]);
  await db.query("insert into profiles(id,full_name,username,role) values($1,'Leches prueba',$2,'cashier')", [actor, 'milk-' + actor]);
  await db.query("update cash_registers set status='closed' where status='open'");
  await db.query('update pos_inventory_settings set enabled=false');
  await db.query("insert into cash_registers(id,opened_by,initial_balance,exchange_rate,status) values($1,$2,0,16,'open')", [register, actor]);
  for (const [id, name, price, phase] of [[matcha16,'Matcha cariño 16 oz',105,'Leche alternativa'],[matcha20,'Matcha latte cariño 20 oz',140,'Leche alternativa'],[iced,'Iced coffee caramelo 16 oz',95,'Tipo de Leche']]) {
    await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,$2,$3,'Bebidas',true,true,$4)", [id,name,price,[phase]]);
  }
  const milks = [];
  for (const name of ['Leche entera','Leche deslactosada','Leche deslactosada light','Leche de avena','Leche de coco','Leche de almendra','Lala 100']) {
    const id=randomUUID(),price=name==='Lala 100'?15:0;
    await db.query("insert into extras(id,name,price,phase,active) values($1,$2,$3,'Leche alternativa',true)", [id,name,price]);
    milks.push({id,name,price});
  }
  const paidOat=randomUUID();
  await db.query("insert into extras(id,name,price,phase,active) values($1,'Avena prueba',15,'Tipo de Leche',true)",[paidOat]);
  const staff=await connection('authenticated',actor);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const payload=(product,extras,total)=>({register_id:register,items:[{product_id:product,quantity:1,extra_ids:extras,note:'Sin hielo'}],expected_total:total,
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'',pager_number:1});
  for(const [product,base] of [[matcha16,105],[matcha20,140]]) {
    for(const milk of milks) {
      const input=payload(product,[milk.id],base+milk.price);
      for(const fn of ['cafe_private.clip_quote','cafe_private.phone_catalog_quote']) {
        const result=(await db.query(`select ${fn}($1,$2) result`,[randomUUID(),input])).rows[0].result;
        assert.equal(Number(result.total),base+milk.price);assert.equal(result.items[0].product.displayExtras[0].price,milk.price);checks+=2;
      }
      const request=randomUUID(),sale=(await staff.query('select pos_checkout($1,$2) result',[request,input])).rows[0].result;
      assert.equal(Number(sale.total),base+milk.price);assert.equal(sale.items[0].product.displayExtras[0].price,milk.price);checks+=2;
      assert.deepEqual((await staff.query('select pos_checkout($1,$2) result',[request,input])).rows[0].result,sale);checks++;
    }
  }
  const two=payload(matcha16,[milks[0].id,milks[3].id],105);
  for(const fn of ['cafe_private.clip_quote','cafe_private.phone_catalog_quote','cafe_private.manual_checkout']) {
    await assert.rejects(db.query(`select ${fn}($1,$2)`,[randomUUID(),two]),/una opción por fase/);checks++;
  }
  const coffee=(await staff.query('select pos_checkout($1,$2) result',[randomUUID(),payload(iced,[paidOat],110)])).rows[0].result;
  assert.equal(Number(coffee.total),110);checks++;
  await assert.rejects(staff.query('select pos_checkout($1,$2)',[randomUUID(),payload(iced,[milks[3].id],95)]),/Extra no permitido/);checks++;
  const phonePayload={...payload(matcha20,[milks[3].id],140),contact_name:'Ana prueba',contact_phone:'8681112233'};
  delete phonePayload.register_id;delete phonePayload.pager_number;delete phonePayload.payment_method;delete phonePayload.tender_mxn;delete phonePayload.tender_usd;
  const key=randomUUID(),phone=(await staff.query('select pos_phone_save($1,$2) result',[key,phonePayload])).rows[0].result;
  assert.equal(Number(phone.snapshot.total),140);checks++;
  await db.query('update extras set price=10 where id=$1',[milks[3].id]);
  assert.deepEqual((await staff.query('select pos_phone_save($1,$2) result',[key,phonePayload])).rows[0].result,phone);checks++;
  console.log(`PASS ${checks} milk-choice checks: both sized Matchas, free alternatives, Lala 100 +15, unchanged Iced surcharge, one milk per drink, durable sale/phone replay`);
  return checks + await novemberMatchaCases({ db, staff, payload, matcha16, matcha20, iced, alternativeLala: milks.find(milk => milk.name === 'Lala 100').id });
}

async function novemberMatchaCases({ db, staff, payload, matcha16, matcha20, iced, alternativeLala }) {
  const variants = [
    ['Matcha ceremonial 16 oz', 140, ['Leche alternativa', 'Cold foam', 'Fruta extra']],
    ['Matcha fresa 16 oz', 115, ['Leche alternativa', 'Fruta extra']],
    ['Matcha latte cold foam fresa 20 oz', 140, ['Leche alternativa', 'Fruta extra']],
    ['Matcha latte cold foam mango 20 oz', 140, ['Leche alternativa', 'Fruta extra']],
    ['Matcha mango 16 oz', 115, ['Leche alternativa', 'Fruta extra']],
  ];
  const ids = [matcha16, matcha20];
  await db.query("update products set wizard_steps=array['Fruta extra','Leche alternativa'] where id=$1", [matcha16]);
  await db.query("update products set wizard_steps=array['Leche alternativa','Fruta extra'] where id=$1", [matcha20]);
  for (const [name, price, steps] of variants) {
    const id = randomUUID();
    ids.push(id);
    await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,$2,$3,'Bebidas',true,true,$4)", [id, name, price, steps]);
  }
  const foam = randomUUID(), fruit = randomUUID(), standardLala = randomUUID();
  await db.query(`insert into extras(id,name,price,phase,active) values
    ($1,'Cold foam',15,'Cold foam',true),($2,'Fresa extra',15,'Fruta extra',true),($3,'Lala 100',15,'Tipo de Leche',true)`, [foam, fruit, standardLala]);
  const otherFruitDrink = randomUUID();
  await db.query("insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,'Bebida de prueba con fruta',100,'Bebidas',true,true,array['Fruta extra'])", [otherFruitDrink]);
  const beforeRequest = randomUUID();
  const oldOrder = (await staff.query('select pos_checkout($1,$2) result', [beforeRequest, payload(matcha16, [alternativeLala, fruit], 135)])).rows[0].result;
  const updateSql = await readFile(new URL('./november-matcha-extras.sql', import.meta.url), 'utf8');
  await db.query('update extras set price=20 where id=$1', [foam]);
  await assert.rejects(db.query(updateSql), /Revisa el grupo Cold foam/);
  await db.query('rollback');
  assert.equal((await db.query('select price from extras where id=$1', [alternativeLala])).rows[0].price, '15.00');
  await db.query('update extras set price=15 where id=$1', [foam]);

  const catalog = async () => ({
    products: (await db.query('select id, name, price, wizard_steps, catalog_revision from products where id=any($1::uuid[]) order by id', [[...ids, iced, otherFruitDrink]])).rows,
    extras: (await db.query('select id, name, price, phase, active, catalog_revision from extras where id=any($1::uuid[]) order by id', [[foam, fruit, standardLala, alternativeLala]])).rows,
  });
  const before = await catalog();
  await db.query(updateSql);
  const after = await catalog();
  await db.query(updateSql);
  assert.deepEqual(await catalog(), after, 'already applied catalog produces no new revisions');
  for (const previous of before.products) {
    if (!ids.includes(previous.id)) {
      assert.deepEqual(after.products.find(row => row.id === previous.id), previous);
      continue;
    }
    const wizard_steps = previous.wizard_steps.includes('Cold foam')
      ? previous.wizard_steps.filter(step => step !== 'Fruta extra')
      : previous.wizard_steps.map(step => step === 'Fruta extra' ? 'Cold foam' : step);
    assert.deepEqual(after.products.find(row => row.id === previous.id), {
      ...previous, wizard_steps, catalog_revision: String(Number(previous.catalog_revision) + 1),
    });
  }
  for (const previous of before.extras) {
    const expected = previous.id === foam ? { name: 'Cold foam extra' } : previous.id === alternativeLala ? { price: '0.00' } : null;
    assert.deepEqual(after.extras.find(row => row.id === previous.id), expected
      ? { ...previous, ...expected, catalog_revision: String(Number(previous.catalog_revision) + 1) } : previous);
  }

  for (const fn of ['cafe_private.clip_quote', 'cafe_private.phone_catalog_quote', 'pos_checkout']) {
    const client = fn === 'pos_checkout' ? staff : db;
    const result = (await client.query(`select ${fn}($1,$2) result`, [randomUUID(), payload(matcha16, [alternativeLala, foam], 120)])).rows[0].result;
    assert.equal(Number(result.total), 120);
    assert.deepEqual(result.items[0].product.displayExtras.map(extra => [extra.name, Number(extra.price)]), [['Lala 100', 0], ['Cold foam extra', 15]]);
    await assert.rejects(client.query(`select ${fn}($1,$2)`, [randomUUID(), payload(matcha16, [fruit], 120)]), /Extra no permitido/);
  }
  const regular = (await staff.query('select pos_checkout($1,$2) result', [randomUUID(), payload(iced, [standardLala], 110)])).rows[0].result;
  assert.equal(Number(regular.total), 110);
  assert.deepEqual((await staff.query('select pos_checkout($1,$2) result', [beforeRequest, payload(matcha16, [alternativeLala, fruit], 135)])).rows[0].result, oldOrder);
  const checks = 27;
  console.log(`PASS ${checks} November Matcha checks: seven variants, scoped prices, all checkout paths, durable replay and idempotency`);
  return checks;
}
