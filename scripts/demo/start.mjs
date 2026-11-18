import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { freshLocalApi } from '../testing/local-api.mjs';
import { work } from '../staging/runtime.mjs';
import { claimDemo, seedDemo } from './seed.mjs';
import { prepareDemoApp, startDemoApp, root } from './app.mjs';
import { verifyBaseline } from './fidelity.mjs';

let local,app;
try {
  await verifyBaseline();
  console.log('Creating a fresh local demo database (55621/55622). No hosted connection accepted.');
  local=await freshLocalApi({portBase:55621,storage:true});
  const {db,config,service}=local,actors={};
  for(const [role,name] of [['admin','Responsable Demo'],['cashier','Caja Demo'],['second','Caja Relevo Demo']]) {
    const username=`demo_${role}`,password=randomUUID()+'!';
    // Baseline internal username adapter; never a real inbox or customer account.
    const {data,error}=await service.auth.admin.createUser({email:`${username}@carinitomio.local`,password,email_confirm:true});
    assert.ifError(error&&Error(error.message));
    actors[role]={id:data.user.id,username,password};
    await db.query('insert into profiles(id,username,full_name,role) values($1,$2,$3,$4)',[data.user.id,username,name,role==='admin'?'admin':'cashier']);
  }
  await local.install();
  for(const file of ['202611020022_catalog_photos.sql','202611050023_alternative_milk_choice.sql'])await db.query(await readFile(path.join(root,'supabase/migrations',file),'utf8'));
  await claimDemo(db);
  const result=await seedDemo(db,actors);
  const directory=await mkdtemp(path.join(work,'generic-demo-'));
  const prepared=await prepareDemoApp(config,directory);
  await writeFile(path.join(directory,'access.private.json'),JSON.stringify({url:'http://127.0.0.1:3127',actors,fixture:result,app:prepared.app,printing:prepared.printing},null,2),{mode:0o600});
  await writeFile(path.join(work,'generic-demo-latest.txt'),directory);
  console.log('Building Café Demo. Random local passwords are in '+path.join(directory,'access.private.json'));
  app=await startDemoApp(prepared);
  console.log('DEMO READY: http://127.0.0.1:3127 · customer tickets only · mock printing · CLIP off');
  console.log('Use demo_cashier for the open register; demo_admin for administration. Ctrl+C stops this disposable demo.');
  if(process.argv.includes('--verify')) {
    const {verifyDemoHttp}=await import('./verify-http.mjs');
    await verifyDemoHttp({config,actors,result,prepared});
  }
  if(!process.argv.includes('--verify')||process.argv.includes('--keep'))await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
} finally { await app?.stop();await local?.cleanup(); }
