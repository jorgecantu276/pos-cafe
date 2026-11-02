import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawn,spawnSync} from 'node:child_process';

const [folder,expectedCommit]=process.argv.slice(2);
assert.ok(process.platform==='win32'&&folder&&path.isAbsolute(folder)&&/^[a-f0-9]{40}$/.test(expectedCommit??''),'Pass a prepared Windows client release and its reviewed full commit.');
const manifest=JSON.parse(readFileSync(path.join(folder,'release.json'),'utf8'));
assert.equal(manifest.fixtureOnly,false);assert.equal(manifest.sourceDirty,false);assert.equal(manifest.sourceCommit,expectedCommit);assert.equal(manifest.node,'v24.22.2');
assert.equal(new URL(manifest.supabaseUrl).protocol,'https:');
const scratch=mkdtempSync(path.join(tmpdir(),'pos-client-verification-')),relocated=path.join(scratch,'release');
cpSync(folder,relocated,{recursive:true});
const hashes=JSON.parse(readFileSync(path.join(relocated,'SHA256.json'),'utf8'));
for(const entry of hashes)assert.equal(createHash('sha256').update(readFileSync(path.join(relocated,entry.file))).digest('hex'),entry.sha256,entry.file);
assert.ok(existsSync(path.join(relocated,'database-migrations/202611020020_delivery_readiness.sql')));
assert.ok(existsSync(path.join(relocated,'database-migrations/202611020021_staff_revision_read.sql')));
const example=JSON.parse(readFileSync(path.join(relocated,'pos-cafe-config.example.json'),'utf8'));
assert.equal(example.ClipEnabled,false);assert.equal(example.ClipTokenFile,'');assert.equal(example.SupabaseServiceRoleKey,'');
assert.equal(createHash('sha256').update(example.SupabaseAnonKey).digest('hex'),manifest.publicKeySha256);
const config={...example,Port:3119,PrintMode:'mock',PrintDataDirectory:path.join(scratch,'test-journal'),BackupDirectory:path.join(scratch,'test-backups'),BackupRecoveryKeyFile:path.join(scratch,'private','recovery.key')};
const configFile=path.join(scratch,'config.json');writeFileSync(configFile,JSON.stringify(config));
const powershell=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const child=spawn(powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(relocated,'Start-POS.ps1'),'-ConfigPath',configFile,'-NoBrowser'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
try{
  let identity;
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null)throw Error('Client release startup failed: '+logs.slice(-2000));
    try{const response=await fetch('http://127.0.0.1:3119/api/local-instance',{signal:AbortSignal.timeout(1000)});if(response.ok){identity=await response.json();break;}}catch{/* Own local server is starting. */}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  assert.ok(identity?.instanceToken&&identity.releaseId&&identity.configId,'Relocated client release did not start.');
  const response=await fetch('http://127.0.0.1:3119/login');assert.equal(response.status,200);
  const html=await response.text();const asset=html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/);assert.ok(asset);
  assert.equal((await fetch(new URL(asset[1],'http://127.0.0.1:3119'))).status,200);
  assert.equal((await fetch('http://127.0.0.1:3119/api/printing',{headers:{'X-Pos-Print':'1'}})).status,401);
  assert.equal((await fetch('http://127.0.0.1:3119/api/payments/clip')).status,401);
  execFileSync(powershell,['-NoProfile','-File',path.join(relocated,'Start-POS.ps1'),'-ConfigPath',configFile,'-NoBrowser'],{windowsHide:true,stdio:'pipe',timeout:45000});
  assert.equal((await (await fetch('http://127.0.0.1:3119/api/local-instance')).json()).instanceToken,identity.instanceToken);
  let restoreTool=false;
  if(existsSync(path.join(relocated,'backup-tools/scripts/backups/restore-business.mjs'))){
    const result=spawnSync(path.join(relocated,'node.exe'),[path.join(relocated,'backup-tools/scripts/backups/restore-business.mjs')],{windowsHide:true,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/Uso:/);restoreTool=true;
  }
  const report={pass:true,sourceCommit:manifest.sourceCommit,sourceDirty:false,fixtureOnly:false,target:manifest.supabaseUrl,node:manifest.node,hashes:hashes.length,
    relocatedStartup:true,sameInstanceReused:true,loginAndStaticAssets:true,restoreToolLoads:restoreTool,printing:'mock',clipEnabled:false,serviceKeyUsed:false,
    scope:'Public client target compiled into artifact; isolated local mock startup only. No login, business writes, physical paper or bank charge.'};
  writeFileSync(path.join(scratch,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));console.log('Client release evidence: '+path.join(scratch,'report.json'));
}finally{
  if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
}
