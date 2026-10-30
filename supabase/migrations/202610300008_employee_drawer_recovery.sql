begin;

-- Supervisor closes an abandoned shift without impersonating its cashier.
-- The original cashier and frozen financial summary remain on the closing slip.
create function public.pos_manager_close_drawer(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; r public.cash_registers; s public.shifts; summary jsonb;
  amount numeric:=(p_payload->>'counted')::numeric; reason text:=trim(coalesce(p_payload->>'reason',''));
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  result:=cafe_private.drawer_replay(p_request,'manager_close',p_payload); if result is not null then return result; end if;
  if p_payload->'count_confirmed' is distinct from 'true'::jsonb or length(reason) not between 3 and 300
    or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>10000000 or amount<>round(amount,2)
    then raise exception 'Cuenta el efectivo y explica por qué el responsable cierra este turno'; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register')::uuid for update;
  if not found or r.status<>'open' then raise exception 'El turno ya no está abierto. Actualiza el estado'; end if;
  if exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null) then raise exception 'Primero resuelve la entrega pendiente'; end if;
  summary:=public.pos_shift_summary(r.id);
  if jsonb_typeof(p_payload->'preview') is distinct from 'object'
    or p_payload->'preview'->'expenses_revision' is distinct from summary->'expenses_revision'
    or p_payload->'preview'->'total_sales' is distinct from summary->'total_sales'
    or p_payload->'preview'->'cash_sales' is distinct from summary->'cash_sales' then
    raise exception 'El turno cambió desde la vista previa. Actualiza antes de cerrar';
  end if;
  insert into public.shifts(register_id,cashier_id,opened_at,starting_cash,total_sales,total_expenses,expected_cash,counted_cash,difference,expenses_detail,user_name)
    values(r.id,r.opened_by,r.opened_at,r.initial_balance,(summary->>'total_sales')::numeric,
      r.initial_balance+(summary->>'cash_sales')::numeric-(summary->>'expected_cash')::numeric,
      (summary->>'expected_cash')::numeric,amount,amount-(summary->>'expected_cash')::numeric,
      r.expenses_detail,(select full_name from public.profiles where id=r.opened_by)) returning * into s;
  update public.cash_registers set status='closed',closed_by=auth.uid(),closed_at=now(),final_balance=amount where id=r.id;
  result:=jsonb_build_object('request_id',p_request,'report',to_jsonb(s),'original_cashier',r.opened_by,'closed_by',auth.uid(),'reason',reason);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'manager_close',p_payload,result,now());
  return result;
end $$;

create function public.pos_closed_shift(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  select to_jsonb(s)||jsonb_build_object('closed_at',r.closed_at,'closed_by',r.closed_by,
    'manager_reason',(select q.result->>'reason' from cafe_private.drawer_requests q
      where q.operation='manager_close' and q.result->'report'->>'id'=s.id::text limit 1))
    into result from public.shifts s join public.cash_registers r on r.id=s.register_id
    where s.id=p_shift and r.status='closed' and (s.cashier_id=auth.uid() or cafe_private.is_admin());
  if result is null then raise exception 'Corte guardado no disponible' using errcode='42501'; end if;
  return result;
end $$;
revoke all on function public.pos_manager_close_drawer(uuid,jsonb),public.pos_closed_shift(uuid) from public,anon;
grant execute on function public.pos_manager_close_drawer(uuid,jsonb),public.pos_closed_shift(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
