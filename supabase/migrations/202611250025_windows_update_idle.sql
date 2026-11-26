begin;

-- One read snapshot covers the drawer, handoffs and CLIP reconciliation.
create or replace function public.pos_windows_update_idle() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.cash_registers where status = 'open'
  ) and not exists (
    select 1 from cafe_private.drawer_handoffs where accepted_at is null
  ) and not exists (
    select 1 from cafe_private.clip_payments where state not in ('failed', 'completed')
  );
$$;

revoke all on function public.pos_windows_update_idle() from public, anon, authenticated;
grant execute on function public.pos_windows_update_idle() to service_role;
notify pgrst, 'reload schema';

commit;

