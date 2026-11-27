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
Import-Module (Join-Path (Split-Path $Bootstrap -Parent) 'HostedProcess.psm1') -Force -DisableNameChecking
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
$sshExecutable=(Get-Command ssh.exe -ErrorAction Stop).Source
$keygen=Join-Path ([IO.Path]::GetDirectoryName($sshExecutable)) 'ssh-keygen.exe'
$fixtureKey=Join-Path $WorkDirectory 'fixture-key-with-spaces test'
[void](Native -Executable $keygen -Arguments @('-q','-t','ed25519','-N','','-f',$fixtureKey))
if(!(Test-Path -LiteralPath $fixtureKey) -or (Get-Content -LiteralPath ($fixtureKey+'.pub') -Raw).Trim() -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$'){
    throw 'OpenSSH fixture key generation failed'
}
$guardNode=$syntax.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-OwnedKeepAlive'},$true)
if(!$guardNode){throw 'Keepalive ownership guard was not found'}
Invoke-Expression $guardNode.Extent.Text
$created=[DateTime]::new(2026,11,27,1,2,3,[DateTimeKind]::Utc).AddTicks(1234567)
$fixtureExecutable='C:\Windows\System32\wsl.exe'
$fixtureOwner='0123456789abcdef0123456789abcdef'
$fixtureProcess=[pscustomobject]@{
    ProcessId=123456; ExecutablePath=$fixtureExecutable; CreationDate=$created
    CommandLine="wsl.exe --distribution Ubuntu-24.04 --user root -- /usr/bin/env POS_HOSTED_OWNER=$fixtureOwner sleep infinity"
}
$fixtureReceipt=[pscustomobject]@{
    owner=$fixtureOwner; distribution='Ubuntu-24.04'; keepAlivePid=123456; keepAliveExecutable=$fixtureExecutable
    keepAliveStartedTicks=$created.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
}
$receiptFile=Join-Path $WorkDirectory 'synthetic-engine.json'
$fixtureReceipt | ConvertTo-Json | Set-Content -LiteralPath $receiptFile -Encoding utf8NoBOM
$priorCulture=[Threading.Thread]::CurrentThread.CurrentCulture
try {
    foreach($culture in @('en-US','es-MX')) {
        [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($culture)
        $roundTrip=Get-Content -LiteralPath $receiptFile -Raw | ConvertFrom-Json
        if($roundTrip.keepAliveStartedTicks -isnot [string]){throw 'Keepalive start identity must remain a decimal string'}
        Assert-OwnedKeepAlive $fixtureProcess $roundTrip $fixtureExecutable
        $roundTrip.keepAliveStartedTicks=($created.Ticks+1).ToString([Globalization.CultureInfo]::InvariantCulture)
        $rejected=$false
        try{Assert-OwnedKeepAlive $fixtureProcess $roundTrip $fixtureExecutable}catch{$rejected=$true}
        if(!$rejected){throw 'A reused keepalive PID with a different start time was accepted'}
    }
} finally { [Threading.Thread]::CurrentThread.CurrentCulture=$priorCulture }
$plainArguments=@('--distribution','Ubuntu-24.04','--user','root','--','/usr/bin/env',"POS_HOSTED_OWNER=$fixtureOwner",'sleep','infinity')
if((Quote-WindowsArguments $plainArguments) -cne ($plainArguments -join ' ')){
    throw 'WSL option names and plain values must remain unquoted'
}
$literalArguments=@('--distribution','Ubuntu-24.04','','path with spaces','embedded "quotes"','trailing path\','plain\','quote at end"')
$argvStart=[Diagnostics.ProcessStartInfo]::new()
$argvStart.FileName=$Node; $argvStart.UseShellExecute=$false; $argvStart.CreateNoWindow=$true
$argvStart.RedirectStandardOutput=$true; $argvStart.RedirectStandardError=$true
$argvStart.Arguments=Quote-WindowsArguments (@('-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--')+$literalArguments)
$argvProcess=[Diagnostics.Process]::Start($argvStart)
try {
    $argvOut=$argvProcess.StandardOutput.ReadToEndAsync(); $argvErr=$argvProcess.StandardError.ReadToEndAsync()
    if(!$argvProcess.WaitForExit(5000)){$argvProcess.Kill($true);throw 'Offline argument echo exceeded its deadline'}
    if($argvProcess.ExitCode -ne 0 -or $argvErr.GetAwaiter().GetResult()){throw 'Offline argument echo failed'}
    $actualArguments=$argvOut.GetAwaiter().GetResult() | ConvertFrom-Json
    if((ConvertTo-Json -InputObject $actualArguments -Compress) -cne (ConvertTo-Json -InputObject $literalArguments -Compress)){
        throw 'Windows argument helper changed literal arguments'
    }
} finally {$argvProcess.Dispose()}
$driver=Join-Path (Split-Path $Bootstrap -Parent) 'Run-HostedSmoothiesRehearsal.ps1'
$driverAst=[Management.Automation.Language.Parser]::ParseFile($driver,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Actual rehearsal driver did not parse'}
foreach($name in @('Invoke-PrivateRehearsalCommand','ConvertTo-SafeRehearsalDiagnostic')){
    $driverFunction=$driverAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if(!$driverFunction){throw 'Actual rehearsal function was not found'}
    Invoke-Expression $driverFunction.Extent.Text
}
$writerScript=Join-Path $WorkDirectory 'owned-background-writer.cjs'
$parentScript=Join-Path $WorkDirectory 'failed-parent.cjs'
[IO.File]::WriteAllText($writerScript,'process.stdout.on("error",()=>{});process.stderr.on("error",()=>{});setInterval(()=>{process.stdout.write("synthetic heartbeat\n")},200)')
[IO.File]::WriteAllText($parentScript,'const fs=require("fs"),path=require("path"),cp=require("child_process");const root=__dirname;const child=cp.spawn(process.execPath,[path.join(root,"owned-background-writer.cjs")],{detached:true,stdio:"inherit"});child.unref();fs.writeFileSync(path.join(root,"owned-processes.json"),JSON.stringify({parent:process.pid,child:child.pid}));process.stderr.write("synthetic ERR_ASSERTION before parent exit7\n");process.exit(7)')
$work=$WorkDirectory; $phase='synthetic-assertion'; $timer=[Diagnostics.Stopwatch]::StartNew(); $failed=$false
try {
    try { Invoke-PrivateRehearsalCommand -Executable $Node -Arguments @($parentScript) -LogName 'synthetic-private' -TimeoutSeconds 4 }
    catch { $failed=$true }
    if(!$failed -or $script:failureExitCode -ne 7 -or $script:failureCode -cne 'ERR_ASSERTION' -or $timer.Elapsed.TotalSeconds -gt 3){
        throw 'The actual rehearsal runner hid the failed parent behind descendant EOF'
    }
    $ownedPids=Get-Content -LiteralPath (Join-Path $WorkDirectory 'owned-processes.json') -Raw | ConvertFrom-Json
    if(Get-CimInstance Win32_Process -Filter ('ProcessId='+$ownedPids.parent)){throw 'Synthetic parent was still alive'}
    $writer=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ownedPids.child)
    if(!$writer -or $writer.ExecutablePath -ine $Node -or !$writer.CommandLine.Contains($writerScript)){
        throw 'The explicitly owned background writer must remain alive when the runner returns'
    }
} finally {
    $pidFile=Join-Path $WorkDirectory 'owned-processes.json'
    if(Test-Path -LiteralPath $pidFile){
        $ownedPids=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $writer=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ownedPids.child)
        if($writer -and $writer.ExecutablePath -ieq $Node -and $writer.CommandLine.Contains($writerScript)){
            Stop-Process -Id ([int]$ownedPids.child) -ErrorAction Stop
        }
    }
}
'failed-parent-returned-with-owned-writer-alive'
'windows-argument-roundtrip-ok'
'keepalive-json-roundtrip-ok'
'native-regression-ok'
`);
      const result = await run('pwsh.exe', ['-NoProfile', '-File', script, '-Bootstrap',
        path.resolve('scripts/testing/Start-HostedWslDocker.ps1'), '-Node', process.execPath,
        '-WorkDirectory', directory], { timeout: 12_000 });
      assert.match(result.stdout, /native-regression-ok/);
      assert.match(result.stdout, /keepalive-json-roundtrip-ok/);
      assert.match(result.stdout, /windows-argument-roundtrip-ok/);
      assert.match(result.stdout, /failed-parent-returned-with-owned-writer-alive/);
      assert.equal(result.stderr, '');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

