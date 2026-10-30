-- Apply after 202610280001 with the matching application. Synthetic acceptance first.
begin;
select pg_advisory_xact_lock(60281028);
alter table public.cash_registers add column expenses_detail jsonb not null default '[]';
alter table public.cash_registers add column expenses_revision bigint not null default 0;
create table cafe_private.shift_expense_requests (
  request_id uuid primary key,
  register_id uuid not null references public.cash_registers(id),
  cashier_id uuid not null references public.profiles(id),
  payload jsonb not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  unique(register_id,revision)
);
revoke all on cafe_private.shift_expense_requests from public,anon,authenticated;

create function public.pos_shift_summary(p_register uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; sales numeric; cash numeric; expense numeric; methods jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  select * into r from public.cash_registers where id=p_register and
    (opened_by=auth.uid() or cafe_private.is_admin()) for share;
  if not found then raise exception 'Turno no disponible' using errcode='42501'; end if;
  select coalesce(sum(total),0),coalesce(sum(total) filter(where lower(payment_method) in ('efectivo','mixto','cash')),0)
    into sales,cash from public.orders where register_id=r.id and status='completed';
  select coalesce(sum((value->>'amount')::numeric),0) into expense from jsonb_array_elements(r.expenses_detail);
  select coalesce(jsonb_object_agg(method,amount),'{}') into methods from (
    select coalesce(payment_method,'desconocido') method,sum(total) amount
    from public.orders where register_id=r.id and status='completed' group by payment_method
  ) totals;
  return jsonb_build_object('register_id',r.id,'status',r.status,'opened_at',r.opened_at,
    'starting_cash',r.initial_balance,'exchange_rate',r.exchange_rate,'total_sales',sales,'cash_sales',cash,
    'expenses',r.expenses_detail,'expenses_revision',r.expenses_revision,
    'expected_cash',r.initial_balance+cash-expense,'payments',methods);
end $$;

create function public.pos_shift_expenses(p_register uuid,p_request uuid,p_revision bigint,p_expenses jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; previous cafe_private.shift_expense_requests; entry jsonb;
  requested jsonb:=jsonb_build_object('revision',p_revision,'expenses',p_expenses); begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null then raise exception 'Solicitud inválida'; end if;
  -- Lock order matches checkout/closing. A stale tab cannot overwrite a newer revision.
  select * into r from public.cash_registers where id=p_register and opened_by=auth.uid() for update;
  if not found then raise exception 'Turno no disponible' using errcode='42501'; end if;
  select * into previous from cafe_private.shift_expense_requests where request_id=p_request;
  if found then
    if previous.register_id<>r.id or previous.cashier_id<>auth.uid() or previous.payload is distinct from requested then
      raise exception 'La identidad del gasto pertenece a otra solicitud';
    end if;
    return public.pos_shift_summary(r.id);
  end if;
  if r.status<>'open' then raise exception 'El turno ya cerró'; end if;
  if p_revision is distinct from r.expenses_revision then raise exception 'Los gastos cambiaron en otra ventana. Actualiza el turno'; end if;
  if jsonb_typeof(p_expenses) is distinct from 'array' or jsonb_array_length(p_expenses)>100 then raise exception 'Gastos inválidos'; end if;
  for entry in select value from jsonb_array_elements(p_expenses) loop
    if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'desc') is distinct from 'string'
      or length(trim(entry->>'desc')) not between 1 and 200
      or jsonb_typeof(entry->'amount') is distinct from 'number'
      or (entry->>'amount')::numeric<=0 or (entry->>'amount')::numeric>1000000
      or (entry->>'amount')::numeric<>round((entry->>'amount')::numeric,2)
      or entry - 'desc' - 'amount' <> '{}'::jsonb then raise exception 'Gasto inválido'; end if;
  end loop;
  update public.cash_registers set expenses_detail=p_expenses,expenses_revision=expenses_revision+1 where id=r.id;
  insert into cafe_private.shift_expense_requests(request_id,register_id,cashier_id,payload,revision)
    values(p_request,r.id,auth.uid(),requested,r.expenses_revision+1);
  return public.pos_shift_summary(r.id);
end $$;

-- Retire the old unchecked entry point. Preview and final close use the same
-- authoritative summary under the same register lock as checkout.
create function public.pos_close_shift(p_register uuid,p_counted numeric,p_expenses jsonb,p_preview jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.cash_registers; s public.shifts; summary jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  select * into r from public.cash_registers where id=p_register and opened_by=auth.uid() for update;
  if not found then raise exception 'Turno no disponible' using errcode='42501'; end if;
  select * into s from public.shifts where register_id=r.id;
  if found then
    if s.counted_cash is distinct from p_counted or s.expenses_detail is distinct from p_expenses then raise exception 'El turno ya cerró con otro arqueo'; end if;
    return to_jsonb(s);
  end if;
  if r.status<>'open' then raise exception 'El turno ya cerró'; end if;
  if p_counted is null or p_counted::text in ('NaN','Infinity','-Infinity') or p_counted<0
    or p_counted>10000000 or p_counted<>round(p_counted,2) then raise exception 'Arqueo inválido'; end if;
  summary:=public.pos_shift_summary(r.id);
  if p_expenses is distinct from r.expenses_detail or jsonb_typeof(p_preview) is distinct from 'object'
    or p_preview->'expenses_revision' is distinct from summary->'expenses_revision'
    or p_preview->'total_sales' is distinct from summary->'total_sales'
    or p_preview->'cash_sales' is distinct from summary->'cash_sales' then
    raise exception 'El turno cambió desde la vista previa. Actualiza el corte antes de cerrar';
  end if;
  insert into public.shifts(register_id,cashier_id,opened_at,starting_cash,total_sales,total_expenses,expected_cash,counted_cash,difference,expenses_detail,user_name)
    values(r.id,auth.uid(),r.opened_at,r.initial_balance,(summary->>'total_sales')::numeric,
      r.initial_balance+(summary->>'cash_sales')::numeric-(summary->>'expected_cash')::numeric,
      (summary->>'expected_cash')::numeric,p_counted,p_counted-(summary->>'expected_cash')::numeric,
      r.expenses_detail,(select full_name from public.profiles where id=auth.uid())) returning * into s;
  update public.cash_registers set status='closed',closed_by=auth.uid(),closed_at=now(),final_balance=p_counted where id=r.id;
  return to_jsonb(s);
end $$;
revoke all on function public.pos_close_shift(uuid,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.pos_shift_summary(uuid),public.pos_shift_expenses(uuid,uuid,bigint,jsonb),
  public.pos_close_shift(uuid,numeric,jsonb,jsonb) from public,anon;
grant execute on function public.pos_shift_summary(uuid),public.pos_shift_expenses(uuid,uuid,bigint,jsonb),
  public.pos_close_shift(uuid,numeric,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
