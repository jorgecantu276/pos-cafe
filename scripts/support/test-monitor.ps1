$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixture=Join-Path $root ('.staging-local\support-monitor-tests\'+[guid]::NewGuid().ToString('N'))
$app=Join-Path $fixture 'app';$data=Join-Path $fixture 'journal';$backups=Join-Path $fixture 'backups'
foreach($folder in @($app,$data,$backups)) { $null=New-Item -ItemType Directory -Path $folder -Force }
$config=Join-Path $fixture 'private-config.json'
$canary='SECRET-MONITOR-CANARY-DO-NOT-TRANSMIT'
@{sourceCommit=('a'*40);node='v24.22.2';fixtureOnly=$false;sourceDirty=$false}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $app 'release.json')
@{PrintMode='windows';PrintDataDirectory=$data;BackupDirectory=$backups;SupabaseServiceRoleKey=$canary;SupabaseAnonKey=$canary;ClipEnabled=$false;RequireExistingPrintJournal=$true}|ConvertTo-Json|Set-Content -LiteralPath $config
@{version=1;lastSuccess=@{createdAt=[DateTime]::UtcNow.ToString('o');bytes=100;sha256=('b'*64)};lastError=$canary}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backups 'status.json')
[IO.File]::WriteAllText((Join-Path $data 'windows-jobs.sqlite'),'journal must remain unchanged')
$journalHash=(Get-FileHash -LiteralPath (Join-Path $data 'windows-jobs.sqlite')).Hash
function global:Get-Printer { @([pscustomobject]@{Name='POS80 Printer';DriverName='Fixture';PortName='CP001';PrinterStatus='Normal'},[pscustomobject]@{Name='Y813BT Sticker';DriverName='Fixture';PortName='COM3';PrinterStatus='Normal'}) }
function global:Get-PrintJob { param($PrinterName) @() }
function global:Get-CimInstance { param($ClassName,$Filter) [pscustomobject]@{DeviceID='C:';FreeSpace=20GB;Size=100GB} }
$global:posMonitorTestDb=@{issues=@();comments=@();private=$true;login='fixture-owner';lose=$null;calls=@()}
function global:gh {
    $a=@($args);$global:LASTEXITCODE=0
    if($a[0] -cne 'api' -or $a[2] -cne 'github.com') { throw 'Unexpected non-pinned API call' }
    $method=$a[4];$endpoint=$a[5]
    $global:posMonitorTestDb.calls+=($method+' '+$endpoint)
    $body=$null
    if($a.Count -gt 6) { $body=Get-Content -LiteralPath $a[7] -Raw|ConvertFrom-Json }
    $db=$global:posMonitorTestDb
    if($endpoint -ceq 'user') { return (@{login=$db.login}|ConvertTo-Json) }
    if($endpoint -ceq 'repos/jorgecantu276/pos-cafe') { return (@{private=$db.private;full_name='jorgecantu276/pos-cafe'}|ConvertTo-Json) }
    if($method -ceq 'GET' -and $endpoint -match '^repos/jorgecantu276/pos-cafe/issues\?') { return (ConvertTo-Json -InputObject @($db.issues) -Depth 10) }
    if($method -ceq 'POST' -and $endpoint -ceq 'repos/jorgecantu276/pos-cafe/issues') {
        $issue=[pscustomobject]@{number=($db.issues.Count+1);state='open';body=$body.body;user=@{login=$db.login}}
        $db.issues+=@($issue)
        if($db.lose -ceq 'issue') { $db.lose=$null;$global:LASTEXITCODE=1;return }
        return ($issue|ConvertTo-Json -Depth 10)
    }
    if($method -ceq 'GET' -and $endpoint -match '^repos/jorgecantu276/pos-cafe/issues/(\d+)$') { return ($db.issues|Where-Object {$_.number -eq [long]$Matches[1]}|ConvertTo-Json -Depth 10) }
    if($endpoint -match '^repos/jorgecantu276/pos-cafe/issues/(\d+)/comments(?:\?|$)') {
        $issueNumber=[long]$Matches[1]
        if($method -ceq 'GET') { return (ConvertTo-Json -InputObject @($db.comments|Where-Object {$_.issue_url -ceq ('https://api.github.com/repos/jorgecantu276/pos-cafe/issues/'+$issueNumber)}) -Depth 10) }
        if($method -ceq 'POST') {
            $comment=[pscustomobject]@{id=($db.comments.Count+100);body=$body.body;issue_url=('https://api.github.com/repos/jorgecantu276/pos-cafe/issues/'+$issueNumber);user=@{login=$db.login}}
            $db.comments+=@($comment)
            if($db.lose -ceq 'comment') { $db.lose=$null;$global:LASTEXITCODE=1;return }
            return ($comment|ConvertTo-Json -Depth 10)
        }
    }
    if($endpoint -match '^repos/jorgecantu276/pos-cafe/issues/comments/(\d+)$') {
        $id=[long]$Matches[1];$comment=@($db.comments|Where-Object {$_.id -eq $id})[0]
        if($method -ceq 'PATCH') { $comment.body=$body.body }
        return ($comment|ConvertTo-Json -Depth 10)
    }
    throw ('Unexpected test endpoint: '+$method+' '+$endpoint)
}
Import-Module (Join-Path $PSScriptRoot 'SupportCore.psm1') -Force
$settings=[pscustomobject]@{Repository='jorgecantu276/pos-cafe';Device='fixture-cafe';PublisherLogin='fixture-owner';GhExecutable='gh';InstallDirectory=$app;ConfigPath=$config;StateDirectory=(Join-Path $fixture 'state')}
$global:posMonitorTestDb.lose='issue'
$failed=$false
try { Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null } catch { $failed=$true }
if(!$failed -or !(Test-Path -LiteralPath (Join-Path $settings.StateDirectory 'pending-report.json'))) { throw 'Lost enrollment did not preserve report' }
$result=Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot
if(!$result.published -or $global:posMonitorTestDb.issues.Count -ne 1 -or $global:posMonitorTestDb.comments.Count -ne 1) { throw 'Lost enrollment not recovered exactly once' }
Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null
if($global:posMonitorTestDb.issues.Count -ne 1 -or $global:posMonitorTestDb.comments.Count -ne 1 -or !($global:posMonitorTestDb.calls[-1] -like 'PATCH *')) { throw 'Heartbeat created duplicate issue/comment' }
if($global:posMonitorTestDb.comments[0].body.Contains($canary)) { throw 'Secret leaked into heartbeat' }
Write-Output 'PASS: automatic heartbeat reuses one issue/comment; lost enrollment recovered; no secrets.'
$statePath=Join-Path $settings.StateDirectory 'state.json'
$state=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
$state.commentId=0;Write-PosSupportJson -Path $statePath -Value $state
$global:posMonitorTestDb.comments=@();$global:posMonitorTestDb.lose='comment'
try { Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null } catch { }
Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null
if($global:posMonitorTestDb.comments.Count -ne 1) { throw 'Lost comment created duplicate' }
$originalBody=$global:posMonitorTestDb.comments[0].body
$global:posMonitorTestDb.comments[0].body='Human notes which must not be overwritten'
$failed=$false
try { Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null } catch { $failed=$true }
if(!$failed -or $global:posMonitorTestDb.comments[0].body -cne 'Human notes which must not be overwritten') { throw 'Unrelated comment overwritten' }
$global:posMonitorTestDb.comments[0].body=$originalBody
$global:posMonitorTestDb.private=$false
$beforeCalls=$global:posMonitorTestDb.calls.Count
try { Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null } catch { }
$newCalls=@($global:posMonitorTestDb.calls|Select-Object -Skip $beforeCalls)
if(@($newCalls|Where-Object {$_ -match '^(PATCH|POST) '}).Count) { throw 'Public repository received report' }
$global:posMonitorTestDb.private=$true
$global:posMonitorTestDb.login='different-account'
$failed=$false
try { Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot|Out-Null } catch { $failed=$true }
if(!$failed) { throw 'Changed publisher accepted' }
$global:posMonitorTestDb.login='fixture-owner'
$lock=[IO.File]::Open((Join-Path $settings.StateDirectory 'cycle.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try { $blocked=Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot;if(!$blocked.skipped){throw 'Concurrent cycle accepted'} } finally { $lock.Dispose() }
Write-Output 'PASS: lost comment recovered; unrelated comments, public repos, changed accounts and overlapping cycles rejected.'
$taskXml=New-PosSupportTaskXml -ShellPath 'C:\Windows\powershell.exe' -MonitorPath 'C:\Support & Tools\Monitor.ps1' -SettingsPath 'C:\Support & Tools\settings.json' -UserSid 'S-1-5-21-1234' -Device 'fixture-cafe'
[xml]$xml=$taskXml
$ns=New-Object Xml.XmlNamespaceManager($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
if($xml.SelectSingleNode('//t:Interval',$ns).InnerText -cne 'PT15M' -or $xml.SelectSingleNode('//t:LogonType',$ns).InnerText -cne 'InteractiveToken' -or $xml.SelectSingleNode('//t:MultipleInstancesPolicy',$ns).InnerText -cne 'IgnoreNew') { throw 'Task schedule/account contract incorrect' }
if($xml.SelectSingleNode('//t:Arguments',$ns).InnerText -notlike '*Support & Tools*') { throw 'XML path escaping failed' }
$scheduler=New-Object -ComObject 'Schedule.Service'
$definition=$scheduler.NewTask(0)
$definition.XmlText=$taskXml
if(!$definition.XmlText.Contains('PT15M')) { throw 'Windows Task Scheduler rejected the XML definition' }
if((Get-FileHash -LiteralPath (Join-Path $data 'windows-jobs.sqlite')).Hash -cne $journalHash) { throw 'Monitor modified journal' }
Write-Output 'PASS: task XML repeats every 15 minutes as current interactive user; journal unchanged.'
$global:posMonitorInstalledTask=$null
$global:posMonitorTaskRegistrations=0
function global:Get-Command {
    param([string]$Name)
    if($Name -ceq 'gh.exe') { return [pscustomobject]@{Source='gh'} }
    return (Microsoft.PowerShell.Core\Get-Command $Name)
}
function global:Get-ScheduledTask { param($TaskName,$TaskPath) return $global:posMonitorInstalledTask }
function global:Register-ScheduledTask {
    param($TaskName,$TaskPath,$Xml)
    [xml]$task=$Xml
    $manager=New-Object Xml.XmlNamespaceManager($task.NameTable);$manager.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    $global:posMonitorInstalledTask=[pscustomobject]@{Description=$task.SelectSingleNode('//t:Description',$manager).InnerText;Actions=@([pscustomobject]@{Execute=$task.SelectSingleNode('//t:Command',$manager).InnerText;Arguments=$task.SelectSingleNode('//t:Arguments',$manager).InnerText});Principal=[pscustomobject]@{UserId=$task.SelectSingleNode('//t:Principal/t:UserId',$manager).InnerText}}
    $global:posMonitorTaskRegistrations++
}
$supportFixtureHome=Join-Path $fixture 'automatic-support'
$installed=& (Join-Path $PSScriptRoot 'Instalar-Soporte-GitHub.ps1') -InstallDirectory $app -ConfigPath $config -SupportHome $supportFixtureHome -Device 'fixture-install'
if($installed.Installed -ne $true -or $global:posMonitorTaskRegistrations -ne 1 -or !$installed.Report.published) { throw 'Automatic installer failed' }
if(!(Test-Path -LiteralPath (Join-Path $supportFixtureHome 'agent-v2\Monitor-POS-GitHub.ps1'))) { throw 'Monitor files not preserved outside POS' }
& (Join-Path $PSScriptRoot 'Instalar-Soporte-GitHub.ps1') -InstallDirectory $app -ConfigPath $config -SupportHome $supportFixtureHome -Device 'fixture-install'|Out-Null
if($global:posMonitorTaskRegistrations -ne 1) { throw 'Rerun replaced existing task' }
$global:posMonitorInstalledTask.Description='Some unrelated task'
$failed=$false
try { & (Join-Path $PSScriptRoot 'Instalar-Soporte-GitHub.ps1') -InstallDirectory $app -ConfigPath $config -SupportHome $supportFixtureHome -Device 'fixture-install'|Out-Null } catch { $failed=$true }
if(!$failed -or $global:posMonitorTaskRegistrations -ne 1) { throw 'Unrelated task overwritten' }
if((Get-FileHash -LiteralPath (Join-Path $data 'windows-jobs.sqlite')).Hash -cne $journalHash) { throw 'Installer modified journal' }
Write-Output 'PASS: installer copies outside POS, registers once, reuses matching task and rejects unrelated tasks; no real task installed in test.'
