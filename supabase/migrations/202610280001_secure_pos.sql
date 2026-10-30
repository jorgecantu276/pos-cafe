-- Apply with the matching application release, never with the legacy checkout.
begin;
select pg_advisory_xact_lock(60281028);
create schema if not exists cafe_private;
revoke all on schema cafe_private from public, anon, authenticated;
create table cafe_private.abandoned_checkouts (
  cashier_id uuid not null references public.profiles(id),
  request_id uuid not null,
  abandoned_at timestamptz not null default now(),
  primary key(cashier_id,request_id)
);
revoke all on cafe_private.abandoned_checkouts from public,anon,authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated;

alter table public.profiles add column is_active boolean not null default true;
create unique index profiles_login_identity on public.profiles
  (lower(regexp_replace(username, '\s', '', 'g'))) where username is not null;
do $$ begin
  if not exists (select 1 from public.profiles where role = 'admin' and is_active) then
    raise exception 'Preflight: an existing administrator profile is required';
  end if;
  if exists(select 1 from public.products where stock is null or stock<0)
    or exists(select 1 from public.supplies where current_stock is null or current_stock<0 or current_stock::text='NaN') then
    raise exception 'Preflight: reconcile invalid inventory balances using actual counts before migration';
  end if;
end $$;

alter table public.cash_registers add column request_id uuid unique;
alter table public.cash_registers add column exchange_rate numeric(10,4);
create unique index one_open_register_per_cashier on public.cash_registers(opened_by) where status='open';
alter table public.shifts add column register_id uuid unique references public.cash_registers(id);
alter table public.shifts add column cashier_id uuid references public.profiles(id);
alter table public.orders add column request_id uuid;
alter table public.orders add column request_payload jsonb;
alter table public.orders add column receipt_snapshot jsonb;
alter table public.orders add column stock_snapshot jsonb;
alter table public.orders add column points_awarded integer;
alter table public.orders add column tender_mxn numeric(10,2);
alter table public.orders add column tender_usd numeric(10,2);
alter table public.orders add column exchange_rate numeric(10,4);
alter table public.orders add column change_mxn numeric(10,2);
alter table public.orders add column cancelled_by uuid references public.profiles(id);
alter table public.orders add column cancelled_at timestamptz;
create unique index orders_actor_request on public.orders(cashier_id,request_id) where request_id is not null;
create index orders_register_status on public.orders(register_id,status);
alter table public.order_items add column product_snapshot jsonb;
alter table public.products alter column stock set default 0;

-- No client receives direct writes to sales, stock RPCs, profiles or balances.
do $$ declare t record; p record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security',t.tablename);
    execute format('revoke all on table public.%I from public, anon, authenticated',t.tablename);
  end loop;
  for p in select tablename,policyname from pg_policies where schemaname='public' loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end $$;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on function public.decrement_stock(uuid,integer) from public,anon,authenticated;
revoke execute on function public.process_recipe_stock(uuid,integer) from public,anon,authenticated;

create function cafe_private.is_staff() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('admin','barista','cashier'))
$$;
create function cafe_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='admin')
$$;
revoke all on all functions in schema cafe_private from public,anon,authenticated;
grant usage on schema cafe_private to authenticated;
grant execute on function cafe_private.is_staff(),cafe_private.is_admin() to authenticated;

create function public.pos_login_profiles() returns table(id uuid,full_name text,username text,avatar_url text)
language sql stable security definer set search_path='' as $$
  select id,full_name,username,avatar_url from public.profiles
  where is_active and role in ('admin','barista','cashier') and username is not null order by full_name
$$;
revoke all on function public.pos_login_profiles() from public;
grant execute on function public.pos_login_profiles() to anon,authenticated;
grant select(id,full_name,username,role,avatar_url,is_active) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (cafe_private.is_admin() or (id=auth.uid() and is_active));

do $$ declare n text; begin
  foreach n in array array['categories','products','extras','modifier_groups','modifier_options','product_modifier_groups'] loop
    execute format('grant select,insert,update,delete on public.%I to authenticated',n);
    execute format('create policy staff_read on public.%I for select to authenticated using (cafe_private.is_staff())',n);
    execute format('create policy admin_write on public.%I for all to authenticated using (cafe_private.is_admin()) with check (cafe_private.is_admin())',n);
  end loop;
  foreach n in array array['supplies','product_recipes','inventory_items','recipes','coupons'] loop
    execute format('grant select,insert,update,delete on public.%I to authenticated',n);
    execute format('create policy admin_only on public.%I for all to authenticated using (cafe_private.is_admin()) with check (cafe_private.is_admin())',n);
  end loop;
end $$;
grant select on public.customers,public.orders,public.order_items,public.order_item_modifiers,public.cash_registers,public.shifts to authenticated;
create policy customers_read on public.customers for select to authenticated using(cafe_private.is_staff());
create policy orders_read on public.orders for select to authenticated using(cafe_private.is_admin() or (cafe_private.is_staff() and cashier_id=auth.uid()));
create policy items_read on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
create policy modifiers_read on public.order_item_modifiers for select to authenticated using(exists(select 1 from public.order_items i where i.id=order_item_id));
create policy registers_read on public.cash_registers for select to authenticated using(cafe_private.is_admin() or (cafe_private.is_staff() and opened_by=auth.uid()));
create policy shifts_read on public.shifts for select to authenticated using(cafe_private.is_admin() or (cafe_private.is_staff() and cashier_id=auth.uid()));

create function public.pos_manage_profile(p_id uuid,p_name text,p_username text,p_role text,p_avatar text,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare old public.profiles; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  lock table public.profiles in share row exclusive mode;
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into strict old from public.profiles where id=p_id;
  if p_username is distinct from old.username then raise exception 'El usuario de acceso no se puede cambiar; conserva su identidad de Auth'; end if;
  if p_role is null or p_role not in ('admin','barista','cashier') or p_active is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Perfil inválido'; end if;
  if old.role='admin' and old.is_active and (p_role<>'admin' or not p_active)
    and not exists(select 1 from public.profiles where id<>p_id and role='admin' and is_active) then raise exception 'No se puede desactivar el último administrador'; end if;
  update public.profiles set full_name=trim(p_name),role=p_role,avatar_url=p_avatar,is_active=p_active where id=p_id;
end $$;

create function public.pos_register_customer(p_name text,p_phone text,p_birth_date date,p_promos boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.customers; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if length(trim(p_name)) not between 1 and 150 or length(p_phone)>30 or p_birth_date>current_date then raise exception 'Cliente inválido'; end if;
  insert into public.customers(name,phone,birth_date,accept_promos,points,customer_code)
    values(trim(p_name),nullif(trim(p_phone),''),p_birth_date,coalesce(p_promos,false),50,'AA-'||replace(gen_random_uuid()::text,'-','')) returning * into c;
  return to_jsonb(c);
end $$;

create function public.pos_open_shift(p_request uuid,p_cash numeric,p_rate numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_cash is null or p_cash::text in ('NaN','Infinity','-Infinity') or p_cash<0 or p_cash>10000000 or p_cash<>round(p_cash,2)
    or p_rate is null or p_rate::text in ('NaN','Infinity','-Infinity') or p_rate<=0 or p_rate>1000 or p_rate<>round(p_rate,4) then raise exception 'Apertura inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into r from public.cash_registers where request_id=p_request;
  if found then
    if r.opened_by<>auth.uid() or r.initial_balance<>p_cash or r.exchange_rate<>p_rate then raise exception 'Identidad de apertura reutilizada'; end if;
    return to_jsonb(r);
  end if;
  if exists(select 1 from public.cash_registers where opened_by=auth.uid() and status='open') then raise exception 'Ya existe un turno abierto; recarga para recuperarlo'; end if;
  insert into public.cash_registers(opened_by,initial_balance,exchange_rate,request_id) values(auth.uid(),p_cash,p_rate,p_request) returning * into r;
  return to_jsonb(r);
end $$;

-- One statement/transaction: locks serialize register close, replay, stock and points.
create function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.cash_registers; o public.orders; product public.products; extra public.extras; customer public.customers;
  line jsonb; xid text; qty integer; unit numeric; total numeric:=0; preview numeric;
  mxn numeric; usd numeric; received numeric; method text; cid uuid; earned integer:=0;
  lines jsonb:='[]'; stocks jsonb:='[]'; extra_list jsonb; line_product jsonb;
  need record; note text; phases text[]; customer_name text:='Invitado';
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
  -- Stable locks also protect duplicate product lines within one sale.
  lock table public.product_recipes in share mode;
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
  for need in select p.id,sum((v->>'quantity')::integer) qty from jsonb_array_elements(p_payload->'items') v join public.products p on p.id=(v->>'product_id')::uuid group by p.id order by p.id loop
    if (select coalesce(stock,0)<need.qty from public.products where id=need.id) then raise exception 'Stock insuficiente de producto'; end if;
    update public.products set stock=stock-need.qty where id=need.id;
    stocks:=stocks||jsonb_build_array(jsonb_build_object('kind','product','id',need.id,'quantity',need.qty));
  end loop;
  perform 1 from public.supplies where id in(select pr.supply_id from public.product_recipes pr where pr.product_id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_payload->'items') v)) order by id for update;
  for need in select pr.supply_id id,sum(pr.quantity_required*(v->>'quantity')::integer) qty,
    bool_and(pr.quantity_required>0 and pr.quantity_required::text<>'NaN') valid
    from jsonb_array_elements(p_payload->'items') v join public.product_recipes pr on pr.product_id=(v->>'product_id')::uuid group by pr.supply_id order by pr.supply_id loop
    if need.id is null or need.valid is not true or not exists(select 1 from public.supplies where id=need.id and current_stock::text<>'NaN' and current_stock>=need.qty) then raise exception 'Stock o receta de ingrediente inválido'; end if;
    update public.supplies set current_stock=current_stock-need.qty where id=need.id;
    stocks:=stocks||jsonb_build_array(jsonb_build_object('kind','supply','id',need.id,'quantity',need.qty));
  end loop;
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
    update public.customers set points=coalesce(customers.points,0)+earned,total_spent=coalesce(total_spent,0)+total,last_visit=now() where id=cid;
  end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,stock_snapshot,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn)
    values(r.id,cid,auth.uid(),total,0,total,method,'completed',p_request,p_payload,stocks,earned,mxn,usd,r.exchange_rate,case when method in ('efectivo','mixto') then received-total else 0 end) returning * into o;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::integer,(line->'product'->>'price')::numeric,
      (line->>'quantity')::integer*(line->'product'->>'price')::numeric,
      concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  update public.orders set receipt_snapshot=jsonb_build_object('items',lines,'total',o.total,'customer_name',customer_name,'order_type',p_payload->>'order_type','order_note',p_payload->>'order_note','created_at',o.created_at,'payment_method',method,'tender_mxn',mxn,'tender_usd',usd,'exchange_rate',r.exchange_rate,'change_mxn',o.change_mxn) where id=o.id returning * into o;
  return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
end $$;

-- A tombstone serializes abandonment with checkout, including delayed network
-- requests. Existing committed sales can only be recovered, never abandoned.
create function public.pos_abandon_checkout(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  if exists(select 1 from public.orders where cashier_id=auth.uid() and request_id=p_request) then raise exception 'La venta existe. Usa recuperar venta antes de continuar'; end if;
  insert into cafe_private.abandoned_checkouts(cashier_id,request_id) values(auth.uid(),p_request) on conflict do nothing;
end $$;

create function public.pos_close_shift(p_register uuid,p_counted numeric,p_expenses jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; s public.shifts; sales numeric; cash numeric; expense numeric; entry jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  select * into r from public.cash_registers where id=p_register and opened_by=auth.uid() for update;
  if not found then raise exception 'Turno no disponible'; end if;
  select * into s from public.shifts where register_id=r.id;
  if found then
    if s.counted_cash is distinct from p_counted or s.expenses_detail is distinct from p_expenses then raise exception 'El turno ya cerró con otro arqueo'; end if;
    return to_jsonb(s);
  end if;
  if r.status<>'open' then raise exception 'Turno cerrado'; end if;
  if p_counted is null or p_counted::text in ('NaN','Infinity','-Infinity') or p_counted<0 or p_counted>10000000 or p_counted<>round(p_counted,2) or jsonb_typeof(p_expenses) is distinct from 'array' or jsonb_array_length(p_expenses)>100 then raise exception 'Arqueo inválido'; end if;
  expense:=0;
  for entry in select value from jsonb_array_elements(p_expenses) loop
    if jsonb_typeof(entry->'amount') is distinct from 'number' or length(trim(entry->>'desc')) not between 1 and 200 or entry->>'desc' is null
      or (entry->>'amount')::numeric<=0 or (entry->>'amount')::numeric>1000000 or (entry->>'amount')::numeric<>round((entry->>'amount')::numeric,2) then raise exception 'Gasto inválido'; end if;
    expense:=expense+(entry->>'amount')::numeric;
  end loop;
  select coalesce(sum(total),0),coalesce(sum(total) filter(where payment_method in ('efectivo','mixto','cash')),0) into sales,cash from public.orders where register_id=r.id and status='completed';
  insert into public.shifts(register_id,cashier_id,opened_at,starting_cash,total_sales,total_expenses,expected_cash,counted_cash,difference,expenses_detail,user_name)
    values(r.id,auth.uid(),r.opened_at,r.initial_balance,sales,expense,r.initial_balance+cash-expense,p_counted,p_counted-(r.initial_balance+cash-expense),p_expenses,(select full_name from public.profiles where id=auth.uid())) returning * into s;
  update public.cash_registers set status='closed',closed_by=auth.uid(),closed_at=now(),final_balance=p_counted where id=r.id;
  return to_jsonb(s);
end $$;

-- Cancellation preserves the owner's existing status-only stock policy. It
-- never claims a physical refund or returns ingredients already prepared.
create function public.pos_cancel_sale(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into o from public.orders where id=p_order;
  if o.register_id is not null then
    perform 1 from public.cash_registers where id=o.register_id and status='open' for update;
    if not found then raise exception 'El turno está cerrado; requiere conciliación del responsable'; end if;
  end if;
  select * into o from public.orders where id=p_order for update;
  if not found then raise exception 'Venta no disponible'; end if;
  if o.status='cancelled' then return; end if;
  if o.status<>'completed' then raise exception 'Venta pendiente: requiere conciliación'; end if;
  if o.request_id is not null and o.customer_id is not null then
    update public.customers set points=coalesce(points,0)-coalesce(o.points_awarded,0),total_spent=coalesce(total_spent,0)-o.total where id=o.customer_id;
  end if;
  update public.orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where id=p_order;
end $$;

revoke all on function public.pos_manage_profile(uuid,text,text,text,text,boolean),public.pos_register_customer(text,text,date,boolean),public.pos_open_shift(uuid,numeric,numeric),public.pos_checkout(uuid,jsonb),public.pos_abandon_checkout(uuid),public.pos_close_shift(uuid,numeric,jsonb),public.pos_cancel_sale(uuid) from public,anon;
grant execute on function public.pos_manage_profile(uuid,text,text,text,text,boolean),public.pos_register_customer(text,text,date,boolean),public.pos_open_shift(uuid,numeric,numeric),public.pos_checkout(uuid,jsonb),public.pos_abandon_checkout(uuid),public.pos_close_shift(uuid,numeric,jsonb),public.pos_cancel_sale(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
