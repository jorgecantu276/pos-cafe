begin;

-- Correct contact data in place. The private request journal preserves the
-- original values, actor and exact result without changing loyalty or sales.
create function public.pos_edit_customer(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; customer public.customers; previous jsonb;
  customer_name text:=trim(coalesce(p_payload->>'name',''));
  phone text:=coalesce(p_payload->>'phone','');
  digits text:=regexp_replace(phone,'[^0-9]','','g'); phone_key text;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_payload->>'actor_id' is distinct from auth.uid()::text then
    raise exception 'La sesión cambió. Recupera la corrección con el responsable original' using errcode='42501';
  end if;
  -- Enrollment takes the drawer lock before the phone lock. Keep that order;
  -- direct legacy registration takes only the same canonical phone lock.
  result:=cafe_private.drawer_replay(p_request,'customer_edit',p_payload);
  if result is not null then return result; end if;
  if length(customer_name) not between 1 and 150 or length(phone)>60
    or length(digits) not between 10 and 15 or phone ~ '[^0-9+().[:space:]-]'
    or nullif(p_payload->>'customer_id','') is null then
    raise exception 'Escribe el nombre y un teléfono válido de 10 a 15 dígitos';
  end if;
  phone_key:=cafe_private.loyalty_phone_key(phone);
  perform pg_advisory_xact_lock(hashtextextended('loyalty:'||phone_key,0));
  select * into customer from public.customers where id=(p_payload->>'customer_id')::uuid for update;
  if not found then raise exception 'El cliente ya no está disponible. Actualiza la lista'; end if;
  if exists(select 1 from public.customers c where c.id<>customer.id and cafe_private.loyalty_phone_key(c.phone)=phone_key) then
    raise exception 'Ese teléfono ya está registrado en otro cliente. Busca al cliente existente';
  end if;
  previous:=jsonb_build_object('name',customer.name,'phone',customer.phone);
  update public.customers set name=customer_name,phone=phone_key where id=customer.id returning * into customer;
  result:=jsonb_build_object('request_id',p_request,'customer',to_jsonb(customer),'previous',previous);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'customer_edit',p_payload,result,now());
  return result;
end $$;
revoke all on function public.pos_edit_customer(uuid,jsonb) from public,anon;
grant execute on function public.pos_edit_customer(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
