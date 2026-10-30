import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {Client} from 'pg';
import {restoreBackup} from '../recovery/restore.mjs';
import {unseal,sha256} from '../recovery/artifacts.mjs';
import {work,root} from '../staging/runtime.mjs';
import {sourceFiles,verifyIdentity} from '../staging/bootstrap.mjs';
import {fingerprint,project} from '../staging/safety.mjs';

export async function reportClone(){
  const source=await sourceFiles(),files=['202610280001_secure_pos.sql','202610280002_shift_expenses.sql','202610280004_reports.sql','202610300005_single_drawer.sql'];
  const migrations=await Promise.all(files.map(f=>readFile(path.join(root,'supabase/migrations',f),'utf8')));
  const hashes=migrations.map((_,i)=>fingerprint(source.snapshot,migrations.slice(0,i+1).join('\n')));
  const directory=path.join(work,'recovery');let selected;
  for(const entry of (await readdir(directory,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name!=='keys').reverse()){
    const base=path.join(directory,entry.name);
    try{
      const manifest=JSON.parse(await readFile(path.join(base,'manifest.json'),'utf8'));if(!hashes.includes(manifest.contract))continue;
      const file=path.join(base,'backup.aes-gcm.json'),bytes=await readFile(file);assert.equal(sha256(bytes),manifest.encryptedSha256);
      const payload=unseal(JSON.parse(bytes),await readFile(path.join(directory,'keys',`${manifest.runId}.key`)));
      assert.equal(payload.contract,manifest.contract);
      if(!payload.locale||!payload.databaseAcl||!payload.bootstrapRole||!payload.dbSettings)continue;
      assert.equal(payload.config.api,'http://127.0.0.1:55451');const original=new URL(payload.config.database);assert.equal(original.hostname,'127.0.0.1');assert.equal(original.port,'55452');
      selected={payload,file,hash:sha256(bytes)};break;
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  assert.ok(selected,'A verified encrypted LOCAL synthetic archive is required. No production fallback exists.');
  const runId=randomUUID();let restored,db;
  try{
    restored=await restoreBackup({payload:{...selected.payload,runId}});
    const target=new URL(restored.config.database);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55462');assert.equal(target.pathname,'/restored_pos');
    db=new Client({connectionString:restored.config.database});await db.connect();
    const marker=(await db.query('select * from cafe_private.staging_identity')).rows[0];assert.equal(marker.project,project);assert.equal(marker.source_hash,selected.payload.contract);assert.equal(marker.ready,true);
    for(let i=hashes.indexOf(selected.payload.contract)+1;i<migrations.length;i++)await db.query(migrations[i]);
    await db.query('update cafe_private.staging_identity set source_hash=$1 where project=$2',[source.hash,project]);await verifyIdentity(db);await restored.startServices();
    return {runId,db,config:restored.config,contract:source.hash,verifyArchive:async()=>assert.equal(sha256(await readFile(selected.file)),selected.hash),cleanup:async()=>{await db.end();await restored.cleanup();}};
  }catch(e){await db?.end();await restored?.cleanup();throw e;}
}
