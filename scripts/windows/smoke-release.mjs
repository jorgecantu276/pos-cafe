import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { verifyPackage } from './auto-update.mjs';
const folder = process.argv[2];
assert.ok(folder && path.isAbsolute(folder), 'Pass an absolute prepared release directory.');
const manifest = JSON.parse(readFileSync(path.join(folder, 'release.json'), 'utf8'));
assert.equal(manifest.fixtureOnly, true, 'This smoke drill only runs loopback builds, never client targets.');
for (const devTool of ['@embedded-postgres','embedded-postgres','eslint','oxlint','@oxlint','supabase']) {
  assert.equal(existsSync(path.join(folder,'app/node_modules',devTool)),false,'Release must exclude development tool: '+devTool);
}
const scratch = mkdtempSync(path.join(tmpdir(), 'pos-cafe-release-'));
const relocated = path.join(scratch, 'release');
cpSync(folder, relocated, { recursive: true });
const hashes = JSON.parse(readFileSync(path.join(relocated, 'SHA256.json'), 'utf8'));
for (const entry of hashes) assert.equal(createHash('sha256').update(readFileSync(path.join(relocated, entry.file))).digest('hex'), entry.sha256, entry.file);
const packageIdentity = { commit: manifest.sourceCommit,
  filesSha256: createHash('sha256').update(readFileSync(path.join(relocated, 'SHA256.json'))).digest('hex') };
await verifyPackage(relocated, packageIdentity, relocated, manifest);
const config = JSON.parse(readFileSync(path.join(relocated, 'pos-cafe-config.example.json'), 'utf8'));
config.Port = 3119; config.PrintDataDirectory = path.join(scratch, 'persistent-print-data');
assert.equal(config.ClipEnabled,false);
config.ClipTokenFile=path.join(scratch,'clip-token.txt');
writeFileSync(config.ClipTokenFile,'REPLACE_WITH_CLIP_BASIC_TOKEN');
const configPath = path.join(scratch, 'pos-cafe-config.json');
writeFileSync(configPath, JSON.stringify(config));
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const updateReadyToken = randomUUID();
const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(relocated, 'Start-POS.ps1'), '-ConfigPath', configPath, '-NoBrowser'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, POS_UPDATE_READY_TOKEN: updateReadyToken } });
let logs = ''; child.stdout.on('data', bytes => { logs += bytes; }); child.stderr.on('data', bytes => { logs += bytes; });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('Release startup failed: ' + logs);
    try { ready = (await fetch('http://127.0.0.1:3119/manifest.json', {signal:AbortSignal.timeout(1000)})).status === 200; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Prepared release did not become ready: ' + logs);
  for (let attempt = 0; attempt < 20 && !logs.includes('POS_UPDATE_READY ' + updateReadyToken); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(logs.includes('POS_UPDATE_READY ' + updateReadyToken), 'Packaged launcher must emit its authenticated readiness signal.');
  const identityResponse = await fetch('http://127.0.0.1:3119/api/local-instance');
  assert.equal(identityResponse.status,200);
  assert.equal(identityResponse.headers.get('Cache-Control'),'no-store');
  const identity = await identityResponse.json();
  assert.equal(identity.protocol,1);
  assert.ok(identity.instanceToken && identity.releaseId && identity.configId);
  // Reopening the actual Next release must reuse its process, not launch another.
  execFileSync(powershell,['-NoLogo','-NoProfile','-File',path.join(relocated,'Start-POS.ps1'),'-ConfigPath',configPath,'-NoBrowser'],{windowsHide:true,stdio:'pipe',timeout:45000});
  assert.deepEqual(await (await fetch('http://127.0.0.1:3119/api/local-instance')).json(),identity);
  for (const [url,status] of [['/login',200],['/favicon.ico',200],['/product-photos/matcha.webp',200],['/product-photos/cheesecake.webp',200],['/staff-avatars/avatar-1.svg',200],['/staff-avatars/avatar-2.svg',200],['/sw.js',200],['/api/users',401],['/api/payments/clip',401]]) {
    const response = await fetch('http://127.0.0.1:3119' + url, {signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,status,url);
    if(url.endsWith('.webp')) assert.match(response.headers.get('content-type'),/image\/webp/);
  }
  assert.ok(existsSync(path.join(relocated,'app/scripts/printing/DesktopPrinter.cs')));
  assert.ok(existsSync(path.join(relocated,'database-migrations/202610280004_reports.sql')));
  assert.equal(existsSync(path.join(relocated,'database-migrations/202610280003_inventory.sql')),false);
  assert.ok(existsSync(path.join(relocated,'database-migrations/202610300005_single_drawer.sql')));
  assert.ok(existsSync(path.join(relocated,'database-migrations/202610300006_loyalty_phone.sql')));
  for(const name of ['202610300007_safe_drawer_rate.sql','202610300008_employee_drawer_recovery.sql','202610300009_customer_correction.sql','202610300010_register_shortcuts.sql','202610300011_recent_tickets.sql','202610300012_business_backups.sql','202611020013_catalog_requests.sql','202611020014_customer_history.sql','202611020015_order_pager.sql','202611020016_clip_payments.sql','202611020017_inventory.sql','202611020018_required_order_pager.sql','202611020019_phone_orders.sql','202611020020_delivery_readiness.sql','202611020021_staff_revision_read.sql','schema.snapshot.json'])assert.ok(existsSync(path.join(relocated,'database-migrations',name)));
  for(const name of ['Open-POS.cmd','Install-POS-shortcut.ps1'])assert.ok(existsSync(path.join(relocated,name)));
  for(const name of ['backup-tools/scripts/backups/inspect.mjs','backup-tools/lib/business-backup-format.mjs'])assert.ok(existsSync(path.join(relocated,name)));
  for(const name of ['clip-setup/clip-token.example.txt','clip-setup/README.md','clip-setup/clip-webhook/index.ts'])assert.ok(existsSync(path.join(relocated,name)));
  // Reading prerender seeds used to create unindexed route-cache files under
  // .next/server, invalidating enrollment and later signed updates. Check the
  // complete package after real HTML/favicon requests, not only indexed bytes.
  await verifyPackage(relocated, packageIdentity, relocated, manifest);
  // Mismatched runtime config is rejected before binding a server port.
  writeFileSync(configPath, JSON.stringify({...config,SupabaseUrl:'http://127.0.0.1:59998'}));
  assert.throws(() => execFileSync(powershell,['-NoProfile','-File',path.join(relocated,'Start-POS.ps1'),'-ConfigPath',configPath,'-NoBrowser'],{windowsHide:true,stdio:'pipe'}));
} finally {
  // Only terminate the exact process tree created by this isolated drill.
  try {
    const running = () => child.exitCode === null && child.signalCode === null;
    if (running()) {
      // The launcher can exit between the check and taskkill. Confirm root
      // termination below; inherited output pipes are not proof it is alive.
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide:true,stdio:'ignore',timeout:10000}); } catch {}
      for (let attempt = 0; running() && attempt < 100; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.equal(running(), false, 'The owned release launcher did not stop within the bounded cleanup deadline.');
  } finally {
    child.stdout.destroy(); child.stderr.destroy();
  }
}
await verifyPackage(relocated, packageIdentity, relocated, manifest);
console.log(`PASS relocated Windows release: ${hashes.length} hashes and exact file set preserved after startup/login/favicon/stop; bundled runtime/server/assets/helpers/migrations; API checks; target mismatch refused. No hosted database or physical printer used.`);
