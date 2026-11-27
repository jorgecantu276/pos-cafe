[CmdletBinding()]
param(
    [long]$SourceRunId = 45881982067,
    [ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit = '6904d8c500f05647f8a00dd7b6b292aa80a8a8a3',
    [long]$ArtifactId = 0,
    [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedZipSha256 = '1ba631fc5812cfef2f8aee5b7267aa69d481f7c5e3a794e36ddd82ee50d54767',
    [AllowEmptyString()][ValidatePattern('^(?:[a-f0-9]{64})?$')][string]$ExpectedIndexSha256 = 'd49f81fe40ca4370c8530df7c8975ae88b78fb38f58e9c9ae5c5c22085d6305c',
    [AllowEmptyString()][ValidatePattern('^(?:[a-f0-9]{16})?$')][string]$ExpectedPackageId = '91d0185345dfb706',
    [string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Hosted-LanTrust.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'HostedProcess.psm1') -Force -DisableNameChecking

# This driver is intentionally unavailable on an operator's or development PC.
# The workflow owns a new hosted Windows 2025 VM and its WSL Docker daemon.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
    !$env:RUNNER_TEMP -or !$env:GITHUB_WORKSPACE -or !$env:RUNNER_TRACKING_ID) {
    throw 'This rehearsal requires a fresh GitHub-hosted Windows 2025 runner.'
}
if ($SourceRunId -le 0 -or $ArtifactId -lt 0) { throw 'Select one immutable candidate run and artifact.' }
if ($SourceRunId -ne 45881982067 -or $SourceCommit -cne '6904d8c500f05647f8a00dd7b6b292aa80a8a8a3') {
    if (!$PSBoundParameters.ContainsKey('ExpectedIndexSha256')) { $ExpectedIndexSha256 = '' }
    if (!$PSBoundParameters.ContainsKey('ExpectedPackageId')) { $ExpectedPackageId = '' }
}

$repository = 'jorgecantu276/pos-cafe'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runnerTemporary = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$workspace = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE).TrimEnd('\')
if ($source -ine $workspace -or ![IO.Path]::IsPathRooted($runnerTemporary) -or $runnerTemporary.StartsWith('\\')) {
    throw 'The hosted checkout and private runner temporary directory must be explicit.'
}
if (!$EvidenceDirectory) { $EvidenceDirectory = Join-Path $runnerTemporary 'smoothies-rehearsal-evidence' }
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
if (!$EvidenceDirectory.StartsWith($runnerTemporary + '\', [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $EvidenceDirectory -PathType Leaf) -or
    ((Test-Path -LiteralPath $EvidenceDirectory) -and @(Get-ChildItem -LiteralPath $EvidenceDirectory -Force).Count)) {
    throw 'Use an empty evidence directory strictly inside this disposable runner temporary directory.'
}

$node = (Get-Command 'node.exe' -ErrorAction Stop).Source
$gh = (Get-Command 'gh.exe' -ErrorAction Stop).Source
$docker = (Get-Command 'docker.exe' -ErrorAction Stop).Source
if ((& $node '-p' 'process.version').Trim() -cne 'v24.22.2' -or $LASTEXITCODE -ne 0) { throw 'Use the pinned Node 24.22.2 runtime.' }
$work = Join-Path $runnerTemporary ('smoothies-hosted-rehearsal-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $work
$null = New-Item -ItemType Directory -Path $EvidenceDirectory
$privateEvidence = Join-Path $work 'acceptance-private'
$null = New-Item -ItemType Directory -Path $privateEvidence
$phase = 'host-validation'
$result = 'fail'
$temporaryTrustIdentity = $null
$temporaryTrustChanged = $false
$temporaryTrustRemoved = $true
$acceptance = $null
$candidateIntegrityBefore = 'unverified'
$candidateIntegrityAfter = 'not-checked'
$originalCandidateModified = $null
$platformProof = @{ state = 'unverified' }
$failureCode = $null
$failureScript = $null
$failureLine = $null
$failureExitCode = $null
$failureDiagnostics = @()
$ownedEngineValidated = $false
$ownedProxyRemoved = $false
$ownedContextRemoved = $false
$requiredChecks = @('zip-build-equality','complete-file-index','exact-zip-install','private-config','launch-reuse','browser-offline','json-import',
    'opening-counts','photos','private-recipes','extra-scope','weekly-special','cash-sale','closing','gzip','backup-attachment','full-restore','signed-live-update','docker-restart','installer-repair',
    'external-ciphertext-copy','external-copy-failure-local-preserved','external-copy-restart-retry')

function ConvertTo-SafeRehearsalDiagnostic {
    param([string]$Text)
    $safe = $Text -replace '(?im)^.*(?:password|passwd|secret|service.?role|jwt|authorization|api.?key|access_token|refresh_token|SMOOTHIES_(?:ANON|SERVICE|DATABASE|ADMIN)|p_payload).*$','[redacted sensitive log line]'
    $safe = $safe -replace '(?i)\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b','[redacted token]'
    $safe = $safe -replace '(?i)\bpostgres(?:ql)?://[^\s"''<>]+','[redacted database URL]'
    $safe = $safe -replace '(?im)\b[A-Z]:[\\/][^\r\n]*','[redacted Windows path]'
    $safe = $safe -replace '(?i)(?:https?|file)://[^\s"''<>]+','[redacted URL]'
    $safe = $safe -replace '(?i)/(?:home|mnt|root|tmp|run)/[^\s"''<>]+','[redacted runner path]'
    $safe = $safe -replace '[A-Za-z0-9_+/=\-]{32,}','[redacted long value]'
    return @($safe -split '\r?\n' | Where-Object { $_.Trim() } | Select-Object -Last 45 | ForEach-Object {
        if ($_.Length -gt 300) { $_.Substring(0,300) + ' [truncated]' } else { $_ }
    })
}

function Invoke-PrivateRehearsalCommand {
    param([string]$Executable, [string[]]$Arguments, [string]$LogName, [ValidateRange(1,3600)][int]$TimeoutSeconds = 1800)
    # Never upload or print these private synthetic setup/server logs. The only
    # exported artifact is the explicitly projected acceptance JSON below.
    $stdoutFile = Join-Path $work ($LogName + '.stdout.log')
    $stderrFile = Join-Path $work ($LogName + '.stderr.log')
    Write-Host ('Starting hosted rehearsal phase ' + $phase + ' (owned command deadline ' + $TimeoutSeconds + 's).')
    $completed = Invoke-HostedProcess -Executable $Executable -Arguments $Arguments -StdoutFile $stdoutFile -StderrFile $stderrFile -TimeoutSeconds $TimeoutSeconds
    $exitCode = if ($completed.TimedOut) { -1 } else { $completed.ExitCode }
    Write-Host ('Completed owned command during ' + $phase + ' (root exit ' + $exitCode + '; deadline exceeded ' + $completed.TimedOut + '; output drain bounded ' + $completed.DrainTimedOut + ').')
    if ($exitCode -ne 0) {
        $script:failureExitCode = $exitCode
        $log = (@(Get-Content -LiteralPath $stdoutFile -Tail 125 -ErrorAction SilentlyContinue) +
            @(Get-Content -LiteralPath $stderrFile -Tail 125 -ErrorAction SilentlyContinue)) -join "`n"
        foreach ($knownCode in @('ERR_ASSERTION','EADDRINUSE','ECONNREFUSED','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT')) {
            if ($log.Contains($knownCode)) { $script:failureCode = $knownCode; break }
        }
        if ($log -match '(?<file>acceptance(?:-ui|-update)?\.mjs|auto-update\.mjs|prepare-local\.mjs|start-local\.mjs|restore-local\.mjs):(?<line>[0-9]+):[0-9]+') {
            $script:failureScript = $Matches.file
            $script:failureLine = [int]$Matches.line
        }
        $script:failureDiagnostics = @(ConvertTo-SafeRehearsalDiagnostic $log)
        Write-Host ('Hosted rehearsal command failed during ' + $phase + ' (exit ' + $exitCode + ').')
        foreach ($line in $script:failureDiagnostics) { Write-Host $line }
        throw 'The bounded rehearsal command did not complete successfully.'
    }
}

function Get-RehearsalJson {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 65536) { throw 'Unexpected rehearsal receipt.' }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Invoke-OwnedProxy([ValidateSet('check','stop')][string]$Action) {
    $proxy = $engineReceipt.proxy
    $helper = Join-Path ([IO.Path]::GetDirectoryName($engineReceiptPath)) 'guest-transport-control.sh'
    $item = Get-Item -LiteralPath $helper -Force
    if ($proxy.script -cne $helper -or $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $proxy.scriptSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant() -cne $proxy.scriptSha256) { throw 'The owned transport helper changed.' }
    if ($helper -notmatch '^([A-Za-z]):[\\/](.*)$') { throw 'The helper must use a local runner drive.' }
    $guestHelper = '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\','/')
    $output = & wsl.exe --distribution Ubuntu-24.04 --user root -- bash $guestHelper $proxy.guestAddress $proxy.windowsGateway $engineReceipt.owner $Action ([string]$proxy.pid)
    if ($LASTEXITCODE -ne 0 -or ($Action -ceq 'check' -and ($output | Out-String).Trim() -cne 'owned-listener-active')) { throw 'The owned transport unit did not confirm its exact live identity.' }
}

try {
    $phase = 'docker-validation'
    $engineJson = & $docker 'info' '--format' '{{json .}}' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'The owned WSL Docker daemon is unavailable.' }
    $engine = ($engineJson -join "`n") | ConvertFrom-Json
    if ($engine.OSType -cne 'linux') { throw 'The rehearsal requires the real Linux Docker engine.' }
    if ($env:POS_TEST_WSL_ENGINE -cne '1' -or !$env:POS_TEST_WSL_RECEIPT) { throw 'The owned WSL engine parity receipt is required.' }
    $engineReceiptPath = [IO.Path]::GetFullPath($env:POS_TEST_WSL_RECEIPT)
    if (!$engineReceiptPath.StartsWith($runnerTemporary + '\',[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($engineReceiptPath) -cne 'engine.json') { throw 'Use the owned runner-temporary engine receipt.' }
    $ancestor = [IO.Path]::GetDirectoryName($engineReceiptPath)
    while ($ancestor -ine $runnerTemporary) {
        $item = Get-Item -LiteralPath $ancestor -Force
        if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The engine receipt cannot traverse redirected directories.' }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
        if (!$ancestor) { throw 'The engine receipt escaped its runner-temporary owner.' }
    }
    $engineReceipt = Get-RehearsalJson $engineReceiptPath
    $selectedContext = (& $docker 'context' 'inspect' | Out-String) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'The actual Docker context is unavailable.' }
    if ($engineReceipt.version -ne 3 -or $engineReceipt.owner -cnotmatch '^[a-f0-9]{32}$' -or
        $engineReceipt.daemonId -cne $engine.ID -or ('mx.pos-hosted-rehearsal=' + $engineReceipt.owner) -cnotin $engine.Labels -or
        $engineReceipt.distribution -cne 'Ubuntu-24.04' -or $engineReceipt.endpoint -cne ('tcp://' + $engineReceipt.proxy.guestAddress + ':2376') -or
        $engineReceipt.context -cne ('pos-hosted-' + $engineReceipt.owner) -or $engineReceipt.runId -cne $env:GITHUB_RUN_ID -or
        $engineReceipt.job -cne $env:GITHUB_JOB -or @($selectedContext).Count -ne 1 -or
        $selectedContext[0].Name -cne $engineReceipt.context -or $selectedContext[0].Endpoints.docker.Host -cne $engineReceipt.endpoint -or
        $engineReceipt.kernel -cnotmatch '^[A-Za-z0-9._+()-]{1,128}$' -or $engineReceipt.kernel -cne $engine.KernelVersion) {
        throw 'The receipt does not identify the actual owned WSL Linux daemon.'
    }
    if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT -or $env:POS_ACCEPTANCE_DISPOSABLE -cne '1') { throw 'The current fresh-host transport cannot be overridden.' }
    $proxy = $engineReceipt.proxy
    foreach ($address in @($proxy.guestAddress,$proxy.windowsGateway)) {
        $parsed = $null
        if (![Net.IPAddress]::TryParse($address,[ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
            $parsed.ToString() -cne $address -or $address -cnotmatch '^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)') { throw 'Only exact private same-host WSL addresses are accepted.' }
    }
    $gateway = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $proxy.windowsGateway -ErrorAction SilentlyContinue)
    if ($proxy.guestAddress -ceq $proxy.windowsGateway -or $gateway.Count -ne 1 -or $gateway[0].InterfaceIndex -ne $proxy.gatewayInterfaceIndex -or
        $proxy.unit -cne ('pos-transport-' + $engineReceipt.owner + '.service') -or $proxy.pid -le 0 -or
        $proxy.endpoint -cne $engineReceipt.endpoint -or $proxy.guestPrefixLength -lt 1 -or $proxy.guestPrefixLength -gt 30) { throw 'The private transport ownership differs.' }
    Invoke-OwnedProxy 'check'
    $ownedEngineValidated = $true
    $completedAt = [DateTimeOffset]::MinValue
    if (![DateTimeOffset]::TryParse([string]$engineReceipt.completedAt,[ref]$completedAt) -or
        $completedAt -lt [DateTimeOffset]::UtcNow.AddHours(-1) -or $completedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) { throw 'The owned engine receipt must be fresh for this rehearsal.' }
    $parity = $engineReceipt.parity
    if ($parity.composeBindSha256 -cnotmatch '^[a-f0-9]{64}$' -or $parity.composeBindSha256 -cne $parity.rawBindSha256 -or
        $parity.composeBindSha256 -cne $parity.binaryCopySha256) { throw 'Compose, raw-CLI bind and binary-copy parity must all be confirmed.' }
    $requiredPorts = @(58000,55432,55541,55542,55543,55544)
    if (@($parity.loopbackPorts).Count -ne $requiredPorts.Count -or @($requiredPorts | Where-Object { $parity.loopbackPorts -notcontains $_ }).Count) { throw 'Every required Windows loopback port must have completed genuine container parity.' }
    $platformProof = @{ state = 'verified'; host = 'github-hosted-windows-2025'; image = $env:ImageOS;
        engine = 'linux'; distribution = 'Ubuntu-24.04'; kernel = [string]$engineReceipt.kernel; transport = 'owned-wsl-private-peer'; peerRestriction = 'windows-gateway-only';
        parity = @{ composeBind = 'verified'; rawCliBind = 'verified'; binaryCopy = 'verified'; windowsLoopbackPorts = $requiredPorts } }

    $phase = 'immutable-artifact-download'
    $runJson = & $gh 'run' 'view' ([string]$SourceRunId) '--repo' $repository '--json' 'headSha,status,conclusion' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'The selected source run could not be verified.' }
    $run = ($runJson -join "`n") | ConvertFrom-Json
    if ($run.headSha -cne $SourceCommit) { throw 'The selected candidate run does not match its accepted source.' }
    if ([string]$SourceRunId -ceq [string]$env:GITHUB_RUN_ID) {
        $jobsJson = & $gh 'api' ('repos/' + $repository + '/actions/runs/' + $SourceRunId + '/jobs?filter=latest&per_page=100') 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'The current run candidate checks could not be verified.' }
        $jobs = ($jobsJson -join "`n") | ConvertFrom-Json
        if ($jobs.total_count -gt 100) { throw 'The current run job listing exceeds its bounded verification.' }
        foreach ($required in @('verify','Portable Smoothies package (Windows)','Smoothies import and cash recovery',
            'Auth and backend integration (test:admin-http)','Auth and backend integration (test:phone-http)',
            'Auth and backend integration (test:restore-business)','Auth and backend integration (test:storage-contract)')) {
            $matched = @($jobs.jobs | Where-Object { $_.name -ceq $required })
            if ($matched.Count -ne 1 -or $matched[0].status -cne 'completed' -or $matched[0].conclusion -cne 'success') { throw 'All seven standard candidate checks must pass before the installed rehearsal.' }
        }
    } elseif ($run.status -cne 'completed' -or $run.conclusion -cne 'success') { throw 'A prior source run must have completed successfully.' }
    if (!$ArtifactId) {
        $artifactsJson = & $gh 'api' ('repos/' + $repository + '/actions/runs/' + $SourceRunId + '/artifacts?per_page=100') 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'The exact run candidate artifact listing is unavailable.' }
        $artifacts = ($artifactsJson -join "`n") | ConvertFrom-Json
        $matched = @($artifacts.artifacts | Where-Object { $_.name -ceq ('smoothies-windows-candidate-' + $SourceCommit) -and $_.expired -eq $false })
        if ($artifacts.total_count -gt 100 -or $matched.Count -ne 1) { throw 'Select one unambiguous artifact from the exact source run.' }
        $ArtifactId = [long]$matched[0].id
    }
    $artifactJson = & $gh 'api' ('repos/' + $repository + '/actions/artifacts/' + $ArtifactId) 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'The original candidate artifact could not be verified.' }
    $artifact = ($artifactJson -join "`n") | ConvertFrom-Json
    $artifactName = 'smoothies-windows-candidate-' + $SourceCommit
    if ($artifact.name -cne $artifactName -or $artifact.expired -ne $false -or $artifact.workflow_run.id -ne $SourceRunId -or $artifact.workflow_run.head_sha -cne $SourceCommit) {
        throw 'The artifact identity differs from the selected original candidate.'
    }
    $download = Join-Path $work 'download'
    $null = New-Item -ItemType Directory -Path $download
    Invoke-PrivateRehearsalCommand $gh @('run','download',([string]$SourceRunId),'--repo',$repository,'--name',$artifactName,'--dir',$download) 'artifact-download.private.log'
    $zip = Join-Path $download 'smoothies-candidate.zip'
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedZipSha256) {
        $candidateIntegrityBefore = 'changed'; $originalCandidateModified = $true
        throw 'The original candidate ZIP hash differs.'
    }

    $phase = 'exact-package-verification'
    $reference = Join-Path $work 'original-reference'
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Invoke-PrivateRehearsalCommand $powershell @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
        (Join-Path $source 'scripts\smoothies\Extract-Smoothies-Update.ps1'),'-ZipPath',$zip,'-Destination',$reference) 'reference-extraction.private.log'
    $index = Join-Path $reference 'SHA256.json'
    # Derivation is safe only now: the source identity and expected ZIP digest
    # have already anchored this exact, unchanged artifact.
    if (!$ExpectedIndexSha256) { $ExpectedIndexSha256 = (Get-FileHash -LiteralPath $index -Algorithm SHA256).Hash.ToLowerInvariant() }
    $referenceRelease = Get-RehearsalJson (Join-Path $reference 'release.json')
    if ($referenceRelease.sourceCommit -cne $SourceCommit -or $referenceRelease.id -cnotmatch '^[a-f0-9]{16}$') { throw 'The original package release metadata differs from its selected source.' }
    if (!$ExpectedPackageId) { $ExpectedPackageId = $referenceRelease.id }
    if ((Get-FileHash -LiteralPath $index -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedIndexSha256) { throw 'The original candidate file-index hash differs.' }
    $verifyScript = Join-Path $work 'verify-reference.mjs'
    $verifyCode = @'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [folder, commit, id, indexHash] = process.argv.slice(2);
const release = JSON.parse((await readFile(path.join(folder, 'release.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(release.sourceCommit, commit); assert.equal(release.id, id);
assert.equal(release.product, 'smoothies'); assert.equal(release.sourceDirty, false); assert.equal(release.familySourceDirty, false);
assert.equal(createHash('sha256').update(await readFile(path.join(folder, 'SHA256.json'))).digest('hex'), indexHash);
const { verifyPackage } = await import(pathToFileURL(path.join(folder, 'app/scripts/smoothies/auto-update.mjs')));
await verifyPackage(folder, { ...release, packageId: release.id, filesSha256: indexHash }, release);
console.log('Original candidate manifest, full file index and every file verified.');
'@
    [IO.File]::WriteAllText($verifyScript, $verifyCode, (New-Object Text.UTF8Encoding($false)))
    $bundledNode = Join-Path $reference 'node.exe'
    Invoke-PrivateRehearsalCommand $bundledNode @($verifyScript,$reference,$SourceCommit,$ExpectedPackageId,$ExpectedIndexSha256) 'package-verification.private.log'
    $candidateIntegrityBefore = 'verified'
    Write-Host 'Verified the unchanged original candidate ZIP and its complete file index.'

    $phase = 'docker-image-prefetch'
    $warmDirectory = Join-Path $work 'image-prefetch'
    $null = New-Item -ItemType Directory -Path $warmDirectory
    $warmSettings = Join-Path $warmDirectory 'instalacion.env'
    Invoke-PrivateRehearsalCommand $bundledNode @((Join-Path $reference 'app\scripts\smoothies\provision-supabase.mjs'),$warmSettings) 'image-config.private.log'
    Invoke-PrivateRehearsalCommand $docker @('compose','--project-name','smoothies-rehearsal-image-prefetch','-f',
        (Join-Path $warmDirectory 'supabase\compose.yml'),'pull') 'image-prefetch.private.log'
    Write-Host 'Prefetched the original local-backend images before the offline installer rehearsal.'

    $phase = 'synthetic-lan-certificate'
    Write-Host 'Starting bounded synthetic LAN certificate generation.'
    $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric,InterfaceMetric)
    $address = $null
    foreach ($route in $routes) {
        $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
            Where-Object { $_.AddressState -eq 'Preferred' -and !$_.SkipAsSource -and $_.IPAddress -match '^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)' })
        if ($addresses.Count) { $address = $addresses[0].IPAddress; break }
    }
    if (!$address -or (Get-NetTCPConnection -State Listen -LocalPort 3443 -ErrorAction SilentlyContinue)) { throw 'A free HTTPS port and an assigned private host IPv4 interface are required.' }
    $origin = 'https://' + $address + ':3443'
    $certificateDirectory = Join-Path $work 'https'
    $certificateLog = Join-Path $work 'certificate.json'
    $certificateJson = Invoke-HostedBoundedProcess -Executable $bundledNode -Arguments @((Join-Path $reference 'app\scripts\smoothies\provision-lan.mjs'),$origin,$certificateDirectory) -Seconds 120
    [IO.File]::WriteAllText($certificateLog, $certificateJson, [Text.UTF8Encoding]::new($false))
    Write-Host 'Bounded synthetic LAN certificate generation completed.'
    $certificate = Get-RehearsalJson $certificateLog
    if ($certificate.origin -cne $origin) { throw 'The certificate origin differs from the selected host interface.' }
    foreach ($file in @($certificate.certFile,$certificate.keyFile,$certificate.publicCertificate)) {
        $absolute = [IO.Path]::GetFullPath([string]$file)
        if (!$absolute.StartsWith($certificateDirectory + '\',[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $absolute -PathType Leaf)) { throw 'The generated certificate escaped its owned disposable directory.' }
    }
    $publicPem = [IO.Path]::ChangeExtension([string]$certificate.publicCertificate, '.pem')
    if (!(Test-Path -LiteralPath $publicPem -PathType Leaf)) { throw 'The generated public CA PEM is missing.' }
    $temporaryTrustIdentity = New-HostedLanTrustIdentity $certificate.publicCertificate
    $temporaryTrustRemoved = $false
    $phase = 'synthetic-lan-machine-trust'
    Write-Host 'Starting bounded exact synthetic machine-root import.'
    Add-HostedLanTrust $temporaryTrustIdentity
    $temporaryTrustChanged = $true
    Write-Host 'Bounded exact synthetic machine-root import completed.'

    $env:NODE_EXTRA_CA_CERTS = $publicPem
    $env:POS_TEST_LAN_ORIGIN = $origin
    $env:POS_TEST_LAN_CERT_FILE = $certificate.certFile
    $env:POS_TEST_LAN_KEY_FILE = $certificate.keyFile
    $env:POS_ACCEPTANCE_DISPOSABLE = '1'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $externalBackup = Join-Path $work 'external-backup-fixture'
    $null = New-Item -ItemType Directory -Path $externalBackup
    $env:SMOOTHIES_BACKUP_EXPORT_DIR = $externalBackup
    $env:POS_TEST_BACKUP_EXPORT_DIR = $externalBackup
    Write-Host 'Prepared verified HTTPS trust only for the synthetic disposable-runner authority.'

    $phase = 'installed-lan-workflow'
    $candidateIntegrityAfter = 'unverified'
    # Source is the rehearsal harness; the installed app is extracted byte-for-
    # byte from the anchored artifact. No package file is rewritten or patched.
    Invoke-PrivateRehearsalCommand $node @((Join-Path $source 'scripts\smoothies\acceptance.mjs'),$zip,$privateEvidence,$reference) 'installed-rehearsal.private.log'
    $acceptance = Get-RehearsalJson (Join-Path $privateEvidence 'acceptance.json')
    if ($acceptance.result -cne 'pass' -or $acceptance.sourceCommit -cne $SourceCommit -or $acceptance.packageId -cne $ExpectedPackageId -or
        $acceptance.zipSha256 -cne $ExpectedZipSha256 -or $acceptance.filesSha256 -cne $ExpectedIndexSha256 -or $acceptance.lanHttps -ne $true -or
        $acceptance.actualDeviceAcceptance -cne 'pending') { throw 'The completed acceptance receipt differs from the anchored LAN candidate.' }
    if (@($requiredChecks | Where-Object { $acceptance.checks -cnotcontains $_ }).Count) { throw 'The installed receipt does not confirm every required workflow check.' }
    $phase = 'candidate-integrity-after-rehearsal'
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedZipSha256) {
        $candidateIntegrityAfter = 'changed'; $originalCandidateModified = $true
        throw 'The original candidate ZIP changed during rehearsal.'
    }
    Invoke-PrivateRehearsalCommand $bundledNode @($verifyScript,$reference,$SourceCommit,$ExpectedPackageId,$ExpectedIndexSha256) 'package-integrity-after.private.log'
    $candidateIntegrityAfter = 'verified'; $originalCandidateModified = $false
    $phase = 'complete'
    $result = 'pass'
} catch {
    # Raw child output and generated credentials remain only in this disposable
    # VM. The exported failure describes its phase, never logs or exception text.
    $result = 'fail'
    if (!$failureDiagnostics.Count) { $failureDiagnostics = @(ConvertTo-SafeRehearsalDiagnostic $_.Exception.Message) }
} finally {
    if ($ownedEngineValidated) {
        try {
            Invoke-OwnedProxy 'stop'
            $ownedProxyRemoved = $true
            $context = (& $docker context inspect $engineReceipt.context | Out-String) | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0 -or @($context).Count -ne 1 -or $context[0].Name -cne $engineReceipt.context -or $context[0].Endpoints.docker.Host -cne $engineReceipt.endpoint) { throw 'The owned context changed before cleanup.' }
            if ((& $docker context show).Trim() -ceq $engineReceipt.context) { & $docker context use default | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not restore default context.' } }
            & $docker context rm $engineReceipt.context | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not remove the exact owned context.' }
            $ownedContextRemoved = $true
        } catch { $result = 'fail'; $phase = 'owned-transport-cleanup' }
    }
    if ($temporaryTrustIdentity) {
        try {
            Remove-HostedLanTrust $temporaryTrustIdentity
            $temporaryTrustRemoved = $true
            Write-Host 'Exact temporary synthetic machine root removed.'
        } catch { $temporaryTrustRemoved = $false }
        if (!$temporaryTrustRemoved) { $result = 'fail'; $phase = 'temporary-trust-cleanup' }
    }
    $proof = [ordered]@{
        protocol = 1; result = $result; phase = $phase; completedAt = [DateTime]::UtcNow.ToString('o')
        repository = $repository; sourceRunId = $SourceRunId; artifactId = $ArtifactId
        sourceCommit = $SourceCommit; packageId = $ExpectedPackageId; zipSha256 = $ExpectedZipSha256; filesSha256 = $ExpectedIndexSha256
        originalCandidateModified = $originalCandidateModified; candidateIntegrity = @{ before = $candidateIntegrityBefore; after = $candidateIntegrityAfter }
        platform = $platformProof; tlsVerification = 'enabled'; actualDeviceAcceptance = 'pending'
        temporaryTrustChanged = $temporaryTrustChanged; temporaryTrustRemoved = $temporaryTrustRemoved
        temporaryTrustStore = 'LocalMachine\Root'
        ownedProxyRemoved = $ownedProxyRemoved; ownedContextRemoved = $ownedContextRemoved
    }
    if ($failureExitCode -ne $null) { $proof.childExitCode = $failureExitCode }
    if ($failureCode) { $proof.failureCode = $failureCode }
    if ($failureScript) { $proof.failureScript = $failureScript; $proof.failureLine = $failureLine }
    if ($failureDiagnostics.Count) { $proof.failureDiagnostics = $failureDiagnostics }
    if ($result -ceq 'pass') {
        $proof.checks = @($acceptance.checks | Where-Object { $requiredChecks -ccontains [string]$_ })
    }
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'rehearsal.json'), ($proof | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Write-Host ($proof | ConvertTo-Json -Depth 5 -Compress)
}
if ($result -cne 'pass') { throw ('The unchanged-candidate hosted rehearsal failed during ' + $phase + '. Only sanitized evidence was exported.') }
