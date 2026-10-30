begin;

-- Explicit owner choices, initially empty. Sales never change their order.
create table cafe_private.register_shortcuts (
  singleton boolean primary key default true check(singleton),
  product_ids uuid[] not null default '{}' check(cardinality(product_ids)<=8),
  revision integer not null default 0 check(revision>=0),
  updated_by uuid references public.profiles(id), updated_at timestamptz
);
insert into cafe_private.register_shortcuts(singleton) values(true);
create table cafe_private.register_shortcut_requests (
  request_id uuid primary key, actor_id uuid not null references public.profiles(id),
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
revoke all on cafe_private.register_shortcuts,cafe_private.register_shortcut_requests from public,anon,authenticated;

create function public.get_register_shortcuts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  return (select jsonb_build_object('product_ids',product_ids,'revision',revision) from cafe_private.register_shortcuts where singleton=true);
end $$;

create function public.pos_set_register_shortcuts(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous cafe_private.register_shortcut_requests; settings cafe_private.register_shortcuts;
  chosen uuid[]; result jsonb; expected integer;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_payload->>'actor_id' is distinct from auth.uid()::text then
    raise exception 'La sesión cambió. Recupera los favoritos con el responsable original' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(60281030010);
  select * into previous from cafe_private.register_shortcut_requests where request_id=p_request;
  if found then
    if previous.actor_id<>auth.uid() then raise exception 'La solicitud pertenece a otro responsable' using errcode='42501'; end if;
    if previous.payload is distinct from p_payload then raise exception 'Solicitud reutilizada con otros favoritos'; end if;
    return previous.result;
  end if;
  if jsonb_typeof(p_payload->'product_ids') is distinct from 'array'
    or jsonb_array_length(p_payload->'product_ids')>8
    or jsonb_typeof(p_payload->'revision') is distinct from 'number'
    or (p_payload->>'revision') !~ '^[0-9]+$' then
    raise exception 'Elige hasta 8 productos activos y actualiza antes de guardar';
  end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'product_ids') value where jsonb_typeof(value)<>'string') then
    raise exception 'Elige productos válidos';
  end if;
  select coalesce(array_agg(value::uuid order by position),'{}') into chosen
    from jsonb_array_elements_text(p_payload->'product_ids') with ordinality as selection(value,position);
  if cardinality(chosen)<>(select count(distinct value) from unnest(chosen) value) then raise exception 'No repitas productos favoritos'; end if;
  -- Lock selected products while validating so deactivation cannot race the save.
  perform id from public.products where id=any(chosen) order by id for share;
  if cardinality(chosen)<>(select count(*) from public.products where id=any(chosen) and is_active=true) then
    raise exception 'Algún producto ya no está activo. Actualiza y revisa los favoritos';
  end if;
  expected:=(p_payload->>'revision')::integer;
  select * into settings from cafe_private.register_shortcuts where singleton=true for update;
  if not found then raise exception 'Falta la configuración de favoritos'; end if;
  if settings.revision<>expected then raise exception 'Los favoritos cambiaron en otra ventana. Actualiza antes de guardar'; end if;
  update cafe_private.register_shortcuts set product_ids=chosen,revision=revision+1,updated_by=auth.uid(),updated_at=now()
    where singleton=true returning * into settings;
  result:=jsonb_build_object('request_id',p_request,'product_ids',settings.product_ids,'revision',settings.revision);
  insert into cafe_private.register_shortcut_requests(request_id,actor_id,payload,result) values(p_request,auth.uid(),p_payload,result);
  return result;
end $$;
revoke all on function public.get_register_shortcuts(),public.pos_set_register_shortcuts(uuid,jsonb) from public,anon;
grant execute on function public.get_register_shortcuts(),public.pos_set_register_shortcuts(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
