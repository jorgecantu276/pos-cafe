param([string]$Root,[string]$RepositoryRoot)
$ErrorActionPreference='Stop'
$agent=Join-Path $RepositoryRoot 'scripts\smoothies'
$global:machineGuid='11111111-2222-3333-4444-555555555555';$global:registryReads=0
function global:Get-ItemProperty {param($LiteralPath,$Name,$ErrorAction) if($Name -cne 'MachineGuid'){throw 'Unexpected registry read'};$global:registryReads++;[pscustomobject]@{MachineGuid=$global:machineGuid}}
$global:db=@{issues=@();comments=@();private=$true;login='fixture-owner';lose=$null;calls=@()}
function global:gh {
    $a=@($args);$global:LASTEXITCODE=0
    if($a[0] -cne 'api' -or $a[2] -cne 'github.com'){throw 'Unexpected API invocation'}
    $method=$a[4];$endpoint=$a[5];$db=$global:db;$db.calls+=($method+' '+$endpoint)
    $body=if($a.Count -gt 6){Get-Content -LiteralPath $a[7] -Raw -Encoding UTF8|ConvertFrom-Json}else{$null}
    if($endpoint -ceq 'user'){return (@{login=$db.login}|ConvertTo-Json)}
    if($endpoint -ceq 'repos/jorgecantu276/punto-demo'){return (@{private=$db.private;full_name='jorgecantu276/punto-demo'}|ConvertTo-Json)}
    if($method -ceq 'GET' -and $endpoint -match '^repos/jorgecantu276/punto-demo/issues\?'){return (ConvertTo-Json -InputObject @($db.issues) -Depth 12)}
    if($method -ceq 'POST' -and $endpoint -ceq 'repos/jorgecantu276/punto-demo/issues'){
        $issue=[pscustomobject]@{number=($db.issues.Count+1);state='open';body=$body.body;user=@{login=$db.login}};$db.issues+=@($issue)
        if($db.lose -ceq 'issue'){$db.lose=$null;$global:LASTEXITCODE=1;return};return ($issue|ConvertTo-Json -Depth 12)
    }
    if($method -ceq 'GET' -and $endpoint -match '^repos/jorgecantu276/punto-demo/issues/(\d+)$'){return ($db.issues|Where-Object {$_.number -eq [long]$Matches[1]}|ConvertTo-Json -Depth 12)}
    if($endpoint -match '^repos/jorgecantu276/punto-demo/issues/(\d+)/comments(?:\?|$)'){
        $number=[long]$Matches[1]
        if($method -ceq 'GET'){return (ConvertTo-Json -InputObject @($db.comments|Where-Object {$_.issue_url -ceq ('https://api.github.com/repos/jorgecantu276/punto-demo/issues/'+$number)}) -Depth 14)}
        if($method -ceq 'POST'){
            $comment=[pscustomobject]@{id=($db.comments.Count+100);body=$body.body;issue_url=('https://api.github.com/repos/jorgecantu276/punto-demo/issues/'+$number);user=@{login=$db.login}};$db.comments+=@($comment)
            if($db.lose -ceq 'comment'){$db.lose=$null;$global:LASTEXITCODE=1;return};return ($comment|ConvertTo-Json -Depth 14)
        }
    }
    if($endpoint -match '^repos/jorgecantu276/punto-demo/issues/comments/(\d+)$'){
        $comment=@($db.comments|Where-Object {$_.id -eq [long]$Matches[1]})[0]
        if($method -ceq 'PATCH'){$comment.body=$body.body};return ($comment|ConvertTo-Json -Depth 14)
    }
    throw ('Unexpected endpoint '+$method+' '+$endpoint)
}
$global:task=$null;$global:registered=0
function global:Get-ScheduledTask {param($TaskName,$TaskPath,$ErrorAction)$global:task}
function global:Register-ScheduledTask {
    param($TaskName,$TaskPath,$Xml)
    [xml]$doc=$Xml;$ns=New-Object Xml.XmlNamespaceManager($doc.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    if($doc.SelectSingleNode('//t:StartBoundary',$ns).InnerText -notlike '*T08:00:00' -or $doc.SelectNodes('//t:Repetition|//t:LogonTrigger',$ns).Count){throw 'Unexpected daily schedule'}
    $global:registered++
    $global:task=[pscustomobject]@{Description=$doc.SelectSingleNode('//t:Description',$ns).InnerText;Actions=@([pscustomobject]@{Execute=$doc.SelectSingleNode('//t:Command',$ns).InnerText;Arguments=$doc.SelectSingleNode('//t:Arguments',$ns).InnerText});Principal=[pscustomobject]@{UserId=$doc.SelectSingleNode('//t:UserId',$ns).InnerText};Triggers=@([pscustomobject]@{DaysInterval=1;StartBoundary=$doc.SelectSingleNode('//t:StartBoundary',$ns).InnerText;Repetition=[pscustomobject]@{Interval=''}})}
}
function global:Get-Command {
    [CmdletBinding()]param([string]$Name)
    if($Name -ceq 'gh.exe'){return [pscustomobject]@{Source='gh'}}
    Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
Import-Module (Join-Path $agent 'SmoothiesSupport.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $agent 'SupportTransport.psm1') -Force
$installer=Join-Path $agent 'Install-SmoothiesSupport.ps1'
$disabled=& $installer -Root $Root -ConfigurationPath (Join-Path $RepositoryRoot 'config\smoothies-reporting.example.json')|ConvertFrom-Json
if($disabled.installed -or $global:registryReads -ne 0 -or $global:db.calls.Count -ne 0 -or $global:registered -ne 0){throw 'Disabled template performed live setup'}
$binding=Get-SmoothiesSupportBinding $Root
$configuration=[pscustomobject]@{protocol=1;product='smoothies';enabled=$true;repository='jorgecantu276/punto-demo';publisher='fixture-owner';device='fixture-smoothies';machineSha256=$binding.machineSha256;backendIdentitySha256=$binding.backendIdentitySha256;developmentMachineSha256=('f'*64)}
$inputPath=Join-Path $Root 'support-input.private.json';Write-PosSupportJson $inputPath $configuration
$installed=& $installer -Root $Root -ConfigurationPath $inputPath|ConvertFrom-Json
if(!$installed.installed -or $installed.publication -ne $false -or $global:registered -ne 1 -or $global:db.issues.Count -ne 0){throw 'Installer did not remain read-only on GitHub'}
$again=& $installer -Root $Root -ConfigurationPath $inputPath|ConvertFrom-Json
if(!$again.installed -or $global:registered -ne 1){throw 'Repeated install duplicated a task'}
Write-Output 'PASS disabled/null placeholder performs no live setup; actual opt-in daily task is owned and idempotent.'
$global:db.lose='comment';$failed=$false
try{Invoke-SmoothiesSupportCycle -Root $Root -Force|Out-Null}catch{$failed=$true}
if(!$failed -or !(Test-Path -LiteralPath (Join-Path $Root 'soporte\state\pending-report.json'))){throw 'Lost acknowledgment discarded the pending report'}
$result=Invoke-SmoothiesSupportCycle -Root $Root -Force
if(!$result.published -or $global:db.issues.Count -ne 1 -or $global:db.comments.Count -ne 1){throw 'Lost acknowledgment duplicated issue/comment'}
$body=$global:db.comments[0].body
foreach($secret in @('PRIVATE-SERVICE-CANARY','PUBLIC-ANON-CANARY',$global:machineGuid,$Root,'C:\')){if($body.Contains($secret)){throw 'Private metadata escaped the allowlist'}}
if(!$body.StartsWith('<!-- pos-smoothies-support-status:v1:fixture-smoothies -->')){throw 'Smoothies reused the Cafe identity'}
$before=$global:db.calls.Count;$daily=Invoke-SmoothiesSupportCycle -Root $Root
if(!$daily.skipped -or $global:db.calls.Count -ne $before){throw 'Daily suppression used the network'}
Write-Output 'PASS unknown acknowledgment reconciles one private issue/comment; same-day report skips and secrets stay local.'
# A different enrolled installation using the same human device label cannot
# attach to the first machine's issue or silently create a second one.
$otherState=[pscustomobject]@{version=1;issueNumber=0;commentId=0;lastSuccessAt=$null;lastError=$null}
$before=$global:db.calls.Count;$failed=$false
try{Publish-PosSupportStatus -Settings ([pscustomobject]@{Repository=$configuration.repository;PublisherLogin=$configuration.publisher;Device=$configuration.device;GhExecutable='gh'}) -State $otherState -StateFile (Join-Path $Root 'soporte\state\other-machine.json') -StateDirectory (Join-Path $Root 'soporte\state') -Product 'smoothies' -Body 'Unrelated installation' -InstallationBinding (('a'*64)+':'+$binding.backendIdentitySha256)|Out-Null}catch{$failed=$true}
if(!$failed -or $global:db.issues.Count -ne 1 -or $global:db.comments.Count -ne 1 -or @($global:db.calls|Select-Object -Skip $before|Where-Object {$_ -match '^(POST|PATCH) '}).Count){throw 'Same label overwrote another installation'}
Write-Output 'PASS two machines sharing a device label refuse remote binding mismatch without new issue or comment.'
$before=$global:db.calls.Count
$global:machineGuid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';$failed=$false
try{Invoke-SmoothiesSupportCycle -Root $Root|Out-Null}catch{$failed=$true}
if(!$failed -or $global:db.calls.Count -ne $before){throw 'Changed machine bypassed enrollment'}
$global:machineGuid='11111111-2222-3333-4444-555555555555'
foreach($condition in @('public','publisher')) {
    if($condition -ceq 'public'){$global:db.private=$false}else{$global:db.login='wrong-account'}
    $before=$global:db.calls.Count;$failed=$false
    try{Invoke-SmoothiesSupportCycle -Root $Root -Force|Out-Null}catch{$failed=$true}
    if(!$failed -or @($global:db.calls|Select-Object -Skip $before|Where-Object {$_ -match '^(POST|PATCH) '}).Count){throw 'Wrong destination/account received report'}
    $global:db.private=$true;$global:db.login='fixture-owner'
}
$original=$global:db.comments[0].body;$global:db.comments[0].body='Human notes'
try{Invoke-SmoothiesSupportCycle -Root $Root -Force|Out-Null}catch{}
if($global:db.comments[0].body -cne 'Human notes'){throw 'Human comment overwritten'};$global:db.comments[0].body=$original
$report=Get-Content -LiteralPath (Join-Path $Root 'diagnostico\support-report.json') -Raw -Encoding UTF8|ConvertFrom-Json
$report|Add-Member -NotePropertyName rawLog -NotePropertyValue 'PRIVATE-SERVICE-CANARY'
$failed=$false;try{Assert-SmoothiesPublicReport $report}catch{$failed=$true};if(!$failed){throw 'Unknown report field escaped allowlist'}
$global:task.Description='Unrelated task';$failed=$false
try{& $installer -Root $Root -ConfigurationPath $inputPath|Out-Null}catch{$failed=$true}
if(!$failed -or $global:registered -ne 1){throw 'Foreign task overwritten'}
Write-Output 'PASS changed machine/public/account/foreign-comment/schema/task refusals preserve owned state.'
