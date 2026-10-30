begin;

-- Ten-digit local numbers are Mexican. Explicit international prefixes remain
-- distinct (e.g. +1 US numbers); punctuation never changes customer identity.
create function cafe_private.loyalty_phone_key(p_phone text) returns text
language sql immutable set search_path='' as $$
  select case when length(d)=10 then '52'||d else d end
  from (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d) normalized
$$;
revoke all on function cafe_private.loyalty_phone_key(text) from public,anon,authenticated;

-- Cover both the durable enrollment RPC and the older registration entry point.
-- Existing customers are preserved; only new registrations require a phone.
create or replace function public.pos_register_customer(p_name text,p_phone text,p_birth_date date,p_promos boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.customers; digits text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); phone_key text;
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 150 or length(coalesce(p_phone,''))>60
    or length(digits) not between 10 and 15 or coalesce(p_phone,'') ~ '[^0-9+().[:space:]-]'
    or p_birth_date>current_date then raise exception 'Escribe el nombre y un teléfono válido de 10 a 15 dígitos'; end if;
  phone_key:=cafe_private.loyalty_phone_key(digits);
  perform pg_advisory_xact_lock(hashtextextended('loyalty:'||phone_key,0));
  if exists(select 1 from public.customers where cafe_private.loyalty_phone_key(phone)=phone_key) then
    raise exception 'Ese teléfono ya está registrado. Busca y selecciona al cliente existente';
  end if;
  insert into public.customers(name,phone,birth_date,accept_promos,points,customer_code)
    values(trim(p_name),phone_key,p_birth_date,coalesce(p_promos,false),50,'AA-'||replace(gen_random_uuid()::text,'-','')) returning * into c;
  return to_jsonb(c);
end $$;

create or replace function public.pos_enroll_customer(p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; customer jsonb; begin
  result:=cafe_private.drawer_replay(p_request,'customer',p_payload); if result is not null then return result; end if;
  customer:=public.pos_register_customer(p_payload->>'name',p_payload->>'phone',nullif(p_payload->>'birthday','')::date,coalesce((p_payload->>'promos')::boolean,false));
  result:=jsonb_build_object('request_id',p_request,'customer',customer);
  insert into cafe_private.drawer_requests values(p_request,auth.uid(),'customer',p_payload,result,now());
  return result;
end $$;

-- Parameterized search avoids raw PostgREST filter interpolation. Phone matches
-- rank ahead of name/code matches, and only five choices leave the server.
create function public.pos_search_customers(p_search text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(p_search,'')); digits text:=regexp_replace(query,'[^0-9]','','g'); phone_query boolean;
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if length(query) not between 2 and 100 then return '[]'::jsonb; end if;
  phone_query:=length(digits)>=2 and query !~ '[^0-9+().[:space:]-]';
  return (select coalesce(jsonb_agg(to_jsonb(matches)-'rank' order by rank,name,id),'[]'::jsonb) from (
    select c.*,case when phone_query and cafe_private.loyalty_phone_key(c.phone)=cafe_private.loyalty_phone_key(query) then 0
      when phone_query and strpos(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),digits)>0 then 1 else 2 end rank
    from public.customers c
    where (phone_query and (strpos(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),digits)>0
      or cafe_private.loyalty_phone_key(c.phone)=cafe_private.loyalty_phone_key(query)))
      or strpos(lower(c.name),lower(query))>0 or strpos(lower(c.customer_code),lower(query))>0
    order by rank,c.name,c.id limit 5
  ) matches);
end $$;
revoke all on function public.pos_search_customers(text) from public,anon;
grant execute on function public.pos_search_customers(text) to authenticated;
notify pgrst,'reload schema';
commit;
