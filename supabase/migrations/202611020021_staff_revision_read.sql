-- 001 grants profile reads by explicit column. Make the 020 revision visible
-- through that same existing admin/self RLS policy, without granting SELECT *.
begin;
grant select(management_revision) on public.profiles to authenticated;
notify pgrst,'reload schema';
commit;
