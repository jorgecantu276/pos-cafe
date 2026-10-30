-- One physical POS/drawer. No inventory functionality is introduced.
begin;
select pg_advisory_xact_lock(60281030);
do $$ begin
  if (select count(*) from public.cash_registers where status='open')>1 then
    raise exception 'Hay varios turnos abiertos. Concilia la caja antes de activar una sola caja física';
  end if;
end $$;
create unique index one_physical_drawer_open on public.cash_registers((true)) where status='open';

create table cafe_private.drawer_settings (
  singleton boolean primary key default true check(singleton), rate numeric(10,4) check(rate>0 and rate<=1000),
  updated_by uuid references public.profiles(id), updated_at timestamptz
);
-- No guessed commercial exchange rate; an existing open session supplies its own.
insert into cafe_private.drawer_settings(singleton,rate)
values(true,(select exchange_rate from public.cash_registers where status='open'));
create table cafe_private.drawer_requests (
  request_id uuid primary key, actor_id uuid not null references public.profiles(id), operation text not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create table cafe_private.drawer_handoffs (
  id uuid primary key, from_register uuid not null unique references public.cash_registers(id),
  from_cashier uuid not null references public.profiles(id), from_name text not null,
  to_cashier uuid not null references public.profiles(id), to_name text not null,
  delivered numeric(10,2) not null check(delivered>=0), rate numeric(10,4) not null,
  created_at timestamptz not null default now(), accepted_at timestamptz,
  accepted_register uuid unique references public.cash_registers(id), received numeric(10,2), note text,
  check((accepted_at is null and accepted_register is null and received is null) or
    (accepted_at is not null and accepted_register is not null and received>=0))
);
create unique index one_drawer_pending_handoff on cafe_private.drawer_handoffs((true)) where accepted_at is null;
revoke all on cafe_private.drawer_settings,cafe_private.drawer_requests,cafe_private.drawer_handoffs from public,anon,authenticated;

create function cafe_private.drawer_replay(p_request uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous cafe_private.drawer_requests; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Solicitud inválida'; end if;
  if p_payload ? 'actor_id' and p_payload->>'actor_id' is distinct from auth.uid()::text then raise exception 'La sesión cambió. Recupera la solicitud con el cajero original' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(60281030);
  select * into previous from cafe_private.drawer_requests where request_id=p_request;
  if found then
    if previous.actor_id<>auth.uid() then raise exception 'La solicitud pertenece a otro cajero' using errcode='42501'; end if;
    if previous.operation<>p_operation or previous.payload is distinct from p_payload then raise exception 'Solicitud reutilizada con otros datos'; end if;
    return previous.result;
  end if;
  return null;
end $$;
revoke all on function cafe_private.drawer_replay(uuid,text,jsonb) from public,anon,authenticated;

create function public.pos_drawer_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  return jsonb_build_object('rate',(select rate from cafe_private.drawer_settings),
    'active',(select jsonb_build_object('id',r.id,'cashier_id',r.opened_by,'cashier_name',p.full_name)
      from public.cash_registers r join public.profiles p on p.id=r.opened_by where r.status='open'),
    'handoff',(select jsonb_build_object('id',h.id,'from_name',h.from_name,'to_id',h.to_cashier,'to_name',h.to_name,'delivered',h.delivered,'rate',h.rate)
      from cafe_private.drawer_handoffs h where h.accepted_at is null),
    'cashiers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by full_name,id),'[]')
      from public.profiles where is_active and role in ('admin','cashier','barista') and id<>auth.uid()));
end $$;

create function public.pos_set_drawer_rate(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; amount numeric:=(p_payload->>'rate')::numeric; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  result:=cafe_private.drawer_replay(p_request,'rate',p_payload); if result is not null then return result; end if;
  if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>1000 or amount<>round(amount,4) then raise exception 'Tipo de cambio inválido'; end if;
  if exists(select 1 from public.cash_registers where status='open') or exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null) then
    raise exception 'Cambia el tipo de cambio con la caja cerrada y sin entrega pendiente';
  end if;
  update cafe_private.drawer_settings set rate=amount,updated_by=auth.uid(),updated_at=now();
  result:=jsonb_build_object('request_id',p_request,'rate',amount);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'rate',p_payload,result,now());
  return result;
end $$;

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
  if rate is null then raise exception 'El responsable debe guardar el tipo de cambio en Administración → Caja'; end if;
  if p_rate is distinct from rate then raise exception 'El tipo de cambio guardado cambió. Actualiza antes de abrir'; end if;
  insert into public.cash_registers(opened_by,initial_balance,exchange_rate,request_id) values(auth.uid(),p_cash,rate,p_request) returning * into r;
  return to_jsonb(r);
end $$;

create function public.pos_begin_drawer_handoff(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; report jsonb; r public.cash_registers; target public.profiles; begin
  result:=cafe_private.drawer_replay(p_request,'handoff',p_payload); if result is not null then return result; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register')::uuid and opened_by=auth.uid() for update;
  if not found or r.status<>'open' then raise exception 'Recupera tu turno abierto antes de entregar la caja'; end if;
  select * into target from public.profiles where id=(p_payload->>'to')::uuid and id<>auth.uid() and is_active and role in ('admin','cashier','barista') for share;
  if not found then raise exception 'Selecciona otro cajero activo'; end if;
  if exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null) then raise exception 'Ya existe una entrega pendiente'; end if;
  report:=public.pos_close_shift(r.id,(p_payload->>'counted')::numeric,p_payload->'expenses',p_payload->'preview');
  insert into cafe_private.drawer_handoffs(id,from_register,from_cashier,from_name,to_cashier,to_name,delivered,rate)
    values(p_request,r.id,auth.uid(),(select full_name from public.profiles where id=auth.uid()),target.id,target.full_name,(p_payload->>'counted')::numeric,r.exchange_rate);
  result:=jsonb_build_object('request_id',p_request,'report',report);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'handoff',p_payload,result,now());
  return result;
end $$;

create function public.pos_accept_drawer_handoff(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; h cafe_private.drawer_handoffs; r public.cash_registers; amount numeric:=(p_payload->>'counted')::numeric; receipt_note text:=trim(coalesce(p_payload->>'note','')); begin
  result:=cafe_private.drawer_replay(p_request,'accept',p_payload); if result is not null then return result; end if;
  select * into h from cafe_private.drawer_handoffs where id=(p_payload->>'handoff')::uuid for update;
  if not found or h.to_cashier<>auth.uid() then raise exception 'La entrega corresponde a otro cajero' using errcode='42501'; end if;
  if h.accepted_at is not null then raise exception 'La entrega ya fue aceptada. Recupera el turno existente'; end if;
  if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>10000000 or amount<>round(amount,2)
    or length(receipt_note)>300 or (amount<>h.delivered and length(receipt_note)<3) then raise exception 'Confirma el efectivo recibido y explica cualquier diferencia'; end if;
  if exists(select 1 from public.cash_registers where status='open') then raise exception 'La caja ya tiene un turno abierto'; end if;
  insert into public.cash_registers(opened_by,initial_balance,exchange_rate,request_id) values(auth.uid(),amount,h.rate,p_request) returning * into r;
  update cafe_private.drawer_handoffs set accepted_at=now(),accepted_register=r.id,received=amount,note=receipt_note where id=h.id;
  result:=jsonb_build_object('request_id',p_request,'register',to_jsonb(r));
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'accept',p_payload,result,now());
  return result;
end $$;

create function public.pos_reassign_drawer_handoff(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; h cafe_private.drawer_handoffs; target public.profiles; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  result:=cafe_private.drawer_replay(p_request,'reassign',p_payload); if result is not null then return result; end if;
  select * into h from cafe_private.drawer_handoffs where id=(p_payload->>'handoff')::uuid and accepted_at is null for update;
  if not found then raise exception 'Entrega pendiente no disponible'; end if;
  select * into target from public.profiles where id=(p_payload->>'to')::uuid and id<>h.from_cashier and is_active and role in ('admin','cashier','barista') for share;
  if not found or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 300 then raise exception 'Confirma el nuevo cajero y el motivo'; end if;
  update cafe_private.drawer_handoffs set to_cashier=target.id,to_name=target.full_name where id=h.id;
  result:=jsonb_build_object('request_id',p_request,'handoff',h.id,'previous_cashier',h.to_cashier,'to',target.id);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'reassign',p_payload,result,now());
  return result;
end $$;

create function public.pos_drawer_history() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc),'[]') from
    (select id,from_name,to_name,delivered,received,received-delivered difference,rate,note,created_at,accepted_at
      from cafe_private.drawer_handoffs order by created_at desc,id desc limit 50) h);
end $$;

create function cafe_private.protect_drawer_cashier() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.is_active is distinct from true or new.role is null or new.role not in ('admin','cashier','barista')) and
    (exists(select 1 from public.cash_registers where status='open' and opened_by=old.id) or
     exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null and to_cashier=old.id)) then
    raise exception 'Cierra o entrega la caja y reasigna las entregas pendientes antes de desactivar al cajero';
  end if;
  return new;
end $$;
create trigger protect_drawer_cashier before update of is_active,role on public.profiles for each row execute function cafe_private.protect_drawer_cashier();
revoke all on function cafe_private.protect_drawer_cashier() from public,anon,authenticated;

-- Fast customer enrollment, preserving the existing 50-point welcome rule.
create function public.pos_enroll_customer(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; normalized_phone text:=regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g'); customer jsonb; begin
  result:=cafe_private.drawer_replay(p_request,'customer',p_payload); if result is not null then return result; end if;
  if length(trim(coalesce(p_payload->>'name',''))) not between 1 and 150 or
    (trim(coalesce(p_payload->>'phone',''))<>'' and length(normalized_phone) not between 10 and 15) then raise exception 'Escribe el nombre y revisa el teléfono opcional'; end if;
  if normalized_phone<>'' and exists(select 1 from public.customers where regexp_replace(coalesce(customers.phone,''),'[^0-9]','','g')=normalized_phone) then
    raise exception 'Ese teléfono ya está registrado. Busca y selecciona al cliente existente';
  end if;
  customer:=public.pos_register_customer(p_payload->>'name',normalized_phone,nullif(p_payload->>'birthday','')::date,coalesce((p_payload->>'promos')::boolean,false));
  result:=jsonb_build_object('request_id',p_request,'customer',customer);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'customer',p_payload,result,now());
  return result;
end $$;

revoke all on function public.pos_drawer_status(),public.pos_set_drawer_rate(uuid,jsonb),public.pos_begin_drawer_handoff(uuid,jsonb),
  public.pos_accept_drawer_handoff(uuid,jsonb),public.pos_reassign_drawer_handoff(uuid,jsonb),public.pos_drawer_history(),public.pos_enroll_customer(uuid,jsonb) from public,anon;
grant execute on function public.pos_drawer_status(),public.pos_set_drawer_rate(uuid,jsonb),public.pos_begin_drawer_handoff(uuid,jsonb),
  public.pos_accept_drawer_handoff(uuid,jsonb),public.pos_reassign_drawer_handoff(uuid,jsonb),public.pos_drawer_history(),public.pos_enroll_customer(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
