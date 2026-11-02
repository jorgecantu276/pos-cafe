-- CLIP requests are durable and independent of browser/Windows lifetime.
begin;
create function cafe_private.clip_quote(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.cash_registers; o public.orders; product public.products; extra public.extras; customer public.customers;
  line jsonb; xid text; qty integer; unit numeric; total numeric:=0; preview numeric;
  mxn numeric; usd numeric; received numeric; method text; cid uuid; earned integer:=0;
  lines jsonb:='[]'; extra_list jsonb; line_product jsonb;
  note text; phases text[]; customer_name text:='Invitado';
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  select * into o from public.orders where cashier_id=auth.uid() and request_id=p_request;
  if found then
    if o.request_payload is distinct from p_payload then raise exception 'Identidad de venta reutilizada con otros datos'; end if;
    return o.receipt_snapshot || jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status',o.status);
  end if;
  if exists(select 1 from cafe_private.abandoned_checkouts where cashier_id=auth.uid() and request_id=p_request) then raise exception 'Solicitud descartada; no se registró una venta'; end if;
  select * into r from public.cash_registers where id=(p_payload->>'register_id')::uuid and opened_by=auth.uid() for update;
  if not found or r.status<>'open' or r.exchange_rate is null then raise exception 'Abre o recupera tu turno antes de cobrar'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Orden vacía o demasiado grande'; end if;
  method:=p_payload->>'payment_method';
  if method is null or method not in ('efectivo','mixto','tarjeta','otro') then raise exception 'Método inválido'; end if;
  if p_payload->'pager_number' is not null and p_payload->'pager_number'<>'null'::jsonb and
    (jsonb_typeof(p_payload->'pager_number')<>'number' or (p_payload->>'pager_number')::numeric<>trunc((p_payload->>'pager_number')::numeric)
    or (p_payload->>'pager_number')::numeric not between 1 and 30) then raise exception 'El control debe ser del 1 al 30'; end if;
  -- Stable locks also protect duplicate product lines within one sale.
  perform 1 from public.products where id in(select (v->>'product_id')::uuid from jsonb_array_elements(p_payload->'items') v) order by id for update;
  for line in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
      or (line->>'quantity')::numeric not between 1 and 1000 then raise exception 'Cantidad inválida'; end if;
    qty:=(line->>'quantity')::integer;
    select * into product from public.products where id=(line->>'product_id')::uuid;
    if not found or product.is_active is not true or product.price is null or product.price<0 or product.price::text='NaN' then raise exception 'Producto no disponible'; end if;
    if jsonb_typeof(line->'extra_ids') is distinct from 'array' or jsonb_array_length(line->'extra_ids')>30 then raise exception 'Extras inválidos'; end if;
    unit:=product.price; extra_list:='[]'; phases:='{}';
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(line->'extra_ids')) then raise exception 'Extra duplicado'; end if;
    for xid in select value from jsonb_array_elements_text(line->'extra_ids') loop
      select * into extra from public.extras where id=xid::uuid for share;
      if not found or extra.active is not true or product.customizable is not true or not coalesce(extra.phase=any(product.wizard_steps),false)
        or extra.price is null or extra.price<0 or extra.price::text='NaN' then raise exception 'Extra no permitido'; end if;
      if extra.phase in ('Tamaño','Tipo de Leche') and extra.phase=any(phases) then raise exception 'Selecciona una opción por fase'; end if;
      phases:=array_append(phases,extra.phase); unit:=unit+extra.price;
      extra_list:=extra_list||jsonb_build_array(jsonb_build_object('id',extra.id,'name',extra.name,'phase',extra.phase,'price',extra.price));
    end loop;
    note:=coalesce(line->>'note','');
    if length(note)>1000 then raise exception 'Nota demasiado larga'; end if;
    line_product:=jsonb_build_object('id',product.id,'name',product.name,'price',unit,'basePrice',product.price,'category',product.category,'displayExtras',extra_list,'note',note);
    lines:=lines||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'quantity',qty,'product',line_product));
    total:=total+unit*qty;
  end loop;
  preview:=(p_payload->>'expected_total')::numeric;
  if total<=0 or total>10000000 or preview is null or total<>preview then raise exception 'El catálogo cambió. Revisa la orden antes de cobrar'; end if;
  if length(coalesce(p_payload->>'order_note',''))>1000 or (p_payload->>'order_type') is null or (p_payload->>'order_type') not in ('En Local','Para Llevar') then raise exception 'Datos de preparación inválidos'; end if;
  mxn:=(p_payload->>'tender_mxn')::numeric; usd:=(p_payload->>'tender_usd')::numeric;
  if mxn is null or usd is null or mxn::text in ('NaN','Infinity','-Infinity') or usd::text in ('NaN','Infinity','-Infinity') or mxn<0 or usd<0 or mxn>10000000 or usd>1000000 or mxn<>round(mxn,2) or usd<>round(usd,2) then raise exception 'Importe recibido inválido'; end if;
  received:=round(mxn+usd*r.exchange_rate,2);
  if method in ('efectivo','mixto') and received<total then raise exception 'Efectivo insuficiente'; end if;
  if method in ('tarjeta','otro') and (mxn<>0 or usd<>0) then raise exception 'No registres efectivo con este método'; end if;
  cid:=nullif(p_payload->>'customer_id','')::uuid;
  if cid is not null then
    select * into customer from public.customers where id=cid for update;
    if not found then raise exception 'Cliente no disponible'; end if;
    earned:=floor(total/10); customer_name:=customer.name;
  end if;
  return jsonb_build_object('items',lines,'total',total,'customer_name',customer_name,'order_type',p_payload->>'order_type',
    'order_note',p_payload->>'order_note','created_at',now(),'payment_method','tarjeta','tender_mxn',0,'tender_usd',0,
    'exchange_rate',r.exchange_rate,'change_mxn',0,'pager_number',(p_payload->>'pager_number')::integer);
end $$;
revoke all on function cafe_private.clip_quote(uuid,jsonb) from public,anon,authenticated,service_role;

create table cafe_private.clip_payments (
  request_id uuid primary key, actor_id uuid not null references public.profiles(id),
  register_id uuid not null references public.cash_registers(id), payload jsonb not null, quote jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','dispatching','pending','review','failed','completed')),
  terminal_serial text, provider_id text unique, provider_transaction text unique, evidence jsonb,
  webhook_key uuid not null default gen_random_uuid(), result jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index clip_one_unresolved_actor on cafe_private.clip_payments(actor_id) where state not in ('failed','completed');
create unique index clip_one_unresolved_terminal on cafe_private.clip_payments(terminal_serial) where state not in ('failed','completed');
create index clip_unresolved_register on cafe_private.clip_payments(register_id) where state not in ('failed','completed');
create table cafe_private.clip_webhook_hints (
  request_id uuid references cafe_private.clip_payments(request_id), provider_id text not null,
  created_at timestamptz not null default now(), primary key(request_id,provider_id)
);
revoke all on cafe_private.clip_payments,cafe_private.clip_webhook_hints from public,anon,authenticated,service_role;

create function public.pos_clip_prepare(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payment cafe_private.clip_payments; snapshot jsonb; begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>256000 or p_payload->>'payment_method' is distinct from 'tarjeta' then raise exception 'Solicitud CLIP inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  -- Same lock order as closing/finalization: register, then payment.
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
    snapshot:=cafe_private.clip_quote(p_request,p_payload);
  exception when sqlstate 'P0001' or sqlstate '22P02' or sqlstate '22003' or sqlstate '22023' then
    -- No journal/dispatch exists: the UI may correct this newly rejected quote.
    raise exception 'Revisa el pedido y el catálogo antes de enviar a CLIP' using errcode='PCL01';
  end;
  insert into cafe_private.clip_payments(request_id,actor_id,register_id,payload,quote)
    values(p_request,auth.uid(),(p_payload->>'register_id')::uuid,p_payload,snapshot);
  return jsonb_build_object('request_id',p_request,'state','prepared');
end $$;
revoke all on function public.pos_clip_prepare(uuid,jsonb) from public,anon,service_role;
grant execute on function public.pos_clip_prepare(uuid,jsonb) to authenticated;

-- Service-only journal methods. Browsers cannot claim, attach, approve or fail a payment.
create function public.pos_clip_get(p_request uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(p)||jsonb_build_object('hints',coalesce((select jsonb_agg(h.provider_id order by h.created_at desc) from cafe_private.clip_webhook_hints h where h.request_id=p.request_id),'[]'))
  from cafe_private.clip_payments p where p.request_id=p_request and (p_actor is null or p.actor_id=p_actor)
$$;
create function public.pos_clip_claim(p_request uuid,p_actor uuid,p_terminal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p cafe_private.clip_payments; begin
  if p_terminal is null or p_terminal !~ '^[A-Za-z0-9-]{5,80}$' then raise exception 'Terminal inválida'; end if;
  select * into p from cafe_private.clip_payments where request_id=p_request and actor_id=p_actor for update;
  if not found then raise exception 'Pago no disponible'; end if;
  if p.state<>'prepared' then return jsonb_build_object('claimed',false); end if;
  update cafe_private.clip_payments set state='dispatching',terminal_serial=p_terminal,updated_at=now() where request_id=p_request;
  return jsonb_build_object('claimed',true);
end $$;
create function public.pos_clip_attach(p_request uuid,p_actor uuid,p_provider text) returns void
language plpgsql security definer set search_path='' as $$
declare p cafe_private.clip_payments; begin
  if p_provider is null or p_provider !~ '^pinpad-[A-Za-z0-9-]{8,100}$' then raise exception 'Identidad CLIP inválida'; end if;
  select * into p from cafe_private.clip_payments where request_id=p_request and actor_id=p_actor for update;
  if not found or p.state='prepared' then raise exception 'Pago no enviado'; end if;
  if p.provider_id is not null and p.provider_id<>p_provider then raise exception 'Otro pago ya está vinculado'; end if;
  update cafe_private.clip_payments set provider_id=p_provider,state=case when state='dispatching' then 'pending' else state end,updated_at=now() where request_id=p_request;
end $$;
create function public.pos_clip_notify(p_request uuid,p_key uuid,p_provider text) returns void
language plpgsql security definer set search_path='' as $$ begin
  if p_provider is null or p_provider !~ '^pinpad-[A-Za-z0-9-]{8,100}$' then return; end if;
  perform 1 from cafe_private.clip_payments where request_id=p_request and webhook_key=p_key and state not in ('prepared','failed','completed') for update;
  if not found then return; end if;
  if (select count(*) from cafe_private.clip_webhook_hints where request_id=p_request)>=16 then return; end if;
  insert into cafe_private.clip_webhook_hints(request_id,provider_id) values(p_request,p_provider) on conflict do nothing;
end $$;

create function public.pos_clip_settle(p_request uuid,p_actor uuid,p_provider text,p_outcome text,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p cafe_private.clip_payments; r public.cash_registers; o public.orders; line jsonb; cid uuid; total numeric; earned integer; receipt jsonb; begin
  select register_id into r.id from cafe_private.clip_payments where request_id=p_request and actor_id=p_actor;
  select * into r from public.cash_registers where id=r.id for update;
  select * into p from cafe_private.clip_payments where request_id=p_request and actor_id=p_actor for update;
  if not found then raise exception 'Pago no disponible'; end if;
  if p.state='completed' then return p.result; end if;
  if p.state='failed' then return null; end if;
  if p.state='prepared' then raise exception 'Pago no enviado'; end if;
  if p_outcome='unavailable' and p.provider_id is null and p_evidence=jsonb_build_object('code','ERR10_04') then
    update cafe_private.clip_payments set state='failed',evidence=p_evidence,updated_at=now() where request_id=p_request; return null;
  end if;
  if p.provider_id is distinct from p_provider or p_provider is null then raise exception 'Pago CLIP no vinculado'; end if;
  total:=(p.quote->>'total')::numeric;
  if p_evidence->>'reference' is distinct from ('pos-'||p_request::text)
    or p_evidence->>'device' is distinct from p.terminal_serial
    or (p_evidence->>'amount_cents')::bigint is distinct from (total*100)::bigint
    or p_evidence->>'currency' is distinct from 'MXN' then raise exception 'El pago no corresponde al pedido'; end if;
  if p_outcome='failed' and p_evidence->>'status' in ('CANCELED','REJECTED') and (p_evidence->>'paid_cents')::bigint=0 then
    update cafe_private.clip_payments set state='failed',evidence=p_evidence,updated_at=now() where request_id=p_request; return null;
  end if;
  if p_outcome is distinct from 'completed' or coalesce(p_evidence->>'status','') not in ('COMPLETED','APPROVED')
    or (p_evidence->>'paid_cents')::bigint is distinct from (total*100)::bigint
    or (p_evidence->>'tip_cents')::bigint is distinct from 0 or coalesce(p_evidence->>'transaction','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Aprobación CLIP incompleta'; end if;
  if r.status<>'open' or r.opened_by<>p_actor then raise exception 'Concilia el turno antes de completar el pago recibido'; end if;
  cid:=nullif(p.payload->>'customer_id','')::uuid; earned:=case when cid is null then 0 else floor(total/10)::integer end;
  if cid is not null then update public.customers set points=coalesce(points,0)+earned,total_spent=coalesce(total_spent,0)+total,last_visit=now() where id=cid; end if;
  insert into public.orders(register_id,customer_id,cashier_id,subtotal,discount,total,payment_method,status,request_id,request_payload,points_awarded,tender_mxn,tender_usd,exchange_rate,change_mxn,pager_number)
    values(r.id,cid,p_actor,total,0,total,'tarjeta','completed',p_request,p.payload,earned,0,0,(p.quote->>'exchange_rate')::numeric,0,(p.quote->>'pager_number')::integer) returning * into o;
  for line in select value from jsonb_array_elements(p.quote->'items') loop
    insert into public.order_items(order_id,product_id,quantity,unit_price,total_price,notes,product_snapshot)
      values(o.id,(line->'product'->>'id')::uuid,(line->>'quantity')::integer,(line->'product'->>'price')::numeric,
        (line->>'quantity')::integer*(line->'product'->>'price')::numeric,
        concat_ws(' · ',nullif(line->'product'->>'note',''),(select string_agg(v->>'name',', ') from jsonb_array_elements(line->'product'->'displayExtras') v)),line->'product');
  end loop;
  receipt:=p.quote||jsonb_build_object('created_at',o.created_at);
  update public.orders set receipt_snapshot=receipt where id=o.id;
  receipt:=receipt||jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'status','completed');
  update cafe_private.clip_payments set state='completed',provider_transaction=p_evidence->>'transaction',evidence=p_evidence,result=receipt,updated_at=now() where request_id=p_request;
  return receipt;
end $$;
revoke all on function public.pos_clip_get(uuid,uuid),public.pos_clip_claim(uuid,uuid,text),public.pos_clip_attach(uuid,uuid,text),public.pos_clip_notify(uuid,uuid,text),public.pos_clip_settle(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_clip_get(uuid,uuid),public.pos_clip_claim(uuid,uuid,text),public.pos_clip_attach(uuid,uuid,text),public.pos_clip_notify(uuid,uuid,text),public.pos_clip_settle(uuid,uuid,text,text,jsonb) to service_role;

create function public.pos_clip_pending() returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(row)) from (select p.request_id,p.actor_id,u.full_name as cashier,p.state,p.quote->'total' as total,
    p.quote->'pager_number' as pager_number,p.provider_id,p.created_at from cafe_private.clip_payments p join public.profiles u on u.id=p.actor_id
    where p.state not in ('failed','completed') order by p.created_at limit 100) row),'[]');
end $$;
revoke all on function public.pos_clip_pending() from public,anon,service_role;
grant execute on function public.pos_clip_pending() to authenticated;

-- Fence the existing checkout/abandon and every drawer-close path on the server.
alter function public.pos_checkout(uuid,jsonb) set schema cafe_private;
alter function cafe_private.pos_checkout(uuid,jsonb) rename to manual_checkout;
revoke all on function cafe_private.manual_checkout(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.pos_checkout(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
  perform 1 from public.cash_registers where id=(p_payload->>'register_id')::uuid for update;
  if exists(select 1 from cafe_private.clip_payments where request_id=p_request or (actor_id=auth.uid() and state not in ('failed','completed'))) then raise exception 'Recupera el pago CLIP desde el POS; no vuelvas a cobrar'; end if;
  return cafe_private.manual_checkout(p_request,p_payload);
end $$;
revoke all on function public.pos_checkout(uuid,jsonb) from public,anon,service_role;
grant execute on function public.pos_checkout(uuid,jsonb) to authenticated;
create function cafe_private.clip_fence() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if TG_TABLE_NAME='cash_registers' then
    if old.status='open' and new.status<>'open' and exists(select 1 from cafe_private.clip_payments where register_id=old.id and state not in ('failed','completed')) then raise exception 'Resuelve el pago CLIP pendiente antes de cerrar o entregar caja'; end if;
  else
    if exists(select 1 from cafe_private.clip_payments where actor_id=new.cashier_id and request_id=new.request_id and state<>'failed') then raise exception 'El pago CLIP requiere conciliación; no se puede descartar'; end if;
  end if;
  return new;
end $$;
revoke all on function cafe_private.clip_fence() from public,anon,authenticated,service_role;
create trigger clip_block_drawer_close before update on public.cash_registers for each row execute function cafe_private.clip_fence();
create trigger clip_block_abandon before insert on cafe_private.abandoned_checkouts for each row execute function cafe_private.clip_fence();
notify pgrst,'reload schema';
commit;
