-- Require an explicit delivery control for NEW sales and CLIP quotations.
-- Existing receipts and in-flight payment identities remain recoverable as saved.
begin;
create function cafe_private.require_order_pager(p_payload jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare pager numeric; begin
  if jsonb_typeof(p_payload->'pager_number') is distinct from 'number' then
    raise exception 'Elige un control del 1 al 30';
  end if;
  pager:=(p_payload->>'pager_number')::numeric;
  if pager<>trunc(pager) or pager not between 1 and 30 then
    raise exception 'Elige un control del 1 al 30';
  end if;
end $$;
revoke all on function cafe_private.require_order_pager(jsonb) from public,anon,authenticated,service_role;

create or replace function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  perform 1 from public.cash_registers where id=(p_payload->>'register_id')::uuid for update;
  if exists(select 1 from cafe_private.clip_payments where request_id=p_request or (actor_id=auth.uid() and state not in ('failed','completed'))) then raise exception 'Recupera el pago CLIP desde el POS; no vuelvas a cobrar'; end if;
  if not exists(select 1 from public.orders where cashier_id=auth.uid() and request_id=p_request) then
    perform cafe_private.require_order_pager(p_payload);
  end if;
  return cafe_private.manual_checkout(p_request,p_payload);
end $$;

create or replace function public.pos_clip_prepare(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payment cafe_private.clip_payments; snapshot jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>256000 or p_payload->>'payment_method' is distinct from 'tarjeta' then raise exception 'Solicitud CLIP inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  perform 1 from public.cash_registers where id=(p_payload->>'register_id')::uuid for update;
  select * into payment from cafe_private.clip_payments where request_id=p_request;
  if found then
    if payment.actor_id<>auth.uid() then raise exception 'Pago de otro cajero' using errcode='42501'; end if;
    if payment.payload is distinct from p_payload then raise exception 'La identidad del pago cambió'; end if;
    return jsonb_build_object('request_id',p_request,'state',payment.state);
  end if;
  if exists(select 1 from public.orders where cashier_id=auth.uid() and request_id=p_request) then raise exception 'La venta ya existe; recupera su comprobante'; end if;
  if exists(select 1 from cafe_private.clip_payments where actor_id=auth.uid() and state not in ('failed','completed')) then raise exception 'Resuelve el pago CLIP pendiente'; end if;
  begin
    perform cafe_private.require_order_pager(p_payload);
    snapshot:=cafe_private.clip_quote(p_request,p_payload);
  exception when sqlstate 'P0001' or sqlstate '22P02' or sqlstate '22003' or sqlstate '22023' then
    raise exception 'Revisa el pedido y el control de entrega antes de enviar a CLIP' using errcode='PCL01';
  end;
  insert into cafe_private.clip_payments(request_id,actor_id,register_id,payload,quote)
    values(p_request,auth.uid(),(p_payload->>'register_id')::uuid,p_payload,snapshot);
  return jsonb_build_object('request_id',p_request,'state','prepared');
end $$;
notify pgrst,'reload schema';
commit;
