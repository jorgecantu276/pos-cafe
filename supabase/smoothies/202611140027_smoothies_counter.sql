begin;

-- The smoothies counter uses the sale folio. A supplied legacy control still
-- has to be valid, and previously saved requests retain their original payload.
create or replace function cafe_private.require_order_pager(p_payload jsonb) returns void
language plpgsql stable set search_path='' as $$
declare pager numeric;
begin
  if p_payload->>'pager_number' is null and to_regclass('smoothies_local.identity') is not null then return; end if;
  if jsonb_typeof(p_payload->'pager_number') is distinct from 'number' then
    raise exception 'El control debe ser del 1 al 30';
  end if;
  pager := (p_payload->>'pager_number')::numeric;
  if pager <> trunc(pager) or pager not between 1 and 30 then
    raise exception 'El control debe ser del 1 al 30';
  end if;
end;
$$;

-- Stage a sale item for review without exposing private notes to the counter.
create or replace function public.pos_publish_smoothies_recipe(p_recipe uuid, p_trial uuid, p_name text, p_price numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare recipe cafe_private.smoothies_recipes; latest uuid; product uuid;
begin
  if not cafe_private.is_admin() then raise exception 'Abre el recetario con tu cuenta de administración.' using errcode='42501'; end if;
  select * into recipe from cafe_private.smoothies_recipes where id=p_recipe and owner_id=auth.uid() for update;
  if not found then raise exception 'No tienes acceso a esta receta.' using errcode='42501'; end if;
  if recipe.product_id is not null then return recipe.product_id; end if;
  select id into latest from cafe_private.smoothies_recipe_trials where recipe_id=p_recipe order by number desc limit 1;
  if latest is null or latest is distinct from p_trial then raise exception 'Vuelve a abrir la receta para revisar la última prueba.'; end if;
  if coalesce(length(btrim(p_name)), 0) not between 1 and 100 or p_price is null
    or p_price <= 0 or p_price > 1000000 or round(p_price, 2) <> p_price then raise exception 'Revisa el nombre y el precio de venta.'; end if;

  perform pg_advisory_xact_lock(60281102013);
  if exists(select 1 from public.products where lower(btrim(name))=lower(btrim(p_name))) then
    raise exception 'Ya existe un producto con ese nombre. Elige otro nombre para el menú.';
  end if;
  product := (public.pos_save_catalog(recipe.id, jsonb_build_object('actor_id', auth.uid(), 'kind', 'product', 'action', 'save',
    'id', null, 'fields', jsonb_build_object('name', btrim(p_name), 'price', p_price, 'category', 'Smoothies',
      'customizable', false, 'wizard_steps', '[]'::jsonb, 'image_url', '')))->>'id')::uuid;
  update public.products set is_active=false where id=product;
  update cafe_private.smoothies_recipes set product_id=product, updated_at=now() where id=p_recipe;
  return product;
end;
$$;
notify pgrst,'reload schema';
commit;
