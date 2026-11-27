[CmdletBinding()]
param(
    [long]$SourceRunId = 45881982067,
    [ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit = '6904d8c500f05647f8a00dd7b6b292aa80a8a8a3',
    [long]$ArtifactId = 0,
    [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedZipSha256 = '1ba631fc5812cfef2f8aee5b7267aa69d481f7c5e3a794e36ddd82ee50d54767',
    [AllowEmptyString()][ValidatePattern('^(?:[a-f0-9]{64})?$')][string]$ExpectedIndexSha256 = 'd49f81fe40ca4370c8530df7c8975ae88b78fb38f58e9c9ae5c5c22085d6305c',
    [AllowEmptyString()][ValidatePattern('^(?:[a-f0-9]{16})?$')][string]$ExpectedPackageId = '91d0185345dfb706',
    [string]$EvidenceDirectory,
    [switch]$PlatformOnly
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'HostedProcess.psm1') -Force -DisableNameChecking

# This driver is intentionally unavailable on an operator's or development PC.
# The workflow owns a new hosted Windows 2025 VM and its WSL Docker daemon.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
    !$env:RUNNER_TEMP -or !$env:GITHUB_WORKSPACE -or !$env:RUNNER_TRACKING_ID) {
    throw 'This rehearsal requires a fresh GitHub-hosted Windows 2025 runner.'
}
if ($SourceRunId -le 0 -or $ArtifactId -lt 0) { throw 'Select one immutable candidate run and artifact.' }
if ($PlatformOnly -and ([string]$SourceRunId -cne [string]$env:GITHUB_RUN_ID -or $SourceCommit -cne $env:GITHUB_SHA)) {
    throw 'A platform-only probe must identify its actual current GitHub run and source.'
}
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
$gh = if (!$PlatformOnly) { (Get-Command 'gh.exe' -ErrorAction Stop).Source } else { $null }
$docker = if (!$PlatformOnly) { (Get-Command 'docker.exe' -ErrorAction Stop).Source } else { $null }
if ((& $node '-p' 'process.version').Trim() -cne 'v24.22.2' -or $LASTEXITCODE -ne 0) { throw 'Use the pinned Node 24.22.2 runtime.' }
$work = Join-Path $runnerTemporary ('smoothies-hosted-rehearsal-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $work
$null = New-Item -ItemType Directory -Path $EvidenceDirectory
$privateEvidence = Join-Path $work 'acceptance-private'
$null = New-Item -ItemType Directory -Path $privateEvidence
$phase = 'host-validation'
$result = 'fail'
$temporaryThumbprint = $null
$temporaryCertificateHash = $null
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
    $completed = Invoke-HostedProcess -Executable $Executable -Arguments $Arguments -StdoutFile $stdoutFile -StderrFile $stderrFile -TimeoutSeconds $TimeoutSeconds
    $exitCode = if ($completed.TimedOut) { -1 } else { $completed.ExitCode }
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

try {
    $phase = 'docker-validation'
    $engineProofFile = Join-Path $work 'platform-proof.json'
    & $node (Join-Path $source 'scripts\testing\hosted-wsl-engine.mjs') 1>$engineProofFile 2>(Join-Path $work 'engine-verification.private.log')
    if ($LASTEXITCODE -ne 0) {
        $failureDiagnostics = @(ConvertTo-SafeRehearsalDiagnostic (Get-Content -LiteralPath (Join-Path $work 'engine-verification.private.log') -Tail 25 | Out-String))
        throw 'The owned hosted WSL Docker engine failed shared attestation.'
    }
    $platformProof = Get-RehearsalJson $engineProofFile

    if ($PlatformOnly) {
        $phase = 'platform-complete'
        $result = 'pass'
    } else {
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

    $phase = 'synthetic-lan-trust'
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
    & $bundledNode (Join-Path $reference 'app\scripts\smoothies\provision-lan.mjs') $origin $certificateDirectory 1>$certificateLog 2>(Join-Path $work 'certificate.private.log')
    if ($LASTEXITCODE -ne 0) { throw 'The synthetic LAN certificate could not be provisioned.' }
    $certificate = Get-RehearsalJson $certificateLog
    if ($certificate.origin -cne $origin) { throw 'The certificate origin differs from the selected host interface.' }
    foreach ($file in @($certificate.certFile,$certificate.keyFile,$certificate.publicCertificate)) {
        $absolute = [IO.Path]::GetFullPath([string]$file)
        if (!$absolute.StartsWith($certificateDirectory + '\',[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $absolute -PathType Leaf)) { throw 'The generated certificate escaped its owned disposable directory.' }
    }
    $publicPem = [IO.Path]::ChangeExtension([string]$certificate.publicCertificate, '.pem')
    if (!(Test-Path -LiteralPath $publicPem -PathType Leaf)) { throw 'The generated public CA PEM is missing.' }
    $ca = New-Object Security.Cryptography.X509Certificates.X509Certificate2([string]$certificate.publicCertificate)
    $thumbprint = $ca.Thumbprint
    if ($thumbprint -cnotmatch '^[A-F0-9]{40}$' -or (Test-Path -LiteralPath ('Cert:\CurrentUser\Root\' + $thumbprint))) { throw 'The synthetic authority must be new on this disposable VM.' }
    $temporaryThumbprint = $thumbprint
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $temporaryCertificateHash = [Convert]::ToBase64String($hash.ComputeHash($ca.RawData)) } finally { $hash.Dispose() }
    $temporaryTrustRemoved = $false
    Import-Certificate -FilePath $certificate.publicCertificate -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
    $temporaryTrustChanged = $true

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
    }
} catch {
    # Raw child output and generated credentials remain only in this disposable
    # VM. The exported failure describes its phase, never logs or exception text.
    $result = 'fail'
    if (!$failureDiagnostics.Count) { $failureDiagnostics = @(ConvertTo-SafeRehearsalDiagnostic $_.Exception.Message) }
} finally {
    if ($temporaryThumbprint) {
        try {
            $certificatePath = 'Cert:\CurrentUser\Root\' + $temporaryThumbprint
            if (Test-Path -LiteralPath $certificatePath) {
                $stored = Get-Item -LiteralPath $certificatePath
                $hash = [Security.Cryptography.SHA256]::Create()
                try { $storedHash = [Convert]::ToBase64String($hash.ComputeHash($stored.RawData)) } finally { $hash.Dispose() }
                if ($storedHash -cne $temporaryCertificateHash) { throw 'The temporary certificate identity changed.' }
                Remove-Item -LiteralPath $certificatePath -Force
            }
            $temporaryTrustRemoved = !(Test-Path -LiteralPath $certificatePath)
        } catch { $temporaryTrustRemoved = $false }
        if (!$temporaryTrustRemoved) { $result = 'fail'; $phase = 'temporary-trust-cleanup' }
    }
    if ($PlatformOnly) {
        $proof = [ordered]@{
            protocol = 1; scope = 'test-platform-only'; result = $result; phase = $phase; completedAt = [DateTime]::UtcNow.ToString('o')
            sourceRunId = [long]$env:GITHUB_RUN_ID; sourceCommit = $env:GITHUB_SHA; platform = $platformProof
            actualDeviceAcceptance = 'pending'; qualified = $false
        }
    } else {
    $proof = [ordered]@{
        protocol = 1; scope = 'installed-lan'; result = $result; phase = $phase; completedAt = [DateTime]::UtcNow.ToString('o')
        repository = $repository; sourceRunId = $SourceRunId; artifactId = $ArtifactId
        sourceCommit = $SourceCommit; packageId = $ExpectedPackageId; zipSha256 = $ExpectedZipSha256; filesSha256 = $ExpectedIndexSha256
        originalCandidateModified = $originalCandidateModified; candidateIntegrity = @{ before = $candidateIntegrityBefore; after = $candidateIntegrityAfter }
        platform = $platformProof; tlsVerification = 'enabled'; actualDeviceAcceptance = 'pending'
        temporaryTrustChanged = $temporaryTrustChanged; temporaryTrustRemoved = $temporaryTrustRemoved
    }
    }
    if ($failureExitCode -ne $null) { $proof.childExitCode = $failureExitCode }
    if ($failureCode) { $proof.failureCode = $failureCode }
    if ($failureScript) { $proof.failureScript = $failureScript; $proof.failureLine = $failureLine }
    if ($failureDiagnostics.Count) { $proof.failureDiagnostics = $failureDiagnostics }
    if (!$PlatformOnly -and $result -ceq 'pass') {
        $proof.checks = @($acceptance.checks | Where-Object { $requiredChecks -ccontains [string]$_ })
    }
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'rehearsal.json'), ($proof | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Write-Host ($proof | ConvertTo-Json -Depth 5 -Compress)
}
if ($result -cne 'pass') {
    $failureScope = if ($PlatformOnly) { 'The hosted test-platform check' } else { 'The unchanged-candidate hosted rehearsal' }
    throw ($failureScope + ' failed during ' + $phase + '. Only sanitized evidence was exported.')
}
