begin;

create table cafe_private.catalog_requests (
  request_id uuid primary key, actor_id uuid not null references public.profiles(id),
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
revoke all on cafe_private.catalog_requests from public,anon,authenticated;

create function public.pos_save_catalog(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous cafe_private.catalog_requests; target uuid; kind text; action text; fields jsonb;
  item_name text; item_price numeric; group_name text; steps text[]; result jsonb;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->>'actor_id' is distinct from auth.uid()::text then
    raise exception 'La sesión cambió. Recupera el guardado con el responsable original' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(60281102013);
  select * into previous from cafe_private.catalog_requests where request_id=p_request;
  if found then
    if previous.actor_id<>auth.uid() then raise exception 'La solicitud pertenece a otro responsable' using errcode='42501'; end if;
    if previous.payload is distinct from p_payload then raise exception 'Solicitud reutilizada con otros datos'; end if;
    return previous.result;
  end if;
  kind:=p_payload->>'kind'; action:=p_payload->>'action'; fields:=p_payload->'fields';
  if kind is null or kind not in ('product','extra') or action is null or action not in ('save','deactivate') then
    raise exception 'Operación de catálogo inválida';
  end if;
  target:=(p_payload->>'id')::uuid;
  if action='deactivate' then
    if target is null then raise exception 'Elige un producto o extra'; end if;
    if kind='product' then
      update public.products set is_active=false where id=target;
    else
      update public.extras set active=false where id=target;
    end if;
    if not found then raise exception 'El producto o extra ya no existe'; end if;
  else
    if jsonb_typeof(fields) is distinct from 'object'
      or jsonb_typeof(fields->'name') is distinct from 'string'
      or jsonb_typeof(fields->'price') is distinct from 'number' then raise exception 'Revisa nombre y precio'; end if;
    item_name:=btrim(fields->>'name'); item_price:=(fields->>'price')::numeric;
    group_name:=btrim(fields->>case when kind='product' then 'category' else 'phase' end);
    if length(item_name) not between 1 and 200 or item_price<0 or item_price>1000000 or round(item_price,2)<>item_price
      or group_name is null or length(group_name) not between 1 and 100 then raise exception 'Revisa nombre, precio y grupo'; end if;
    if kind='product' then
      if jsonb_typeof(fields->'customizable') is distinct from 'boolean'
        or jsonb_typeof(fields->'wizard_steps') is distinct from 'array'
        or jsonb_array_length(fields->'wizard_steps')>30
        or length(coalesce(fields->>'image_url',''))>2048 then raise exception 'Revisa las opciones de preparación y la foto'; end if;
      if exists(select 1 from jsonb_array_elements(fields->'wizard_steps') value
        where jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 100) then
        raise exception 'Revisa los grupos de preparación';
      end if;
      select coalesce(array_agg(value order by position),'{}') into steps
        from jsonb_array_elements_text(fields->'wizard_steps') with ordinality as options(value,position);
      if not (fields->>'customizable')::boolean then steps:='{}'; end if;
      if target is null then
        insert into public.products(name,price,category,customizable,image_url,wizard_steps,is_active)
          values(item_name,item_price,group_name,(fields->>'customizable')::boolean,coalesce(fields->>'image_url',''),steps,true) returning id into target;
      else
        update public.products set name=item_name,price=item_price,category=group_name,
          customizable=(fields->>'customizable')::boolean,image_url=coalesce(fields->>'image_url',''),wizard_steps=steps where id=target;
        if not found then raise exception 'El producto ya no existe'; end if;
      end if;
    else
      if target is null then
        insert into public.extras(name,price,phase,active) values(item_name,item_price,group_name,true) returning id into target;
      else
        update public.extras set name=item_name,price=item_price,phase=group_name where id=target;
        if not found then raise exception 'El extra ya no existe'; end if;
      end if;
    end if;
  end if;
  result:=jsonb_build_object('request_id',p_request,'kind',kind,'action',action,'id',target);
  insert into cafe_private.catalog_requests(request_id,actor_id,payload,result) values(p_request,auth.uid(),p_payload,result);
  return result;
end $$;
revoke all on function public.pos_save_catalog(uuid,jsonb) from public,anon;
grant execute on function public.pos_save_catalog(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
