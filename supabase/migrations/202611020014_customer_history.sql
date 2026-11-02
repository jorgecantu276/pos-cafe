begin;
create function public.pos_customer_history(p_customer uuid,p_page integer default 0,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare captured timestamptz:=statement_timestamp(); ceiling timestamptz; result jsonb;
begin
  if not cafe_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Página inválida'; end if;
  if p_as_of is not null and (not isfinite(p_as_of) or p_as_of>captured) then raise exception 'Fecha de consulta inválida'; end if;
  if p_customer is null or not exists(select 1 from public.customers where id=p_customer) then raise exception 'El cliente ya no existe'; end if;
  ceiling:=coalesce(p_as_of,captured);
  with filtered as materialized(select * from public.orders where customer_id=p_customer and created_at<=ceiling),
    page as(select * from filtered order by created_at desc,id desc limit 50 offset p_page*50)
  select jsonb_build_object('captured_at',captured,'as_of',ceiling,'page',p_page,'page_size',50,
    'summary',(select jsonb_build_object('rows',count(*),'sales',coalesce(sum(total) filter(where status='completed'),0)) from filtered),
    'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'ticket_number',o.ticket_number,'created_at',o.created_at,
      'total',o.total,'status',o.status,'payment_method',o.payment_method,'order_items',
      coalesce((select jsonb_agg(jsonb_build_object('quantity',i.quantity,'unit_price',i.unit_price,'total_price',i.total_price,
        'notes',i.notes,'product_snapshot',i.product_snapshot,'products',jsonb_build_object('name',p.name)) order by i.id)
        from public.order_items i left join public.products p on p.id=i.product_id where i.order_id=o.id),'[]'::jsonb))
      order by o.created_at desc,o.id desc) from page o),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.pos_customer_history(uuid,integer,timestamptz) from public,anon;
grant execute on function public.pos_customer_history(uuid,integer,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
