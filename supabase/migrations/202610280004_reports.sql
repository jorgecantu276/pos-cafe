-- Read-only administrative reports. One statement snapshot per response; money
-- stays numeric in PostgreSQL and totals never depend on a PostgREST row cap.
begin;

create function cafe_private.report_window(p_period text, p_from date, p_to date)
returns table(start_at timestamptz,end_at timestamptz,day date)
language plpgsql stable set search_path='' as $$
begin
  day := (statement_timestamp() at time zone 'America/Matamoros')::date;
  if p_period='all' then
    if p_from is not null or p_to is not null then raise exception 'Fechas incompatibles con Histórico'; end if;
    start_at:=null; end_at:=null;
  elsif p_period='today' then
    if p_from is not null or p_to is not null then raise exception 'Fechas incompatibles con Hoy'; end if;
    start_at:=day::timestamp at time zone 'America/Matamoros';
    end_at:=(day+1)::timestamp at time zone 'America/Matamoros';
  elsif p_period='range' then
    if p_from is null or p_to is null or p_from>p_to or not isfinite(p_from) or not isfinite(p_to)
      then raise exception 'Selecciona un intervalo de fechas válido'; end if;
    start_at:=p_from::timestamp at time zone 'America/Matamoros';
    end_at:=(p_to+1)::timestamp at time zone 'America/Matamoros';
  else raise exception 'Periodo inválido'; end if;
  return next;
end $$;
revoke all on function cafe_private.report_window(text,date,date) from public,anon,authenticated;

create function public.pos_sales_report(p_period text default 'today',p_from date default null,p_to date default null,
  p_search text default '',p_page integer default 0,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w record; result jsonb; captured timestamptz:=statement_timestamp(); ceiling timestamptz;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>1000000 or p_search is null or length(p_search)>100 then raise exception 'Consulta inválida'; end if;
  if p_as_of is not null and (not isfinite(p_as_of) or p_as_of>captured) then raise exception 'Fecha de consulta inválida'; end if;
  ceiling:=coalesce(p_as_of,captured);
  select * into w from cafe_private.report_window(p_period,p_from,p_to);
  with filtered as materialized (
    select o.* from public.orders o
    where o.created_at<=ceiling and (w.start_at is null or o.created_at>=w.start_at)
      and (w.end_at is null or o.created_at<w.end_at)
      and (btrim(p_search)='' or strpos(lower(o.id::text),lower(btrim(p_search)))>0
        or (ltrim(btrim(p_search),'#')<>'' and strpos(lpad(o.ticket_number::text,greatest(4,length(o.ticket_number::text)),'0'),ltrim(btrim(p_search),'#'))>0)
        or exists(select 1 from public.order_items i left join public.products p on p.id=i.product_id
          where i.order_id=o.id and strpos(lower(coalesce(i.product_snapshot->>'name',p.name,'Producto eliminado')),lower(btrim(p_search)))>0))
  ), summary as (
    select count(*) as rows, count(*) filter(where status='completed') as completed,
      count(*) filter(where status='pending') as pending,
      count(*) filter(where status in ('cancelled','canceled')) as cancelled,
      coalesce(sum(total) filter(where status='completed'),0) as sales,
      coalesce(round(avg(total) filter(where status='completed'),2),0) as average
    from filtered
  ), page as (select * from filtered order by created_at desc,id desc limit 50 offset p_page*50),
  top_products as (
    select coalesce(i.product_snapshot->>'name',p.name,'Producto eliminado') as name,sum(i.quantity) as quantity
    from filtered o join public.order_items i on i.order_id=o.id left join public.products p on p.id=i.product_id
    where o.status='completed' group by 1 order by quantity desc,name limit 3
  ), payments as (
    select case payment_method when 'cash' then 'Efectivo' when 'efectivo' then 'Efectivo'
      when 'card' then 'Tarjeta' when 'tarjeta' then 'Tarjeta' when 'mixto' then 'Mixto' else 'Otro' end as name,
      sum(total) as total from filtered where status='completed' group by 1
  )
  select jsonb_build_object('captured_at',captured,'as_of',ceiling,'day',w.day,'start_at',w.start_at,'end_at',w.end_at,
    'page',p_page,'page_size',50,'summary',(select to_jsonb(s) from summary s),
    'registered_customers',(select count(*) from public.customers),
    'active_products',(select count(*) from public.products where is_active),
    'top_products',coalesce((select jsonb_agg(t order by quantity desc,name) from top_products t),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(t order by total desc,name) from payments t),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('order_items',
      coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('products',jsonb_build_object('name',p.name)) order by i.id)
        from public.order_items i left join public.products p on p.id=i.product_id where i.order_id=o.id),'[]'::jsonb))
      order by o.created_at desc,o.id desc) from page o),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.pos_shift_history(p_period text default 'all',p_from date default null,p_to date default null,
  p_page integer default 0,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w record; result jsonb; captured timestamptz:=statement_timestamp(); ceiling timestamptz;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Página inválida'; end if;
  if p_as_of is not null and (not isfinite(p_as_of) or p_as_of>captured) then raise exception 'Fecha de consulta inválida'; end if;
  ceiling:=coalesce(p_as_of,captured);
  select * into w from cafe_private.report_window(p_period,p_from,p_to);
  with filtered as materialized(select * from public.shifts s where s.created_at<=ceiling
      and(w.start_at is null or s.created_at>=w.start_at) and(w.end_at is null or s.created_at<w.end_at)),
    page as(select * from filtered order by created_at desc,id desc limit 50 offset p_page*50)
  select jsonb_build_object('captured_at',captured,'as_of',ceiling,'day',w.day,'page',p_page,'page_size',50,
    'summary',(select jsonb_build_object('rows',count(*),'sales',coalesce(sum(total_sales),0),
      'expenses',coalesce(sum(total_expenses),0),'difference',coalesce(sum(difference),0)) from filtered),
    'shifts',coalesce((select jsonb_agg(s order by created_at desc,id desc) from page s),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.pos_customer_report(p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>1000000 or p_search is null or length(p_search)>100 then raise exception 'Consulta inválida'; end if;
  with spending as (
    select customer_id,sum(total) as spent from public.orders where status='completed' and created_at<=statement_timestamp() group by customer_id
  ), filtered as materialized (
    select c.id,c.name,c.phone,c.points,coalesce(s.spent,0) as completed_spent from public.customers c
      left join spending s on s.customer_id=c.id
      where strpos(lower(c.name),lower(btrim(p_search)))>0 or strpos(coalesce(c.phone,''),btrim(p_search))>0
  ), page as(select * from filtered order by completed_spent desc,name,id limit 50 offset p_page*50)
  select jsonb_build_object('captured_at',statement_timestamp(),'page',p_page,'page_size',50,
    'summary',(select jsonb_build_object('rows',count(*),'sales',coalesce(sum(completed_spent),0)) from filtered),
    'customers',coalesce((select jsonb_agg(c order by completed_spent desc,name,id) from page c),'[]'::jsonb)) into result;
  return result;
end $$;

revoke all on function public.pos_sales_report(text,date,date,text,integer,timestamptz),
  public.pos_shift_history(text,date,date,integer,timestamptz),public.pos_customer_report(text,integer) from public,anon,authenticated;
grant execute on function public.pos_sales_report(text,date,date,text,integer,timestamptz),
  public.pos_shift_history(text,date,date,integer,timestamptz),public.pos_customer_report(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
