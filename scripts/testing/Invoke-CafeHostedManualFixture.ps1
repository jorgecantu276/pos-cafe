param([Parameter(Mandatory)][string]$InputFile)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:POS_ACCEPTANCE_DISPOSABLE -cne '1') { throw 'Hosted synthetic fixture only.' }
$inputRecord=Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
$work=[IO.Path]::GetFullPath($inputRecord.work)
if (!$work.StartsWith(([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture must remain in owned temporary state.' }
foreach($file in @($InputFile,$inputRecord.configFile,$inputRecord.installDirectory,$inputRecord.candidateDirectory,$inputRecord.zipPath,$inputRecord.probeNodePath,$inputRecord.boundaryReceipt)) {
    $resolved=[IO.Path]::GetFullPath($file)
    if (!$resolved.StartsWith($work+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture input escaped owned state.' }
    for($part=Get-Item -LiteralPath $resolved; $part; $part=Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($part.FullName)) -ErrorAction SilentlyContinue) {
        if($part.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Fixture path is redirected.'}
        if($part.FullName.TrimEnd('\').Equals($work,[StringComparison]::OrdinalIgnoreCase)){break}
    }
}
$boundary=Get-Content -LiteralPath $inputRecord.boundaryReceipt -Raw | ConvertFrom-Json
if ($boundary.format -cne 'cafe-hosted-egress-v1' -or $boundary.state -cne 'active' -or $boundary.owner -cne $inputRecord.boundaryOwner -or !$boundary.globalNonLoopbackBlock) { throw 'Active reviewed OS boundary required.' }
$global=Get-NetFirewallRule -Name $boundary.globalNonLoopbackBlock -PolicyStore ActiveStore
$expected=@('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
if ($global.Group -cne $boundary.owner -or $global.Action -ne 'Block' -or $global.Direction -ne 'Outbound' -or [string]$global.Enabled -cne 'True' -or ($global | Get-NetFirewallApplicationFilter).Program -cne 'Any' -or
    @(Compare-Object @($global | Get-NetFirewallAddressFilter | ForEach-Object RemoteAddress) $expected).Count -or
    (Get-Service MpsSvc).Status -ne 'Running' -or @(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object {[string]$_.Enabled -cne 'True'}).Count) { throw 'VM-wide non-loopback denial is not enforced.' }
$home=Join-Path $work 'manual-fixture'
$null=New-Item -ItemType Directory -Path $home
$operator=Join-Path $home 'Invoke-CafeManualUpdate.ps1'
if (![IO.Path]::GetFullPath($inputRecord.operatorScript).Equals((Join-Path $PSScriptRoot 'Invoke-CafeManualUpdate.ps1'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Use the pinned co-located reviewed operator.' }
Copy-Item -LiteralPath $inputRecord.operatorScript -Destination $operator
if ((Get-FileHash -LiteralPath $operator).Hash.ToLowerInvariant() -cne $inputRecord.operatorScriptSha256) { throw 'Reviewed operator bytes changed.' }
. $operator -FunctionsOnly
function Write-FixtureJson([string]$File,$Value) { [IO.File]::WriteAllText($File,($Value | ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding($false))) }
$config=Read-CafeJson $inputRecord.configFile
$machine=Get-CafeMachineSha256
$runtime=Get-CafeHash $inputRecord.configFile
$oldIndex=Get-CafeHash (Join-Path $inputRecord.installDirectory 'SHA256.json')
$newIndex=Get-CafeHash (Join-Path $inputRecord.candidateDirectory 'SHA256.json')
$old=Read-CafeJson (Join-Path $inputRecord.installDirectory 'release.json')
$new=Read-CafeJson (Join-Path $inputRecord.candidateDirectory 'release.json')
$manual=[ordered]@{change='brownie-syrup-v1';machineSha256=$machine;runtimeConfigurationSha256=$runtime;predecessorCommit=$old.sourceCommit;predecessorIndexSha256=$oldIndex;packageIndexSha256=$newIndex;backendPlanSha256=$inputRecord.backendPlanSha256;operatorScriptSha256=$inputRecord.operatorScriptSha256;publication='manual-cafe-prerelease';latest=$false;automaticEnrollment=$false;familyPromotion=$false}
$identity=[ordered]@{product='cafe';preset='cafe';tier=1;edition='customer';deliveryScope='cafe-manual-maintenance-v1';client='synthetic-cafe-hosted';qualificationId='synthetic-procedural-admission';sourceCommit=$new.sourceCommit;sourceTree=$inputRecord.sourceTree;contentSha256=$inputRecord.zipSha256;databaseContractSha256=$inputRecord.databaseContractSha256;configurationSha256=$runtime;backendIdentitySha256=(Get-CafeTextHash ($config.SupabaseUrl+"`n"+$new.publicKeySha256));familyRelease='pos-v1.0.0-rc.7';familySourceCommit=$new.sourceCommit}
# These records admit the SAME guarded FunctionsOnly procedure in a synthetic lab.
# They are not actual check outcomes or a customer package qualification. They
# remain private; genuine outcomes are separately recorded after execution.
$proof=[ordered]@{testOnly=$true;purpose='hosted-isolated-guard-fixture';fixture='synthetic-procedural-admission';scope='Guarded operator fixture input, not genuine qualification evidence.'}
foreach($key in $identity.Keys){$proof[$key]=$identity[$key]}
$proof.manualMaintenance=$manual;$proof.artifactSha256=$inputRecord.zipSha256;$proof.verdict='ACCEPT';$proof.independent=$true
$proof.results=[ordered]@{}
foreach($check in @('unit','types','lint','build','package','database','browser','new-install','retained-upgrade','recovery','install-guard','backup','journal','provider-config','migration-plan','device-preflight')){$proof.results[$check]='passed'}
$proof.results.family='not-promoted'
$checks=Join-Path $home 'synthetic-admission-checks.private.json';$review=Join-Path $home 'synthetic-admission-review.private.json'
Write-FixtureJson $checks $proof;Write-FixtureJson $review $proof
$record=[ordered]@{testOnly=$true;purpose='hosted-isolated-guard-fixture';fixture='synthetic-procedural-admission'}
foreach($key in $identity.Keys){$record[$key]=$identity[$key]}
$record.format='pos-qualification-v1';$record.state='customer-package-qualified';$record.qualifiedAt=[DateTime]::UtcNow.ToString('o');$record.manualMaintenance=$manual
$record.artifact=@{kind='windows-package';file=$inputRecord.zipPath;sha256=$inputRecord.zipSha256};$record.supportedPredecessors=@($old.sourceCommit)
$record.operatorScript=@{file=$operator;sha256=$inputRecord.operatorScriptSha256};$record.checks=@{file=$checks;sha256=(Get-CafeHash $checks)};$record.independentReview=@{file=$review;sha256=(Get-CafeHash $review)}
$qualification=Join-Path $home 'synthetic-admission.private.json';Write-FixtureJson $qualification $record
$maintenance=[ordered]@{testOnly=$true;purpose='hosted-isolated-guard-fixture';fixture='synthetic-procedural-admission'}
foreach($key in $identity.Keys){$maintenance[$key]=$identity[$key]}
$maintenance.format='cafe-backend-maintenance-applied-v1';$maintenance.state='applied';$maintenance.manualMaintenance=$manual;$maintenance.backendOrigin=$config.SupabaseUrl;$maintenance.publicKeySha256=$new.publicKeySha256;$maintenance.backendPlanSha256=$manual.backendPlanSha256;$maintenance.predecessorCommit=$old.sourceCommit
$maintenanceFile=Join-Path $home 'synthetic-maintenance.private.json';Write-FixtureJson $maintenanceFile $maintenance
$plan=[ordered]@{testOnly=$true;fixture='synthetic-procedural-admission';purpose='hosted-isolated-guard-fixture'};foreach($key in $identity.Keys){$plan[$key]=$identity[$key]}
$plan.format='cafe-manual-maintenance-v1';$plan.operationsHome=$home;$plan.manualMaintenance=$manual;$plan.machineSha256=$machine;$plan.installDirectory=$inputRecord.installDirectory;$plan.configPath=$inputRecord.configFile;$plan.configSha256=$runtime;$plan.backendOrigin=$config.SupabaseUrl;$plan.publicKeySha256=$new.publicKeySha256;$plan.printMode='mock';$plan.nodeOptionsSha256=(Get-CafeTextHash ([string]$env:NODE_OPTIONS));$plan.probeNodePath=$inputRecord.probeNodePath;$plan.probeNodeSha256=(Get-CafeHash $inputRecord.probeNodePath)
$plan.predecessor=@{sourceCommit=$old.sourceCommit;filesSha256=$oldIndex};$plan.candidate=@{sourceCommit=$new.sourceCommit;filesSha256=$newIndex;zipPath=$inputRecord.zipPath;zipSha256=$inputRecord.zipSha256};$plan.qualification=@{file=$qualification;sha256=(Get-CafeHash $qualification)};$plan.maintenance=@{file=$maintenanceFile;sha256=(Get-CafeHash $maintenanceFile)};$plan.shortcutPaths=@()
$receipt=Join-Path $home 'manual-transition.private.json'
$result=Invoke-CafeManualUpdate -Plan $plan -ReceiptPath $receipt
if ($result.state -cne 'installed-verified-not-started') { throw 'Expected actual guarded folder transition.' }
$again=Invoke-CafeManualUpdate -Plan $plan -ReceiptPath $receipt
if ($again.state -cne 'already-installed-verified') { throw 'Expected guarded idempotent verification.' }
@{format='cafe-hosted-manual-fixture-v1';state='guarded-transition-passed';testOnly=$true;admission='synthetic-procedural-fixture';customerQualification=$false;operatorScriptSha256=$inputRecord.operatorScriptSha256;previousDirectory=$result.previousDirectory;receiptPath=$receipt;idempotent=$true} | ConvertTo-Json -Compress
