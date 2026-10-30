begin;

-- One STABLE call uses one MVCC snapshot across all business/Auth tables.
-- Only the server's service role may export password hashes and private audit
-- data. Browser roles, including a signed-in owner, never receive this RPC.
create function public.pos_business_backup() returns text
language plpgsql stable security definer set search_path='' as $$
declare relation record; table_rows jsonb; columns jsonb; sequence_state jsonb;
  tables jsonb:='{}'::jsonb; sequences jsonb:='{}'::jsonb;
begin
  for relation in
    select n.nspname schema_name,c.relname table_name,c.oid
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and not c.relispartition
      and (n.nspname in ('public','cafe_private') or (n.nspname='auth' and c.relname in ('users','identities')))
    order by n.nspname,c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from %I.%I t',relation.schema_name,relation.table_name) into table_rows;
    select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum)
      into columns from pg_catalog.pg_attribute a where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped;
    tables:=tables||jsonb_build_object(relation.schema_name||'.'||relation.table_name,jsonb_build_object('columns',columns,'rows',table_rows));
  end loop;
  if not (tables ? 'auth.users') or not (tables ? 'auth.identities') then
    raise exception 'Faltan tablas de acceso para un respaldo verificable';
  end if;
  -- Sequence values can advance beyond the MVCC rows during active sales;
  -- retaining a higher counter is safe and must not be rewound at recovery.
  for relation in
    select n.nspname schema_name,c.relname sequence_name from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='S' and n.nspname in ('public','cafe_private') order by 1,2
  loop
    execute format('select jsonb_build_object(''last_value'',last_value::text,''is_called'',is_called) from %I.%I',relation.schema_name,relation.sequence_name) into sequence_state;
    sequences:=sequences||jsonb_build_object(relation.schema_name||'.'||relation.sequence_name,sequence_state);
  end loop;
  return jsonb_build_object('format','pos-cafe-business-snapshot-v1','snapshot_at',statement_timestamp(),
    'database',current_database(),'server_version',current_setting('server_version'),'tables',tables,'sequences',sequences)::text;
end $$;
revoke all on function public.pos_business_backup() from public,anon,authenticated;
grant execute on function public.pos_business_backup() to service_role;
notify pgrst,'reload schema';
commit;
