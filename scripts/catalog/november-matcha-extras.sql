-- Catalog data change against the verified menu after migration 023.
begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(60281102013);
lock table public.products, public.extras in share row exclusive mode;

do $update$
declare
  matchas constant text[] := array[
    'matcha cariño 16 oz',
    'matcha ceremonial 16 oz',
    'matcha fresa 16 oz',
    'matcha latte cariño 20 oz',
    'matcha latte cold foam fresa 20 oz',
    'matcha latte cold foam mango 20 oz',
    'matcha mango 16 oz'
  ];
  lala_id uuid;
  foam_id uuid;
begin
  if (select count(distinct lower(name)) from public.products
      where lower(name) = any(matchas) and category = 'Bebidas' and customizable
        and wizard_steps @> array['Leche alternativa']
        and wizard_steps && array['Fruta extra', 'Cold foam']) <> cardinality(matchas)
    or (select count(*) from public.products where lower(name) = any(matchas)) <> cardinality(matchas)
  then
    raise exception 'El catálogo de Matcha cambió. Revisa los productos antes de aplicar el ajuste.';
  end if;

  if exists (
    select from public.products where not (lower(name) = any(matchas))
      and wizard_steps && array['Leche alternativa', 'Cold foam']
  ) then
    raise exception 'Otro producto usa Leche alternativa o Cold foam. Revisa el alcance del ajuste.';
  end if;

  select id into strict lala_id from public.extras
    where phase = 'Leche alternativa' and name = 'Lala 100';
  if not exists (select from public.extras where id = lala_id and active and price in (0, 15)) then
    raise exception 'Revisa el extra Lala 100 de Matcha antes de cambiar su precio.';
  end if;

  select id into strict foam_id from public.extras
    where phase = 'Cold foam' and name in ('Cold foam', 'Cold foam extra');
  if not exists (select from public.extras where id = foam_id and active and price = 15)
    or exists (select from public.extras where phase = 'Cold foam' and active and id <> foam_id)
  then
    raise exception 'Revisa el grupo Cold foam. Se esperaba un solo extra activo a $15.';
  end if;

  update public.extras set price = 0 where id = lala_id and price <> 0;
  update public.extras set name = 'Cold foam extra' where id = foam_id and name <> 'Cold foam extra';

  update public.products set wizard_steps = case
    when 'Cold foam' = any(wizard_steps) then array_remove(wizard_steps, 'Fruta extra')
    else array_replace(wizard_steps, 'Fruta extra', 'Cold foam')
  end
  where lower(name) = any(matchas) and 'Fruta extra' = any(wizard_steps);
end
$update$;

commit;
