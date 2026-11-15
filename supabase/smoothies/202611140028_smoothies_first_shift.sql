begin;

create or replace function public.pos_open_shift(p_request uuid,p_cash numeric,p_rate numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; rate numeric; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(60281030);
  if p_request is null or p_cash is null or p_cash::text in ('NaN','Infinity','-Infinity') or p_cash<0 or p_cash>10000000 or p_cash<>round(p_cash,2) then raise exception 'Apertura inválida'; end if;
  select * into r from public.cash_registers where request_id=p_request;
  if found then
    if r.opened_by<>auth.uid() then raise exception 'La apertura pertenece a otro cajero' using errcode='42501'; end if;
    if r.initial_balance is distinct from p_cash or r.exchange_rate is distinct from p_rate then raise exception 'Identidad de apertura reutilizada'; end if;
    return to_jsonb(r);
  end if;
  if exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null) then raise exception 'Primero confirma la entrega de caja pendiente'; end if;
  if exists(select 1 from public.cash_registers where status='open') then raise exception 'La única caja ya tiene un turno abierto. Recupera el turno o realiza el cambio de cajero'; end if;
  select s.rate into rate from cafe_private.drawer_settings s;
  -- The legacy shift requires a positive conversion factor. A peso-only shift
  -- has no conversion, so keep the saved commercial rate empty and use identity.
  if rate is null and to_regclass('smoothies_local.identity') is not null then rate := 1; end if;
  if rate is null then raise exception 'El responsable debe guardar el tipo de cambio en Administración → Caja'; end if;
  if p_rate is distinct from rate then raise exception 'El tipo de cambio guardado cambió. Actualiza antes de abrir'; end if;
  insert into public.cash_registers(opened_by,initial_balance,exchange_rate,request_id) values(auth.uid(),p_cash,rate,p_request) returning * into r;
  return to_jsonb(r);
end $$;

commit;
