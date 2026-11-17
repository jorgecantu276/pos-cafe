begin;

create function public.pos_save_smoothies_extra(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  raw_ids jsonb := p_payload#>'{fields,applicable_product_ids}';
  scope_ids uuid[];
  extra_phase text;
  extra_revision bigint;
  response jsonb;
begin
  if not cafe_private.is_admin() then raise exception 'Acceso exclusivo del administrador.' using errcode='42501'; end if;
  if p_payload->>'kind' is distinct from 'extra' or p_payload->>'action' is distinct from 'save'
      or jsonb_typeof(raw_ids) is distinct from 'array' or jsonb_array_length(raw_ids)>2000 then
    raise exception 'Revisa los productos del extra.';
  end if;
  perform pg_advisory_xact_lock(810192418);
  perform pg_advisory_xact_lock(60281102013);
  if exists(select 1 from cafe_private.catalog_requests where request_id=p_request) then
    return public.pos_save_catalog(p_request,p_payload);
  end if;
  select coalesce(array_agg(distinct item::uuid order by item::uuid),'{}') into scope_ids
    from jsonb_array_elements_text(raw_ids) as ids(item);
  if array_position(scope_ids,null) is not null or exists(
    select 1 from unnest(scope_ids) ids(id) where not exists(select 1 from public.products p where p.id=ids.id)
  ) then raise exception 'Actualiza el catálogo y vuelve a elegir los productos.'; end if;
  response:=public.pos_save_catalog(p_request,p_payload);
  update public.extras set applicable_product_ids=scope_ids where id=(response->>'id')::uuid
    returning phase,catalog_revision into extra_phase,extra_revision;
  update public.products p set customizable=true,
    wizard_steps=case when coalesce(extra_phase=any(p.wizard_steps),false) then p.wizard_steps
      else array_append(coalesce(p.wizard_steps,'{}'::text[]),extra_phase) end
    where p.id=any(scope_ids)
      and (p.customizable is distinct from true or not coalesce(extra_phase=any(p.wizard_steps),false));
  response:=response||jsonb_build_object('revision',extra_revision);
  update cafe_private.catalog_requests set result=response where request_id=p_request;
  return response;
end $$;
revoke all on function public.pos_save_smoothies_extra(uuid,jsonb) from public,anon,service_role;
grant execute on function public.pos_save_smoothies_extra(uuid,jsonb) to authenticated;

alter function public.pos_import_smoothies(uuid,jsonb) set schema cafe_private;
revoke all on function cafe_private.pos_import_smoothies(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.pos_import_smoothies(p_actor uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare response jsonb;
begin
  response:=cafe_private.pos_import_smoothies(p_actor,p_data);
  if response->>'unchanged'='true' then return response; end if;
  -- Refreshing the imported menu must retain phases for extras made in Catálogo.
  with manual_groups as (
    select scope.product_id,array_agg(distinct e.phase order by e.phase) phases
    from public.extras e cross join lateral unnest(e.applicable_product_ids) scope(product_id)
    where e.active and not exists(select 1 from cafe_private.smoothies_extra_sources s where s.extra_id=e.id)
    group by scope.product_id
  )
  update public.products p set customizable=true, wizard_steps=array(
    select distinct phase from unnest(coalesce(p.wizard_steps,'{}'::text[])||g.phases) phases(phase) order by phase)
  from manual_groups g where g.product_id=p.id
    and (p.customizable is distinct from true or not coalesce(p.wizard_steps @> g.phases,false));
  return response;
end $$;
revoke all on function public.pos_import_smoothies(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pos_import_smoothies(uuid,jsonb) to service_role;

create table cafe_private.smoothies_opening_counts (
  source_id text not null references cafe_private.smoothies_opening_plan(source_id),
  unit text not null,
  revision bigint not null check(revision>0),
  quantity numeric(10,3) not null check(quantity>=0),
  counted_at timestamptz not null default now(),
  counted_by uuid not null references public.profiles(id),
  primary key(source_id,unit,revision)
);
revoke all on cafe_private.smoothies_opening_counts from public,anon,authenticated,service_role;

create or replace function public.pos_smoothies_opening_plan() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_admin() then raise exception 'Acceso exclusivo del administrador.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.source_id,'name',p.name,'unit',p.unit,
    'quantity',p.planned_quantity,'pack',p.purchase_pack,'cost',p.purchase_cost,
    'counted',c.quantity,'revision',coalesce(c.revision,0)) order by p.name,p.source_id),'[]')
    from cafe_private.smoothies_opening_plan p
    left join lateral (select quantity,revision from cafe_private.smoothies_opening_counts
      where source_id=p.source_id and unit=p.unit order by revision desc limit 1) c on true
    where p.listed);
end $$;

create function public.pos_count_smoothies_opening(p_id text,p_unit text,p_revision bigint,p_quantity numeric)
returns void language plpgsql security definer set search_path='' as $$
declare current_count cafe_private.smoothies_opening_counts;
begin
  if not cafe_private.is_admin() then raise exception 'Acceso exclusivo del administrador.' using errcode='42501'; end if;
  if p_revision is null or p_revision<0 or p_quantity is null
      or p_quantity<0 or p_quantity>9999999.999 or round(p_quantity,3)<>p_quantity then
    raise exception 'Escribe una cantidad válida de hasta tres decimales.';
  end if;
  perform 1 from cafe_private.smoothies_opening_plan
    where source_id=p_id and listed and unit=p_unit for update;
  if not found then raise exception 'Este insumo cambió. Actualiza el conteo.'; end if;
  select * into current_count from cafe_private.smoothies_opening_counts
    where source_id=p_id and unit=p_unit order by revision desc limit 1;
  if current_count.revision=p_revision+1 and current_count.quantity=p_quantity and current_count.counted_by=auth.uid() then return; end if;
  if coalesce(current_count.revision,0)<>p_revision then raise exception 'Este insumo cambió. Actualiza el conteo.'; end if;
  if current_count.quantity is not distinct from p_quantity then return; end if;
  insert into cafe_private.smoothies_opening_counts(source_id,unit,revision,quantity,counted_by)
    values(p_id,p_unit,p_revision+1,p_quantity,auth.uid());
end $$;
revoke all on function public.pos_count_smoothies_opening(text,text,bigint,numeric) from public,anon,service_role;
grant execute on function public.pos_count_smoothies_opening(text,text,bigint,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
