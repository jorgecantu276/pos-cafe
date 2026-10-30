import { sha256 } from './artifacts.mjs';
import { quoteIdentifier as q } from '../staging/safety.mjs';

export async function databaseFingerprint(db) {
  const tables = (await db.query(`select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by 1,2`)).rows;
  const data = {}, counts = {};
  for (const table of tables) {
    const name = `${table.schema}.${table.name}`;
    const rows = (await db.query(`select to_jsonb(t) row from ${q(table.schema)}.${q(table.name)} t order by to_jsonb(t)::text`)).rows;
    // Hash rows in a locale-independent order; SQL text collation can vary by
    // cluster even when every restored byte/value is identical.
    data[name] = sha256(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())); counts[name] = rows.length;
  }
  const catalog = {};
  const queries = {
    relations: `select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text owner,coalesce(c.relacl,acldefault((case when c.relkind='S' then 's' else 'r' end)::"char",c.relowner))::text[] acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','cafe_private') order by 1,2`,
    schemas: `select nspname,nspowner::regrole::text owner,coalesce(nspacl,acldefault('n',nspowner))::text[] acl from pg_namespace where nspname in ('public','auth','cafe_private') order by 1`,
    functions: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proowner::regrole::text owner,coalesce(p.proacl,acldefault('f',p.proowner))::text[] acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','cafe_private') order by 1,2,3`,
    columns: `select n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) default_value,coalesce(a.attacl,'{}'::aclitem[])::text[] acl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped and c.relkind in ('r','v') and n.nspname in ('public','auth','cafe_private') order by 1,2,a.attnum`,
    policies: `select schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname in ('public','auth','cafe_private') order by 1,2,3`,
    constraints: `select n.nspname,c.relname,x.conname,pg_get_constraintdef(x.oid) definition from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','cafe_private') order by 1,2,3`,
    triggers: `select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth','cafe_private') order by 1,2,3`,
    defaults: `select d.defaclrole::regrole::text owner,coalesce(n.nspname,'') schema,d.defaclobjtype,d.defaclacl::text[] acl from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace order by 1,2,3`,
    sequences: `select schemaname,sequencename,sequenceowner,data_type::text,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value from pg_sequences where schemaname in ('public','auth','cafe_private') order by 1,2`,
    roles: `select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,md5(coalesce(rolconfig::text,'')) config_hash from pg_roles where rolname !~ '^pg_' order by 1`,
    memberships: `select roleid::regrole::text role,member::regrole::text member,grantor::regrole::text grantor,admin_option,inherit_option,set_option from pg_auth_members order by 1,2,3`,
    database: `select datdba::regrole::text owner,datcollate,datctype,datlocprovider,datlocale,daticurules,datcollversion,pg_encoding_to_char(encoding) encoding from pg_database where datname=current_database()`,
    database_acl: `select grantor::regrole::text grantor,case when grantee=0 then 'PUBLIC' else grantee::regrole::text end grantee,privilege_type,is_grantable from pg_database d,aclexplode(d.datacl) where datname=current_database() order by 1,2,3`,
    database_settings: `select r.rolname,s.setconfig from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole where s.setdatabase=(select oid from pg_database where datname=current_database()) order by r.rolname nulls first`,
  };
  for (const [name, sql] of Object.entries(queries)) {
    catalog[name] = (await db.query(sql)).rows;
    for (const row of catalog[name]) if (Array.isArray(row.acl)) row.acl.sort();
  }
  // is_called matters when a restored sequence has never been used.
  for (const sequence of catalog.sequences) {
    Object.assign(sequence, (await db.query(`select last_value,is_called from ${q(sequence.schemaname)}.${q(sequence.sequencename)}`)).rows[0]);
  }
  const subset = schema => Object.fromEntries(Object.entries(data).filter(([name]) => name.startsWith(`${schema}.`)));
  return { tables: data, counts, catalog, schema: sha256(JSON.stringify(catalog)),
    business: sha256(JSON.stringify({ public: subset('public'), private: subset('cafe_private') })), auth: sha256(JSON.stringify(subset('auth'))) };
}
