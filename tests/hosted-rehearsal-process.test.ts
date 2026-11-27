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
