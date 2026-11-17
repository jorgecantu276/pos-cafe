begin;

create table cafe_private.smoothies_weekly_special (
  singleton boolean primary key default true check (singleton),
  product_id uuid references public.products(id) on delete set null,
  revision integer not null check (revision > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
revoke all on cafe_private.smoothies_weekly_special from public, anon, authenticated;

create function public.pos_smoothies_special() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_staff() then
    raise exception 'Inicia sesión en la caja.' using errcode='42501';
  end if;
  return coalesce(
    (select jsonb_build_object('product_id', p.id, 'revision', s.revision)
     from cafe_private.smoothies_weekly_special s
     left join public.products p on p.id=s.product_id and p.is_active and lower(btrim(p.category))='smoothies'),
    jsonb_build_object('product_id', null, 'revision', 0)
  );
end;
$$;

create function public.pos_set_smoothies_special(p_product uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_product uuid; current_revision integer;
begin
  if not cafe_private.is_admin() then
    raise exception 'Solo administración puede cambiar el especial.' using errcode='42501';
  end if;
  if p_revision is null or p_revision < 0 then raise exception 'Vuelve a abrir el catálogo.'; end if;
  perform pg_advisory_xact_lock(810192425);
  if p_product is not null then
    perform 1 from public.products p where p.id=p_product and p.is_active and lower(btrim(p.category))='smoothies' for share;
    if not found then raise exception 'Elige un smoothie activo.'; end if;
  end if;
  select product_id, revision into current_product, current_revision from cafe_private.smoothies_weekly_special for update;
  current_revision := coalesce(current_revision, 0);
  if current_product is distinct from p_product then
    if current_revision <> p_revision then
      raise exception 'El especial cambió en otra ventana. Actualiza y vuelve a elegir.';
    end if;
    current_revision := current_revision + 1;
    insert into cafe_private.smoothies_weekly_special(product_id, revision, updated_by)
    values (p_product, current_revision, auth.uid())
    on conflict (singleton) do update set product_id=excluded.product_id, revision=excluded.revision,
      updated_by=excluded.updated_by, updated_at=now();
  end if;
  return jsonb_build_object('product_id', p_product, 'revision', current_revision);
end;
$$;

create function cafe_private.clear_unavailable_smoothies_special() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update cafe_private.smoothies_weekly_special
  set product_id=null, revision=revision+1, updated_by=auth.uid(), updated_at=now()
  where product_id=new.id;
  return new;
end;
$$;
revoke all on function cafe_private.clear_unavailable_smoothies_special() from public, anon, authenticated;
create trigger clear_unavailable_smoothies_special
after update of category, is_active on public.products for each row
when (new.is_active is distinct from true or lower(btrim(new.category)) is distinct from 'smoothies')
execute function cafe_private.clear_unavailable_smoothies_special();

revoke all on function public.pos_smoothies_special(), public.pos_set_smoothies_special(uuid, integer) from public, anon;
grant execute on function public.pos_smoothies_special(), public.pos_set_smoothies_special(uuid, integer) to authenticated;
notify pgrst,'reload schema';
commit;
