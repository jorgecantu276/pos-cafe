-- Cash/card split is distinct from historical `mixto` (MXN + USD cash).
-- Apply deliberately with the matching application; never from the updater.
begin;
select pg_advisory_xact_lock(60281028);
alter table public.orders drop constraint orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check(payment_method in ('efectivo','mixto','tarjeta','otro','cash','card','efectivo_tarjeta'));
alter table public.orders add column card_amount_mxn numeric not null default 0;
alter table public.orders add constraint orders_split_card_amount check (
  card_amount_mxn::text not in ('NaN','Infinity','-Infinity')
  and card_amount_mxn=round(card_amount_mxn,2)
  and ((payment_method='efectivo_tarjeta' and card_amount_mxn>0 and card_amount_mxn<total)
    or (payment_method is distinct from 'efectivo_tarjeta' and card_amount_mxn=0))
);

create function cafe_private.split_card_amount(p_payload jsonb,p_total numeric) returns numeric
language plpgsql immutable set search_path='' as $$
declare card numeric:=coalesce((p_payload->>'card_amount_mxn')::numeric,0); begin
  if card::text in ('NaN','Infinity','-Infinity') or card<>round(card,2) then raise exception 'Importe de tarjeta inválido'; end if;
  if p_payload->>'payment_method'='efectivo_tarjeta' then
    if card<=0 or card>=p_total or (p_payload->>'tender_usd')::numeric is distinct from 0 then
      raise exception 'El pago mixto requiere efectivo MXN y tarjeta, ambos mayores a cero';
    end if;
  elsif card<>0 then raise exception 'Este método no admite un importe parcial de tarjeta'; end if;
  return card;
end $$;
revoke all on function cafe_private.split_card_amount(jsonb,numeric) from public,anon,authenticated,service_role;
create or replace function cafe_private.manual_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.cash_registers; o public.orders; product public.products; extra public.extras; customer public.customers;
  line jsonb; xid text; qty integer; unit numeric; total numeric:=0; preview numeric;
  mxn numeric; usd numeric; received numeric; card numeric; method text; cid uuid; earned integer:=0;
  lines jsonb:='[]'; extra_list jsonb; line_product jsonb;
  note text; phases text[]; customer_name text:='Invitado';
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  select * into o from public.orders where cashier_id=auth.uid() and request_id=p_request;
  if found then
    if o.request_payload is distinct from p_payload then raise exception 'Identidad de venta reutilizada con otros datos'; end if;
    return o.receipt_snapshot || jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
  end if;
  if exists(select 1 from cafe_private.abandoned_checkouts where cashier_id=auth.uid() and request_id=p_request) then raise exception 'Solicitud descartada; no se registró una venta'; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register_id')::uuid and opened_by=auth.uid() for update;
  if not found or r.status<>'open' or r.exchange_rate is null then raise exception 'Abre o recupera tu turno antes de cobrar'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Orden vacía o demasiado grande'; end if;
  method:=p_payload->>'payment_method';
  if method is null or method not in ('efectivo','mixto','tarjeta','otro','efectivo_tarjeta') then raise exception 'Método inválido'; end if;
  if p_payload->'pager_number' is not null and p_payload->'pager_number'<>'null'::jsonb and
    (jsonb_typeof(p_payload->'pager_number')<>'number' or (p_payload->>'pager_number')::numeric<>trunc((p_payload->>'pager_number')::numeric)
    or (p_payload->>'pager_number')::numeric not between 1 and 30) then raise exception 'El control debe ser del 1 al 30'; end if;
  -- Stable locks also protect duplicate product lines within one sale.
  perform 1 from public.products where id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_payload->'items') v) order by id for update;
  for line in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
      or (line->>'quantity')::numeric not between 1 and 1000 then raise exception 'Cantidad inválida'; end if;
    qty:=(line->>'quantity')::integer;
    select * into product from public.products where id=(line->>'product_id')::uuid;
    if not found or product.is_active is not true or product.price is null or product.price<0 or product.price::text='NaN' then raise exception 'Producto no disponible'; end if;
    if jsonb_typeof(line->'extra_ids') is distinct from 'array' or jsonb_array_length(line->'extra_ids')>30 then raise exception 'Extras inválidos'; end if;
    unit:=product.price; extra_list:='[]'; phases:='{}';
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(line->'extra_ids')) then raise exception 'Extra duplicado'; end if;
    for xid in select value from jsonb_array_elements_text(line->'extra_ids') loop
      select * into extra from public.extras where id=xid::uuid for share;
      if not found or extra.active is not true or product.customizable is not true or not coalesce(extra.phase=any(product.wizard_steps),false)
        or extra.price is null or extra.price<0 or extra.price::text='NaN' then raise exception 'Extra no permitido'; end if;
      if extra.phase in ('Tamaño','Tipo de Leche','Leche alternativa','Leche alternativa Matcha') and extra.phase=any(phases) then raise exception 'Selecciona una opción por fase'; end if;
      phases:=array_append(phases,extra.phase); unit:=unit+extra.price;
      extra_list:=extra_list||jsonb_build_array(jsonb_build_object('id',extra.id,'name',extra.name,'phase',extra.phase,'price',extra.price));
    end loop;
    note:=coalesce(line->>'note','');
    if length(note)>1000 then raise exception 'Nota demasiado larga'; end if;
    line_product:=jsonb_build_object('id',product.id,'name',product.name,'price',unit,'basePrice',product.price,'category',product.category,'displayExtras',extra_list,'note',note);
    lines:=lines||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'quantity',qty,'product',line_product));
    total:=total+unit*qty;
  end loop;
  preview:=(p_payload->>'expected_total')::numeric;
  if total<=0 or total>10000000 or preview is null or total<>preview then raise exception 'El catálogo cambió. Revisa la orden antes de cobrar'; end if;
  if length(coalesce(p_payload->>'order_note',''))>1000 or (p_payload->>'order_type') is null or (p_payload->>'order_type') not in ('En Local','Para Llevar') then raise exception 'Datos de preparación inválidos'; end if;
  mxn:=(p_payload->>'tender_mxn')::numeric; usd:=(p_payload->>'tender_usd')::numeric;
  if mxn is null or usd is null or mxn::text in ('NaN','Infinity','-Infinity') or usd::text in ('NaN','Infinity','-Infinity') or mxn<0 or usd<0 or mxn>10000000 or usd>1000000 or mxn<>round(mxn,2) or usd<>round(usd,2) then raise exception 'Importe recibido inválido'; end if;
  card:=cafe_private.split_card_amount(p_payload,total);
  received:=round(mxn+usd*r.exchange_rate,2);
  if method='efectivo_tarjeta' and received+card<total then raise exception 'Efectivo insuficiente para completar el pago mixto'; end if;
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
    update public.customers set points=coalesce(customers.points,0)+earned,total_spent=coalesce(total_spent,0)+total,last_visit=now() where id=cid;
  end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn,pager_number,card_amount_mxn)
    values(r.id,cid,auth.uid(),total,0,total,method,'completed',p_request,p_payload,earned,mxn,usd,r.exchange_rate,case when method in ('efectivo','mixto','efectivo_tarjeta') then received+card-total else 0 end,(p_payload->>'pager_number')::integer,card) returning * into o;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::integer,(line->'product'->>'price')::numeric,
      (line->>'quantity')::integer*(line->'product'->>'price')::numeric,
      concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  update public.orders set receipt_snapshot=jsonb_build_object('pager_number',o.pager_number,'items',lines,'total',o.total,'customer_name',customer_name,'order_type',p_payload->>'order_type','order_note',p_payload->>'order_note','created_at',o.created_at,'payment_method',method,'card_amount_mxn',card,'tender_mxn',mxn,'tender_usd',usd,'exchange_rate',r.exchange_rate,'change_mxn',o.change_mxn) where id=o.id returning * into o;
  return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
end $$;

create or replace function cafe_private.clip_quote(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.cash_registers; o public.orders; product public.products; extra public.extras; customer public.customers;
  line jsonb; xid text; qty integer; unit numeric; total numeric:=0; preview numeric;
  mxn numeric; usd numeric; received numeric; card numeric; method text; cid uuid; earned integer:=0;
  lines jsonb:='[]'; extra_list jsonb; line_product jsonb;
  note text; phases text[]; customer_name text:='Invitado';
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  select * into o from public.orders where cashier_id=auth.uid() and request_id=p_request;
  if found then
    if o.request_payload is distinct from p_payload then raise exception 'Identidad de venta reutilizada con otros datos'; end if;
    return o.receipt_snapshot || jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
  end if;
  if exists(select 1 from cafe_private.abandoned_checkouts where cashier_id=auth.uid() and request_id=p_request) then raise exception 'Solicitud descartada; no se registró una venta'; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register_id')::uuid and opened_by=auth.uid() for update;
  if not found or r.status<>'open' or r.exchange_rate is null then raise exception 'Abre o recupera tu turno antes de cobrar'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Orden vacía o demasiado grande'; end if;
  method:=p_payload->>'payment_method';
  if method is null or method not in ('efectivo','mixto','tarjeta','otro','efectivo_tarjeta') then raise exception 'Método inválido'; end if;
  if p_payload->'pager_number' is not null and p_payload->'pager_number'<>'null'::jsonb and
    (jsonb_typeof(p_payload->'pager_number')<>'number' or (p_payload->>'pager_number')::numeric<>trunc((p_payload->>'pager_number')::numeric)
    or (p_payload->>'pager_number')::numeric not between 1 and 30) then raise exception 'El control debe ser del 1 al 30'; end if;
  -- Stable locks also protect duplicate product lines within one sale.
  perform 1 from public.products where id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_payload->'items') v) order by id for update;
  for line in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
      or (line->>'quantity')::numeric not between 1 and 1000 then raise exception 'Cantidad inválida'; end if;
    qty:=(line->>'quantity')::integer;
    select * into product from public.products where id=(line->>'product_id')::uuid;
    if not found or product.is_active is not true or product.price is null or product.price<0 or product.price::text='NaN' then raise exception 'Producto no disponible'; end if;
    if jsonb_typeof(line->'extra_ids') is distinct from 'array' or jsonb_array_length(line->'extra_ids')>30 then raise exception 'Extras inválidos'; end if;
    unit:=product.price; extra_list:='[]'; phases:='{}';
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(line->'extra_ids')) then raise exception 'Extra duplicado'; end if;
    for xid in select value from jsonb_array_elements_text(line->'extra_ids') loop
      select * into extra from public.extras where id=xid::uuid for share;
      if not found or extra.active is not true or product.customizable is not true or not coalesce(extra.phase=any(product.wizard_steps),false)
        or extra.price is null or extra.price<0 or extra.price::text='NaN' then raise exception 'Extra no permitido'; end if;
      if extra.phase in ('Tamaño','Tipo de Leche','Leche alternativa','Leche alternativa Matcha') and extra.phase=any(phases) then raise exception 'Selecciona una opción por fase'; end if;
      phases:=array_append(phases,extra.phase); unit:=unit+extra.price;
      extra_list:=extra_list||jsonb_build_array(jsonb_build_object('id',extra.id,'name',extra.name,'phase',extra.phase,'price',extra.price));
    end loop;
    note:=coalesce(line->>'note','');
    if length(note)>1000 then raise exception 'Nota demasiado larga'; end if;
    line_product:=jsonb_build_object('id',product.id,'name',product.name,'price',unit,'basePrice',product.price,'category',product.category,'displayExtras',extra_list,'note',note);
    lines:=lines||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'quantity',qty,'product',line_product));
    total:=total+unit*qty;
  end loop;
  preview:=(p_payload->>'expected_total')::numeric;
  if total<=0 or total>10000000 or preview is null or total<>preview then raise exception 'El catálogo cambió. Revisa la orden antes de cobrar'; end if;
  if length(coalesce(p_payload->>'order_note',''))>1000 or (p_payload->>'order_type') is null or (p_payload->>'order_type') not in ('En Local','Para Llevar') then raise exception 'Datos de preparación inválidos'; end if;
  mxn:=(p_payload->>'tender_mxn')::numeric; usd:=(p_payload->>'tender_usd')::numeric;
  if mxn is null or usd is null or mxn::text in ('NaN','Infinity','-Infinity') or usd::text in ('NaN','Infinity','-Infinity') or mxn<0 or usd<0 or mxn>10000000 or usd>1000000 or mxn<>round(mxn,2) or usd<>round(usd,2) then raise exception 'Importe recibido inválido'; end if;
  card:=cafe_private.split_card_amount(p_payload,total);
  received:=round(mxn+usd*r.exchange_rate,2);
  if method='efectivo_tarjeta' and received+card<total then raise exception 'Efectivo insuficiente para completar el pago mixto'; end if;
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
  end if;
  return jsonb_build_object('items',lines,'total',total,'customer_name',customer_name,'order_type',p_payload->>'order_type',
    'order_note',p_payload->>'order_note','created_at',now(),'payment_method',method,'card_amount_mxn',card,'tender_mxn',mxn,'tender_usd',usd,
    'exchange_rate',r.exchange_rate,'change_mxn',case when method='efectivo_tarjeta' then received+card-total else 0 end,'pager_number',(p_payload->>'pager_number')::integer);
end $$;

create or replace function cafe_private.phone_payment_quote(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare phone public.pos_phone_orders; r public.cash_registers; total numeric; mxn numeric; usd numeric; received numeric; card numeric; method text; begin
  select * into r from public.cash_registers where id=(p_payload->>'register_id')::uuid and opened_by=auth.uid() for update;
  if not found or r.status<>'open' or r.exchange_rate is null then raise exception 'Abre o recupera tu turno antes de cobrar'; end if;
  select * into phone from public.pos_phone_orders where id=(p_payload->>'phone_order_id')::uuid for update;
  if not found or phone.status<>'pending' then raise exception 'Este pedido ya se cobró o se canceló. Actualiza la lista'; end if;
  if jsonb_typeof(p_payload->'phone_order_revision') is distinct from 'number' or (p_payload->>'phone_order_revision')::numeric<>phone.revision then raise exception 'El pedido cambió. Actualiza la lista'; end if;
  if p_payload->>'pager_number' is not null then raise exception 'Los pedidos por teléfono se identifican por su folio, sin control'; end if;
  if exists(select 1 from cafe_private.clip_payments where payload->>'phone_order_id'=phone.id::text and state not in ('failed','completed')) then raise exception 'Comprueba el pago CLIP de este pedido. No vuelvas a cobrar'; end if;
  perform 1 from public.products where id in(select (v->'product'->>'id')::uuid from jsonb_array_elements(phone.snapshot->'items') v) order by id for update;
  total:=(phone.snapshot->>'total')::numeric;
  if (p_payload->>'expected_total')::numeric is distinct from total then raise exception 'Revisa el importe guardado del pedido'; end if;
  if nullif(p_payload->>'customer_id','')::uuid is distinct from phone.customer_id then raise exception 'Conserva el cliente del pedido guardado'; end if;
  method:=p_payload->>'payment_method';
  if method is null or method not in ('efectivo','mixto','tarjeta','otro','efectivo_tarjeta') then raise exception 'Método inválido'; end if;
  mxn:=(p_payload->>'tender_mxn')::numeric;usd:=(p_payload->>'tender_usd')::numeric;
  if mxn is null or usd is null or mxn::text in ('NaN','Infinity','-Infinity') or usd::text in ('NaN','Infinity','-Infinity') or mxn<0 or usd<0 or mxn>10000000 or usd>1000000 or mxn<>round(mxn,2) or usd<>round(usd,2) then raise exception 'Importe recibido inválido'; end if;
  card:=cafe_private.split_card_amount(p_payload,total);
  received:=round(mxn+usd*r.exchange_rate,2);
  if method='efectivo_tarjeta' and received+card<total then raise exception 'Efectivo insuficiente para completar el pago mixto'; end if;
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  return phone.snapshot||jsonb_build_object('source','phone','phone_order_id',phone.id,'phone_folio',phone.folio,
    'phone_order_revision',phone.revision,'contact_phone',phone.contact_phone,'pager_number',null,'payment_method',method,
    'card_amount_mxn',card,'tender_mxn',mxn,'tender_usd',usd,'exchange_rate',r.exchange_rate,'change_mxn',case when method in ('efectivo','mixto','efectivo_tarjeta') then received+card-total else 0 end);
end $$;

create or replace function cafe_private.phone_manual_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare quote jsonb; phone public.pos_phone_orders; o public.orders; line jsonb; earned integer; begin
  if exists(select 1 from cafe_private.abandoned_checkouts where cashier_id=auth.uid() and request_id=p_request) then raise exception 'Este cobro se descartó. Abre el pedido de nuevo'; end if;
  quote:=cafe_private.phone_payment_quote(p_payload);
  select * into strict phone from public.pos_phone_orders where id=(p_payload->>'phone_order_id')::uuid;
  earned:=case when phone.customer_id is null then 0 else floor((quote->>'total')::numeric/10)::int end;
  if phone.customer_id is not null then
    update public.customers set points=coalesce(points,0)+earned,total_spent=coalesce(total_spent,0)+(quote->>'total')::numeric,last_visit=now() where id=phone.customer_id;
  end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn,card_amount_mxn)
    values((p_payload->>'register_id')::uuid,phone.customer_id,auth.uid(),(quote->>'total')::numeric,0,(quote->>'total')::numeric,p_payload->>'payment_method','completed',p_request,p_payload,earned,
      (quote->>'tender_mxn')::numeric,(quote->>'tender_usd')::numeric,(quote->>'exchange_rate')::numeric,(quote->>'change_mxn')::numeric,(quote->>'card_amount_mxn')::numeric) returning * into o;
  for line in select value from jsonb_array_elements(quote->'items') loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::int,(line->'product'->>'price')::numeric,(line->>'quantity')::int*(line->'product'->>'price')::numeric,
      concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  update public.orders set receipt_snapshot=quote||jsonb_build_object('created_at',o.created_at) where id=o.id returning * into o;
  return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
end $$;

create or replace function public.pos_clip_prepare(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payment cafe_private.clip_payments; snapshot jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>256000 or coalesce(p_payload->>'payment_method','') not in ('tarjeta','efectivo_tarjeta') then raise exception 'Solicitud CLIP inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  perform 1 from public.cash_registers where id=(p_payload->>'register_id')::uuid for update;
  select * into payment from cafe_private.clip_payments where request_id=p_request;
  if found then
    if payment.actor_id<>auth.uid() then raise exception 'Pago de otro cajero' using errcode='42501'; end if;
    if payment.payload is distinct from p_payload then raise exception 'La identidad del pago cambió'; end if;
    return jsonb_build_object('request_id',p_request,'state',payment.state);
  end if;
  if exists(select 1 from public.orders where cashier_id=auth.uid() and request_id=p_request) then raise exception 'La venta ya existe; recupera su comprobante'; end if;
  if exists(select 1 from cafe_private.clip_payments where actor_id=auth.uid() and state not in ('failed','completed')) then raise exception 'Resuelve el pago CLIP pendiente'; end if;
  begin
    if p_payload->>'phone_order_id' is not null then snapshot:=cafe_private.phone_payment_quote(p_payload);
    else
      perform cafe_private.require_order_pager(p_payload);
      snapshot:=cafe_private.clip_quote(p_request,p_payload);
    end if;
  exception when sqlstate 'P0001' or sqlstate '22P02' or sqlstate '22003' or sqlstate '22023' then
    raise exception 'Revisa el pedido antes de enviar a CLIP' using errcode='PCL01';
  end;
  insert into cafe_private.clip_payments(request_id,actor_id,register_id,payload,quote)
    values(p_request,auth.uid(),(p_payload->>'register_id')::uuid,p_payload,snapshot);
  return jsonb_build_object('request_id',p_request,'state','prepared');
end $$;

create or replace function public.pos_clip_settle(p_request uuid,p_actor uuid,p_provider text,p_outcome text,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p cafe_private.clip_payments; r public.cash_registers; o public.orders; line jsonb; cid uuid; total numeric; charged numeric; earned integer; receipt jsonb; begin
  select register_id into r.id from cafe_private.clip_payments where request_id=p_request and actor_id=p_actor;
  select * into r from public.cash_registers where id=r.id for update;
  select * into p from cafe_private.clip_payments where request_id=p_request and actor_id=p_actor for update;
  if not found then raise exception 'Pago no disponible'; end if;
  if p.state='completed' then return p.result; end if;
  if p.state='failed' then return null; end if;
  if p.state='prepared' then raise exception 'Pago no enviado'; end if;
  if p_outcome='unavailable' and p.provider_id is null and p_evidence=jsonb_build_object('code','ERR10_04') then
    update cafe_private.clip_payments set state='failed',evidence=p_evidence,updated_at=now() where request_id=p_request; return null;
  end if;
  if p.provider_id is distinct from p_provider or p_provider is null then raise exception 'Pago CLIP no vinculado'; end if;
  total:=(p.quote->>'total')::numeric;
  charged:=case when p.quote->>'payment_method'='efectivo_tarjeta' then (p.quote->>'card_amount_mxn')::numeric else total end;
  if p_evidence->>'reference' is distinct from ('pos-'||p_request::text)
    or p_evidence->>'device' is distinct from p.terminal_serial
    or (p_evidence->>'amount_cents')::bigint is distinct from (charged*100)::bigint
    or p_evidence->>'currency' is distinct from 'MXN' then raise exception 'El pago no corresponde al pedido'; end if;
  if p_outcome='failed' and p_evidence->>'status' in ('CANCELED','REJECTED') and (p_evidence->>'paid_cents')::bigint=0 then
    update cafe_private.clip_payments set state='failed',evidence=p_evidence,updated_at=now() where request_id=p_request; return null;
  end if;
  if p_outcome is distinct from 'completed' or coalesce(p_evidence->>'status','') not in ('COMPLETED','APPROVED')
    or (p_evidence->>'paid_cents')::bigint is distinct from (charged*100)::bigint
    or (p_evidence->>'tip_cents')::bigint is distinct from 0 or coalesce(p_evidence->>'transaction','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Aprobación CLIP incompleta'; end if;
  if r.status<>'open' or r.opened_by<>p_actor then raise exception 'Concilia el turno antes de completar el pago recibido'; end if;
  cid:=nullif(p.payload->>'customer_id','')::uuid; earned:=case when cid is null then 0 else floor(total/10)::integer end;
  if cid is not null then update public.customers set points=coalesce(points,0)+earned,total_spent=coalesce(total_spent,0)+total,last_visit=now() where id=cid; end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn,pager_number,card_amount_mxn)
    values(r.id,cid,p_actor,total,0,total,p.quote->>'payment_method','completed',p_request,p.payload,earned,
      (p.quote->>'tender_mxn')::numeric,(p.quote->>'tender_usd')::numeric,(p.quote->>'exchange_rate')::numeric,
      (p.quote->>'change_mxn')::numeric,(p.quote->>'pager_number')::integer,coalesce((p.quote->>'card_amount_mxn')::numeric,0)) returning * into o;
  for line in select value from jsonb_array_elements(p.quote->'items') loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::integer,(line->'product'->>'price')::numeric,
        (line->>'quantity')::integer*(line->'product'->>'price')::numeric,
        concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  receipt:=p.quote||jsonb_build_object('created_at',o.created_at);
  update public.orders set receipt_snapshot=receipt where id=o.id;
  receipt:=receipt||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status','completed');
  update cafe_private.clip_payments set state='completed',provider_transaction=p_evidence->>'transaction',evidence=p_evidence,result=receipt,updated_at=now() where request_id=p_request;
  return receipt;
end $$;

create or replace function public.pos_shift_summary(p_register uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; sales numeric; cash numeric; expense numeric; methods jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  select * into r from public.cash_registers where id=p_register and
    (opened_by=auth.uid() or cafe_private.is_admin()) for share;
  if not found then raise exception 'Turno no disponible' using errcode='42501'; end if;
  select coalesce(sum(total),0),coalesce(sum(case when lower(payment_method) in ('efectivo','mixto','cash') then total when payment_method='efectivo_tarjeta' then total-card_amount_mxn else 0 end),0)
    into sales,cash from public.orders where register_id=r.id and status='completed';
  select coalesce(sum((value->>'amount')::numeric),0) into expense from jsonb_array_elements(r.expenses_detail);
  select coalesce(jsonb_object_agg(method,amount),'{}') into methods from (
    select method,sum(amount) amount from (
      select case when payment_method='efectivo_tarjeta' then 'efectivo' else coalesce(payment_method,'desconocido') end method,
        case when payment_method='efectivo_tarjeta' then total-card_amount_mxn else total end amount
      from public.orders where register_id=r.id and status='completed'
      union all select 'tarjeta',card_amount_mxn from public.orders where register_id=r.id and status='completed' and payment_method='efectivo_tarjeta'
    ) parts group by method
  ) totals;
  return jsonb_build_object('register_id',r.id,'status',r.status,'opened_at',r.opened_at,
    'starting_cash',r.initial_balance,'exchange_rate',r.exchange_rate,'total_sales',sales,'cash_sales',cash,
    'expenses',r.expenses_detail,'expenses_revision',r.expenses_revision,
    'expected_cash',r.initial_balance+cash-expense,'payments',methods);
end $$;

create or replace function public.pos_sales_report(p_period text default 'today',p_from date default null,p_to date default null,
  p_search text default '',p_page integer default 0,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w record; result jsonb; captured timestamptz:=statement_timestamp(); ceiling timestamptz;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>1000000 or p_search is null or length(p_search)>100 then raise exception 'Consulta inválida'; end if;
  if p_as_of is not null and (not isfinite(p_as_of) or p_as_of>captured) then raise exception 'Fecha de consulta inválida'; end if;
  ceiling:=coalesce(p_as_of,captured);
  select * into w from cafe_private.report_window(p_period,p_from,p_to);
  with filtered as materialized (
    select o.* from public.orders o
    where o.created_at<=ceiling and (w.start_at is null or o.created_at>=w.start_at)
      and (w.end_at is null or o.created_at<w.end_at)
      and (btrim(p_search)='' or strpos(lower(o.id::text),lower(btrim(p_search)))>0
        or (ltrim(btrim(p_search),'#')<>'' and strpos(lpad(o.ticket_number::text,greatest(4,length(o.ticket_number::text)),'0'),ltrim(btrim(p_search),'#'))>0)
        or exists(select 1 from public.order_items i left join public.products p on p.id=i.product_id
          where i.order_id=o.id and strpos(lower(coalesce(i.product_snapshot->>'name',p.name,'Producto eliminado')),lower(btrim(p_search)))>0))
  ), summary as (
    select count(*) as rows, count(*) filter(where status='completed') as completed,
      count(*) filter(where status='pending') as pending,
      count(*) filter(where status in ('cancelled','canceled')) as cancelled,
      coalesce(sum(total) filter(where status='completed'),0) as sales,
      coalesce(round(avg(total) filter(where status='completed'),2),0) as average
    from filtered
  ), page as (select * from filtered order by created_at desc,id desc limit 50 offset p_page*50),
  top_products as (
    select coalesce(i.product_snapshot->>'name',p.name,'Producto eliminado') as name,sum(i.quantity) as quantity
    from filtered o join public.order_items i on i.order_id=o.id left join public.products p on p.id=i.product_id
    where o.status='completed' group by 1 order by quantity desc,name limit 3
  ), payments as (
    select case payment_method when 'cash' then 'Efectivo' when 'efectivo' then 'Efectivo'
      when 'card' then 'Tarjeta' when 'tarjeta' then 'Tarjeta' when 'mixto' then 'MXN + USD' else 'Otro' end as name,
      sum(amount) as total from (
        select case when payment_method='efectivo_tarjeta' then 'efectivo' else payment_method end payment_method,
          case when payment_method='efectivo_tarjeta' then total-card_amount_mxn else total end amount from filtered where status='completed'
        union all select 'tarjeta',card_amount_mxn from filtered where status='completed' and payment_method='efectivo_tarjeta'
      ) parts group by 1
  )
  select jsonb_build_object('captured_at',captured,'as_of',ceiling,'day',w.day,'start_at',w.start_at,'end_at',w.end_at,
    'page',p_page,'page_size',50,'summary',(select to_jsonb(s) from summary s),
    'registered_customers',(select count(*) from public.customers),
    'active_products',(select count(*) from public.products where is_active),
    'top_products',coalesce((select jsonb_agg(t order by quantity desc,name) from top_products t),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(t order by total desc,name) from payments t),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('order_items',
      coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('products',jsonb_build_object('name',p.name)) order by i.id)
        from public.order_items i left join public.products p on p.id=i.product_id where i.order_id=o.id),'[]'::jsonb))
      order by o.created_at desc,o.id desc) from page o),'[]'::jsonb)) into result;
  return result;
end $$;

-- Historical cuts keep NULL: their payment breakdown was never recorded.
alter table public.shifts add column payments jsonb;

create or replace function public.pos_close_shift(p_register uuid,p_counted numeric,p_expenses jsonb,p_preview jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; s public.shifts; summary jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  select * into r from public.cash_registers where id=p_register and opened_by=auth.uid() for update;
  if not found then raise exception 'Turno no disponible' using errcode='42501'; end if;
  select * into s from public.shifts where register_id=r.id;
  if found then
    if s.counted_cash is distinct from p_counted or s.expenses_detail is distinct from p_expenses then raise exception 'El turno ya cerró con otro arqueo'; end if;
    return to_jsonb(s);
  end if;
  if r.status<>'open' then raise exception 'El turno ya cerró'; end if;
  if p_counted is null or p_counted::text in ('NaN','Infinity','-Infinity') or p_counted<0
    or p_counted>10000000 or p_counted<>round(p_counted,2) then raise exception 'Arqueo inválido'; end if;
  summary:=public.pos_shift_summary(r.id);
  if p_expenses is distinct from r.expenses_detail or jsonb_typeof(p_preview) is distinct from 'object'
    or p_preview->'expenses_revision' is distinct from summary->'expenses_revision'
    or p_preview->'total_sales' is distinct from summary->'total_sales'
    or p_preview->'cash_sales' is distinct from summary->'cash_sales' then
    raise exception 'El turno cambió desde la vista previa. Actualiza el corte antes de cerrar';
  end if;
  insert into public.shifts(register_id,cashier_id,opened_at,starting_cash,total_sales,total_expenses,expected_cash,counted_cash,difference,expenses_detail,user_name,payments)
    values(r.id,auth.uid(),r.opened_at,r.initial_balance,(summary->>'total_sales')::numeric,
      r.initial_balance+(summary->>'cash_sales')::numeric-(summary->>'expected_cash')::numeric,
      (summary->>'expected_cash')::numeric,p_counted,p_counted-(summary->>'expected_cash')::numeric,
      r.expenses_detail,(select full_name from public.profiles where id=auth.uid()),summary->'payments') returning * into s;
  update public.cash_registers set status='closed',closed_by=auth.uid(),closed_at=now(),final_balance=p_counted where id=r.id;
  return to_jsonb(s);
end $$;

create or replace function public.pos_manager_close_drawer(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; r public.cash_registers; s public.shifts; summary jsonb;
  amount numeric:=(p_payload->>'counted')::numeric; reason text:=trim(coalesce(p_payload->>'reason',''));
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  result:=cafe_private.drawer_replay(p_request,'manager_close',p_payload); if result is not null then return result; end if;
  if p_payload->'count_confirmed' is distinct from 'true'::jsonb or length(reason) not between 3 and 300
    or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>10000000 or amount<>round(amount,2)
    then raise exception 'Cuenta el efectivo y explica por qué el responsable cierra este turno'; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register')::uuid for update;
  if not found or r.status<>'open' then raise exception 'El turno ya no está abierto. Actualiza el estado'; end if;
  if exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null) then raise exception 'Primero resuelve la entrega pendiente'; end if;
  summary:=public.pos_shift_summary(r.id);
  if jsonb_typeof(p_payload->'preview') is distinct from 'object'
    or p_payload->'preview'->'expenses_revision' is distinct from summary->'expenses_revision'
    or p_payload->'preview'->'total_sales' is distinct from summary->'total_sales'
    or p_payload->'preview'->'cash_sales' is distinct from summary->'cash_sales' then
    raise exception 'El turno cambió desde la vista previa. Actualiza antes de cerrar';
  end if;
  insert into public.shifts(register_id,cashier_id,opened_at,starting_cash,total_sales,total_expenses,expected_cash,counted_cash,difference,expenses_detail,user_name,payments)
    values(r.id,r.opened_by,r.opened_at,r.initial_balance,(summary->>'total_sales')::numeric,
      r.initial_balance+(summary->>'cash_sales')::numeric-(summary->>'expected_cash')::numeric,
      (summary->>'expected_cash')::numeric,amount,amount-(summary->>'expected_cash')::numeric,
      r.expenses_detail,(select full_name from public.profiles where id=r.opened_by),summary->'payments') returning * into s;
  update public.cash_registers set status='closed',closed_by=auth.uid(),closed_at=now(),final_balance=amount where id=r.id;
  result:=jsonb_build_object('request_id',p_request,'report',to_jsonb(s),'original_cashier',r.opened_by,'closed_by',auth.uid(),'reason',reason);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'manager_close',p_payload,result,now());
  return result;
end $$;


-- A previously applied isolated Matcha catalog adjustment already enforces one
-- Matcha milk choice. Keep that guard for retained catalogs and fresh databases.
do $milk_guard$
declare definition text;
  old_check constant text := 'extra.phase in (''Tamaño'',''Tipo de Leche'',''Leche alternativa'')';
  new_check constant text := 'extra.phase in (''Tamaño'',''Tipo de Leche'',''Leche alternativa'',''Leche alternativa Matcha'')';
begin
  select pg_get_functiondef('cafe_private.phone_catalog_quote(uuid,jsonb)'::regprocedure) into definition;
  if length(definition)-length(replace(definition,new_check,''))=length(new_check) then
    null; -- The retained catalog adjustment already installed the same check.
  elsif length(definition)-length(replace(definition,old_check,''))=length(old_check) then
    execute replace(definition,old_check,new_check);
  else raise exception 'Unexpected phone milk validation; review before updating'; end if;
end $milk_guard$;

notify pgrst,'reload schema';
commit;
