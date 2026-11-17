begin;

create table cafe_private.smoothies_recipes (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  product_id uuid unique references public.products(id),
  updated_at timestamptz not null default now()
);
create index smoothies_recipes_by_owner on cafe_private.smoothies_recipes (owner_id, updated_at desc);

create table cafe_private.smoothies_recipe_trials (
  id uuid primary key,
  recipe_id uuid not null references cafe_private.smoothies_recipes(id),
  number integer not null check (number > 0),
  ingredients text not null check (length(btrim(ingredients)) between 1 and 4000),
  method text not null default '' check (length(method) <= 4000),
  changes text not null default '' check (length(changes) <= 4000),
  created_at timestamptz not null default now(),
  unique (recipe_id, number)
);
revoke all on cafe_private.smoothies_recipes, cafe_private.smoothies_recipe_trials from public, anon, authenticated;

create function public.pos_smoothies_recipes() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_admin() then raise exception 'Abre el recetario con tu cuenta de administración.' using errcode='42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'product_id', r.product_id,
      'updated_at', r.updated_at, 'trial_count', coalesce(t.number, 0)) order by r.updated_at desc, r.id), '[]')
    from cafe_private.smoothies_recipes r
    left join lateral (
      select number from cafe_private.smoothies_recipe_trials where recipe_id=r.id order by number desc limit 1
    ) t on true
    where r.owner_id=auth.uid()
  );
end;
$$;

create function public.pos_smoothies_recipe_trials(p_recipe uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_admin() or not exists(
    select 1 from cafe_private.smoothies_recipes where id=p_recipe and owner_id=auth.uid()
  ) then raise exception 'No tienes acceso a esta receta.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.number desc), '[]')
    from cafe_private.smoothies_recipe_trials t where t.recipe_id=p_recipe);
end;
$$;

create function public.pos_save_smoothies_recipe_trial(p_recipe uuid, p_trial uuid, p_name text,
  p_ingredients text, p_method text, p_changes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  recipe cafe_private.smoothies_recipes;
  trial cafe_private.smoothies_recipe_trials;
begin
  if not cafe_private.is_admin() then raise exception 'Abre el recetario con tu cuenta de administración.' using errcode='42501'; end if;
  if p_recipe is null or p_trial is null or coalesce(length(btrim(p_name)), 0) not between 1 and 100
    or coalesce(length(btrim(p_ingredients)), 0) not between 1 and 4000
    or length(coalesce(p_method, '')) > 4000 or length(coalesce(p_changes, '')) > 4000 then
    raise exception 'Revisa el nombre de la receta y los ingredientes.';
  end if;

  insert into cafe_private.smoothies_recipes(id, owner_id, name)
  values(p_recipe, auth.uid(), btrim(p_name)) on conflict (id) do nothing;
  select * into recipe from cafe_private.smoothies_recipes where id=p_recipe and owner_id=auth.uid() for update;
  if not found then raise exception 'No tienes acceso a esta receta.' using errcode='42501'; end if;

  select * into trial from cafe_private.smoothies_recipe_trials where id=p_trial;
  if found then
    if trial.recipe_id <> p_recipe or trial.ingredients <> btrim(p_ingredients)
      or trial.method <> btrim(coalesce(p_method, '')) or trial.changes <> btrim(coalesce(p_changes, '')) then
      raise exception 'Ese intento de guardado ya corresponde a otra prueba.';
    end if;
    return to_jsonb(trial);
  end if;

  insert into cafe_private.smoothies_recipe_trials(id, recipe_id, number, ingredients, method, changes)
  select p_trial, p_recipe, coalesce(max(number), 0) + 1, btrim(p_ingredients), btrim(coalesce(p_method, '')), btrim(coalesce(p_changes, ''))
  from cafe_private.smoothies_recipe_trials where recipe_id=p_recipe returning * into trial;
  update cafe_private.smoothies_recipes set updated_at=now() where id=p_recipe;
  return to_jsonb(trial);
end;
$$;

create function public.pos_publish_smoothies_recipe(p_recipe uuid, p_trial uuid, p_name text, p_price numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  recipe cafe_private.smoothies_recipes;
  latest uuid;
  product uuid;
begin
  if not cafe_private.is_admin() then raise exception 'Abre el recetario con tu cuenta de administración.' using errcode='42501'; end if;
  select * into recipe from cafe_private.smoothies_recipes where id=p_recipe and owner_id=auth.uid() for update;
  if not found then raise exception 'No tienes acceso a esta receta.' using errcode='42501'; end if;
  if recipe.product_id is not null then return recipe.product_id; end if;
  select id into latest from cafe_private.smoothies_recipe_trials where recipe_id=p_recipe order by number desc limit 1;
  if latest is null or latest is distinct from p_trial then raise exception 'Abre la última prueba antes de agregarla al menú.'; end if;
  if coalesce(length(btrim(p_name)), 0) not between 1 and 100 or p_price is null
    or p_price <= 0 or p_price > 1000000 or round(p_price, 2) <> p_price then raise exception 'Revisa el nombre y el precio de venta.'; end if;

  -- Serialize with the catalogue editor and the form importer.
  perform pg_advisory_xact_lock(60281102013);
  if exists(select 1 from public.products where lower(btrim(name))=lower(btrim(p_name))) then
    raise exception 'Ya existe un producto con ese nombre. Elige otro nombre para el menú.';
  end if;
  product := (public.pos_save_catalog(recipe.id, jsonb_build_object('actor_id', auth.uid(), 'kind', 'product', 'action', 'save',
    'id', null, 'fields', jsonb_build_object('name', btrim(p_name), 'price', p_price, 'category', 'Smoothies',
      'customizable', false, 'wizard_steps', '[]'::jsonb, 'image_url', '')))->>'id')::uuid;
  update cafe_private.smoothies_recipes set product_id=product, updated_at=now() where id=p_recipe;
  return product;
end;
$$;

revoke all on function public.pos_smoothies_recipes(), public.pos_smoothies_recipe_trials(uuid),
  public.pos_save_smoothies_recipe_trial(uuid, uuid, text, text, text, text), public.pos_publish_smoothies_recipe(uuid, uuid, text, numeric)
from public, anon;
grant execute on function public.pos_smoothies_recipes(), public.pos_smoothies_recipe_trials(uuid),
  public.pos_save_smoothies_recipe_trial(uuid, uuid, text, text, text, text), public.pos_publish_smoothies_recipe(uuid, uuid, text, numeric)
to authenticated;
notify pgrst,'reload schema';
commit;
