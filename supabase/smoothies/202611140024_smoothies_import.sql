begin;

-- NULL keeps the existing catalog behavior. Imported extras carry an explicit
-- list of eligible presentations, including when they apply to the whole form.
alter table public.extras add column applicable_product_ids uuid[];

do $migration$
declare
  signature text;
  definition text;
  old_check constant text := 'not coalesce(extra.phase=any(product.wizard_steps),false)';
begin
  foreach signature in array array[
    'cafe_private.manual_checkout(uuid,jsonb)',
    'cafe_private.clip_quote(uuid,jsonb)',
    'cafe_private.phone_catalog_quote(uuid,jsonb)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    if length(definition)-length(replace(definition,old_check,'')) <> length(old_check) then
      raise exception 'Revisa el filtro de extras de %',signature;
    end if;
    execute replace(definition,old_check,old_check ||
      ' or (extra.applicable_product_ids is not null and not (product.id=any(extra.applicable_product_ids)))');
  end loop;
end $migration$;

create table cafe_private.smoothies_product_sources (
  source_id text primary key,
  product_id uuid not null unique references public.products(id)
);
create table cafe_private.smoothies_extra_sources (
  source_id text primary key,
  extra_id uuid not null unique references public.extras(id)
);
create table cafe_private.smoothies_opening_plan (
  source_id text primary key,
  name text not null,
  unit text not null,
  planned_quantity numeric(10,3),
  purchase_pack text not null,
  purchase_cost numeric(10,2),
  listed boolean not null default true
);
create table cafe_private.smoothies_imports (
  digest text primary key,
  imported_by uuid not null,
  imported_at timestamptz not null default now(),
  palette jsonb not null
);
revoke all on cafe_private.smoothies_product_sources,cafe_private.smoothies_extra_sources,
  cafe_private.smoothies_opening_plan,cafe_private.smoothies_imports from public,anon,authenticated;

-- The local application validates and resolves the file before calling this
-- service-only function. One transaction covers the catalog and opening plan.
create function public.pos_import_smoothies(p_actor uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  fingerprint text := encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
  row_data jsonb;
  target_id uuid;
  eligible_ids uuid[];
  steps text[];
begin
  if to_regclass('smoothies_local.identity') is null then
    raise exception 'El importador requiere la base local de smoothies.';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active for share) then
    raise exception 'Acceso exclusivo del administrador.';
  end if;
  perform pg_advisory_xact_lock(810192418);
  if exists(select 1 from cafe_private.smoothies_imports where digest=fingerprint) then
    return jsonb_build_object('unchanged',true);
  end if;

  -- Keep concurrent manual catalog saves out while matching and updating IDs.
  lock table public.products,public.extras in share row exclusive mode;
  for row_data in select value from jsonb_array_elements(p_data->'menu') loop
    select product_id into target_id from cafe_private.smoothies_product_sources where source_id=row_data->>'id';
    if exists(select 1 from public.products p
      where lower(btrim(p.name))=lower(row_data->>'displayName') and p.id is distinct from target_id
        and not exists(select 1 from cafe_private.smoothies_product_sources s where s.product_id=p.id
          and not exists(select 1 from jsonb_array_elements(p_data->'menu') j where j->>'id'=s.source_id))) then
      raise exception 'Ya existe otro producto llamado %. Revisa el catálogo.',row_data->>'displayName';
    end if;
    select coalesce(array_agg(distinct e->>'phase' order by e->>'phase'),'{}') into steps
    from jsonb_array_elements(p_data->'extras') e where (e->'productIds') ? (row_data->>'id');
    if target_id is null then
      insert into public.products(name,description,price,category,is_active,stock,customizable,wizard_steps)
      values(row_data->>'displayName',row_data->>'notes',(row_data->>'price')::numeric,'Smoothies',true,0,cardinality(steps)>0,steps)
      returning id into target_id;
      insert into cafe_private.smoothies_product_sources values(row_data->>'id',target_id);
    else
      update public.products set name=row_data->>'displayName',description=row_data->>'notes',
        price=(row_data->>'price')::numeric,is_active=true,customizable=cardinality(steps)>0,wizard_steps=steps
      where id=target_id;
    end if;
  end loop;

  for row_data in select value from jsonb_array_elements(p_data->'extras') loop
    select extra_id into target_id from cafe_private.smoothies_extra_sources where source_id=row_data->>'id';
    if exists(select 1 from public.extras e where lower(btrim(e.name))=lower(row_data->>'name')
      and e.id is distinct from target_id and (e.active or e.applicable_product_ids is null)
      and not exists(select 1 from cafe_private.smoothies_extra_sources s where s.extra_id=e.id
        and not exists(select 1 from jsonb_array_elements(p_data->'extras') j where j->>'id'=s.source_id))) then
      raise exception 'Ya existe otro extra llamado %. Revisa el catálogo.',row_data->>'name';
    end if;
    select array_agg(product_id order by product_id) into eligible_ids
    from cafe_private.smoothies_product_sources where (row_data->'productIds') ? source_id;
    if cardinality(eligible_ids) is distinct from jsonb_array_length(row_data->'productIds') then
      raise exception 'El extra % contiene productos desconocidos.',row_data->>'name';
    end if;
    if target_id is null then
      insert into public.extras(name,price,phase,active,applicable_product_ids)
      values(row_data->>'name',(row_data->>'price')::numeric,row_data->>'phase',true,eligible_ids)
      returning id into target_id;
      insert into cafe_private.smoothies_extra_sources values(row_data->>'id',target_id);
    else
      update public.extras set name=row_data->>'name',price=(row_data->>'price')::numeric,
        phase=row_data->>'phase',active=true,applicable_product_ids=eligible_ids where id=target_id;
    end if;
  end loop;

  update public.products p set is_active=false from cafe_private.smoothies_product_sources s
    where p.id=s.product_id and p.is_active and not exists(select 1 from jsonb_array_elements(p_data->'menu') j where j->>'id'=s.source_id);
  update public.extras e set active=false from cafe_private.smoothies_extra_sources s
    where e.id=s.extra_id and e.active and not exists(select 1 from jsonb_array_elements(p_data->'extras') j where j->>'id'=s.source_id);
  update cafe_private.smoothies_opening_plan p set listed=false where listed
    and not exists(select 1 from jsonb_array_elements(p_data->'stock') j where j->>'id'=p.source_id);
  insert into cafe_private.smoothies_opening_plan(source_id,name,unit,planned_quantity,purchase_pack,purchase_cost)
    select j->>'id',j->>'name',j->>'unit',(j->>'quantity')::numeric,j->>'pack',(j->>'cost')::numeric
    from jsonb_array_elements(p_data->'stock') j
    on conflict(source_id) do update set name=excluded.name,unit=excluded.unit,
      planned_quantity=excluded.planned_quantity,purchase_pack=excluded.purchase_pack,purchase_cost=excluded.purchase_cost,listed=true;
  insert into cafe_private.smoothies_imports(digest,imported_by,palette) values(fingerprint,p_actor,p_data->'palette');
  return jsonb_build_object('unchanged',false);
end;
$$;
revoke all on function public.pos_import_smoothies(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pos_import_smoothies(uuid,jsonb) to service_role;

create function public.pos_smoothies_opening_plan()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_admin() then raise exception 'Acceso exclusivo del administrador.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',source_id,'name',name,'unit',unit,
    'quantity',planned_quantity,'pack',purchase_pack,'cost',purchase_cost) order by name,source_id),'[]')
    from cafe_private.smoothies_opening_plan where listed);
end;
$$;
revoke all on function public.pos_smoothies_opening_plan() from public,anon,authenticated;
grant execute on function public.pos_smoothies_opening_plan() to authenticated;
notify pgrst,'reload schema';
commit;
