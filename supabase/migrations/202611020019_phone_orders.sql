-- Phone orders are preparation promises, never sales until paid at pickup.
begin;
create table public.pos_phone_orders (
  id uuid primary key default gen_random_uuid(), folio bigint generated always as identity unique,
  source text not null default 'phone' check(source='phone'),
  status text not null default 'pending' check(status in ('pending','paid','cancelled')),
  contact_name text not null, contact_phone text not null,
  customer_id uuid references public.customers(id),
  snapshot jsonb not null, revision integer not null default 0,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  paid_order_id uuid unique references public.orders(id), paid_at timestamptz,
  cancelled_by uuid references public.profiles(id), cancelled_at timestamptz, cancel_reason text,
  check((status='paid')=(paid_order_id is not null))
);
create index pos_phone_orders_pending on public.pos_phone_orders(status,created_at,id);
alter table public.pos_phone_orders enable row level security;
revoke all on public.pos_phone_orders from public,anon,authenticated,service_role;
revoke all on sequence public.pos_phone_orders_folio_seq from public,anon,authenticated,service_role;
create table cafe_private.phone_requests (
  actor_id uuid not null references public.profiles(id),request_id uuid not null,
  payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
revoke all on cafe_private.phone_requests from public,anon,authenticated,service_role;
alter table public.orders add column phone_order_id uuid unique references public.pos_phone_orders(id);
alter table public.orders add column order_source text not null default 'in_person' check(order_source in ('in_person','phone'));
alter table public.orders add constraint phone_sale_source check((order_source='phone')=(phone_order_id is not null));

-- One reservation owner, independently of how many payment attempts it needs.
alter table cafe_private.inventory_reservations drop constraint inventory_reservations_pkey;
alter table cafe_private.inventory_reservations alter column request_id drop not null;
alter table cafe_private.inventory_reservations add column phone_order_id uuid references public.pos_phone_orders(id);
alter table cafe_private.inventory_reservations add constraint inventory_reservation_owner check(num_nonnulls(request_id,phone_order_id)=1);
create unique index inventory_clip_reservation on cafe_private.inventory_reservations(request_id,product_id) where request_id is not null;
create unique index inventory_phone_reservation on cafe_private.inventory_reservations(phone_order_id,product_id) where phone_order_id is not null;

create function public.pos_phone_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  return (select to_jsonb(p) from public.pos_phone_orders p where id=p_id);
end $$;
create function public.pos_phone_print_state(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  return (select to_jsonb(p)||jsonb_build_object('paid_sale_status',o.status)
    from public.pos_phone_orders p left join public.orders o on o.id=p.paid_order_id where p.id=p_id);
end $$;
create function public.pos_phone_list(p_status text default 'pending',p_search text default '',p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('pending','paid','cancelled') or p_search is null or length(p_search)>100 then raise exception 'Consulta de pedidos inválida'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p)) from (select * from public.pos_phone_orders
    where status=p_status and (p_before is null or folio<p_before) and (btrim(p_search)='' or strpos(lower(contact_name),lower(btrim(p_search)))>0
      or strpos(contact_phone,regexp_replace(p_search,'[^0-9]','','g'))>0 and p_search ~ '[0-9]'
      or folio::text=btrim(p_search)) order by folio desc limit 200) p),'[]');
end $$;

create function cafe_private.phone_catalog_quote(p_request uuid,p_payload jsonb) returns jsonb
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
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Orden vacía o demasiado grande'; end if;
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
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
  end if;
  return jsonb_build_object('items',lines,'total',total,'customer_name',customer_name,'order_type',p_payload->>'order_type',
    'order_note',p_payload->>'order_note','created_at',now());
end $$;


create function public.pos_phone_save(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior cafe_private.phone_requests; phone public.pos_phone_orders; quote jsonb; line record; i public.pos_inventory_items;
  held integer; enabled boolean; name text; number text; result jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>256000 then raise exception 'Pedido inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phone:'||auth.uid()::text||p_request::text,0));
  select * into prior from cafe_private.phone_requests where actor_id=auth.uid() and request_id=p_request;
  if found then
    if prior.payload is distinct from p_payload then raise exception 'Este guardado corresponde a otro pedido'; end if;
    return prior.result;
  end if;
  name:=btrim(coalesce(p_payload->>'contact_name',''));number:=regexp_replace(coalesce(p_payload->>'contact_phone',''),'[^0-9]','','g');
  if length(name) not between 1 and 120 or length(number) not between 10 and 15 then raise exception 'Escribe el nombre y un teléfono de 10 a 15 dígitos'; end if;
  perform 1 from public.pos_inventory_settings where singleton for share;
  select s.enabled into enabled from public.pos_inventory_settings s where singleton;
  quote:=cafe_private.phone_catalog_quote(p_request,p_payload)||jsonb_build_object('customer_name',name,'source','phone','inventory_reserved',enabled);
  insert into public.pos_phone_orders(contact_name,contact_phone,customer_id,snapshot,created_by)
    values(name,number,nullif(p_payload->>'customer_id','')::uuid,quote,auth.uid()) returning * into phone;
  if enabled then
    for line in select (v->'product'->>'id')::uuid product_id,sum((v->>'quantity')::int)::int quantity from jsonb_array_elements(quote->'items') v group by 1 order by 1 loop
      select * into strict i from public.pos_inventory_items where product_id=line.product_id for update;
      select coalesce(sum(quantity),0) into held from cafe_private.inventory_reservations where product_id=line.product_id;
      if (i.mode='availability' and not i.available) or (i.mode='counted' and i.quantity is not null and i.quantity-held<line.quantity) then raise exception 'Existencias insuficientes para guardar el pedido'; end if;
      insert into cafe_private.inventory_reservations(phone_order_id,product_id,quantity) values(phone.id,line.product_id,line.quantity);
    end loop;
  end if;
  result:=to_jsonb(phone);
  insert into cafe_private.phone_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request,p_payload,result);
  return result;
end $$;

create function cafe_private.phone_payment_quote(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare phone public.pos_phone_orders; r public.cash_registers; total numeric; mxn numeric; usd numeric; received numeric; method text; begin
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
  if method is null or method not in ('efectivo','mixto','tarjeta','otro') then raise exception 'Método inválido'; end if;
  mxn:=(p_payload->>'tender_mxn')::numeric;usd:=(p_payload->>'tender_usd')::numeric;
  if mxn is null or usd is null or mxn::text in ('NaN','Infinity','-Infinity') or usd::text in ('NaN','Infinity','-Infinity') or mxn<0 or usd<0 or mxn>10000000 or usd>1000000 or mxn<>round(mxn,2) or usd<>round(usd,2) then raise exception 'Importe recibido inválido'; end if;
  received:=round(mxn+usd*r.exchange_rate,2);
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  return phone.snapshot||jsonb_build_object('source','phone','phone_order_id',phone.id,'phone_folio',phone.folio,
    'phone_order_revision',phone.revision,'contact_phone',phone.contact_phone,'pager_number',null,'payment_method',method,
    'tender_mxn',mxn,'tender_usd',usd,'exchange_rate',r.exchange_rate,'change_mxn',case when method in ('efectivo','mixto') then received-total else 0 end);
end $$;

create function cafe_private.phone_sale_link() returns trigger
language plpgsql security definer set search_path='' as $$
declare phone public.pos_phone_orders; begin
  if TG_OP='INSERT' then
    if new.request_payload->>'phone_order_id' is null then return new; end if;
    select * into strict phone from public.pos_phone_orders where id=(new.request_payload->>'phone_order_id')::uuid for update;
    if phone.status<>'pending' or (new.request_payload->>'phone_order_revision')::numeric is distinct from phone.revision::numeric then raise exception 'El pedido ya no está pendiente'; end if;
    new.phone_order_id:=phone.id;new.order_source:='phone';new.pager_number:=null;
  elsif new.phone_order_id is not null and new.receipt_snapshot is not null and new.receipt_snapshot is distinct from old.receipt_snapshot then
    update public.pos_phone_orders set status='paid',paid_order_id=new.id,paid_at=new.created_at,revision=revision+1 where id=new.phone_order_id and status='pending';
    if not found then raise exception 'El pedido ya no está pendiente'; end if;
  end if;
  return new;
end $$;
create trigger phone_sale_link before insert on public.orders for each row execute function cafe_private.phone_sale_link();
create trigger phone_sale_finish after update of receipt_snapshot on public.orders for each row execute function cafe_private.phone_sale_link();

create function cafe_private.phone_manual_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare quote jsonb; phone public.pos_phone_orders; o public.orders; line jsonb; earned integer; begin
  if exists(select 1 from cafe_private.abandoned_checkouts where cashier_id=auth.uid() and request_id=p_request) then raise exception 'Este cobro se descartó. Abre el pedido de nuevo'; end if;
  quote:=cafe_private.phone_payment_quote(p_payload);
  select * into strict phone from public.pos_phone_orders where id=(p_payload->>'phone_order_id')::uuid;
  earned:=case when phone.customer_id is null then 0 else floor((quote->>'total')::numeric/10)::int end;
  if phone.customer_id is not null then
    update public.customers set points=coalesce(points,0)+earned,total_spent=coalesce(total_spent,0)+(quote->>'total')::numeric,last_visit=now() where id=phone.customer_id;
  end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn)
    values((p_payload->>'register_id')::uuid,phone.customer_id,auth.uid(),(quote->>'total')::numeric,0,(quote->>'total')::numeric,p_payload->>'payment_method','completed',p_request,p_payload,earned,
      (quote->>'tender_mxn')::numeric,(quote->>'tender_usd')::numeric,(quote->>'exchange_rate')::numeric,(quote->>'change_mxn')::numeric) returning * into o;
  for line in select value from jsonb_array_elements(quote->'items') loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::int,(line->'product'->>'price')::numeric,(line->>'quantity')::int*(line->'product'->>'price')::numeric,
      concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  update public.orders set receipt_snapshot=quote||jsonb_build_object('created_at',o.created_at) where id=o.id returning * into o;
  return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
end $$;

create or replace function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>256000 then raise exception 'Venta inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  perform 1 from public.cash_registers where id=(p_payload->>'register_id')::uuid for update;
  if exists(select 1 from cafe_private.clip_payments where request_id=p_request or (actor_id=auth.uid() and state not in ('failed','completed'))) then raise exception 'Recupera el pago CLIP desde el POS; no vuelvas a cobrar'; end if;
  select * into o from public.orders where cashier_id=auth.uid() and request_id=p_request;
  if found then
    if o.request_payload is distinct from p_payload then raise exception 'Este cobro corresponde a otra venta'; end if;
    return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
  end if;
  if p_payload->>'phone_order_id' is not null then return cafe_private.phone_manual_checkout(p_request,p_payload); end if;
  perform cafe_private.require_order_pager(p_payload);
  return cafe_private.manual_checkout(p_request,p_payload);
end $$;

create or replace function public.pos_clip_prepare(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payment cafe_private.clip_payments; snapshot jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>256000 or p_payload->>'payment_method' is distinct from 'tarjeta' then raise exception 'Solicitud CLIP inválida'; end if;
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

create or replace function cafe_private.consume_product_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.pos_inventory_items; o public.orders; p public.products; actor_name text; held integer; own_held integer;
begin
  perform 1 from public.pos_inventory_settings where singleton for share;
  if not (select enabled from public.pos_inventory_settings where singleton) then return new; end if;
  select * into strict o from public.orders where id=new.order_id;
  if o.request_id is null then return new; end if; -- historical/imported rows
  if o.status<>'completed' or not ((cafe_private.is_staff() and o.cashier_id=auth.uid()) or exists(
    select 1 from cafe_private.clip_payments where request_id=o.request_id and actor_id=o.cashier_id and state in ('dispatching','pending')
  )) then raise exception 'Venta de inventario inválida'; end if;
  perform 1 from public.products where id in(
    select (v->'product'->>'id')::uuid from cafe_private.clip_payments cp,
      lateral jsonb_array_elements(cp.quote->'items') v where cp.request_id=o.request_id
  ) order by id for update;
  select * into strict p from public.products where id=new.product_id for update;
  select * into strict i from public.pos_inventory_items where product_id=new.product_id for update;
  select quantity into own_held from cafe_private.inventory_reservations where (request_id=o.request_id or phone_order_id=o.phone_order_id) and product_id=new.product_id for update;
  if found then
    if own_held<new.quantity then raise exception 'Reserva del pedido insuficiente'; end if;
    if own_held=new.quantity then delete from cafe_private.inventory_reservations where (request_id=o.request_id or phone_order_id=o.phone_order_id) and product_id=new.product_id;
    else update cafe_private.inventory_reservations set quantity=quantity-new.quantity where (request_id=o.request_id or phone_order_id=o.phone_order_id) and product_id=new.product_id; end if;
  elsif o.phone_order_id is not null or exists(select 1 from cafe_private.clip_payments where request_id=o.request_id) then raise exception 'Reserva del pedido no disponible'; end if;
  select coalesce(sum(quantity),0) into held from cafe_private.inventory_reservations where product_id=new.product_id;
  if i.mode='availability' then
    if not i.available then raise exception 'Producto agotado: %',p.name; end if;
  elsif i.quantity is not null then
    if new.quantity is null or new.quantity<=0 or new.quantity<>trunc(new.quantity) or i.quantity-held<new.quantity then raise exception 'Existencias insuficientes: %',p.name; end if;
    select full_name into actor_name from public.profiles where id=o.cashier_id;
    update public.pos_inventory_items set quantity=quantity-new.quantity,revision=revision+1 where product_id=i.product_id;
    insert into public.pos_inventory_movements(product_id,code,product_name,unit,actor_id,actor_name,kind,before_quantity,after_quantity,reason,order_id,sale_item_id)
      values(i.product_id,i.code,p.name,i.unit,o.cashier_id,actor_name,'sale',i.quantity,i.quantity-new.quantity,'Venta',o.id,new.id);
  end if;
  return new;
end $$;

create or replace function cafe_private.reserve_clip_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
declare line record; i public.pos_inventory_items; held integer; begin
  if new.payload->>'phone_order_id' is not null then return new; end if;
  perform 1 from public.pos_inventory_settings where singleton for share;
  if not (select enabled from public.pos_inventory_settings where singleton) then return new; end if;
  perform 1 from public.products where id in(select (v->'product'->>'id')::uuid from jsonb_array_elements(new.quote->'items') v) order by id for update;
  for line in select (v->'product'->>'id')::uuid product_id,sum((v->>'quantity')::int)::int quantity from jsonb_array_elements(new.quote->'items') v group by 1 order by 1 loop
    select * into strict i from public.pos_inventory_items where product_id=line.product_id for update;
    select coalesce(sum(quantity),0) into held from cafe_private.inventory_reservations where product_id=line.product_id;
    if (i.mode='availability' and not i.available) or (i.mode='counted' and i.quantity is not null and i.quantity-held<line.quantity) then
      raise exception 'Existencias insuficientes. Revisa el pedido antes de enviar a CLIP' using errcode='PCL01';
    end if;
    insert into cafe_private.inventory_reservations(request_id,product_id,quantity) values(new.request_id,line.product_id,line.quantity);
  end loop;
  return new;
end $$;


create function cafe_private.phone_inventory_setting_fence() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if new.enabled<>old.enabled and exists(select 1 from public.pos_phone_orders where status='pending') then raise exception 'Cobra o cancela los pedidos por teléfono antes de cambiar el inventario'; end if;
  return new;
end $$;
create trigger phone_inventory_setting_fence before update on public.pos_inventory_settings for each row execute function cafe_private.phone_inventory_setting_fence();

create function public.pos_phone_cancel(p_request uuid,p_id uuid,p_revision integer,p_reason text,p_returns jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare phone public.pos_phone_orders; prior cafe_private.phone_requests; payload jsonb; result jsonb; line jsonb; decision jsonb; amount numeric;
  item record; i public.pos_inventory_items; actor_name text; waste integer; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_id is null or p_revision is null or length(btrim(coalesce(p_reason,''))) not between 1 and 200
    or jsonb_typeof(p_returns) is distinct from 'array' or jsonb_array_length(p_returns)>100 then raise exception 'Revisa el motivo y las cantidades de cancelación'; end if;
  payload:=jsonb_build_object('action','cancel','id',p_id,'revision',p_revision,'reason',p_reason,'returns',p_returns);
  perform pg_advisory_xact_lock(hashtextextended('phone:'||auth.uid()::text||p_request::text,0));
  select * into prior from cafe_private.phone_requests where actor_id=auth.uid() and request_id=p_request;
  if found then
    if prior.payload is distinct from payload then raise exception 'Esta cancelación corresponde a otros datos'; end if;
    return prior.result;
  end if;
  select * into phone from public.pos_phone_orders where id=p_id for update;
  if not found or phone.status<>'pending' or phone.revision<>p_revision then raise exception 'El pedido cambió. Actualiza la lista'; end if;
  if exists(select 1 from cafe_private.clip_payments cp where cp.payload->>'phone_order_id'=p_id::text and cp.state not in ('failed','completed')) then raise exception 'Comprueba el pago CLIP antes de cancelar. No vuelvas a cobrar'; end if;
  if (phone.snapshot->>'inventory_reserved')::boolean then
    if jsonb_array_length(p_returns)<>jsonb_array_length(phone.snapshot->'items') or
      (select count(*)<>count(distinct v->>'line_id') from jsonb_array_elements(p_returns) v) then raise exception 'Indica cuántas unidades vendibles vuelven por cada artículo'; end if;
    for line in select value from jsonb_array_elements(phone.snapshot->'items') loop
      select value into decision from jsonb_array_elements(p_returns) where value->>'line_id'=line->>'id';
      amount:=(decision->>'return_quantity')::numeric;
      if jsonb_typeof(decision->'return_quantity') is distinct from 'number' or amount is null or amount<>trunc(amount) or amount<0 or amount>(line->>'quantity')::int then raise exception 'Cantidad vendible inválida'; end if;
    end loop;
    perform 1 from public.products where id in(select product_id from cafe_private.inventory_reservations where phone_order_id=p_id) order by id for update;
    select full_name into actor_name from public.profiles where id=auth.uid();
    for item in select product_id,quantity from cafe_private.inventory_reservations where phone_order_id=p_id order by product_id for update loop
      select sum((v->>'quantity')::int-(r->>'return_quantity')::int)::int into waste
        from jsonb_array_elements(phone.snapshot->'items') v join jsonb_array_elements(p_returns) r on r->>'line_id'=v->>'id' where (v->'product'->>'id')::uuid=item.product_id;
      select * into strict i from public.pos_inventory_items where product_id=item.product_id for update;
      if waste>0 then
        if i.mode='counted' and i.quantity is not null then update public.pos_inventory_items set quantity=quantity-waste,revision=revision+1 where product_id=i.product_id; end if;
        insert into public.pos_inventory_movements(product_id,code,product_name,unit,actor_id,actor_name,kind,before_quantity,after_quantity,reason,request_id,details)
          select i.product_id,i.code,p.name,i.unit,auth.uid(),actor_name,'waste',i.quantity,
            case when i.mode='counted' and i.quantity is not null then i.quantity-waste else i.quantity end,btrim(p_reason),p_request,
            jsonb_build_object('phone_order_id',p_id,'quantity',waste,'returns',p_returns) from public.products p where p.id=i.product_id;
      end if;
    end loop;
    delete from cafe_private.inventory_reservations where phone_order_id=p_id;
  elsif jsonb_array_length(p_returns)<>0 then raise exception 'Este pedido se guardó sin reserva de inventario'; end if;
  update public.pos_phone_orders set status='cancelled',revision=revision+1,cancelled_by=auth.uid(),cancelled_at=now(),cancel_reason=btrim(p_reason) where id=p_id returning to_jsonb(pos_phone_orders) into result;
  insert into cafe_private.phone_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request,payload,result);
  return result;
end $$;

create or replace function public.pos_inventory_write(p_request uuid,p_changes jsonb,p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; old public.pos_inventory_items; next public.pos_inventory_items;
  prior cafe_private.inventory_requests; p public.products; action text; amount numeric;
  reason text; result jsonb:='[]'; actor_name text;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_actor is distinct from auth.uid() then raise exception 'La sesión cambió. Recupera con el usuario original.' using errcode='42501'; end if;
  if p_request is null or jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) not between 1 and 500 or octet_length(p_changes::text)>300000 then raise exception 'Solicitud de inventario inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||auth.uid()::text||p_request::text,0));
  select * into prior from cafe_private.inventory_requests where actor_id=auth.uid() and request_id=p_request;
  if found then
    if prior.payload is distinct from p_changes then raise exception 'Solicitud reutilizada con otros datos'; end if;
    return prior.result;
  end if;
  if (select count(*)<>count(distinct v->>'product_id') from jsonb_array_elements(p_changes) v) then raise exception 'Producto duplicado'; end if;
  perform 1 from public.products where id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_changes) v) order by id for update;
  select full_name into actor_name from public.profiles where id=auth.uid();
  for c in select value from jsonb_array_elements(p_changes) order by value->>'product_id' loop
    if exists(select 1 from cafe_private.inventory_reservations where product_id=(c->>'product_id')::uuid) then
      raise exception 'Hay un pedido o pago pendiente para este producto. Resuélvelo antes de ajustar existencias';
    end if;
    select * into old from public.pos_inventory_items where product_id=(c->>'product_id')::uuid for update;
    if not found then raise exception 'Producto de inventario no encontrado'; end if;
    if jsonb_typeof(c->'revision') is distinct from 'number' or (c->>'revision')::numeric<>old.revision then
      raise exception 'Las existencias cambiaron. Actualiza y revisa el conteo.' using errcode='40001';
    end if;
    select * into strict p from public.products where id=old.product_id;
    next:=old; action:=c->>'action'; reason:=trim(coalesce(c->>'reason',''));
    if length(reason)>200 then raise exception 'El motivo admite hasta 200 caracteres'; end if;
    if action in ('configure','import') then
      next.mode:=c->>'mode'; next.unit:=c->>'unit';
      if next.mode is null or next.mode not in ('availability','counted') or next.unit is null
        or next.unit not in ('pieza','rebanada','pastel','botella','lata','paquete') then raise exception 'Revisa modo y unidad'; end if;
      if c->>'minimum' is null then next.minimum:=null;
      else
        amount:=(c->>'minimum')::numeric;
        if jsonb_typeof(c->'minimum')<>'number' or amount<>trunc(amount) or amount not between 0 and 1000000 then raise exception 'Mínimo inválido'; end if;
        next.minimum:=amount::integer;
      end if;
      if next.mode<>old.mode or next.unit<>old.unit then next.quantity:=null; next.last_counted_at:=null; end if;
      if action='import' then
        if jsonb_typeof(c->'available') is distinct from 'boolean' then raise exception 'Disponibilidad inválida'; end if;
        next.available:=(c->>'available')::boolean;
        -- Blank CSV quantities preserve an existing count; they never mean zero.
        if c->>'quantity' is not null then
          amount:=(c->>'quantity')::numeric;
          if next.mode<>'counted' or jsonb_typeof(c->'quantity')<>'number' or amount<>trunc(amount) or amount not between 0 and 1000000 then raise exception 'Conteo inválido'; end if;
          next.quantity:=amount::integer; next.last_counted_at:=now();
        end if;
      end if;
      reason:=coalesce(nullif(reason,''),case when action='import' then 'Importación CSV' else 'Configuración de inventario' end);
    elsif action='availability' then
      if old.mode<>'availability' or jsonb_typeof(c->'available') is distinct from 'boolean' then raise exception 'Revisa la disponibilidad'; end if;
      next.available:=(c->>'available')::boolean;
      reason:=case when next.available then 'Disponible' else 'Agotado' end;
    elsif action in ('count','receive','waste') then
      amount:=(c->>'quantity')::numeric;
      if old.mode<>'counted' or jsonb_typeof(c->'quantity') is distinct from 'number' or amount is null
        or amount<>trunc(amount) or amount not between 0 and 1000000 or (action<>'count' and amount=0) then raise exception 'Cantidad inválida'; end if;
      if action<>'count' and old.quantity is null then raise exception 'Registra primero el conteo físico'; end if;
      next.quantity:=case action when 'count' then amount::int when 'receive' then old.quantity+amount::int else old.quantity-amount::int end;
      if next.quantity not between 0 and 1000000 then raise exception 'La cantidad deja existencias fuera de rango'; end if;
      if action='waste' and reason='' then raise exception 'Indica el motivo de la merma'; end if;
      if action='count' then next.last_counted_at:=now(); end if;
      reason:=coalesce(nullif(reason,''),case when action='count' then 'Conteo físico' else 'Entrada de producto' end);
    else raise exception 'Acción de inventario inválida'; end if;
    update public.pos_inventory_items set mode=next.mode,unit=next.unit,quantity=next.quantity,minimum=next.minimum,
      available=next.available,last_counted_at=next.last_counted_at,revision=revision+1 where product_id=old.product_id returning * into next;
    insert into public.pos_inventory_movements(product_id,code,product_name,unit,actor_id,actor_name,kind,before_quantity,after_quantity,reason,request_id,details)
      values(old.product_id,old.code,p.name,next.unit,auth.uid(),actor_name,action,old.quantity,next.quantity,reason,p_request,
        jsonb_build_object('before',jsonb_build_object('mode',old.mode,'unit',old.unit,'minimum',old.minimum,'available',old.available),
          'after',jsonb_build_object('mode',next.mode,'unit',next.unit,'minimum',next.minimum,'available',next.available)));
    result:=result||jsonb_build_array(to_jsonb(next));
  end loop;
  insert into cafe_private.inventory_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request,p_changes,result);
  return result;
end $$;


create or replace function public.pos_inventory_return(p_request uuid,p_order uuid,p_lines jsonb,p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare line jsonb; m public.pos_inventory_movements; i public.pos_inventory_items;
  prior cafe_private.inventory_requests; payload jsonb; amount numeric; already integer; result jsonb:='[]'; actor_name text;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_actor is distinct from auth.uid() then raise exception 'La sesión cambió. Recupera con el usuario original.' using errcode='42501'; end if;
  if p_request is null or p_order is null or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 100 or octet_length(p_lines::text)>30000 then raise exception 'Devolución inválida'; end if;
  payload:=jsonb_build_object('order',p_order,'lines',p_lines);
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||auth.uid()::text||p_request::text,0));
  select * into prior from cafe_private.inventory_requests where actor_id=auth.uid() and request_id=p_request;
  if found then
    if prior.payload is distinct from payload then raise exception 'Solicitud reutilizada con otros datos'; end if;
    return prior.result;
  end if;
  if not exists(select 1 from public.orders where id=p_order and status='cancelled' for update) then raise exception 'Primero cancela la venta'; end if;
  if (select count(*)<>count(distinct v->>'id') from jsonb_array_elements(p_lines) v) then raise exception 'Línea duplicada'; end if;
  perform 1 from public.products where id in(select product_id from public.pos_inventory_movements where order_id=p_order and kind='sale') order by id for update;
  select full_name into actor_name from public.profiles where id=auth.uid();
  for line in select value from jsonb_array_elements(p_lines) order by value->>'id' loop
    select * into m from public.pos_inventory_movements where id=(line->>'id')::bigint and order_id=p_order and kind='sale' for update;
    if not found then raise exception 'Línea de venta inválida'; end if;
    amount:=(line->>'quantity')::numeric;
    if jsonb_typeof(line->'quantity') is distinct from 'number' or amount is null or amount<>trunc(amount) or amount not between 1 and 1000000 then raise exception 'Cantidad de devolución inválida'; end if;
    select coalesce(sum(after_quantity-before_quantity),0) into already from public.pos_inventory_movements where returned_from=m.id;
    if amount+already>m.before_quantity-m.after_quantity then raise exception 'La devolución supera lo vendido'; end if;
    select * into strict i from public.pos_inventory_items where product_id=m.product_id for update;
    if exists(select 1 from cafe_private.inventory_reservations where product_id=m.product_id) then raise exception 'Resuelve el pedido o pago pendiente antes de devolver este producto'; end if;
    if i.mode<>'counted' or i.quantity is null or i.unit<>m.unit then raise exception 'Revisa modo, conteo y unidad antes de devolver'; end if;
    if i.quantity+amount>1000000 then raise exception 'Existencias fuera de rango'; end if;
    update public.pos_inventory_items set quantity=quantity+amount::int,revision=revision+1 where product_id=i.product_id;
    insert into public.pos_inventory_movements(product_id,code,product_name,unit,actor_id,actor_name,kind,before_quantity,after_quantity,reason,request_id,order_id,returned_from)
      values(i.product_id,i.code,m.product_name,i.unit,auth.uid(),actor_name,'return',i.quantity,i.quantity+amount::int,'Producto devuelto en condiciones de venta',p_request,p_order,m.id);
    result:=result||jsonb_build_array(jsonb_build_object('id',m.id,'returned',already+amount::int));
  end loop;
  insert into cafe_private.inventory_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request,payload,result);
  return result;
end $$;

revoke all on function cafe_private.initialize_inventory(),cafe_private.consume_product_inventory() from public,anon,authenticated;

revoke all on function public.pos_phone_get(uuid),public.pos_phone_print_state(uuid),public.pos_phone_list(text,text,bigint),public.pos_phone_save(uuid,jsonb),public.pos_phone_cancel(uuid,uuid,integer,text,jsonb) from public,anon,service_role;
grant execute on function public.pos_phone_get(uuid),public.pos_phone_print_state(uuid),public.pos_phone_list(text,text,bigint),public.pos_phone_save(uuid,jsonb),public.pos_phone_cancel(uuid,uuid,integer,text,jsonb) to authenticated;
revoke all on function cafe_private.phone_catalog_quote(uuid,jsonb),cafe_private.phone_payment_quote(jsonb),cafe_private.phone_sale_link(),cafe_private.phone_manual_checkout(uuid,jsonb),cafe_private.phone_inventory_setting_fence() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
