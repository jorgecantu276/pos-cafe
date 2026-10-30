begin;
-- Hosted PostgREST sessions enforce safe-update predicates even on singletons.
create or replace function public.pos_set_drawer_rate(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; amount numeric:=(p_payload->>'rate')::numeric; begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  result:=cafe_private.drawer_replay(p_request,'rate',p_payload); if result is not null then return result; end if;
  if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>1000 or amount<>round(amount,4) then raise exception 'Tipo de cambio inválido'; end if;
  if exists(select 1 from public.cash_registers where status='open') or exists(select 1 from cafe_private.drawer_handoffs where accepted_at is null) then
    raise exception 'Cambia el tipo de cambio con la caja cerrada y sin entrega pendiente';
  end if;
  update cafe_private.drawer_settings set rate=amount,updated_by=auth.uid(),updated_at=now() where singleton=true;
  if not found then raise exception 'Falta la configuración de caja. Solicita revisión al administrador'; end if;
  result:=jsonb_build_object('request_id',p_request,'rate',amount);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'rate',p_payload,result,now());
  return result;
end $$;
notify pgrst,'reload schema';
commit;
