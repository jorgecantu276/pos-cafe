-- Install the Caja build that recognizes the Matcha phases before running this update.
begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(60281102013);
lock table public.products, public.extras in share row exclusive mode;

do $matcha$
declare
  matchas constant text[] := array[
    'matcha cariño 16 oz', 'matcha ceremonial 16 oz', 'matcha fresa 16 oz',
    'matcha latte cariño 20 oz', 'matcha latte cold foam fresa 20 oz',
    'matcha latte cold foam mango 20 oz', 'matcha mango 16 oz'
  ];
  milk constant text := 'Leche alternativa';
  foam constant text := 'Cold foam';
  matcha_milk constant text := 'Leche alternativa Matcha';
  matcha_foam constant text := 'Cold foam Matcha';
  old_check constant text := 'extra.phase in (''Tamaño'',''Tipo de Leche'',''Leche alternativa'')';
  new_check constant text := 'extra.phase in (''Tamaño'',''Tipo de Leche'',''Leche alternativa'',''Leche alternativa Matcha'')';
  signature text;
  definition text;
begin
  if exists (select from public.extras where phase in (matcha_milk, matcha_foam))
    or exists (select from public.products where wizard_steps && array[matcha_milk, matcha_foam]) then
    raise exception 'Ya existen grupos de Matcha. Verifica si el ajuste ya se aplicó.';
  end if;

  if (select count(distinct lower(name)) from public.products
      where lower(name) = any(matchas) and category = 'Bebidas' and customizable
        and wizard_steps @> array[milk] and wizard_steps && array['Fruta extra', foam]) <> cardinality(matchas)
    or (select count(*) from public.products where lower(name) = any(matchas)) <> cardinality(matchas) then
    raise exception 'El catálogo de Matcha cambió. Revisa los productos antes de aplicar el ajuste.';
  end if;

  if exists (select from public.extras where phase = milk and active group by name having count(*) <> 1)
    or (select count(*) from public.extras where phase = milk and name = 'Lala 100' and active and price in (0, 15)) <> 1
    or (select count(*) from public.extras where phase = foam and active) <> 1
    or (select count(*) from public.extras where phase = foam and active and name in (foam, 'Cold foam extra') and price = 15) <> 1 then
    raise exception 'Revisa las opciones activas de Leche alternativa y Cold foam antes de copiarlas.';
  end if;

  foreach signature in array array[
    'cafe_private.manual_checkout(uuid,jsonb)',
    'cafe_private.clip_quote(uuid,jsonb)',
    'cafe_private.phone_catalog_quote(uuid,jsonb)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    if length(definition) - length(replace(definition, old_check, '')) <> length(old_check) then
      raise exception 'Revisa la validación de opciones de leche en %', signature;
    end if;
    execute replace(definition, old_check, new_check);
  end loop;

  insert into public.extras (name, price, phase, active, orden_opcion)
  select name, case when name = 'Lala 100' then 0 else price end, matcha_milk, active, orden_opcion
    from public.extras where phase = milk and active
  union all
  select 'Cold foam extra', price, matcha_foam, active, orden_opcion
    from public.extras where phase = foam and active;

  update public.products set wizard_steps = array_replace(case
    when foam = any(wizard_steps) then array_replace(array_remove(wizard_steps, 'Fruta extra'), foam, matcha_foam)
    else array_replace(wizard_steps, 'Fruta extra', matcha_foam)
  end, milk, matcha_milk)
  where lower(name) = any(matchas);
end $matcha$;

commit;
