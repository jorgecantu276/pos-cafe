[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$ConfigurationPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'SmoothiesSupport.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'SupportTransport.psm1') -Force
$settings=Get-Content -LiteralPath $ConfigurationPath -Raw -Encoding UTF8|ConvertFrom-Json
$fields=@('protocol','product','enabled','repository','publisher','device','machineSha256','backendIdentitySha256','developmentMachineSha256')
if(@($settings.PSObject.Properties|Where-Object {$fields -cnotcontains $_.Name}).Count -or $settings.protocol -ne 1 -or $settings.product -cne 'smoothies') { throw 'smoothies_support_configuration_invalid' }
if($settings.enabled -eq $false){@{installed=$false;state='disabled';publication=$false}|ConvertTo-Json;return}
$binding=Get-SmoothiesSupportBinding $Root
Assert-SmoothiesSupportSettings $settings $binding
$rootPath=Get-SmoothiesPrivateRoot $Root
$directory=Join-Path $rootPath 'soporte'
if((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'smoothies_support_redirected_directory_refused'}
$settingsPath=Join-Path $directory 'reporting.json'
if(Test-Path -LiteralPath $settingsPath) {
    $saved=Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8|ConvertFrom-Json
    foreach($field in $fields){if($saved.$field -cne $settings.$field){throw 'smoothies_support_existing_enrollment_differs'}}
}
$gh=Get-Command 'gh.exe' -ErrorAction Stop
$repo=Invoke-PosSupportApi -GhExecutable $gh.Source -Endpoint 'repos/jorgecantu276/punto-demo' -StateDirectory $directory
if($repo.private -ne $true -or $repo.full_name -cne $settings.repository){throw 'smoothies_support_repository_not_private'}
$publisher=Invoke-PosSupportApi -GhExecutable $gh.Source -Endpoint 'user' -StateDirectory $directory
if($publisher.login -ine $settings.publisher){throw 'smoothies_support_publisher_changed'}
$shell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$monitor=Join-Path $rootPath 'Report-SmoothiesSupport.ps1'
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$monitor+'" -Root "'+$rootPath+'"'
$name='POS Smoothies Support - '+$settings.device
$description='POS Smoothies Support v1 '+$settings.device
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$task=Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
if($task) {
    $actions=@($task.Actions);$triggers=@($task.Triggers)
    if($task.Description -cne $description -or $actions.Count -ne 1 -or $actions[0].Execute -ine $shell -or $actions[0].Arguments -cne $arguments -or
       $task.Principal.UserId -cne $sid -or $triggers.Count -ne 1 -or $triggers[0].DaysInterval -ne 1 -or $triggers[0].StartBoundary -notlike '*T08:00:00' -or
       $triggers[0].Repetition.Interval) {throw 'smoothies_support_foreign_task_refused'}
}
$sourceMonitor=Join-Path $PSScriptRoot 'Report-SmoothiesSupport.ps1'
if((Test-Path -LiteralPath $monitor) -and (Get-FileHash -LiteralPath $monitor).Hash -cne (Get-FileHash -LiteralPath $sourceMonitor).Hash){throw 'smoothies_support_existing_dispatcher_differs'}
$null=New-Item -ItemType Directory -Path $directory -Force
if(!(Test-Path -LiteralPath $settingsPath)){Write-PosSupportJson $settingsPath $settings}
if(!(Test-Path -LiteralPath $monitor)){Copy-Item -LiteralPath $sourceMonitor -Destination $monitor}
if(!$task) {
    $escape={param($value)[Security.SecurityElement]::Escape([string]$value)}
    $start=(Get-Date).Date.AddHours(8).ToString('yyyy-MM-ddTHH:mm:ss')
    $xml=@"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>$description</Description></RegistrationInfo>
<Triggers><CalendarTrigger><StartBoundary>$start</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
<Principals><Principal id="Author"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><Priority>7</Priority><RestartOnFailure><Interval>PT30M</Interval><Count>2</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>$(& $escape $shell)</Command><Arguments>$(& $escape $arguments)</Arguments><WorkingDirectory>$(& $escape $rootPath)</WorkingDirectory></Exec></Actions>
</Task>
"@
    Register-ScheduledTask -TaskName $name -TaskPath '\' -Xml $xml|Out-Null
}
@{installed=$true;publication=$false;state='awaiting-first-report-review';dailyAt='08:00';machineSha256=$binding.machineSha256;backendIdentitySha256=$binding.backendIdentitySha256}|ConvertTo-Json
