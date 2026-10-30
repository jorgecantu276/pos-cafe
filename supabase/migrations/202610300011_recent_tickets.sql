begin;

-- Bounded historical lookup. RLS still applies; the caller cannot supply an
-- actor or role, and no checkout, cancellation or print journal is changed.
create index orders_recent_tickets on public.orders(created_at desc nulls last,id desc);
create index orders_cashier_recent_tickets on public.orders(cashier_id,created_at desc nulls last,id desc);

create function public.pos_recent_tickets(p_limit integer default 10)
returns table(id uuid,ticket_number integer,total numeric,created_at timestamptz,status text,cashier_name text)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not cafe_private.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Solicita entre 1 y 10 tickets' using errcode='22023';
  end if;
  return query
    select o.id,o.ticket_number,o.total,o.created_at,coalesce(o.status,'unknown'),
      coalesce(nullif(btrim(o.receipt_snapshot->>'cashier_name'),''),
        nullif(btrim(o.receipt_snapshot->'cashier'->>'full_name'),''),
        nullif(btrim(p.full_name),''),'Cajero no registrado')
    from public.orders o left join public.profiles p on p.id=o.cashier_id
    where cafe_private.is_admin() or o.cashier_id=auth.uid()
    order by o.created_at desc nulls last,o.id desc limit p_limit;
end $$;
revoke all on function public.pos_recent_tickets(integer) from public,anon;
grant execute on function public.pos_recent_tickets(integer) to authenticated;
notify pgrst,'reload schema';
commit;
