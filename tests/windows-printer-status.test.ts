import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('actual Windows preflight accepts healthy busy/printing queues and withholds known faults', { skip: process.platform !== 'win32' }, () => {
  // Extract only the pure predicate. No driver/device query or spooler call.
  const script = `
    $ErrorActionPreference='Stop'
    $tokens=$null; $errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/printing/windows-print.ps1'),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'Helper parse failed'}
    $predicate=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-CafePrinterReady'},$true)
    if(-not $predicate){throw 'Missing production status predicate'}
    . ([scriptblock]::Create($predicate.Extent.Text))
    $checks=0
    # The first two rows are the owner's current idle queue observations.
    $healthy=@(@(3,0),@(3,0),@(4,11),@(10,10),@(17,9),@(12,14),@(13,15))
    foreach($pair in $healthy){
      $p=[pscustomobject]@{WorkOffline=$false;PrinterStatus=$pair[0];PrinterState=$pair[1];DetectedErrorState=0}
      if(-not(Test-CafePrinterReady $p)){throw ('Healthy queue rejected: '+$pair)}
      $checks++
    }
    foreach($status in @(6,7,8,9,11,16)){
      $p=[pscustomobject]@{WorkOffline=$false;PrinterStatus=$status;PrinterState=0;DetectedErrorState=0}
      if(Test-CafePrinterReady $p){throw ('Fault accepted: '+$status)}
      $checks++
    }
    foreach($errorCode in @(4,6,7,8,9,10,11)){
      $p=[pscustomobject]@{WorkOffline=$false;PrinterStatus=3;PrinterState=0;DetectedErrorState=$errorCode}
      if(Test-CafePrinterReady $p){throw ('Detected fault accepted: '+$errorCode)}
      $checks++
    }
    foreach($warning in @(0,1,2,3,5)){
      $p=[pscustomobject]@{WorkOffline=$false;PrinterStatus=3;PrinterState=0;DetectedErrorState=$warning}
      if(-not(Test-CafePrinterReady $p)){throw ('Unknown or non-blocking warning rejected: '+$warning)}
      $checks++
    }
    if(Test-CafePrinterReady ([pscustomobject]@{WorkOffline=$true;PrinterStatus=3;DetectedErrorState=0})){throw 'Offline queue accepted'}
    if(Test-CafePrinterReady $null){throw 'Missing queue accepted'}
    @{checks=$checks+2;physicalJobs=0}|ConvertTo-Json -Compress
  `;
  const result = spawnSync(path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { checks: 27, physicalJobs: 0 });
});
