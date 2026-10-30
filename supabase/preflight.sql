-- Aggregate-only, read-only release compatibility check on the ORIGINAL schema.
-- Returns no names, phones, passwords, PINs, tokens, order amounts or records.
begin read only;
select jsonb_pretty(jsonb_build_object(
  'active_admin_candidates',(select count(*) from public.profiles where role='admin'),
  'unknown_profile_roles',(select count(*) from public.profiles where role is null or role not in ('admin','barista','cashier')),
  'missing_login_aliases',(select count(*) from public.profiles where username is null or trim(username)=''),
  'duplicate_normalized_alias_groups',(select count(*) from (select lower(regexp_replace(username,'\s','','g')) from public.profiles where username is not null group by 1 having count(*)>1) x),
  'auth_alias_mismatches',(select count(*) from public.profiles p join auth.users u on u.id=p.id where p.username is not null and lower(u.email) is distinct from lower(regexp_replace(p.username,'\s','','g'))||'@carinitomio.local'),
  'existing_open_registers',(select count(*) from public.cash_registers where status='open'),
  'negative_or_null_product_stock',(select count(*) from public.products where stock is null or stock<0),
  'products_at_default_ten_stock',(select count(*) from public.products where stock=10),
  'products_with_invalid_prices',(select count(*) from public.products where price<0 or price::text='NaN'),
  'invalid_supply_balances',(select count(*) from public.supplies where current_stock is null or current_stock<0 or current_stock::text='NaN'),
  'invalid_recipe_lines',(select count(*) from public.product_recipes where product_id is null or supply_id is null or quantity_required<=0 or quantity_required::text='NaN'),
  'duplicate_recipe_pairs',(select count(*) from (select product_id,supply_id from public.product_recipes group by 1,2 having count(*)>1) x),
  'legacy_pending_orders',(select count(*) from public.orders where status='pending'),
  'duplicate_ticket_number_groups',(select count(*) from (select ticket_number from public.orders group by 1 having count(*)>1) x)
)) as release_preflight;
commit;
