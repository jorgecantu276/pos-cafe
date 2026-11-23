-- A stale revision is a confirmed no-write business rejection. Keep unknown
-- transaction/transport outcomes pending for replay; do not classify generic
-- 40001 as safe to discard. Replacing the complete bodies preserves the prior
-- request-journal lookup before revision checks and transactional batch rollback.
begin;
select pg_advisory_xact_lock(60281028);

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
      raise exception 'Las existencias cambiaron. Actualiza y revisa el conteo.' using errcode='PIV01';
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

create or replace function public.pos_inventory_set_enabled(p_request uuid,p_enabled boolean,p_revision integer,p_actor uuid default auth.uid()) returns jsonb
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
  if settings.revision<>p_revision then raise exception 'La activación cambió. Actualiza y revisa.' using errcode='PIV01'; end if;
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

notify pgrst,'reload schema';
commit;
