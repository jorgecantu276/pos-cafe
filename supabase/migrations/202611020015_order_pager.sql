-- Manually assigned physical pager; historical receipts remain unchanged.
begin;
alter table public.orders add column pager_number integer check(pager_number between 1 and 30);
create or replace function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.cash_registers; o public.orders; product public.products; extra public.extras; customer public.customers;
  line jsonb; xid text; qty integer; unit numeric; total numeric:=0; preview numeric;
  mxn numeric; usd numeric; received numeric; method text; cid uuid; earned integer:=0;
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
  if method is null or method not in ('efectivo','mixto','tarjeta','otro') then raise exception 'Método inválido'; end if;
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
      if extra.phase in ('Tamaño','Tipo de Leche') and extra.phase=any(phases) then raise exception 'Selecciona una opción por fase'; end if;
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
  received:=round(mxn+usd*r.exchange_rate,2);
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
    update public.customers set points=coalesce(customers.points,0)+earned,total_spent=coalesce(total_spent,0)+total,last_visit=now() where id=cid;
  end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn,pager_number)
    values(r.id,cid,auth.uid(),total,0,total,method,'completed',p_request,p_payload,earned,mxn,usd,r.exchange_rate,case when method in ('efectivo','mixto') then received-total else 0 end,(p_payload->>'pager_number')::integer) returning * into o;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::integer,(line->'product'->>'price')::numeric,
      (line->>'quantity')::integer*(line->'product'->>'price')::numeric,
      concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  update public.orders set receipt_snapshot=jsonb_build_object('pager_number',o.pager_number,'items',lines,'total',o.total,'customer_name',customer_name,'order_type',p_payload->>'order_type','order_note',p_payload->>'order_note','created_at',o.created_at,'payment_method',method,'tender_mxn',mxn,'tender_usd',usd,'exchange_rate',r.exchange_rate,'change_mxn',o.change_mxn) where id=o.id returning * into o;
  return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
end $$;
commit;
