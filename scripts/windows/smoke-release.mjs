import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
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
const config = JSON.parse(readFileSync(path.join(relocated, 'pos-cafe-config.example.json'), 'utf8'));
config.Port = 3119; config.PrintDataDirectory = path.join(scratch, 'persistent-print-data');
const configPath = path.join(scratch, 'pos-cafe-config.json');
writeFileSync(configPath, JSON.stringify(config));
const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(relocated, 'Start-POS.ps1'), '-ConfigPath', configPath, '-NoBrowser'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const identityResponse = await fetch('http://127.0.0.1:3119/api/local-instance');
  assert.equal(identityResponse.status,200);
  assert.equal(identityResponse.headers.get('Cache-Control'),'no-store');
  const identity = await identityResponse.json();
  assert.equal(identity.protocol,1);
  assert.ok(identity.instanceToken && identity.releaseId && identity.configId);
  // Reopening the actual Next release must reuse its process, not launch another.
  execFileSync(powershell,['-NoLogo','-NoProfile','-File',path.join(relocated,'Start-POS.ps1'),'-ConfigPath',configPath,'-NoBrowser'],{windowsHide:true,stdio:'pipe',timeout:45000});
  assert.deepEqual(await (await fetch('http://127.0.0.1:3119/api/local-instance')).json(),identity);
  for (const [url,status] of [['/login',200],['/product-photos/matcha.webp',200],['/product-photos/cheesecake.webp',200],['/staff-avatars/avatar-1.svg',200],['/staff-avatars/avatar-2.svg',200],['/sw.js',200],['/api/users',401]]) {
    const response = await fetch('http://127.0.0.1:3119' + url, {signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,status,url);
    if(url.endsWith('.webp')) assert.match(response.headers.get('content-type'),/image\/webp/);
  }
  assert.ok(existsSync(path.join(relocated,'app/scripts/printing/DesktopPrinter.cs')));
  assert.ok(existsSync(path.join(relocated,'database-migrations/202610280004_reports.sql')));
  assert.equal(existsSync(path.join(relocated,'database-migrations/202610280003_inventory.sql')),false);
  assert.ok(existsSync(path.join(relocated,'database-migrations/202610300005_single_drawer.sql')));
  assert.ok(existsSync(path.join(relocated,'database-migrations/202610300006_loyalty_phone.sql')));
  for(const name of ['202610300007_safe_drawer_rate.sql','202610300008_employee_drawer_recovery.sql','202610300009_customer_correction.sql','202610300010_register_shortcuts.sql','202610300011_recent_tickets.sql','202610300012_business_backups.sql','202611020013_catalog_requests.sql','202611020014_customer_history.sql','schema.snapshot.json'])assert.ok(existsSync(path.join(relocated,'database-migrations',name)));
  for(const name of ['Open-POS.cmd','Install-POS-shortcut.ps1'])assert.ok(existsSync(path.join(relocated,name)));
  for(const name of ['backup-tools/scripts/backups/inspect.mjs','backup-tools/lib/business-backup-format.mjs'])assert.ok(existsSync(path.join(relocated,name)));
  // Mismatched runtime config is rejected before binding a server port.
  writeFileSync(configPath, JSON.stringify({...config,SupabaseUrl:'http://127.0.0.1:59998'}));
  assert.throws(() => execFileSync(powershell,['-NoProfile','-File',path.join(relocated,'Start-POS.ps1'),'-ConfigPath',configPath,'-NoBrowser'],{windowsHide:true,stdio:'pipe'}));
  console.log(`PASS relocated Windows release: ${hashes.length} hashes; bundled runtime/server/assets/helpers/migrations; login/static/API checks; target mismatch refused. No hosted database or physical printer used.`);
} finally {
  // Only terminate the exact process tree created by this isolated drill.
  if (child.exitCode === null) execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide:true,stdio:'ignore'});
}
