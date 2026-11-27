import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('hosted trust refuses an ordinary PC and its bounded child kills only its owned process tree', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-hosted-trust-'));
  const script = path.join(directory, 'test.ps1'), family = path.join(directory, 'family.mjs'), pids = path.join(directory, 'pids.json');
  const orphan = path.join(directory, 'orphan.mjs'), orphanPid = path.join(directory, 'orphan.json');
  await writeFile(orphan, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',detached:true,windowsHide:true}); child.once('spawn',()=>{writeFileSync(process.argv[2],String(child.pid));child.unref();setTimeout(()=>process.exit(0),200);});`);
  await writeFile(family, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']); writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);`);
  await writeFile(script, String.raw`
param($Module,$Node,$Family,$Pids,$Orphan,$OrphanPid)
$ErrorActionPreference='Stop'
Import-Module $Module -Force -DisableNameChecking
$env:POS_ACCEPTANCE_DISPOSABLE=''
foreach($operation in @({Assert-HostedLanTrustHost},{New-HostedLanTrustIdentity 'missing.cer'},{Add-HostedLanTrust @{}},{Remove-HostedLanTrust @{}})) {
  $refused=$false;try{& $operation}catch{$refused=$true};if(!$refused){throw 'ordinary PC trust mutation accepted'}
}
$output=Invoke-HostedBoundedProcess -Executable $Node -Arguments @('-e','process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(process.env.POS_SYNTHETIC_CHILD));') -Seconds 10 -ChildEnvironment @{POS_SYNTHETIC_CHILD='valid-eof'}
if($output -cne 'valid-eof' -or $env:POS_SYNTHETIC_CHILD){throw 'child EOF or private environment failed'}
$failed=$false;try{Invoke-HostedBoundedProcess -Executable $Node -Arguments @('-e','process.exit(7)') -Seconds 10}catch{$failed=$true};if(!$failed){throw 'nonzero exit accepted'}
$timedOut=$false;try{Invoke-HostedBoundedProcess -Executable $Node -Arguments @($Family,$Pids) -Seconds 1}catch{$timedOut=$true};if(!$timedOut){throw 'owned child timeout not enforced'}
foreach($ownedPid in (Get-Content $Pids -Raw|ConvertFrom-Json)) {if(Get-Process -Id $ownedPid -ErrorAction SilentlyContinue){throw 'owned descendant survived timeout'}}
$watch=[Diagnostics.Stopwatch]::StartNew();$drainRefused=$false
try {Invoke-HostedBoundedProcess -Executable $Node -Arguments @($Orphan,$OrphanPid) -Seconds 1}
catch {$drainRefused=$_.Exception.Message.Contains('output did not drain')}
finally {
  # This fixture intentionally outlives its exited parent. Its own recorded PID
  # is cleaned here; production never guesses or kills unrelated processes.
  if(Test-Path $OrphanPid){Stop-Process -Id ([int](Get-Content $OrphanPid -Raw)) -ErrorAction SilentlyContinue}
}
if(!$drainRefused -or $watch.Elapsed.TotalSeconds -gt 5){throw 'exited parent inherited pipe exceeded shared deadline'}
'owned-tree-and-host-refusal-ok'
`);
  const result = await promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    path.resolve('scripts/testing/Hosted-LanTrust.psm1'), process.execPath, family, pids, orphan, orphanPid], { windowsHide: true, timeout: 30_000 });
  assert.match(result.stdout, /owned-tree-and-host-refusal-ok/);
});
