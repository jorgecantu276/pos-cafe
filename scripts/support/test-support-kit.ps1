$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixture=Join-Path $root ('.staging-local\support-tests\'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$app=Join-Path $fixture 'app'
$null=New-Item -ItemType Directory -Path $app
$data=Join-Path $fixture 'journal'
$null=New-Item -ItemType Directory -Path $data
$backups=Join-Path $fixture 'backups'
$null=New-Item -ItemType Directory -Path $backups
$configFile=Join-Path $fixture 'private-config.json'
$canary='SECRET-CANARY-NEVER-REPORT-123456'
@{ sourceCommit=('a'*40);node='v24.22.2';sourceDirty=$false;fixtureOnly=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'release.json')
@{ PrintMode='windows';PrintDataDirectory=$data;BackupDirectory=$backups;ClipEnabled=$false;RequireExistingPrintJournal=$true;SupabaseServiceRoleKey=$canary;SupabaseAnonKey=$canary;ClipTokenFile=$canary;ReceiptIssuerFile=$canary } | ConvertTo-Json | Set-Content -LiteralPath $configFile
[IO.File]::WriteAllText((Join-Path $data 'windows-jobs.sqlite'),'journal-canary-no-open')
[IO.File]::WriteAllText(($configFile+'.server-error.log'),$canary)
@{instanceToken=$canary;processId=123;releaseId='fixture-release';configId='fixture-config'}|ConvertTo-Json|Set-Content -LiteralPath ($configFile+'.instance.json')
function global:Invoke-RestMethod { param($Uri,$Method,$TimeoutSec) [pscustomobject]@{protocol=1;instanceToken='SECRET-CANARY-NEVER-REPORT-123456';processId=123;releaseId='fixture-release';configId='fixture-config'} }
@{ version=1;lastSuccess=@{createdAt='2026-11-08T12:00:00Z';bytes=123;sha256=('b'*64)};lastError=$canary } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backups 'status.json')
function global:Get-Printer { [pscustomobject]@{ Name='POS80 Printer';DriverName='Fixture';PortName='CP001';PrinterStatus='Normal' } }
function global:Get-PrintJob { param($PrinterName) @() }
function global:Get-CimInstance { param($ClassName,$Filter) [pscustomobject]@{DeviceID='C:';FreeSpace=1000;Size=2000} }
function global:gh { throw 'Unexpected GitHub transmission in preview mode' }
$before=Get-FileHash -LiteralPath (Join-Path $data 'windows-jobs.sqlite')
$helper=Join-Path $PSScriptRoot 'Soporte-POS-GitHub.ps1'
$result=& $helper -InstallDirectory $app -ConfigPath $configFile -OutputDirectory (Join-Path $fixture 'reports')
if($result.Sent -ne $false) { throw 'Preview sent a report' }
$json=Get-Content -LiteralPath $result.Diagnostic -Raw
$body=Get-Content -LiteralPath $result.Preview -Raw
if($json.Contains($canary)-or $body.Contains($canary)) { throw 'Secret content leaked' }
$report=$json|ConvertFrom-Json
if($report.release.commit -cne ('a'*40)-or $report.backup.errorPresent -ne $true-or $report.configuration.serviceKeyConfigured -ne $true) { throw 'Diagnostic lost required flags' }
if($report.printers[0].pendingJobs -ne 0) { throw 'Queue result incorrect' }
if($report.localServer.status -cne 'verified') { throw 'Local instance was not checked' }
if((Get-FileHash -LiteralPath (Join-Path $data 'windows-jobs.sqlite')).Hash -cne $before.Hash) { throw 'Journal modified' }
Write-Output 'PASS: no GitHub call in preview; secrets/log content excluded; required metadata present; journal unchanged.'
$global:posSupportTestCalls=New-Object System.Collections.Generic.List[string]
$global:posSupportTestMode='public'
function global:gh {
    $global:posSupportTestCalls.Add(($args -join ' '))
    $global:LASTEXITCODE=0
    if($args[0] -ceq 'api') {
        if(($args -join ' ') -match '/issues/') {
            if($global:posSupportTestMode -ceq 'pr') { return '{"state":"open","pull_request":{"url":"https://example.invalid/pr"}}' }
            return '{"state":"open","pull_request":null}'
        }
        if($global:posSupportTestMode -ceq 'public') { return '{"private":false,"full_name":"jorgecantu276/pos-cafe"}' }
        return '{"private":true,"full_name":"jorgecantu276/pos-cafe"}'
    }
    if($global:posSupportTestMode -ceq 'lost-response') { $global:LASTEXITCODE=1; return }
    if($args[0] -ceq 'issue' -and $args[1] -in @('create','comment')) { return 'https://github.com/jorgecantu276/pos-cafe/issues/123' }
    throw 'Unexpected gh invocation'
}
$blocked=$false
try { & $helper -InstallDirectory $app -ConfigPath $configFile -OutputDirectory (Join-Path $fixture 'public-reports') -Enviar | Out-Null } catch { $blocked=$_.Exception.Message -like '*repositorio privado esperado*' }
if(!$blocked -or (Test-Path -LiteralPath (Join-Path $fixture 'public-reports'))) { throw 'Public repository accepted' }
if(@($global:posSupportTestCalls | Where-Object {$_ -like 'issue *'}).Count) { throw 'Report sent to public repository' }
Write-Output 'PASS: public destination rejected before collection/transmission.'
$global:posSupportTestMode='pr'
$blocked=$false
try { & $helper -InstallDirectory $app -ConfigPath $configFile -OutputDirectory (Join-Path $fixture 'pr-reports') -IssueNumber 123 -Enviar | Out-Null } catch { $blocked=$_.Exception.Message -like '*no un pull request*' }
if(!$blocked) { throw 'Pull request accepted as support issue' }
$global:posSupportTestMode='private'
$sent=& $helper -InstallDirectory $app -ConfigPath $configFile -OutputDirectory (Join-Path $fixture 'sent-reports') -IssueNumber 123 -Enviar
if($sent.Sent -ne $true -or !($global:posSupportTestCalls[-1] -like 'issue comment 123 --repo github.com/jorgecantu276/pos-cafe --body-file *')) { throw 'Private followup host or body-file failed' }
Write-Output 'PASS: private issue target validated; followup uses body file.'
$global:posSupportTestMode='lost-response'
$failed=$false
try { & $helper -InstallDirectory $app -ConfigPath $configFile -OutputDirectory (Join-Path $fixture 'retained-reports') -Enviar | Out-Null } catch { $failed=$_.Exception.Message -like '*No se confirmo el envio*' }
if(!$failed -or @(Get-ChildItem -LiteralPath (Join-Path $fixture 'retained-reports') -File).Count -ne 2) { throw 'Lost response did not preserve local evidence' }
if((Get-FileHash -LiteralPath (Join-Path $data 'windows-jobs.sqlite')).Hash -cne $before.Hash) { throw 'Journal modified by transport' }
Write-Output 'PASS: unknown send outcome preserves report and journal; no automatic resend.'
