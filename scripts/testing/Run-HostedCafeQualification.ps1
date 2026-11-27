#Requires -Version 7.2
[CmdletBinding()]
param(
    [string]$InputFile=(Join-Path $PSScriptRoot 'cafe-qualification-input.json'),
    [string]$CandidateTag,
    [string]$SourceCommit,
    [string]$CandidateSha256
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'CafeHostedBoundary.psm1') -Force
Assert-CafeHostedComputer
if ($env:NODE_OPTIONS) { throw 'The hosted lab must start without a Node preload.' }
$inputRecord=Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
if ($inputRecord.format -cne 'cafe-exact-rehearsal-input-v1' -or $inputRecord.state -cne 'reviewed-for-isolated-rehearsal') { throw 'Select and review one immutable ZIP descriptor before dispatch; no default engineering artifact is accepted.' }
if (!$PSBoundParameters.ContainsKey('CandidateTag')) { $CandidateTag=[string]$inputRecord.candidateTag }
if (!$PSBoundParameters.ContainsKey('SourceCommit')) { $SourceCommit=[string]$inputRecord.sourceCommit }
if (!$PSBoundParameters.ContainsKey('CandidateSha256')) { $CandidateSha256=[string]$inputRecord.zipSha256 }
if ($CandidateTag -cnotmatch '^[a-z0-9][a-z0-9.-]+$' -or $SourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $CandidateSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    $CandidateTag -cne $inputRecord.candidateTag -or $SourceCommit -cne $inputRecord.sourceCommit -or $CandidateSha256 -cne $inputRecord.zipSha256) { throw 'The selected arguments differ from the reviewed immutable descriptor.' }
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$operatorScript=Join-Path $PSScriptRoot 'Invoke-CafeManualUpdate.ps1'
if ($inputRecord.sourceTree -cnotmatch '^[a-f0-9]{40}$' -or $inputRecord.operatorScriptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    !(Test-Path -LiteralPath $operatorScript) -or (Get-FileHash -LiteralPath $operatorScript).Hash.ToLowerInvariant() -cne $inputRecord.operatorScriptSha256) { throw 'Exact reviewed operator and source tree must be selected in the descriptor.' }
$work=Join-Path $env:RUNNER_TEMP ('cafe-exact-'+[guid]::NewGuid().ToString('N'))
$evidence=Join-Path $env:RUNNER_TEMP 'cafe-exact-evidence'
if (Test-Path -LiteralPath $evidence) { throw 'Never overwrite previous exact-ZIP evidence.' }
$null=New-Item -ItemType Directory -Path $work,$evidence
[void](Assert-CafeOwnedDirectory $work)
$node=(Get-Command node.exe).Source;$docker=(Get-Command docker.exe).Source
$configuration=Join-Path $work 'lab.private.json';$boundary=$null;$audit=$null;$canaryId=$null;$phase='setup';$failure=$null;$completed=$false
$driver=[ordered]@{format='cafe-hosted-driver-v1';sourceCommit=$SourceCommit;candidateZipSha256=$CandidateSha256;inputSha256=(Get-FileHash -LiteralPath $InputFile).Hash.ToLowerInvariant();state='running';checks=@();qualified=$false;productionAcceptance=$false}
function Native {
    param([string]$Executable,[string[]]$Arguments,[string]$Label,[int]$Timeout=900,[switch]$AllowFailure)
    $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$Executable;$start.WorkingDirectory=$source;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $start.Environment['SUPABASE_SERVICES_HOSTNAME']='127.0.0.1'
    $start.Environment.Remove('NODE_OPTIONS') | Out-Null;$start.Environment.Remove('POS_CAFE_TEST_TRANSPORT_FILE') | Out-Null
    if ([IO.Path]::GetFileName($Executable) -ieq 'node.exe') {
        $keep=@('SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','ComSpec','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PSModulePath',
            'GITHUB_ACTIONS','RUNNER_ENVIRONMENT','RUNNER_OS','ImageOS','GITHUB_RUN_ID','RUNNER_TRACKING_ID','RUNNER_TEMP','POS_ACCEPTANCE_DISPOSABLE','NEXT_TELEMETRY_DISABLED','POS_CAFE_REAL_DOCKER','POS_TEST_WSL_ENGINE','COMPOSE_CONVERT_WINDOWS_PATHS','POS_TEST_WSL_RECEIPT','SUPABASE_SERVICES_HOSTNAME')
        foreach ($key in @($start.Environment.Keys)) { if ($keep -inotcontains $key) { [void]$start.Environment.Remove($key) } }
    }
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    try {
        [void]$process.Start();$nativeId=$process.Id;$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit($Timeout*1000)) { $process.Kill($true);$process.WaitForExit();throw "Hosted command timed out: $Label" }
        $text=$stdout.GetAwaiter().GetResult();$diagnostics=$stderr.GetAwaiter().GetResult()
        [IO.File]::WriteAllText((Join-Path $work ($Label+'.stdout.private.log')),$text);[IO.File]::WriteAllText((Join-Path $work ($Label+'.stderr.private.log')),$diagnostics)
        if ($process.ExitCode -ne 0 -and !$AllowFailure) { throw "Hosted command failed: $Label (private diagnostics retained on the disposable VM)." }
        return @{text=$text;code=$process.ExitCode;pid=$nativeId}
    } finally { $process.Dispose() }
}
function Extract-Verified([string]$Zip,[string]$Destination) {
    if (Test-Path -LiteralPath $Destination) { throw 'Never overwrite an extracted package.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        [long]$total=0;$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        if ($archive.Entries.Count -gt 25000) { throw 'Too many package entries.' }
        foreach ($entry in $archive.Entries) {
            $name=$entry.FullName
            if (!$name -or $name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or $name.Split('/') -contains '..' -or !$seen.Add($name) -or (($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960)) { throw 'Unexpected package archive path.' }
            $total+=$entry.Length
            if ($entry.Length -gt 536870912 -or $total -gt 2147483648) { throw 'Package exceeds bounded extraction size.' }
        }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Zip,$Destination)
}
try {
    $engine=Get-Content -LiteralPath $env:POS_TEST_WSL_RECEIPT -Raw | ConvertFrom-Json
    $engineId=(Native $docker @('info','--format','{{.ID}}') 'docker-identity').text.Trim()
    if ($engineId -cne $engine.daemonId) { throw 'The independently provisioned Docker engine changed.' }
    $candidateName='POS-Cafe-'+$SourceCommit.Substring(0,7)+'.zip'
    if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) { throw 'Qualification must receive no repository API token.' }
    $downloads=Assert-CafeOwnedDirectory $env:POS_CAFE_HOSTED_ARTIFACTS
    Copy-Item -LiteralPath (Join-Path $downloads $candidateName) -Destination $work
    Copy-Item -LiteralPath (Join-Path $downloads 'Caja-Cobro-Integrado-rc6.zip') -Destination $work
    # The data-plane runtime and all later children have no repository credential.
    Remove-Item Env:GH_TOKEN,Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
    $candidateZip=Join-Path $work $candidateName;$baselineZip=Join-Path $work 'Caja-Cobro-Integrado-rc6.zip'
    $baselineHash='43256fed95fb3e49b82ed5e3a55d1da88e83ab76748625e54045c06187cca7e8'
    if ((Get-FileHash -LiteralPath $candidateZip).Hash.ToLowerInvariant() -cne $CandidateSha256 -or (Get-FileHash -LiteralPath $baselineZip).Hash.ToLowerInvariant() -cne $baselineHash) { throw 'Downloaded ZIP bytes differ from the selected immutable artifacts.' }
    $candidate=Join-Path $work 'candidate';$oldExtracted=Join-Path $work 'baseline'
    Extract-Verified $candidateZip $candidate;Extract-Verified $baselineZip $oldExtracted
    $baseline=$oldExtracted;if (!(Test-Path -LiteralPath (Join-Path $baseline 'release.json'))) { $baseline=Join-Path $oldExtracted 'Caja' }
    $candidateRelease=Get-Content -LiteralPath (Join-Path $candidate 'release.json') -Raw | ConvertFrom-Json
    $oldRelease=Get-Content -LiteralPath (Join-Path $baseline 'release.json') -Raw | ConvertFrom-Json
    if ($candidateRelease.sourceCommit -cne $SourceCommit -or $candidateRelease.sourceDirty -ne $false -or $candidateRelease.fixtureOnly -ne $false -or $oldRelease.sourceCommit -cne 'b776550a7a91ad1dafb21b2200a235dfe337bb6f') { throw 'Unexpected candidate/predecessor manifest.' }
    $browserOriginal=(Native $node @('-e',"process.stdout.write(require('playwright-core').chromium.executablePath())") 'browser-location').text.Trim()
    $browserDirectory=Join-Path $work 'browser';Copy-Item -LiteralPath (Split-Path -Parent $browserOriginal) -Destination $browserDirectory -Recurse
    $browser=Join-Path $browserDirectory (Split-Path -Leaf $browserOriginal)
    $orchestrator=Join-Path $work 'orchestrator';$null=New-Item -ItemType Directory -Path $orchestrator
    $orchestratorNode=Join-Path $orchestrator 'node.exe';Copy-Item -LiteralPath $node -Destination $orchestratorNode
    $settings=[ordered]@{work=$work;evidence=$evidence;candidate=$candidate;baseline=$baseline;browser=$browser;sourceCommit=$SourceCommit;
        candidateZip=$candidateZip;sourceTree=$inputRecord.sourceTree;operatorScript=$operatorScript;operatorScriptSha256=$inputRecord.operatorScriptSha256;
        harnessCommit=(& git -C $source rev-parse HEAD).Trim();candidateZipSha256=$CandidateSha256;baselineZipSha256=$baselineHash;engineId=$engineId;probesPassed=$false;
        hostInfrastructure=@{commit=(& git -C $source rev-parse HEAD).Trim();provisionerSha256=(Get-FileHash -LiteralPath (Join-Path $source 'scripts/testing/Start-CafeHostedDocker.ps1')).Hash.ToLowerInvariant();loopbackSha256=(Get-FileHash -LiteralPath (Join-Path $source 'scripts/staging/docker-loopback.cs')).Hash.ToLowerInvariant()}}
    if ((Get-FileHash -LiteralPath (Join-Path $source 'scripts/testing/cafe-docker-loopback.cs')).Hash.ToLowerInvariant() -cne $settings.hostInfrastructure.loopbackSha256) { throw 'Pinned test transport changed.' }
    $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configuration -Encoding utf8NoBOM
    $phase='prepare-synthetic-backends'
    [void](Native $orchestratorNode @((Join-Path $PSScriptRoot 'cafe-exact-acceptance.mjs'),'prepare',$configuration) 'prepare-backends' -Timeout 1500)
    $phase='prepare-independent-probes'
    $wsl=(Native 'wsl.exe' @('--distribution',$engine.distribution,'--user','root','--','hostname','-I') 'wsl-address').text.Replace([string][char]0,'').Trim().Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
    $wslIp=@($wsl | Where-Object { $_ -match '^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)\d' } | Select-Object -First 1)
    if ($wslIp.Count -ne 1) { throw 'A private independently controlled WSL canary address is required.' }
    $remote='http://'+$wslIp[0]+':3194';$loopback='http://127.0.0.1:3194'
    $canaryOwner='cafe-canary-'+[guid]::NewGuid().ToString('N')
    $canaryId=(Native $docker @('create','--name',$canaryOwner,'--label',"mx.pos-cafe-lab=$canaryOwner",'-p','3194:3194','-e',"CANARY_REMOTE=$remote",'node:24.22.2-alpine','node','/canary.mjs') 'canary-create').text.Trim()
    if ($canaryId -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid owned canary container identity.' }
    [void](Native $docker @('cp',(Join-Path $PSScriptRoot 'cafe-network-canary.mjs'),"${canaryId}:/canary.mjs") 'canary-copy')
    [void](Native $docker @('start',$canaryId) 'canary-start')
    for ($attempt=0;$attempt -lt 60;$attempt++) { try { if ((Invoke-WebRequest ($loopback+'/probe') -TimeoutSec 2).Content -ceq 'cafe-boundary-canary-v1') { break } } catch {};if ($attempt -eq 59) { throw 'Owned canary did not become reachable.' };Start-Sleep -Milliseconds 500 }
    $nodes=@((Join-Path $candidate 'node.exe'),(Join-Path $baseline 'node.exe'),$orchestratorNode)
    $probe=Join-Path $PSScriptRoot 'cafe-network-probe.mjs';$browserProbe=Join-Path $PSScriptRoot 'cafe-browser-network-probe.mjs'
    $programs=@($nodes)+@(Get-ChildItem -LiteralPath $browserDirectory -Filter '*.exe' -File -Recurse | ForEach-Object FullName)+@((Get-Process -Id $PID).Path,(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'))
    foreach ($relative in @('Microsoft.NET\Framework64\v4.0.30319\csc.exe','Microsoft.NET\Framework\v4.0.30319\csc.exe','System32\conhost.exe','System32\cmd.exe','System32\WerFault.exe','System32\WerFaultSecure.exe','System32\wermgr.exe')) { $systemFile=Join-Path $env:SystemRoot $relative;if (Test-Path -LiteralPath $systemFile) { $programs+=$systemFile } }
    $audit=Start-CafeHostedProcessAudit $work
    $driver.windows=@()
    foreach ($lifecycle in @('newInstall','retainedUpgrade','retainedVerify','recovery')) {
        $window=[ordered]@{phase=$lifecycle;state='preparing';networkRestored=$false}
        $boundary=$null
        try {
            $phase=$lifecycle+'-verify-positive-controls'
            $before=@();foreach ($runtime in $nodes) { $before+=((Native $runtime @($probe,'before',$remote,$loopback) ($lifecycle+'-before-'+[IO.Path]::GetFileName((Split-Path -Parent $runtime)))).text | ConvertFrom-Json) }
            $before+=((Native $orchestratorNode @($browserProbe,'before',$browser,$remote,$loopback) ($lifecycle+'-browser-before')).text | ConvertFrom-Json)
            $boundary=New-CafeHostedBoundary -Directory $work -Programs $programs
            $fence=[Diagnostics.Stopwatch]::StartNew()
            function Fenced-Seconds([int]$Desired) {
                $remaining=220-[int][Math]::Ceiling($fence.Elapsed.TotalSeconds)
                if ($remaining -lt 1) { throw 'Bounded hosted egress-denial window expired before the next operation.' }
                return [Math]::Min($Desired,$remaining)
            }
            $phase=$lifecycle+'-verify-independent-boundary'
            $blocked=@();foreach ($runtime in $nodes) { $blocked+=((Native $runtime @($probe,'blocked',$remote,$loopback) ($lifecycle+'-blocked-'+[IO.Path]::GetFileName((Split-Path -Parent $runtime))) -Timeout (Fenced-Seconds 35)).text | ConvertFrom-Json) }
            $blocked+=((Native $orchestratorNode @($browserProbe,'blocked',$browser,$remote,$loopback) ($lifecycle+'-browser-blocked') -Timeout (Fenced-Seconds 40)).text | ConvertFrom-Json)
            @{format='cafe-boundary-probes-v1';phase=$lifecycle;before=$before;blocked=$blocked;interception=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence ('boundary-probes-'+$lifecycle+'.json')) -Encoding utf8NoBOM
            $settings.boundaryReceipt=$boundary;$settings.probesPassed=$true;$settings.lifecyclePhase=$lifecycle
            $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configuration -Encoding utf8NoBOM
            $phase=$lifecycle+'-exact-package-lifecycle'
            $marker=(Get-WinEvent -LogName Security -MaxEvents 1).RecordId
            $activeBoundary=Get-Content -LiteralPath $boundary -Raw | ConvertFrom-Json;$activeBoundary.applicationLaunchAttempted=$true
            $activeBoundary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $boundary -Encoding utf8NoBOM
            Copy-Item -LiteralPath $boundary -Destination (Join-Path $evidence ('boundary-active-'+$lifecycle+'.json'))
            $run=Native $orchestratorNode @((Join-Path $PSScriptRoot 'cafe-exact-acceptance.mjs'),'run',$configuration) ($lifecycle+'-exact-package-lifecycle') -Timeout (Fenced-Seconds 220) -AllowFailure
            $phase=$lifecycle+'-verify-runtime-cohort'
            Get-CafeHostedProcessAttestation -RootProcessId $run.pid -AfterRecordId $marker -RestrictedPrograms $programs | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence ('process-cohort-'+$lifecycle+'.json')) -Encoding utf8NoBOM
            $activeBoundary=Get-Content -LiteralPath $boundary -Raw | ConvertFrom-Json;$activeBoundary.attestationAccepted=$true
            $activeBoundary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $boundary -Encoding utf8NoBOM
            if ($run.code -ne 0) { throw 'Exact package application acceptance failed; see sanitized result.' }
            $window.state='application-phase-passed'
        } finally {
            if (!$boundary -and (Test-Path -LiteralPath (Join-Path $work 'boundary.private.json'))) { $boundary=Join-Path $work 'boundary.private.json' }
            if ($boundary) {
                Close-CafeHostedRuntimeCohort -ReceiptFile $boundary
                Restore-CafeHostedBoundary -ReceiptFile $boundary
                $window.networkRestored=$true;$window.egressDeniedSeconds=[Math]::Round($fence.Elapsed.TotalSeconds,2)
                Copy-Item -LiteralPath $boundary -Destination (Join-Path $evidence ('boundary-closed-'+$lifecycle+'.json'))
                Move-Item -LiteralPath $boundary -Destination (Join-Path $work ('boundary-'+$lifecycle+'.closed.private.json'))
                $boundary=$null
            }
            $driver.windows+=@($window)
        }
    }
    if ((Get-FileHash -LiteralPath $candidateZip).Hash.ToLowerInvariant() -cne $CandidateSha256) { throw 'Original candidate archive changed during rehearsal.' }
    $driver.state='isolated-rehearsal-passed-synthetic-manual-admission';$completed=$true
} catch { $failure=$_.Exception;$driver.state='failed';$driver.failedPhase=$phase;$driver.failure=$failure.Message }
finally {
    $driver.cleanup=@()
    if (!$boundary -and (Test-Path -LiteralPath (Join-Path $work 'boundary.private.json'))) { $boundary=Join-Path $work 'boundary.private.json' }
    $safeToReconnect=$false
    if ($boundary) {
        try {
            Close-CafeHostedRuntimeCohort -ReceiptFile $boundary
            $driver.cleanup+=@{name='owned application and browser cohort proven stopped';passed=$true}
            Restore-CafeHostedBoundary -ReceiptFile $boundary
            Copy-Item -LiteralPath $boundary -Destination (Join-Path $evidence 'boundary.json')
            $safeToReconnect=$true;$driver.cleanup+=@{name='firewall restored only after cohort shutdown';passed=$true}
        } catch { $driver.cleanup+=@{name='cohort shutdown or firewall restore; denial retained if uncertain';passed=$false};$driver.state='attention-required' }
    } else { $safeToReconnect=$true }
    if ($safeToReconnect -and (Test-Path -LiteralPath (Join-Path $work 'state.private.json'))) {
        try {
            $private=Get-Content -LiteralPath (Join-Path $work 'state.private.json') -Raw | ConvertFrom-Json
            if ((Native $docker @('info','--format','{{.ID}}') 'cleanup-docker-identity').text.Trim() -cne $engineId) { throw 'Docker cleanup identity changed.' }
            foreach ($fixture in @($private.newInstall,$private.retained,$private.recovery)) {
                $ids=@($fixture.isolation.containers | ForEach-Object id)
                $observed=(Native $docker (@('inspect')+$ids) ('cleanup-inspect-'+$fixture.isolation.project)).text | ConvertFrom-Json
                foreach ($container in $observed) {
                    $expected=@($fixture.isolation.containers | Where-Object { $_.id -ceq $container.Id })
                    if ($expected.Count -ne 1 -or $expected[0].image -cne $container.Image -or !$container.Name.EndsWith('_'+$fixture.isolation.project) -or !$container.NetworkSettings.Networks.PSObject.Properties[$fixture.isolation.network]) { throw 'Unknown synthetic backend ownership; leave it intact.' }
                }
                [void](Native $docker (@('stop')+$ids) ('cleanup-stop-'+$fixture.isolation.project) -Timeout 180)
            }
            $driver.cleanup+=@{name='owned synthetic backends stopped; volumes retained';passed=$true}
        } catch { $driver.cleanup+=@{name='owned synthetic backends';passed=$false};$driver.state='attention-required' }
    }
    if ($safeToReconnect -and $canaryId) { try { $label=(Native $docker @('inspect','--format','{{index .Config.Labels "mx.pos-cafe-lab"}}',$canaryId) 'canary-owner').text.Trim();if ($label -cne $canaryOwner) { throw 'Canary ownership changed.' };[void](Native $docker @('rm','-f',$canaryId) 'canary-stop');$driver.cleanup+=@{name='owned canary';passed=$true} } catch { $driver.cleanup+=@{name='owned canary';passed=$false};$driver.state='attention-required' } }
    if ($audit) { try { Restore-CafeHostedProcessAudit $audit;$driver.cleanup+=@{name='audit policy restored';passed=$true} } catch { $driver.cleanup+=@{name='audit restore';passed=$false};$driver.state='attention-required' } }
    $driver.finishedAt=[DateTime]::UtcNow.ToString('o');$driver | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'driver.json') -Encoding utf8NoBOM
}
$driver | ConvertTo-Json -Depth 4
if (!$completed -or $driver.state -eq 'attention-required') { exit 1 }
