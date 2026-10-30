import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {inventoryClone} from './local-restore.mjs';
import {startApp} from '../staging/app.mjs';
import {reportHttpCases} from '../reports/http-cases.mjs';
import {work,root} from '../staging/runtime.mjs';
import {sourceFiles} from '../staging/bootstrap.mjs';

const keep=process.argv.includes('--preview'),checks=[],sessions=[],directory=path.join(work,'inventory-acceptance');
const pass=s=>{checks.push(s);console.log('PASS '+s);};
const ok=(r,name='RPC')=>{assert.ifError(r.error&&Error(name+': '+r.error.message));return r.data;};
let clone,app,gateway;const started=Date.now();
try{
  clone=await inventoryClone();const {db,config,runId}=clone;
  const make=(key=config.anon)=>{const c=createClient(config.api,key,{auth:{persistSession:false,autoRefreshToken:false}});sessions.push(c);return c;};
  const service=make(config.service),anonymous=make(),admin=make(),cashier=make();
  const password='Solo-Prueba-Local_2026!';const actors={};
  for(const [role,client] of [['admin',admin],['cashier',cashier]]){
    const username=`inv_${role}_${runId.slice(0,8)}`,email=`${username}@carinitomio.local`;
    const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true}),'local Auth creation').user;
    ok(await service.from('profiles').insert({id:user.id,username,full_name:role==='admin'?'Administrador — prueba inventario':'Caja — prueba inventario',role,is_active:true}));
    ok(await client.auth.signInWithPassword({email,password}),'real local login');actors[role]={id:user.id,username,password};
  }
  await db.query('update profiles set is_active=false where not(id=any($1::uuid[]))',[Object.values(actors).map(a=>a.id)]);
  const call=async(fn,payload,request=randomUUID())=>ok(await admin.rpc(fn,{p_request:request,p_payload:{...payload,actor_id:actors.admin.id}}),fn);
  await db.query('update products set is_active=false');
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8'));const ids={};
  for(const entry of menu.products){
    const id=randomUUID();ids[entry.name]=id;
    const prepared=/^(Iced|Frappe|Te chai|Dirty chai|Matcha|Cappuccino|Cafe americano)/i.test(entry.name);
    const iced=/^Iced/i.test(entry.name),alternate=/^(Frappe|Te chai|Cappuccino)/i.test(entry.name);
    const phase=iced?'Tipo de Leche':alternate?'Leche alternativa':null;
    // Synthetic explicit pilot policy only; never derive a live tracking policy
    // or opening balance from a product's name/category.
    await db.query('insert into products(id,name,price,stock,category,is_active,inventory_mode,customizable,wizard_steps) values($1,$2,$3,0,$4,true,$5,$6,$7)',[id,entry.name,entry.price_mxn,entry.category,prepared?'untracked':'product',!!phase,phase?[phase]:[]]);
    if(!prepared)await call('pos_adjust_inventory',{kind:'product',id,operation:'entrada',quantity:20,reason:'Existencias sintéticas para pruebas, no conteo real'});
  }
  const milkIds={};
  for(const phase of ['Tipo de Leche','Leche alternativa'])for(const [name,price] of [...(phase==='Tipo de Leche'?[['Entera',0],['Deslactosada',0],['Deslactosada light',0]]:[]),['Avena',15],['Coco',15],['Almendra',15],['Lala 100',15]]){
    const id=randomUUID();milkIds[`${phase}:${name}`]=id;await db.query('insert into extras(id,name,price,phase,active) values($1,$2,$3,$4,true)',[id,name,price,phase]);
  }
  // Existing archive extras are isolated as well; only the confirmed menu
  // groups added above are offered by this disposable demonstration.
  await db.query('update extras set active=false where not(id=any($1::uuid[]))',[Object.values(milkIds)]);
  pass('All 82 real-menu names/prices prepared in disposable clone with explicitly synthetic stock/policies');
  const register=ok(await cashier.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:20}));
  const product=ids.Tortuguitas,pack=ids['Tortuguitas 5pz'];
  const rev=async id=>Number((await db.query('select inventory_revision from products where id=$1',[id])).rows[0].inventory_revision);
  const count=async(id,quantity)=>call('pos_adjust_inventory',{kind:'product',id,operation:'conteo',quantity,revision:await rev(id),reason:'Conteo sintético para comprobar paquetes'});
  await count(pack,0);await count(product,10);
  await call('pos_configure_inventory',{id:pack,mode:'product',source_id:product,units:5,revision:await rev(pack),reason:'Paquete de cinco piezas, ejemplo sintético'});
  const payload={register_id:register.id,items:[{product_id:pack,quantity:1,extra_ids:[],note:''}],expected_total:65,payment_method:'efectivo',tender_mxn:65,tender_usd:0,customer_id:null,order_type:'Para Llevar',order_note:'Prueba HTTP'};
  const request=randomUUID();const sale=ok(await cashier.rpc('pos_checkout',{p_request:request,p_payload:payload}));
  assert.equal(sale.total,65);assert.equal((await db.query('select stock from products where id=$1',[product])).rows[0].stock,5);
  assert.equal(ok(await cashier.rpc('pos_checkout',{p_request:request,p_payload:payload})).id,sale.id);
  pass('Actual cashier HTTP checkout deducts five shared pieces once; same sale replay returns one receipt');
  const entry={kind:'product',id:product,operation:'entrada',quantity:5,reason:'Reposición sintética'};const movementId=randomUUID();
  const receipts=await Promise.all(Array.from({length:12},()=>call('pos_adjust_inventory',entry,movementId)));
  assert.equal(new Set(receipts.map(r=>r.revision)).size,1);assert.equal((await db.query('select stock from products where id=$1',[product])).rows[0].stock,10);
  assert.equal(Number((await db.query('select count(*) from inventory_movements where request_id=$1',[movementId])).rows[0].count),1);
  pass('Twelve real Auth/PostgREST retries replenish once and create one movement');
  assert.ok((await anonymous.rpc('pos_adjust_inventory',{p_request:randomUUID(),p_payload:entry})).error);
  assert.ok((await cashier.rpc('pos_adjust_inventory',{p_request:randomUUID(),p_payload:{...entry,actor_id:actors.cashier.id}})).error);
  assert.ok((await admin.from('products').update({stock:999}).eq('id',product)).error);
  assert.ok((await admin.rpc('pos_adjust_inventory',{p_request:randomUUID(),p_payload:{...entry,actor_id:actors.cashier.id}})).error);
  pass('Anonymous/cashier adjustments, raw balance writes and a switched actor are denied over HTTP');
  const before=await rev(product);ok(await cashier.rpc('pos_checkout',{p_request:randomUUID(),p_payload:payload}));
  assert.ok((await admin.rpc('pos_adjust_inventory',{p_request:randomUUID(),p_payload:{...entry,actor_id:actors.admin.id,operation:'conteo',quantity:10,revision:before}})).error);
  pass('A stale physical count cannot overwrite a sale committed since the screen loaded');
  const cappuccino=ids.Cappuccino,almond=randomUUID(),dairy=randomUUID(),milk=milkIds['Leche alternativa:Almendra'];
  await db.query("insert into supplies(id,name,unit,current_stock) values($1,'Almendra — cantidad sintética','ml',1000),($2,'Entera — cantidad sintética','ml',1000)",[almond,dairy]);
  await call('pos_configure_inventory',{id:cappuccino,mode:'recipe',source_id:null,units:1,revision:await rev(cappuccino),reason:'Prueba de ingredientes; cantidades no confirmadas del café'});
  await call('pos_save_inventory_recipe',{id:cappuccino,revision:await rev(cappuccino),extra_ids:[],ingredients:[{supply_id:dairy,quantity:200}],reason:'Receta sintética para probar sustituciones'});
  const almondSale={...payload,items:[{product_id:cappuccino,quantity:1,extra_ids:[milk],note:''}],expected_total:95,tender_mxn:95};
  assert.ok((await cashier.rpc('pos_checkout',{p_request:randomUUID(),p_payload:almondSale})).error);
  await call('pos_save_inventory_recipe',{id:cappuccino,revision:await rev(cappuccino),extra_ids:[milk],ingredients:[{supply_id:almond,quantity:200}],reason:'Receta sintética de variante; no cantidades reales'});
  assert.equal(ok(await cashier.rpc('pos_checkout',{p_request:randomUUID(),p_payload:almondSale})).total,95);
  assert.equal(Number((await db.query('select current_stock from supplies where id=$1',[almond])).rows[0].current_stock),800);
  assert.equal(Number((await db.query('select current_stock from supplies where id=$1',[dairy])).rows[0].current_stock),1000);
  pass('Missing milk variant fails closed; confirmed synthetic almond recipe consumes almond and leaves dairy untouched');
  const reports=process.argv.includes('--reports') ? await reportHttpCases({db,admin,cashier,anonymous,menu,ids,register,pass,call}) : null;
  await clone.verifyArchive();pass('Retained encrypted archive unchanged; source staging and hosted databases never connected');
  await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'access.json'),JSON.stringify(actors),{mode:0o600});
  const result={runId,reports,date:'2026-10-28',passed:checks.length,checks,realMenuPresentations:menu.products.length,sourceContract:clone.contract,elapsedSeconds:Math.round((Date.now()-started)/1000),scope:'Disposable restored local Auth/PostgREST only; all counts/recipes synthetic',preview:keep?'http://127.0.0.1:3110':null};
  await writeFile(path.join(directory,'http-result.json'),JSON.stringify(result,null,2));
  if(keep){
    // Same-origin loopback gateway reproduces the production browser path;
    // direct cross-origin GoTrue calls are not a browser acceptance environment.
    gateway=createServer(async(req,res)=>{
      try{
        const body=[];for await(const chunk of req)body.push(chunk);
        const api=req.url.startsWith('/auth/v1/')||req.url.startsWith('/rest/v1/');
        const headers={...req.headers};delete headers.host;delete headers.connection;
        const upstream=await fetch(`${api?config.api:'http://127.0.0.1:3111'}${req.url}`,{method:req.method,headers,redirect:'manual',signal:AbortSignal.timeout(15000),body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(body)});
        const bytes=Buffer.from(await upstream.arrayBuffer());const outgoing=Object.fromEntries([...upstream.headers].filter(([h])=>!['content-length','content-encoding','transfer-encoding','set-cookie'].includes(h)));
        const cookies=upstream.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies;
        res.writeHead(upstream.status,outgoing);res.end(bytes);
      }catch{res.writeHead(503,{'cache-control':'no-store'});res.end('Prueba local sin conexión');}
    });
    await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(3110,'127.0.0.1',resolve);});
    app=await startApp({...config,api:'http://127.0.0.1:3110'},{port:3111});await app.ready();
    result.buildId=(await readFile(path.join(app.app,'.next/BUILD_ID'),'utf8')).trim();await writeFile(path.join(directory,'http-result.json'),JSON.stringify(result,null,2));
    console.log('READY local register + inventory preview: http://127.0.0.1:3110/login');
    console.log('Local synthetic account names: '+Object.values(actors).map(a=>a.username).join(', '));
    console.log('Write inventory-acceptance/stop.json with {"stop":true} to close this owned preview.');
    await writeFile(path.join(directory,'ready.json'),JSON.stringify({runId,url:'http://127.0.0.1:3110/login',buildId:result.buildId}));
    let lastCommand='';
    for(;;){
      const stop=JSON.parse(await readFile(path.join(directory,'stop.json'),'utf8').catch(()=>'{}'));
      if(stop.runId===runId&&stop.stop)break;
      if(stop.runId===runId&&stop.rebuild&&stop.id!==lastCommand){
        lastCommand=stop.id;assert.equal((await sourceFiles()).hash,clone.contract,'Database contract changed; use a new disposable restore');
        await app.stop();app=await startApp({...config,api:'http://127.0.0.1:3110'},{port:3111});await app.ready();
        result.buildId=(await readFile(path.join(app.app,'.next/BUILD_ID'),'utf8')).trim();await writeFile(path.join(directory,'http-result.json'),JSON.stringify(result,null,2));
        await writeFile(path.join(directory,'ready.json'),JSON.stringify({runId,url:'http://127.0.0.1:3110/login',buildId:result.buildId,rebuildId:lastCommand}));console.log('REBUILT isolated production register');
      }
      await new Promise(r=>setTimeout(r,500));
    }
  }
}finally{await app?.stop();if(gateway)await new Promise(resolve=>gateway.close(resolve));for(const c of sessions)c.auth.stopAutoRefresh();await clone?.cleanup();}
