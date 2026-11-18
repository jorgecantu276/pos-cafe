import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { baseline } from './menu.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
export const demoLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="white"/><g fill="none" stroke="#181818" stroke-width="14"><circle cx="600" cy="540" r="240"/><path d="M510 480h160v125a80 80 0 0 1-160 0z M670 495h35a40 40 0 0 1 0 80h-35 M550 440v-50 M590 440v-65 M630 440v-50"/></g><g font-family="Arial,sans-serif" text-anchor="middle" fill="#181818"><text x="600" y="850" font-size="76" font-weight="bold" letter-spacing="8">CAFÉ DEMO</text><text x="600" y="914" font-size="30" letter-spacing="7">UNA PAUSA BIEN HECHA</text></g></svg>`;

async function files(directory) {
  const result=[];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    if(entry.isDirectory()) result.push(...await files(path.join(directory,entry.name)));
    else result.push(path.join(directory,entry.name));
  }
  return result;
}
export async function prepareDemoApp(config, directory) {
  assert.equal(config.api,'http://127.0.0.1:55621'); // fixed, separate demo API only
  const app=await mkdtemp(path.join(directory,'app-'));
  // Allowlist excludes credentials, customer's fixtures, scripts, docs and journals.
  for(const entry of ['app','components','lib','store','types','public','package.json','package-lock.json','tsconfig.json','next.config.ts','postcss.config.mjs','proxy.ts','middleware.ts']) {
    try { await cp(path.join(root,entry),path.join(app,entry),{recursive:true}); }
    catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  await symlink(path.join(root,'node_modules'),path.join(app,'node_modules'),process.platform==='win32'?'junction':'dir');
  await mkdir(path.join(app,'config'));
  const changes=[];
  for(const directoryName of ['app','components','lib','public']) for(const filename of await files(path.join(app,directoryName))) {
    if(!/\.(tsx?|json|js|svg)$/.test(filename))continue;
    const old=await readFile(filename,'utf8');
    let value=old.replaceAll('Cariñito Mío','Café Demo').replaceAll('CARIÑITO MÍO','CAFÉ DEMO')
      .replaceAll('Taller Repostero','Cafetería de demostración')
      .replaceAll('inventario-carinito-mio.csv','inventario-cafe-demo.csv')
      .replaceAll('https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg','/demo-logo.svg')
      .replaceAll('Teléfono: +52 868 305 4668','DEMOSTRACIÓN · SIN VALOR FISCAL')
      .replaceAll('@_carinitomio','GRACIAS POR TU VISITA')
      .replaceAll('Para el postre y una sonrisa,','Tu pausa, tu café.')
      .replaceAll('siempre hay espacio.','Nos vemos en la próxima taza.');
    if(filename===path.join(app,'lib/sale-printing.ts')) value=value.replaceAll('title: `CM ','title: `DEMO ').replaceAll('title:`CM ','title:`DEMO ').replace("add(receiptBranding.qrUrl, 'qr'); add('MENÚ E INSTAGRAM', 'meta');","add('HECHO AL MOMENTO', 'meta');");
    if(filename===path.join(app,'lib/print-journal-server.ts')) {
      const target='const order=sourceDocument;';
      assert.equal(value.split(target).length,2,'Baseline print journal changed');
      value=value.replace(target,"only='customer'; // Explicit demo policy: no preparation copies.\n    const order=sourceDocument;");
    }
    if(value!==old) {
      await writeFile(filename,value);
      changes.push({file:path.relative(app,filename).replaceAll('\\','/'),before:createHash('sha256').update(old).digest('hex'),after:createHash('sha256').update(value).digest('hex')});
    }
  }
  await writeFile(path.join(app,'public/demo-logo.svg'),demoLogo);
  const sharp=require('sharp');
  await sharp(Buffer.from(demoLogo)).jpeg().toFile(path.join(app,'public/receipt-branding/carinito-logo-v1.jpg'));
  await writeFile(path.join(app,'config/receipt-branding.json'),JSON.stringify({version:1,qrUrl:'https://example.com',qrRows:[]}));
  // Generic queue labels; actual Windows printing is unreachable in this demo.
  const machine={customer:{queue:'Demo customer preview',driver:'Demo mock',port:'NONE',paperWidthMm:72,paperHeightMm:210},
    barista:{queue:'Demo unused preparation',driver:'Demo mock',port:'NONE',selectedWidthMm:57,selectedHeightMm:32}};
  await writeFile(path.join(app,'config/cafe-printers.json'),JSON.stringify(machine));
  await writeFile(path.join(app,'config/receipt-issuer.example.json'),'{}');
  const printing=path.join(directory,'printing');await mkdir(printing);
  const issuer=path.join(printing,'issuer.json');
  await writeFile(issuer,JSON.stringify({legalName:'CAFETERÍA FICTICIA DEMO',rfc:'XAXX010101000',taxRegime:'616 - Sin obligaciones fiscales',establishmentAddress:'Avenida Ejemplo 100 · domicilio ficticio',postalCode:'00000',city:'Ciudad Demo'}));
  // Next gives explicit environment values priority over .env. No .env copied.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^POS_|^NEXT_PUBLIC_|^SUPABASE_|^NEXT_RUNTIME|^NODE_OPTIONS$/.test(key)));
  Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:config.api,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.anon,SUPABASE_SERVICE_ROLE_KEY:config.service,
    POS_CLIP_ENABLED:'0',POS_PRINT_MODE:'mock',POS_PRINT_DATA_DIR:printing,POS_RECEIPT_ISSUER_FILE:issuer,POS_REGISTER_UI:'workspace'});
  await writeFile(path.join(directory,'overlay.json'),JSON.stringify({baseline,policy:'Generic branding; customer ticket only; mock printing; CLIP off',changes,assets:['public/demo-logo.svg','public/receipt-branding/carinito-logo-v1.jpg','config/receipt-branding.json','config/cafe-printers.json','config/receipt-issuer.example.json']},null,2));
  return {app,env,printing};
}

export async function startDemoApp(prepared) {
  const {app,env}=prepared,next=require.resolve('next/dist/bin/next');
  await new Promise((resolve,reject)=>{
    const probe=createServer();probe.once('error',()=>reject(Error('Demo port 3127 is occupied. Stop that preview before starting another demo.')));
    probe.listen(3127,'127.0.0.1',()=>probe.close(resolve));
  });
  async function execute(args) {
    await new Promise((resolve,reject)=>{
      let logs='';
      const child=spawn(process.execPath,[next,...args],{cwd:app,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',data=>{logs=(logs+data).slice(-100000);process.stdout.write(data);});
      child.stderr.on('data',data=>{logs=(logs+data).slice(-100000);process.stderr.write(data);});
      child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Object.assign(Error(`Demo build exited ${code}`),{logs})));
    });
  }
  try {await execute(['build','--webpack']);}
  catch(error) {
    if(!/SecurityFatalError|UpgradeNudgeError/.test(error.logs || ''))throw error;
    console.log('Historical framework upgrade notice recorded. Retrying the same build once to retain the requested baseline.');
    await writeFile(path.join(path.dirname(app),'framework-notice.txt'),error.logs);
    await execute(['build','--webpack']);
  }
  const child=spawn(process.execPath,[next,'start','--hostname','127.0.0.1','--port','3127'],{cwd:app,env,windowsHide:true,stdio:'inherit'});
  const stop=async()=>{
    if(child.exitCode!==null)return;
    if(process.platform==='win32') await new Promise(resolve=>{const p=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.once('exit',resolve);p.once('error',resolve);});
    else child.kill('SIGTERM');
  };
  try {
    for(let n=0;n<180;n++) {
      if(child.exitCode!==null)throw Error('Demo server exited');
      try {if((await fetch('http://127.0.0.1:3127/login',{signal:AbortSignal.timeout(1000)})).status===200)return {child,stop};}catch{}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw Error('Demo app startup timed out');
  } catch(error) {await stop();throw error;}
}
