import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {decryptBusinessArchive,validateBusinessArchive} from '../../lib/business-backup-format.mjs';

const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const relation=name=>name.split('.').map(identifier).join('.');
const defaultTables=new Set(['cafe_private.drawer_settings','cafe_private.register_shortcuts','public.pos_inventory_settings']);
export function restoreTarget(config){
  assert.equal(config.confirmEmptyTarget,'RESTORE EMPTY LOCAL POS','Confirma una base local nueva en el archivo privado de destino.');
  const url=new URL(config.database);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    &&!url.search&&!url.hash,'La recuperación requiere PostgreSQL local sin redirecciones/opciones. No admite el negocio alojado.');
  return url.href;
}

// Restore into an already provisioned, matching, EMPTY Supabase target. Its
// provider configuration/roles/Auth migrations are installed separately. Never
// execute SQL supplied inside an archive or merge rows into a trading database.
export async function restoreBusinessArchive(db,archive,{failBeforeCommit}={}){
  assert.ok(['127.0.0.1','localhost','::1'].includes(db.connectionParameters.host),'Solo se admite una base de recuperación local.');
  validateBusinessArchive(archive);
  const snapshot=JSON.parse(archive.snapshotJson),names=Object.keys(snapshot.tables).sort();
  const tables=names.map(relation),counts={};
  await db.query('begin');
  try{
    await db.query("set local lock_timeout='5s'; set local statement_timeout='120s'");
    const identity=(await db.query("select current_user actor,current_setting('session_replication_role') replication,(select rolsuper from pg_roles where rolname=current_user) superuser")).rows[0];
    assert.ok(identity.superuser&&identity.replication==='origin','La restauración necesita un administrador PostgreSQL local con triggers normales.');
    const actual=(await db.query(`select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and not c.relispartition and (n.nspname in ('public','cafe_private') or (n.nspname='auth' and c.relname in ('users','identities'))) order by 1`)).rows.map(row=>row.name);
    assert.deepEqual(actual,names,'El esquema de destino no coincide con las tablas del respaldo. Prepara el contrato correcto antes de restaurar.');
    if(Object.hasOwn(archive.contract.files,'migrations/202611020021_staff_revision_read.sql')){
      const projection=(await db.query("select has_column_privilege('authenticated','public.profiles','management_revision','SELECT') allowed")).rows[0].allowed;
      assert.equal(projection,true,'Falta aplicar la migración 021 de lectura de Equipo en el destino.');
    }
    await db.query('lock table '+tables.join(',')+' in access exclusive mode');
    for(const name of names){
      const columns=(await db.query(`select a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attidentity identity,a.attgenerated generated
        from pg_attribute a where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`,[relation(name)])).rows;
      assert.deepEqual(columns,snapshot.tables[name].columns,'Columnas incompatibles: '+name);
      const count=Number((await db.query('select count(*)::text n from '+relation(name))).rows[0].n);
      if(count){
        assert.ok(defaultTables.has(name)&&count===1,'El destino contiene datos. No se sobrescribió: '+name);
        if(name==='public.pos_inventory_settings')assert.deepEqual((await db.query('select * from '+relation(name))).rows,[{singleton:true,enabled:false,revision:0}],'El inventario de destino ya fue modificado.');
        if(name==='cafe_private.drawer_settings')assert.deepEqual((await db.query('select * from '+relation(name))).rows,[{singleton:true,rate:null,updated_by:null,updated_at:null}],'La configuración de destino ya fue modificada.');
        if(name==='cafe_private.register_shortcuts')assert.deepEqual((await db.query('select * from '+relation(name))).rows,[{singleton:true,product_ids:[],revision:0,updated_by:null,updated_at:null}],'Los favoritos de destino ya fueron modificados.');
      }
    }
    // Managed Auth sessions/tokens are deliberately not archived. A prepared
    // destination must not contain live sessions from another installation.
    for(const name of ['auth.sessions','auth.refresh_tokens']){
      if((await db.query('select to_regclass($1) present',[name])).rows[0].present)
        assert.equal(Number((await db.query('select count(*)::text n from '+relation(name))).rows[0].n),0,'El destino contiene sesiones de acceso.');
    }
    const foreignKeys=(await db.query(`select conrelid::regclass::text source,conname name,pg_get_constraintdef(oid) definition,convalidated valid
      from pg_constraint where contype='f' and conrelid=any($1::regclass[]) order by conrelid,conname`,[tables])).rows;
    assert.ok(foreignKeys.every(key=>key.valid),'El destino tiene relaciones sin validar.');
    // Avoid business/Auth side effects while loading already-accounted rows.
    // Every FK is rebuilt NOT VALID and genuinely validated below; merely
    // VALIDATE-ing an already-valid constraint would not inspect restored rows.
    await db.query('set local session_replication_role=replica');
    for(const name of names)if(defaultTables.has(name))await db.query('delete from '+relation(name));
    for(const name of names){
      const columns=snapshot.tables[name].columns.filter(column=>!column.generated).map(column=>identifier(column.name));
      await db.query(`insert into ${relation(name)} (${columns.join(',')}) overriding system value select ${columns.join(',')}
        from jsonb_populate_recordset(null::${relation(name)},$1::jsonb #> array['tables',$2,'rows'])`,[archive.snapshotJson,name]);
      counts[name]=snapshot.tables[name].rows.length;
    }
    await db.query('set local session_replication_role=origin');
    for(const key of foreignKeys){
      await db.query(`alter table ${key.source} drop constraint ${identifier(key.name)}`);
      await db.query(`alter table ${key.source} add constraint ${identifier(key.name)} ${key.definition} not valid`);
      await db.query(`alter table ${key.source} validate constraint ${identifier(key.name)}`);
    }
    for(const name of names){
      const differences=(await db.query(`with expected as (select value from jsonb_array_elements($1::jsonb #> array['tables',$2,'rows'])),
        actual as (select to_jsonb(t) value from ${relation(name)} t)
        select count(*)::int n from ((select value from expected except all select value from actual)
          union all (select value from actual except all select value from expected)) d`,[archive.snapshotJson,name])).rows[0].n;
      assert.equal(differences,0,'Los datos restaurados difieren del respaldo: '+name);
    }
    const sequenceNames=(await db.query(`select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname in ('public','cafe_private') order by 1`)).rows.map(row=>row.name);
    assert.deepEqual(sequenceNames,Object.keys(snapshot.sequences).sort(),'Secuencias incompatibles.');
    for(const [name,state]of Object.entries(snapshot.sequences)){
      // RESTART is transactional and takes the sequence lock; setval then
      // preserves the original is_called bit in that transactional generation.
      assert.match(String(state.last_value),/^\d+$/);
      await db.query(`alter sequence ${relation(name)} restart with ${state.last_value}`);
      await db.query('select setval($1::regclass,$2::bigint,$3::boolean)',[relation(name),state.last_value,state.is_called]);
    }
    if(failBeforeCommit)await failBeforeCommit();
    await db.query('commit');
    return {restored:true,tableCounts:counts,validatedForeignKeys:foreignKeys.length,sequences:sequenceNames.length,sessionsRestored:false,sourceRelease:archive.releaseCommit};
  }catch(error){await db.query('rollback');throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let db;
  try{
    const [archiveFile,keyFile,targetFile,...extra]=process.argv.slice(2);
    assert.ok(archiveFile&&keyFile&&targetFile&&!extra.length,'Uso: node restore-business.mjs ARCHIVO.posbackup CLAVE.key DESTINO_PRIVADO.json');
    const archive=decryptBusinessArchive(await readFile(archiveFile),await readFile(keyFile));
    assert.ok(!archive.assets,'Esta copia incluye archivos locales. Usa scripts/smoothies/restore-local.mjs.');
    const config=JSON.parse((await readFile(targetFile,'utf8')).replace(/^\uFEFF/,''));
    db=new Client({connectionString:restoreTarget(config)});await db.connect();
    console.log(JSON.stringify(await restoreBusinessArchive(db,archive)));
  }catch(error){console.error(error instanceof Error?error.message:'No se pudo restaurar.');process.exitCode=1;}
  finally{await db?.end();}
}
