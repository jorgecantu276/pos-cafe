Import-Module (Join-Path $PSScriptRoot 'SupportTransport.psm1') -Force

function Get-SmoothiesPrivateRoot {
    param([string]$Root)
    if($Root -notmatch '^[A-Za-z]:[\\/]' -or $Root -match '["\r\n]') { throw 'smoothies_support_local_root_required' }
    $full=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    $candidate=$full
    while($candidate) {
        if((Test-Path -LiteralPath $candidate) -and ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'smoothies_support_redirected_root_refused' }
        $parent=Split-Path -Parent $candidate;if($parent -eq $candidate){break};$candidate=$parent
    }
    return $full
}

function Get-SmoothiesSupportBinding {
    param([Parameter(Mandatory=$true)][string]$Root)
    $rootPath=Get-SmoothiesPrivateRoot $Root
    $release=Get-Content -LiteralPath (Join-Path $rootPath 'release.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($release.version -ne 1 -or $release.product -cne 'smoothies' -or $release.id -cnotmatch '^[a-f0-9]{16}$' -or
       $release.sourceDirty -ne $false -or $release.familySourceDirty -ne $false -or $release.fixtureOnly -eq $true) { throw 'smoothies_support_release_identity_invalid' }
    $installed=Join-Path (Join-Path $rootPath 'versiones') $release.id
    $node=Join-Path $installed 'node.exe'
    $collector=Join-Path $installed 'app\scripts\smoothies\support-report.mjs'
    if(!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $collector -PathType Leaf)) { throw 'smoothies_support_package_incomplete' }
    $guid=[string](Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
    if($guid -notmatch '^[a-fA-F0-9-]{32,36}$') { throw 'smoothies_support_machine_identity_unavailable' }
    # The pinned collector parses the saved startup file; ambient shell keys do
    # not configure this identity. Only its fingerprint leaves this process.
    $backendJson=(& $node $collector '--binding' $rootPath 2>$null|Out-String)
    if($LASTEXITCODE -ne 0){throw 'smoothies_support_backend_identity_invalid'}
    $backend=($backendJson|ConvertFrom-Json).backendIdentitySha256
    if($backend -cnotmatch '^[a-f0-9]{64}$') { throw 'smoothies_support_backend_identity_invalid' }
    return @{root=$rootPath;node=$node;collector=$collector;packageId=$release.id;machineSha256=(Get-PosSupportHash $guid.ToLowerInvariant());backendIdentitySha256=$backend}
}

function Assert-SmoothiesSupportSettings {
    param($Settings,$Binding)
    if($Settings.protocol -ne 1 -or $Settings.product -cne 'smoothies' -or $Settings.enabled -ne $true -or
       $Settings.repository -cne 'jorgecantu276/punto-demo' -or $Settings.publisher -notmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$' -or
       $Settings.device -notmatch '^[a-z0-9-]{1,40}$' -or $Settings.machineSha256 -cnotmatch '^[a-f0-9]{64}$' -or
       $Settings.backendIdentitySha256 -cnotmatch '^[a-f0-9]{64}$' -or $Settings.developmentMachineSha256 -cnotmatch '^[a-f0-9]{64}$' -or
       $Settings.machineSha256 -cne $Binding.machineSha256 -or $Settings.backendIdentitySha256 -cne $Binding.backendIdentitySha256 -or
       $Settings.developmentMachineSha256 -ceq $Binding.machineSha256) { throw 'smoothies_support_enrollment_required' }
}

function Assert-SmoothiesPublicReport {
    param($Report)
    $fields=@{
        ''=@('protocol','product','collectedAt','release','configuration','application','tls','backup','updates','storage','siteAcceptance','remotePublication')
        'release'=@('state','packageId','appVersion','sourceCommit');'application'=@('state')
        'tls'=@('state','trust','keyPresent','matchingIp','keyPairVerification','expiresAt','daysRemaining','originSha256')
        'backup'=@('state','recoveryKeyPresent','lastAttemptFailed','lastSuccessAt','ageHours','archivePresent','sizeMatches','contentVerification','externalCopy')
        'backup.externalCopy'=@('state','configured','restoreAcceptance')
        'updates'=@('state','channel','signingKeyPresent','rejectedCandidateCount','signingTrust','preparedCandidatePresent','feedReachability')
        'updates.signingTrust'=@('state','keySha256','enrollment');'storage'=@('state','availableBytes')
        'siteAcceptance'=@('state','checks');'remotePublication'=@('state','lastSuccessAt','lastAttemptFailed')
    }
    $enums=@('identified','missing','invalid','not-checked','ready','stopped-or-unreachable','identity-mismatch','not-configured','expired-or-not-yet-valid','renewal-due','configured','current','stale','no-success-recorded','needs-review','pending','failed','copied-current','previous-copy-only','enabled','disabled','valid-key-format','invalid-or-missing','observed','unavailable','pending-live-testing','enabled-awaiting-report','reported')
    $fixed=@('requires-device-acceptance','not-repeated-by-diagnostics','not-checked','pending-live-testing')
    function Test-ReportNode($Value,[string]$At) {
        if(!$fields.ContainsKey($At)) { throw 'smoothies_support_report_schema_invalid' }
        foreach($property in $Value.PSObject.Properties) {
            $name=$property.Name;$v=$property.Value
            if($fields[$At] -cnotcontains $name) { throw 'smoothies_support_report_field_refused' }
            $next=if($At){$At+'.'+$name}else{$name}
            if($fields.ContainsKey($next)) { Test-ReportNode $v $next;continue }
            if($name -ceq 'protocol') { if($v -ne 1){throw 'smoothies_support_report_protocol_invalid'};continue }
            if($name -ceq 'product') { if($v -cne 'smoothies'){throw 'smoothies_support_report_product_invalid'};continue }
            if($name -ceq 'state') { if($enums -cnotcontains [string]$v){throw 'smoothies_support_report_state_invalid'};continue }
            if($name -ceq 'configuration') { if(@('readable','missing','invalid') -cnotcontains [string]$v){throw 'smoothies_support_report_configuration_invalid'};continue }
            if($name -ceq 'checks') { if(@($v).Count -ne 7 -or @($v|Where-Object {@('ipad-trust','safari-workflow','network-reconnect','pc-reboot','internet-loss-with-lan','physical-paper','external-restore') -cnotcontains $_}).Count){throw 'smoothies_support_report_checks_invalid'};continue }
            if($name -match '^(collectedAt|lastSuccessAt|expiresAt)$') { $date=[DateTime]::MinValue;if(![DateTime]::TryParse([string]$v,[ref]$date)){throw 'smoothies_support_report_date_invalid'};continue }
            if($name -match '(Sha256|sourceCommit|packageId)$') { $length=if($name -ceq 'sourceCommit'){40}elseif($name -ceq 'packageId'){16}else{64};if([string]$v -cnotmatch ('^[a-f0-9]{'+$length+'}$')){throw 'smoothies_support_report_hash_invalid'};continue }
            if($name -ceq 'appVersion') { if([string]$v -notmatch '^\d+\.\d+\.\d+(?:-rc\.\d+)?$'){throw 'smoothies_support_report_version_invalid'};continue }
            if($name -ceq 'channel') { if([string]$v -cnotmatch '^[a-z][a-z0-9-]{0,30}$'){throw 'smoothies_support_report_channel_invalid'};continue }
            if($name -match '^(daysRemaining|ageHours|availableBytes|rejectedCandidateCount)$') { if($v -isnot [ValueType] -or $v -is [bool] -or [double]$v -lt -100000 -or [double]$v -gt 9007199254740991){throw 'smoothies_support_report_metric_invalid'};continue }
            if($v -is [bool]) { continue }
            if($fixed -cnotcontains [string]$v) { throw 'smoothies_support_report_value_refused' }
        }
    }
    Test-ReportNode $Report ''
    if($Report.protocol -ne 1 -or $Report.product -cne 'smoothies' -or $Report.siteAcceptance.state -cne 'pending-live-testing') { throw 'smoothies_support_report_not_accepted' }
}

function Invoke-SmoothiesSupportCycle {
    param([Parameter(Mandatory=$true)][string]$Root,[switch]$Force)
    $rootPath=Get-SmoothiesPrivateRoot $Root
    $settingsPath=Get-SmoothiesPrivateRoot (Join-Path $rootPath 'soporte\reporting.json')
    if(!(Test-Path -LiteralPath $settingsPath -PathType Leaf)) { return @{state='not-configured';published=$false} }
    $settings=Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8|ConvertFrom-Json
    if($settings.enabled -eq $false) { return @{state='disabled';published=$false} }
    $binding=Get-SmoothiesSupportBinding $rootPath
    Assert-SmoothiesSupportSettings $settings $binding
    $directory=Get-SmoothiesPrivateRoot (Join-Path $rootPath 'soporte\state')
    $null=New-Item -ItemType Directory -Path $directory -Force
    try {$lock=[IO.File]::Open((Join-Path $directory 'cycle.lock'),'OpenOrCreate','ReadWrite','None')}catch{return @{skipped=$true;reason='already_running'}}
    try {
        $stateFile=Get-SmoothiesPrivateRoot (Join-Path $directory 'state.json')
        $state=if(Test-Path -LiteralPath $stateFile){Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8|ConvertFrom-Json}else{[pscustomobject]@{version=1;issueNumber=0;commentId=0;lastSuccessAt=$null;lastError=$null}}
        if($state.version -ne 1 -or [long]$state.issueNumber -lt 0 -or [long]$state.commentId -lt 0){throw 'smoothies_support_state_invalid'}
        if(!$Force -and $state.lastSuccessAt) {
            $last=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::Parse([string]$state.lastSuccessAt).ToUniversalTime(),'Central Standard Time').Date
            $today=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow,'Central Standard Time').Date
            if($last -eq $today){return @{skipped=$true;reason='already_reported_today'}}
        }
        try {
            $reportJson=(& $binding.node $binding.collector $rootPath 2>$null|Out-String)
            if($LASTEXITCODE -ne 0){throw 'smoothies_support_collection_failed'}
            $report=$reportJson|ConvertFrom-Json;Assert-SmoothiesPublicReport $report
            if($report.release.packageId -cne $binding.packageId){throw 'smoothies_support_release_changed'}
            Write-PosSupportJson -Path (Join-Path $directory 'pending-report.json') -Value $report
            $transport=[pscustomobject]@{Repository=$settings.repository;PublisherLogin=$settings.publisher;Device=$settings.device;GhExecutable='gh'}
            $body='Producto: Smoothies'+"`nEquipo: "+$settings.device+"`nMachineSha256: "+$binding.machineSha256+"`nBackendIdentitySha256: "+$binding.backendIdentitySha256+"`nAceptacion inicial: pendiente de revision del primer informe real. Solo metadatos; no acredita papel ni restauracion.`n`n"+'```json'+"`n"+($report|ConvertTo-Json -Depth 12)+"`n"+'```'
            $published=Publish-PosSupportStatus -Settings $transport -State $state -StateFile $stateFile -StateDirectory $directory -Product 'smoothies' -Body $body -InstallationBinding ($binding.machineSha256+':'+$binding.backendIdentitySha256)
            $state.lastSuccessAt=[DateTime]::UtcNow.ToString('o');$state.lastError=$null
            Write-PosSupportJson $stateFile $state
            return @{published=$true;state='awaiting-first-report-review';url=$published.url;checkedAtUtc=$report.collectedAt}
        } catch {
            $state.lastError='report_not_confirmed_pending_preserved';Write-PosSupportJson $stateFile $state
            throw 'smoothies_support_report_not_confirmed'
        }
    } finally {$lock.Dispose()}
}

Export-ModuleMember -Function Get-SmoothiesSupportBinding,Invoke-SmoothiesSupportCycle,Assert-SmoothiesPublicReport,Assert-SmoothiesSupportSettings,Get-SmoothiesPrivateRoot
