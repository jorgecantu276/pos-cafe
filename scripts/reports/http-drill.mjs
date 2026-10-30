import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { reportClone } from './local-restore.mjs';
import { reportHttpCases } from './http-cases.mjs';
import { root } from '../staging/runtime.mjs';

// Requires a new verified synthetic archive matching the financial schema.
let clone; const sessions = [];
try {
  clone = await reportClone(); const { db, config, runId } = clone;
  const make = (key = config.anon) => { const client = createClient(config.api,key,{auth:{persistSession:false,autoRefreshToken:false}}); sessions.push(client); return client; };
  const service=make(config.service),anonymous=make(),admin=make(),cashier=make();
  const ok = result => { assert.ifError(result.error && Error(result.error.message)); return result.data; };
  for (const [role, client] of [['admin',admin],['cashier',cashier]]) {
    const email=`reports_${role}_${runId.slice(0,8)}@carinitomio.local`,password='Solo-Prueba-Local_2026!';
    const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;
    ok(await service.from('profiles').insert({id:user.id,username:email.split('@')[0],full_name:`Reportes — ${role}`,role,is_active:true}));
    ok(await client.auth.signInWithPassword({email,password}));
  }
  await db.query('update products set is_active=false');
  const menu=JSON.parse(await readFile(path.join(root,'tests/fixtures/real-menu.json'),'utf8')),ids={};
  for (const product of menu.products) {
    const id=randomUUID();ids[product.name]=id;
    await db.query('insert into products(id,name,price,category,is_active,customizable,wizard_steps) values($1,$2,$3,$4,true,false,$5)',[id,product.name,product.price_mxn,product.category,[]]);
  }
  const register=ok(await cashier.rpc('pos_open_shift',{p_request:randomUUID(),p_cash:100,p_rate:20}));
  await reportHttpCases({db,admin,cashier,anonymous,menu,ids,register,pass:message=>console.log('PASS '+message)});
  await clone.verifyArchive();
} finally { for (const client of sessions) client.auth.stopAutoRefresh(); await clone?.cleanup(); }
