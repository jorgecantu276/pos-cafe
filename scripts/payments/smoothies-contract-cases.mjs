import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseSmoothiesForm } from '../../lib/smoothies-import.ts';

// Called only on a fresh database in the owned disposable PostgreSQL server.
// Uses the same ordered base + Smoothies migrations as prepare-local (Storage omitted).
export async function smoothiesPaymentContractCases(db, connection, ids) {
  let checks=0;
  const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
  const deny=async(action,pattern)=>{await assert.rejects(action,pattern);checks++;};
  const rpc=async(client,name,args=[]) => (await client.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r;
  const admin=await connection('authenticated',ids.admin),service=await connection('service_role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.admin]);
  const definitions=async()=>(await db.query("select md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','cafe_private') and p.prokind='f'")).rows[0].hash;
  const before=await definitions();
  const source=Object.fromEntries(['small','large','oat','soy'].map(name=>[name,randomUUID()]));
  const file={version:1,menu:[
    {id:source.small,name:'Mango scoped fixture',size:'16 oz',price:85,notes:''},
    {id:source.large,name:'Mango scoped fixture',size:'20 oz',price:100,notes:''},
  ],extras:[
    {id:source.oat,name:'Leche de avena scoped fixture',price:5,scope:'selected',productIds:[source.small]},
    {id:source.soy,name:'Leche de soya scoped fixture',price:7,scope:'all',productIds:[]},
  ],stock:[]};
  const data=parseSmoothiesForm(file);
  equal(await rpc(service,'pos_import_smoothies',[ids.admin,data]),{unchanged:false});
  equal(await rpc(service,'pos_import_smoothies',[ids.admin,data]),{unchanged:true});
  const products=(await db.query('select source_id,product_id from cafe_private.smoothies_product_sources')).rows;
  const extras=(await db.query('select source_id,extra_id from cafe_private.smoothies_extra_sources')).rows;
  const small=products.find(row=>row.source_id===source.small).product_id,large=products.find(row=>row.source_id===source.large).product_id;
  const oat=extras.find(row=>row.source_id===source.oat).extra_id,soy=extras.find(row=>row.source_id===source.soy).extra_id;
  equal((await db.query('select applicable_product_ids from extras where id=$1',[oat])).rows[0].applicable_product_ids,[small]);
  equal(new Set((await db.query('select applicable_product_ids from extras where id=$1',[soy])).rows[0].applicable_product_ids),new Set([small,large]));
  const legacy=randomUUID(),empty=randomUUID(),wrongPhase=randomUUID();
  for(const [id,phase,scope] of [[legacy,'Leche alternativa',null],[empty,'Leche alternativa',[]],[wrongPhase,'Extras',[small]]]) {
    await db.query('insert into extras(id,name,price,phase,active,applicable_product_ids) values($1,$2,3,$3,true,$4)',[id,'Scoped fixture '+id,phase,scope]);
  }
  // The shared migration must not replace Smoothies' peso-only opening or optional pager rules.
  equal((await db.query('select rate from cafe_private.drawer_settings')).rows[0].rate,null);
  const register=await rpc(admin,'pos_open_shift',[randomUUID(),100,1]);equal(Number(register.exchange_rate),1);
  equal((await db.query('select rate from cafe_private.drawer_settings')).rows[0].rate,null);
  const payload=(product,selected,total,method='efectivo')=>({register_id:register.id,items:[{product_id:product,quantity:1,extra_ids:selected,note:''}],
    expected_total:total,payment_method:method,tender_mxn:method==='tarjeta'?0:120,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:''});
  const phonePayload=(product,selected,total)=>({...payload(product,selected,total),contact_name:'Scoped phone fixture',contact_phone:'8682345678'});
  // Scope, cardinality and phase membership must hold in every replaced quote path.
  for(const [product,selected,total,pattern] of [[large,[oat],105,/Extra no permitido/],[small,[oat,soy],97,/opción por fase/],
    [small,[empty],88,/Extra no permitido/],[small,[wrongPhase],88,/Extra no permitido/]]) {
    await deny(rpc(admin,'pos_checkout',[randomUUID(),payload(product,selected,total)]),pattern);
    await deny(rpc(db,'cafe_private.clip_quote',[randomUUID(),payload(product,selected,total,'tarjeta')]),pattern);
    await deny(rpc(admin,'pos_clip_prepare',[randomUUID(),payload(product,selected,total,'tarjeta')]),{code:'PCL01'});
    await deny(rpc(admin,'pos_phone_save',[randomUUID(),phonePayload(product,selected,total)]),pattern);
  }
  equal((await db.query('select count(*)::int n from orders')).rows[0].n,0);
  equal((await db.query('select count(*)::int n from cafe_private.clip_payments')).rows[0].n,0);
  equal((await db.query('select count(*)::int n from pos_phone_orders')).rows[0].n,0);
  const receipts=[];
  receipts.push(await rpc(admin,'pos_checkout',[randomUUID(),payload(small,[oat],90)]));
  receipts.push(await rpc(admin,'pos_checkout',[randomUUID(),payload(large,[soy],107)]));
  receipts.push(await rpc(admin,'pos_checkout',[randomUUID(),payload(large,[legacy],103)]));
  for(const [index,total] of [90,107,103].entries()) {equal(receipts[index].total,total);equal(receipts[index].pager_number,null);}
  const split={...payload(small,[oat],90,'efectivo_tarjeta'),card_amount_mxn:40,tender_mxn:50};
  const splitReceipt=await rpc(admin,'pos_checkout',[randomUUID(),split]);receipts.push(splitReceipt);
  equal(splitReceipt.card_amount_mxn,40);equal(splitReceipt.change_mxn,0);
  const settle=async (request,card)=>{
    await rpc(service,'pos_clip_claim',[request,ids.admin,'SCOPEFIXTURE']);
    const provider='pinpad-'+randomUUID();await rpc(service,'pos_clip_attach',[request,ids.admin,provider]);
    return rpc(service,'pos_clip_settle',[request,ids.admin,provider,'completed',{reference:'pos-'+request,device:'SCOPEFIXTURE',amount_cents:card*100,paid_cents:card*100,
      tip_cents:0,currency:'MXN',status:'COMPLETED',transaction:randomUUID()}]);
  };
  for(const automaticPayload of [payload(small,[oat],90,'tarjeta'),{...payload(large,[soy],107,'efectivo_tarjeta'),card_amount_mxn:70,tender_mxn:50}]) {
    const request=randomUUID();await rpc(admin,'pos_clip_prepare',[request,automaticPayload]);
    const quote=(await rpc(service,'pos_clip_get',[request,ids.admin])).quote;equal(quote.items[0].product.displayExtras.length,1);
    const sale=await settle(request,automaticPayload.card_amount_mxn??automaticPayload.expected_total);receipts.push(sale);
    equal(sale.total,automaticPayload.expected_total);equal(sale.pager_number,null);
  }
  // A valid saved phone quote freezes its chosen extra even if later scoping changes.
  const phone=await rpc(admin,'pos_phone_save',[randomUUID(),phonePayload(small,[oat],90)]);
  await db.query('update extras set applicable_product_ids=$2 where id=$1',[oat,[]]);
  const phonePayment={...split,phone_order_id:phone.id,phone_order_revision:phone.revision};
  const paid=await rpc(admin,'pos_checkout',[randomUUID(),phonePayment]);receipts.push(paid);
  equal(paid.total,90);equal(paid.card_amount_mxn,40);equal(paid.phone_order_id,phone.id);equal(paid.items[0].product.displayExtras[0].id,oat);
  equal((await rpc(admin,'pos_phone_get',[phone.id])).status,'paid');
  const automaticPhone=await rpc(admin,'pos_phone_save',[randomUUID(),phonePayload(large,[soy],107)]);
  const automaticPhonePayment={...payload(large,[soy],107,'efectivo_tarjeta'),card_amount_mxn:70,tender_mxn:50,
    phone_order_id:automaticPhone.id,phone_order_revision:automaticPhone.revision};
  const phoneRequest=randomUUID();await rpc(admin,'pos_clip_prepare',[phoneRequest,automaticPhonePayment]);
  const clipPhone=await settle(phoneRequest,70);receipts.push(clipPhone);
  equal(clipPhone.phone_order_id,automaticPhone.id);equal(clipPhone.card_amount_mxn,70);equal(clipPhone.change_mxn,13);
  const summary=await rpc(admin,'pos_shift_summary',[register.id]);
  const expectedSales=receipts.reduce((sum,sale)=>sum+sale.total,0);
  const expectedCash=receipts.reduce((sum,sale)=>sum+(sale.payment_method==='tarjeta'?0:sale.total-(sale.card_amount_mxn??0)),0);
  equal(summary.total_sales,expectedSales);equal(summary.cash_sales,expectedCash);equal(summary.expected_cash,100+expectedCash);
  const closed=await rpc(admin,'pos_close_shift',[register.id,100+expectedCash,'[]',summary]);equal(closed.payments,summary.payments);equal(closed.difference,0);
  for(const signature of ['cafe_private.manual_checkout(uuid,jsonb)','cafe_private.clip_quote(uuid,jsonb)','cafe_private.phone_catalog_quote(uuid,jsonb)']) {
    const definition=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
    equal((definition.match(/extra\.applicable_product_ids is not null/g)||[]).length,1);
    equal(definition.includes("'Leche alternativa Matcha'"),true);
  }
  equal(await definitions(),before);
  console.log(`PASS ${checks} final Smoothies payment-contract checks: imported eligible extras, one milk, phase membership, NULL/empty scope, peso opening, no pager, manual/Clip split, saved phone quote, cuts and unchanged function signatures`);
  return checks;
}
