import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('actual private rehearsal capture preserves failed parent exit while an owned inherited writer remains alive', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-rehearsal-process-'));
  const script = path.join(directory, 'test.ps1');
  await writeFile(script, String.raw`
param($Driver,$Node,$WorkDirectory)
$ErrorActionPreference='Stop'
Import-Module (Join-Path (Split-Path $Driver -Parent) 'HostedProcess.psm1') -Force -DisableNameChecking
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Driver,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Actual driver did not parse'}
foreach($name in @('Invoke-PrivateRehearsalCommand','ConvertTo-SafeRehearsalDiagnostic')) {
  $function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(!$function){throw 'Actual driver function missing'}
  Invoke-Expression $function.Extent.Text
}
$writerScript=Join-Path $WorkDirectory 'owned-writer.cjs'
$parentScript=Join-Path $WorkDirectory 'failed-parent.cjs'
$pidFile=Join-Path $WorkDirectory 'owned-processes.json'
[IO.File]::WriteAllText($writerScript,'process.stdout.on("error",()=>{});process.stderr.on("error",()=>{});setInterval(()=>process.stdout.write("synthetic heartbeat\n"),200)')
[IO.File]::WriteAllText($parentScript,'const fs=require("fs"),path=require("path"),cp=require("child_process");const child=cp.spawn(process.execPath,[path.join(__dirname,"owned-writer.cjs")],{detached:true,stdio:"inherit",windowsHide:true});child.unref();fs.writeFileSync(path.join(__dirname,"owned-processes.json"),JSON.stringify({parent:process.pid,child:child.pid}));process.stderr.write("synthetic ERR_ASSERTION before exit7\n");setTimeout(()=>process.exit(7),200)')
$work=$WorkDirectory;$phase='synthetic-parent-exit';$timer=[Diagnostics.Stopwatch]::StartNew();$failed=$false
try {
  try {Invoke-PrivateRehearsalCommand -Executable $Node -Arguments @($parentScript) -LogName 'synthetic-private' -TimeoutSeconds 4}
  catch {$failed=$true}
  if(!$failed -or $script:failureExitCode -ne 7 -or $script:failureCode -cne 'ERR_ASSERTION' -or $timer.Elapsed.TotalSeconds -gt 3){throw 'Actual runner hid failed parent behind descendant EOF'}
  $owned=Get-Content $pidFile -Raw|ConvertFrom-Json
  if(Get-Process -Id $owned.parent -ErrorAction SilentlyContinue){throw 'Fixture parent still alive'}
  $writer=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owned.child)
  if(!$writer -or $writer.ExecutablePath -ine $Node -or !$writer.CommandLine.Contains($writerScript)){throw 'Fixture writer must remain alive when runner returns'}
} finally {
  if(Test-Path $pidFile){
    $owned=Get-Content $pidFile -Raw|ConvertFrom-Json
    $writer=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owned.child)
    if($writer -and $writer.ExecutablePath -ieq $Node -and $writer.CommandLine.Contains($writerScript)){Stop-Process -Id ([int]$owned.child)}
  }
}
'failed-parent-returned-with-owned-writer-alive'
`);
  const result = await promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    path.resolve('scripts/testing/Run-HostedSmoothiesRehearsal.ps1'), process.execPath, directory], { windowsHide: true, timeout: 15_000 });
  assert.match(result.stdout, /failed-parent-returned-with-owned-writer-alive/);
});

test('actual image warmup invokes exact cache only for DataLimit and requires original pull to succeed afterward', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-data-limit-cache-'));
  const script = path.join(directory, 'test.ps1');
  await writeFile(script, String.raw`
param($Driver,$WorkDirectory)
$ErrorActionPreference='Stop';$work=$WorkDirectory;$source=Split-Path (Split-Path (Split-Path $Driver -Parent) -Parent) -Parent;$node='fixture-node'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Driver,[ref]$tokens,[ref]$parseErrors)
foreach($name in @('Invoke-HostedImagePrefetch','Get-RehearsalJson')) {
  $function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(!$function -or $parseErrors.Count){throw 'Actual cache caller missing'};Invoke-Expression $function.Extent.Text
}
$env:GITHUB_SHA='a'*40;$env:GITHUB_RUN_ID='42';$env:GITHUB_JOB='synthetic-cache'
$engineReceipt=@{owner=('b'*32);daemonId='synthetic-daemon'}
function Invoke-PrivateRehearsalCommand {
  param($Executable,$Arguments,$LogName)
  if($Executable -ceq 'fixture-node') {
    $script:cacheCalls++
    if($Arguments[0] -notlike '*hosted-image-cache.mjs' -or $Arguments[1] -cne 'fixture compose.yml'){throw 'Unexpected exact cache command'}
    if($script:cacheFails){$script:failureExitCode=1;throw 'Synthetic cache identity failure'}
    @{protocol=1;result='pass';sourceCommit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;job=$env:GITHUB_JOB;owner=$engineReceipt.owner;daemonId=$engineReceipt.daemonId;images=@(@{},@{},@{},@{},@{})}|ConvertTo-Json|Set-Content -LiteralPath $Arguments[2] -Encoding utf8NoBOM
    return
  }
  if($Executable -cne 'fixture-docker' -or ($Arguments -join '|') -cne 'compose|--parallel|1|--project-name|smoothies-rehearsal-image-prefetch|-f|fixture compose.yml|pull|--policy|missing'){throw 'Original command changed after cache'}
  $script:pullCalls++
  if($script:pullCalls -eq 1 -or $script:postCacheFails) {
    [IO.File]::WriteAllText((Join-Path $work ($LogName+'.stdout.log')),'')
    [IO.File]::WriteAllText((Join-Path $work ($LogName+'.stderr.log')),$script:message)
    $script:failureExitCode=$script:exitCode;throw 'Synthetic original registry failure'
  }
}
function Check-Case($Message,$ExitCode,$CacheFails,$PostCacheFails,$ExpectedCache,$ExpectedPull,$ExpectedPass) {
  $script:message=$Message;$script:exitCode=$ExitCode;$script:cacheFails=$CacheFails;$script:postCacheFails=$PostCacheFails
  $script:cacheCalls=0;$script:pullCalls=0;$script:imageCacheProof=$null;$script:failureExitCode=$null;$script:failureDiagnostics=@('prior')
  $passed=$false;try{Invoke-HostedImagePrefetch 'fixture-docker' 'fixture compose.yml';$passed=$true}catch{}
  if($passed -ne $ExpectedPass -or $script:cacheCalls -ne $ExpectedCache -or $script:pullCalls -ne $ExpectedPull){throw 'Cache trigger or mandatory original recheck differs'}
  if($passed -and (!$script:imageCacheProof -or $script:failureExitCode -ne $null -or $script:failureDiagnostics.Count)){throw 'Successful original recheck did not bind cache proof/clear old failure'}
  if(!$passed -and $script:imageCacheProof){throw 'A failed original recheck qualified a cache receipt'}
}
Check-Case 'error from registry: Data limit exceeded' 1 $false $false 1 2 $true
Check-Case 'ordinary network failure' 1 $false $false 0 1 $false
Check-Case 'error from registry: Data limit exceeded; unauthorized' 1 $false $false 0 1 $false
Check-Case 'error from registry: Data limit exceeded' -1 $false $false 0 1 $false
Check-Case 'error from registry: Data limit exceeded' 1 $true $false 1 1 $false
Check-Case 'error from registry: Data limit exceeded' 1 $false $true 1 2 $false
'data-limit-only-exact-cache-original-recheck-ok'
`);
  const result = await promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    path.resolve('scripts/testing/Run-HostedSmoothiesRehearsal.ps1'), directory], { windowsHide: true, timeout: 15_000 });
  assert.match(result.stdout, /data-limit-only-exact-cache-original-recheck-ok/);
});

test('actual failure projection retains a primary assertion and both safe frames ahead of long cleanup while redacting private values', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-safe-failure-'));
  const script = path.join(directory, 'test.ps1');
  await writeFile(script, String.raw`
param($Driver)
$ErrorActionPreference='Stop';$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Driver,[ref]$tokens,[ref]$parseErrors)
$function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'ConvertTo-SafeRehearsalDiagnostic'},$true)
if(!$function -or $parseErrors.Count){throw 'Actual failure projection missing'}
Invoke-Expression $function.Extent.Text
$jwt='eyJ'+('a'*40)+'.'+('b'*40)+'.'+('c'*40)
$privatePath='C:\SyntheticPrivate\credentials.json'
$raw=@('AssertionError [ERR_ASSERTION]: Primary synthetic mismatch',"+ '$jwt'","  at file:///$privatePath",'Authorization: synthetic-private-header','  at file:///C:/task/acceptance-ui.mjs:139:7','  at file:///C:/task/acceptance-ui.mjs:198:5') + @(1..80|ForEach-Object { 'Container synthetic cleanup '+$_ }) + @('Error: outer child exit failure')
$result=@(ConvertTo-SafeRehearsalDiagnostic ($raw -join [Environment]::NewLine))
$joined=$result -join [Environment]::NewLine
if(!$joined.Contains('Primary synthetic mismatch') -or !$joined.Contains('[acceptance frame] acceptance-ui.mjs:139') -or !$joined.Contains('[acceptance frame] acceptance-ui.mjs:198')){throw 'Cleanup drowned primary error or allowlisted frames'}
if($joined.Contains($jwt) -or $joined.Contains('SyntheticPrivate') -or $joined.Contains('synthetic-private-header') -or $joined.Contains('file:///C:')){throw 'Private diagnostic value leaked'}
if($result.Count -gt 60 -or @($result|Where-Object {$_.Length -gt 312}).Count){throw 'Failure projection exceeded its fixed bounds'}
$nested=@('Error: outer node failed with image progress') + @(1..120|ForEach-Object {'Image synthetic pulling '+$_}) + @('error from registry: Synthetic inner cause',"+ '$jwt'",'  at file:///C:/task/acceptance-ui.mjs:397:7') + @(1..80|ForEach-Object {'Container synthetic cleanup '+$_}) + @('Error: outer child failure')
$nestedSafe=(ConvertTo-SafeRehearsalDiagnostic ($nested -join [Environment]::NewLine)) -join [Environment]::NewLine
if(!$nestedSafe.Contains('Synthetic inner cause') -or !$nestedSafe.Contains('acceptance-ui.mjs:397') -or $nestedSafe.Contains($jwt)){throw 'Nested critical cause was lost behind progress or leaked private value'}
'primary-preserved-private-values-redacted'
`);
  const result = await promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    path.resolve('scripts/testing/Run-HostedSmoothiesRehearsal.ps1')], { windowsHide: true, timeout: 15_000 });
  assert.match(result.stdout, /primary-preserved-private-values-redacted/);
});

test('actual image warmup retries only explicit registry throttling and preserves terminal failures', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-image-prefetch-'));
  const script = path.join(directory, 'test.ps1');
  await writeFile(script, String.raw`
param($Driver,$WorkDirectory)
$ErrorActionPreference='Stop';$work=$WorkDirectory
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Driver,[ref]$tokens,[ref]$parseErrors)
$function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-HostedImagePrefetch'},$true)
if(!$function -or $parseErrors.Count){throw 'Actual prefetch helper missing'}
Invoke-Expression $function.Extent.Text
function Start-Sleep {param($Seconds) $script:delays += [int]$Seconds}
function Invoke-PrivateRehearsalCommand {
  param($Executable,$Arguments,$LogName)
  if($Executable -cne 'fixture-docker' -or ($Arguments -join '|') -cne 'compose|--parallel|1|--project-name|smoothies-rehearsal-image-prefetch|-f|fixture compose.yml|pull|--policy|missing'){throw 'Original bounded missing-only command changed'}
  $message=$script:messages[$script:calls];$script:calls++
  if($null -eq $message){return}
  [IO.File]::WriteAllText((Join-Path $work ($LogName+'.stdout.log')),'')
  [IO.File]::WriteAllText((Join-Path $work ($LogName+'.stderr.log')),$message)
  $script:failureExitCode=$script:exitCode;$script:failureDiagnostics=@('synthetic terminal failure')
  throw 'Synthetic private registry failure'
}
function Check-Case($Messages,$ExitCode,$ExpectedCalls,$ShouldPass,$ExpectedDelays) {
  $script:messages=$Messages;$script:exitCode=$ExitCode;$script:calls=0;$script:delays=@()
  $script:failureExitCode=$null;$script:failureCode='synthetic-prior';$script:failureDiagnostics=@()
  $passed=$false;try{Invoke-HostedImagePrefetch 'fixture-docker' 'fixture compose.yml';$passed=$true}catch{}
  if($passed -ne $ShouldPass -or $script:calls -ne $ExpectedCalls -or ($script:delays -join ',') -cne $ExpectedDelays){throw 'Wrong selective retry or finite backoff'}
  if($passed -and ($script:failureExitCode -ne $null -or $script:failureCode -ne $null -or $script:failureDiagnostics.Count)){throw 'Successful retry retained obsolete failure metadata'}
  if(!$passed -and $script:failureExitCode -ne $ExitCode){throw 'Terminal failure metadata was lost'}
}
Check-Case @('error from registry: Rate exceeded','HTTP/1.1 429 Too Many Requests',$null) 1 3 $true '15,30'
Check-Case @('error from registry: Rate exceeded','error from registry: Rate exceeded','error from registry: Rate exceeded') 1 3 $false '15,30'
Check-Case @('HTTP 429; unauthorized') 1 1 $false ''
Check-Case @('HTTP 429; HTTP/1.1 403 Forbidden') 1 1 $false ''
Check-Case @('HTTP 429; manifest unknown') 1 1 $false ''
Check-Case @('HTTP 429; context deadline exceeded') -1 1 $false ''
Check-Case @('ordinary network failure') 1 1 $false ''
Check-Case @('layer aaaa429bbbb failed') 1 1 $false ''
'selective-prefetch-backoff-ok'
`);
  const result = await promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    path.resolve('scripts/testing/Run-HostedSmoothiesRehearsal.ps1'), directory], { windowsHide: true, timeout: 15_000 });
  assert.match(result.stdout, /selective-prefetch-backoff-ok/);
});
