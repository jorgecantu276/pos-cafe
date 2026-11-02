-- Forward-only recovery fixes and reversible activation with stale-write checks.
begin;

create or replace function public.pos_cancel_sale(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into o from public.orders where id=p_order;
  if not found then raise exception 'Venta no disponible'; end if;
  -- A committed cancellation is read-only recovery, including after the corte.
  if o.status='cancelled' then return; end if;
  if o.register_id is not null then
    perform 1 from public.cash_registers where id=o.register_id and status='open' for update;
    if not found then
      -- Closing can have waited for another cancellation to finish first.
      if exists(select 1 from public.orders where id=p_order and status='cancelled') then return; end if;
      raise exception 'El turno está cerrado; requiere conciliación del responsable';
    end if;
  end if;
  select * into o from public.orders where id=p_order for update;
  if o.status='cancelled' then return; end if;
  if o.status<>'completed' then raise exception 'Venta pendiente: requiere conciliación'; end if;
  if o.request_id is not null and o.customer_id is not null then
    update public.customers set points=coalesce(points,0)-coalesce(o.points_awarded,0),total_spent=coalesce(total_spent,0)-o.total where id=o.customer_id;
  end if;
  update public.orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now() where id=p_order;
end $$;

create or replace function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>256000 then raise exception 'Venta inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  perform 1 from public.cash_registers where id=(p_payload->>'register_id')::uuid for update;
  -- This endpoint never reuses a CLIP identity, even if its sale already exists.
  if exists(select 1 from cafe_private.clip_payments where request_id=p_request) then raise exception 'Recupera el pago CLIP desde el POS; no vuelvas a cobrar'; end if;
  select * into o from public.orders where cashier_id=auth.uid() and request_id=p_request;
  if found then
    if o.request_payload is distinct from p_payload then raise exception 'Este cobro corresponde a otra venta'; end if;
    return o.receipt_snapshot||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
  end if;
  if exists(select 1 from cafe_private.clip_payments where actor_id=auth.uid() and state not in ('failed','completed')) then raise exception 'Recupera el pago CLIP desde el POS; no vuelvas a cobrar'; end if;
  if p_payload->>'phone_order_id' is not null then return cafe_private.phone_manual_checkout(p_request,p_payload); end if;
  perform cafe_private.require_order_pager(p_payload);
  return cafe_private.manual_checkout(p_request,p_payload);
end $$;

alter table public.products add column catalog_revision bigint not null default 0;
alter table public.extras add column catalog_revision bigint not null default 0;
alter table public.profiles add column management_revision bigint not null default 0;
create function cafe_private.advance_edit_revision() returns trigger
language plpgsql set search_path='' as $$ begin
  if TG_TABLE_NAME='profiles' then new.management_revision:=old.management_revision+1;
  else new.catalog_revision:=old.catalog_revision+1; end if;
  return new;
end $$;
create trigger product_edit_revision before update on public.products for each row execute function cafe_private.advance_edit_revision();
create trigger extra_edit_revision before update on public.extras for each row execute function cafe_private.advance_edit_revision();
create trigger profile_edit_revision before update on public.profiles for each row execute function cafe_private.advance_edit_revision();
revoke all on function cafe_private.advance_edit_revision() from public,anon,authenticated,service_role;

alter function public.pos_save_catalog(uuid,jsonb) set schema cafe_private;
alter function cafe_private.pos_save_catalog(uuid,jsonb) rename to save_catalog_v13;
revoke all on function cafe_private.save_catalog_v13(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.pos_save_catalog(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior cafe_private.catalog_requests; kind text; target uuid; action text; revision bigint; response jsonb; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload->>'actor_id' is distinct from auth.uid()::text then raise exception 'La sesión cambió. Recupera con el responsable original' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(60281102013);
  select * into prior from cafe_private.catalog_requests where request_id=p_request;
  if found then
    if prior.actor_id<>auth.uid() then raise exception 'Guardado de otro responsable' using errcode='42501'; end if;
    if prior.payload is distinct from p_payload then raise exception 'Este guardado corresponde a otros datos'; end if;
    return prior.result;
  end if;
  kind:=p_payload->>'kind';action:=p_payload->>'action';target:=(p_payload->>'id')::uuid;
  if target is not null then
    if kind='product' then select catalog_revision into revision from public.products where id=target for update;
    elsif kind='extra' then select catalog_revision into revision from public.extras where id=target for update;
    else raise exception 'Operación de catálogo inválida'; end if;
    if not found then raise exception 'El producto o extra ya no existe'; end if;
    -- Legacy 019 saves remain compatible; current editors always send revision.
    if p_payload ? 'revision' or action='reactivate' then
      if jsonb_typeof(p_payload->'revision') is distinct from 'number' or (p_payload->>'revision')::numeric is distinct from revision::numeric then raise exception 'El catálogo cambió. Actualiza antes de guardar'; end if;
    end if;
  end if;
  if action='reactivate' then
    if target is null then raise exception 'Elige un producto o extra'; end if;
    if kind='product' then update public.products set is_active=true where id=target returning catalog_revision into revision;
    else update public.extras set active=true where id=target returning catalog_revision into revision; end if;
    response:=jsonb_build_object('request_id',p_request,'kind',kind,'action',action,'id',target,'revision',revision);
    insert into cafe_private.catalog_requests(request_id,actor_id,payload,result) values(p_request,auth.uid(),p_payload,response);
  else
    response:=cafe_private.save_catalog_v13(p_request,p_payload);
    target:=(response->>'id')::uuid;
    if kind='product' then select catalog_revision into revision from public.products where id=target;
    else select catalog_revision into revision from public.extras where id=target; end if;
    response:=response||jsonb_build_object('revision',revision);
    update cafe_private.catalog_requests set result=response where request_id=p_request;
  end if;
  return response;
end $$;
revoke all on function public.pos_save_catalog(uuid,jsonb) from public,anon,service_role;
grant execute on function public.pos_save_catalog(uuid,jsonb) to authenticated;

create table cafe_private.staff_status_requests (
  request_id uuid primary key,actor_id uuid not null references public.profiles(id),payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
revoke all on cafe_private.staff_status_requests from public,anon,authenticated,service_role;
create function public.pos_set_staff_active(p_request uuid,p_id uuid,p_revision bigint,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior cafe_private.staff_status_requests; profile public.profiles; payload jsonb; result jsonb; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_request is null or p_id is null or p_revision is null or p_active is null then raise exception 'Revisa el usuario y actualiza el equipo'; end if;
  lock table public.profiles in share row exclusive mode;
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  payload:=jsonb_build_object('id',p_id,'revision',p_revision,'active',p_active);
  select * into prior from cafe_private.staff_status_requests where request_id=p_request;
  if found then
    if prior.actor_id<>auth.uid() then raise exception 'Guardado de otro responsable' using errcode='42501'; end if;
    if prior.payload is distinct from payload then raise exception 'Este guardado corresponde a otros datos'; end if;
    return prior.result;
  end if;
  select * into profile from public.profiles where id=p_id;
  if not found then raise exception 'El usuario ya no existe'; end if;
  if profile.management_revision<>p_revision then raise exception 'El equipo cambió. Actualiza antes de guardar'; end if;
  -- Reuse the existing last-admin, drawer, Auth-identity and role checks.
  perform public.pos_manage_profile(p_id,profile.full_name,profile.username,profile.role,profile.avatar_url,p_active);
  select * into profile from public.profiles where id=p_id;
  result:=jsonb_build_object('request_id',p_request,'id',p_id,'is_active',profile.is_active,'management_revision',profile.management_revision);
  insert into cafe_private.staff_status_requests(request_id,actor_id,payload,result) values(p_request,auth.uid(),payload,result);
  return result;
end $$;
revoke all on function public.pos_set_staff_active(uuid,uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.pos_set_staff_active(uuid,uuid,bigint,boolean) to authenticated;
create function public.pos_edit_staff_profile(p_id uuid,p_name text,p_username text,p_role text,p_avatar text,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  lock table public.profiles in share row exclusive mode;
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into profile from public.profiles where id=p_id;
  if not found then raise exception 'El usuario ya no existe'; end if;
  if p_revision is null or profile.management_revision<>p_revision then raise exception 'El equipo cambió. Actualiza antes de guardar'; end if;
  -- Editing name/avatar/role must never reactivate a deactivated account.
  perform public.pos_manage_profile(p_id,p_name,p_username,p_role,p_avatar,profile.is_active);
  return (select jsonb_build_object('id',id,'is_active',is_active,'management_revision',management_revision) from public.profiles where id=p_id);
end $$;
revoke all on function public.pos_edit_staff_profile(uuid,text,text,text,text,bigint) from public,anon,service_role;
grant execute on function public.pos_edit_staff_profile(uuid,text,text,text,text,bigint) to authenticated;

-- Keep the paid preparation action consistent with the linked sale status.
create or replace function public.pos_phone_get(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.pos_phone_print_state(p_id)
$$;
create or replace function public.pos_phone_list(p_status text default 'pending',p_search text default '',p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('pending','paid','cancelled') or p_search is null or length(p_search)>100 then raise exception 'Consulta de pedidos inválida'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p)) from (select p.*,o.status paid_sale_status
    from public.pos_phone_orders p left join public.orders o on o.id=p.paid_order_id
    where p.status=p_status and (p_before is null or p.folio<p_before) and (btrim(p_search)='' or strpos(lower(p.contact_name),lower(btrim(p_search)))>0
      or strpos(p.contact_phone,regexp_replace(p_search,'[^0-9]','','g'))>0 and p_search ~ '[0-9]'
      or p.folio::text=btrim(p_search)) order by p.folio desc limit 200) p),'[]');
end $$;
notify pgrst,'reload schema';
commit;
