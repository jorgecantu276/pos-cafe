import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

test('hosted Native runner keeps stdout separate and bounds only its owned child',
  { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pos-native-regression-'));
    try {
      const script = path.join(directory, 'Native.test.ps1');
      await writeFile(script, String.raw`
#Requires -Version 7.2
param([string]$Bootstrap,[string]$Node,[string]$WorkDirectory)
$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
$syntax=[Management.Automation.Language.Parser]::ParseFile($Bootstrap,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors|Out-String)}
$functionNode=$syntax.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Native'},$true)
if(!$functionNode){throw 'Native function was not found'}
# Only this function is evaluated: no bootstrap, host Docker, service or WSL code.
Invoke-Expression $functionNode.Extent.Text
$actual=Native -Executable $Node -Arguments @('-e','process.stderr.write("pull progress");process.stdout.write(process.argv[1])','container id with spaces')
if($actual -cne 'container id with spaces'){throw 'stdout or argument corruption'}
if((Get-Content (Join-Path $WorkDirectory 'native-stderr.log') -Raw).Trim() -cne 'pull progress'){throw 'stderr lost'}
$failed=$false
try{Native -Executable $Node -Arguments @('-e','process.stderr.write("synthetic command failed");process.exit(7)')}catch{$failed=$_.Exception.Message.Contains('synthetic command failed')}
if(!$failed){throw 'nonzero exit not reported'}
$bounded=$false; $timer=[Diagnostics.Stopwatch]::StartNew()
try{Native -Executable $Node -Arguments @('-e','setInterval(()=>{},1000)') -TimeoutSeconds 1}catch{$bounded=$_.Exception.Message.Contains('deadline')}
if(!$bounded -or $timer.Elapsed.TotalSeconds -gt 5){throw 'owned child deadline failed'}
'native-regression-ok'
`);
      const result = await run('pwsh.exe', ['-NoProfile', '-File', script, '-Bootstrap',
        path.resolve('scripts/testing/Start-HostedWslDocker.ps1'), '-Node', process.execPath,
        '-WorkDirectory', directory], { timeout: 12_000 });
      assert.match(result.stdout, /native-regression-ok/);
      assert.equal(result.stderr, '');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

