-- Optional finished-product inventory, integrated after CLIP/pagers. OFF initially.
begin;
select pg_advisory_xact_lock(60281028);

create table public.pos_inventory_items (
  product_id uuid primary key references public.products(id),
  item_number integer generated always as identity unique,
  code text generated always as ('CM-' || lpad(item_number::text, 6, '0')) stored unique,
  mode text not null default 'availability' check(mode in ('availability','counted')),
  unit text not null default 'pieza' check(unit in ('pieza','rebanada','pastel','botella','lata','paquete')),
  quantity integer check(quantity between 0 and 1000000),
  minimum integer check(minimum between 0 and 1000000),
  available boolean not null default true,
  revision integer not null default 0,
  last_counted_at timestamptz
);
create table public.pos_inventory_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.pos_inventory_items(product_id),
  code text not null, product_name text not null, unit text not null,
  actor_id uuid not null references public.profiles(id), actor_name text not null,
  kind text not null check(kind in ('configure','availability','count','receive','waste','import','sale','return')),
  before_quantity integer, after_quantity integer,
  reason text not null, request_id uuid,
  details jsonb not null default '{}',
  order_id uuid references public.orders(id),
  sale_item_id uuid unique references public.order_items(id),
  returned_from bigint references public.pos_inventory_movements(id),
  created_at timestamptz not null default now()
);
create index pos_inventory_movements_product on public.pos_inventory_movements(product_id,id desc);
create index pos_inventory_movements_order on public.pos_inventory_movements(order_id);
create index pos_inventory_movements_returns on public.pos_inventory_movements(returned_from);
create table cafe_private.inventory_requests (
  actor_id uuid not null references public.profiles(id), request_id uuid not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
revoke all on cafe_private.inventory_requests from public,anon,authenticated;
alter table public.pos_inventory_items enable row level security;
alter table public.pos_inventory_movements enable row level security;
revoke all on public.pos_inventory_items,public.pos_inventory_movements from public,anon,authenticated;
revoke all on sequence public.pos_inventory_items_item_number_seq,public.pos_inventory_movements_id_seq from public,anon,authenticated;
grant select on public.pos_inventory_items to authenticated;
create policy inventory_staff_read on public.pos_inventory_items for select to authenticated using(cafe_private.is_staff());

-- Availability is the safe initial state. No legacy balance is copied.
insert into public.pos_inventory_items(product_id) select id from public.products order by id;
create function cafe_private.initialize_inventory() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into public.pos_inventory_items(product_id) values(new.id);
  return new;
end $$;
create trigger initialize_product_inventory after insert on public.products
for each row execute function cafe_private.initialize_inventory();

create function public.pos_inventory_catalog() returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if (select count(*) from public.pos_inventory_items)>5000 then raise exception 'El catálogo supera 5000 productos; requiere paginación'; end if;
  return coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',p.name,'category',p.category,'is_active',p.is_active) order by p.name,p.id)
    from public.pos_inventory_items i join public.products p on p.id=i.product_id),'[]'::jsonb);
end $$;

create function public.pos_inventory_history(p_product uuid default null,p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc) from (
    select m.*,o.ticket_number from public.pos_inventory_movements m left join public.orders o on o.id=m.order_id
    where (p_product is null or m.product_id=p_product) and (p_before is null or m.id<p_before)
    order by m.id desc limit 100) m),'[]'::jsonb);
end $$;

-- All writers lock products in UUID order before touching inventory. A revision
-- prevents a physical count or CSV preview from overwriting a concurrent sale.
create function public.pos_inventory_write(p_request uuid,p_changes jsonb,p_actor uuid default auth.uid()) returns jsonb
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
      raise exception 'Hay un pago CLIP pendiente para este producto. Resuélvelo antes de ajustar existencias';
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

-- Runs inside pos_checkout's existing transaction. A replay inserts no lines,
-- so it cannot decrement twice. Failure anywhere rolls back stock and sale.
create function cafe_private.consume_product_inventory() returns trigger
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
  select quantity into own_held from cafe_private.inventory_reservations where request_id=o.request_id and product_id=new.product_id for update;
  if found then
    if own_held<new.quantity then raise exception 'Reserva CLIP insuficiente'; end if;
    if own_held=new.quantity then delete from cafe_private.inventory_reservations where request_id=o.request_id and product_id=new.product_id;
    else update cafe_private.inventory_reservations set quantity=quantity-new.quantity where request_id=o.request_id and product_id=new.product_id; end if;
  elsif exists(select 1 from cafe_private.clip_payments where request_id=o.request_id) then raise exception 'Reserva CLIP no disponible'; end if;
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
create trigger consume_product_inventory after insert on public.order_items
for each row execute function cafe_private.consume_product_inventory();

create function public.pos_inventory_sale_lines(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
    select m.id,m.product_id,m.product_name,m.unit,m.before_quantity-m.after_quantity as sold,
      coalesce((select sum(r.after_quantity-r.before_quantity) from public.pos_inventory_movements r where r.returned_from=m.id),0)::int as returned
    from public.pos_inventory_movements m join public.orders o on o.id=m.order_id
    where m.order_id=p_order and m.kind='sale' and o.status='cancelled') x),'[]'::jsonb);
end $$;

create function public.pos_inventory_return(p_request uuid,p_order uuid,p_lines jsonb,p_actor uuid default auth.uid()) returns jsonb
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
    if exists(select 1 from cafe_private.inventory_reservations where product_id=m.product_id) then raise exception 'Resuelve el pago CLIP pendiente antes de devolver este producto'; end if;
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
revoke all on function public.pos_inventory_catalog(),public.pos_inventory_history(uuid,bigint),public.pos_inventory_write(uuid,jsonb,uuid),public.pos_inventory_sale_lines(uuid),public.pos_inventory_return(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.pos_inventory_catalog(),public.pos_inventory_history(uuid,bigint),public.pos_inventory_write(uuid,jsonb,uuid),public.pos_inventory_sale_lines(uuid),public.pos_inventory_return(uuid,uuid,jsonb,uuid) to authenticated;
create table public.pos_inventory_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  revision integer not null default 0
);
insert into public.pos_inventory_settings default values;
alter table public.pos_inventory_settings enable row level security;
revoke all on public.pos_inventory_settings from public,anon,authenticated,service_role;
create table cafe_private.inventory_reservations (
  request_id uuid not null references cafe_private.clip_payments(request_id),
  product_id uuid not null references public.pos_inventory_items(product_id),
  quantity integer not null check(quantity>0), primary key(request_id,product_id)
);
create index inventory_reservations_product on cafe_private.inventory_reservations(product_id);
revoke all on cafe_private.inventory_reservations from public,anon,authenticated,service_role;

create function public.pos_inventory_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  return (select jsonb_build_object('enabled',enabled,'revision',revision) from public.pos_inventory_settings where singleton);
end $$;

create function public.pos_inventory_register() returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  return jsonb_build_object('enabled',(select enabled from public.pos_inventory_settings where singleton),'items',
    case when (select enabled from public.pos_inventory_settings where singleton) then coalesce((select jsonb_agg(
      jsonb_build_object('product_id',i.product_id,'mode',i.mode,'quantity',case when i.quantity is null then null else greatest(0,i.quantity-coalesce(r.held,0)) end,
        'available',i.available)) from public.pos_inventory_items i
        left join (select product_id,sum(quantity)::int held from cafe_private.inventory_reservations group by product_id) r using(product_id)),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create function public.pos_inventory_set_enabled(p_request uuid,p_enabled boolean,p_revision integer,p_actor uuid default auth.uid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior cafe_private.inventory_requests; settings public.pos_inventory_settings; payload jsonb; result jsonb; begin
  if not cafe_private.is_admin() or p_actor is distinct from auth.uid() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_request is null or p_enabled is null or p_revision is null then raise exception 'Revisa la activación'; end if;
  payload:=jsonb_build_object('enabled',p_enabled,'revision',p_revision);
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||auth.uid()::text||p_request::text,0));
  select * into prior from cafe_private.inventory_requests where actor_id=auth.uid() and request_id=p_request;
  if found then
    if prior.payload is distinct from payload then raise exception 'Solicitud reutilizada con otros datos'; end if;
    return prior.result;
  end if;
  select * into settings from public.pos_inventory_settings where singleton for update;
  if settings.revision<>p_revision then raise exception 'La activación cambió. Actualiza y revisa.' using errcode='40001'; end if;
  if exists(select 1 from cafe_private.clip_payments where state not in ('failed','completed')) then raise exception 'Resuelve los pagos CLIP pendientes antes de activar o pausar inventario'; end if;
  -- Sales while paused are intentionally untracked. Never reactivate stale counts.
  if p_enabled and not settings.enabled then
    insert into public.pos_inventory_movements(product_id,code,product_name,unit,actor_id,actor_name,kind,before_quantity,after_quantity,reason,request_id)
      select i.product_id,i.code,p.name,i.unit,auth.uid(),u.full_name,'configure',i.quantity,null,'Activación: requiere conteo actualizado',p_request
      from public.pos_inventory_items i join public.products p on p.id=i.product_id join public.profiles u on u.id=auth.uid()
      where i.mode='counted' and i.quantity is not null;
    update public.pos_inventory_items set quantity=null,last_counted_at=null,revision=revision+1 where mode='counted' and quantity is not null;
  end if;
  update public.pos_inventory_settings set enabled=p_enabled,revision=revision+1 where singleton returning jsonb_build_object('enabled',enabled,'revision',revision) into result;
  insert into cafe_private.inventory_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request,payload,result);
  return result;
end $$;

-- Reserve before the provider POST. Unknown acknowledgements keep their hold;
-- only authenticated provider failure releases it, or settlement consumes it.
create function cafe_private.reserve_clip_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
declare line record; i public.pos_inventory_items; held integer; begin
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
create trigger reserve_clip_inventory after insert on cafe_private.clip_payments for each row execute function cafe_private.reserve_clip_inventory();
create function cafe_private.release_clip_inventory() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if new.state in ('failed','completed') then
    perform 1 from public.products where id in(select product_id from cafe_private.inventory_reservations where request_id=new.request_id) order by id for update;
    if new.state='completed' and exists(select 1 from cafe_private.inventory_reservations where request_id=new.request_id) then raise exception 'Quedan reservas CLIP sin liquidar'; end if;
    delete from cafe_private.inventory_reservations where request_id=new.request_id;
  end if;
  return new;
end $$;
create trigger release_clip_inventory after update of state on cafe_private.clip_payments for each row execute function cafe_private.release_clip_inventory();
revoke all on function cafe_private.reserve_clip_inventory(),cafe_private.release_clip_inventory() from public,anon,authenticated,service_role;
revoke all on function public.pos_inventory_state(),public.pos_inventory_register(),public.pos_inventory_set_enabled(uuid,boolean,integer,uuid) from public,anon,service_role;
grant execute on function public.pos_inventory_state(),public.pos_inventory_register(),public.pos_inventory_set_enabled(uuid,boolean,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
