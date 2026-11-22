param(
    [string]$InstallDirectory=(Join-Path $env:LOCALAPPDATA 'Programs\CarinitoMioPOS'),
    [string]$ConfigPath='C:\POS-Cafe\private\pos-cafe-config.json',
    [string]$SupportHome=(Join-Path $env:LOCALAPPDATA 'POSCafeSupport'),
    [ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Device='cafe-caja-01'
)
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'El monitor requiere Windows.' }
foreach($value in @($InstallDirectory,$ConfigPath,$SupportHome)) {
    if($value -notmatch '^[A-Za-z]:[\\/]' -or $value.Contains('"')) { throw 'Usa rutas absolutas en un disco local.' }
}
$InstallDirectory=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$SupportHome=[IO.Path]::GetFullPath($SupportHome).TrimEnd('\')
if($SupportHome.Equals($InstallDirectory,[StringComparison]::OrdinalIgnoreCase) -or $SupportHome.StartsWith($InstallDirectory+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Soporte debe vivir fuera de la carpeta de Caja.' }
if(!(Test-Path -LiteralPath (Join-Path $InstallDirectory 'release.json') -PathType Leaf) -or !(Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'No se encontro la instalacion/configuracion existente. Indica sus rutas reales.' }
$gh=(Get-Command gh.exe -ErrorAction Stop).Source
$stateDirectory=Join-Path $SupportHome 'state-v2'
$agentDirectory=Join-Path $SupportHome 'agent-v3'
$settingsPath=Join-Path $SupportHome 'settings-v3.json'
$taskName='POSCafe-GitHub-Support-'+$Device
$shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $agentDirectory 'Monitor-POS-GitHub.ps1')+'" -SettingsPath "'+$settingsPath+'"'
$legacySettingsPath=Join-Path $SupportHome 'settings-v2.json'
$legacyArguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $SupportHome 'agent-v2\Monitor-POS-GitHub.ps1')+'" -SettingsPath "'+$legacySettingsPath+'"'
$existing=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
$legacyTask=$existing -and $existing.Actions[0].Arguments -ceq $legacyArguments
if($existing -and ($existing.Description -cne ('POSCafe GitHub Support v2 '+$Device) -or @($existing.Actions).Count -ne 1 -or $existing.Actions[0].Execute -ine $shell -or $existing.Actions[0].Arguments -cnotin @($arguments,$legacyArguments) -or $existing.Principal.UserId -notin @($identity.User.Value,$identity.Name))) { throw 'Ya existe otra tarea con ese nombre. No se modifico.' }
foreach($folder in @($SupportHome,$agentDirectory,$stateDirectory)) {
    if(Test-Path -LiteralPath $folder) {
        $item=Get-Item -LiteralPath $folder
        if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'La carpeta de soporte debe ser local y normal.' }
    }
}
$null=New-Item -ItemType Directory -Path $stateDirectory -Force
Import-Module (Join-Path $PSScriptRoot 'SupportCore.psm1') -Force
$repo=Invoke-PosSupportApi -GhExecutable $gh -Endpoint 'repos/jorgecantu276/pos-cafe' -StateDirectory $stateDirectory
if($repo.private -ne $true -or $repo.full_name -cne 'jorgecantu276/pos-cafe') { throw 'El repositorio esperado no esta disponible como privado.' }
$publisher=Invoke-PosSupportApi -GhExecutable $gh -Endpoint 'user' -StateDirectory $stateDirectory
if(!$publisher.login) { throw 'GitHub CLI requiere la cuenta de soporte autenticada.' }
$settings=[pscustomobject]@{protocol=2;Repository='jorgecantu276/pos-cafe';Device=$Device;PublisherLogin=$publisher.login;GhExecutable=$gh;InstallDirectory=$InstallDirectory;ConfigPath=$ConfigPath;StateDirectory=$stateDirectory;DailyAt='08:00'}
$previousPath=if($legacyTask){$legacySettingsPath}else{$settingsPath}
if($legacyTask -and !(Test-Path -LiteralPath $previousPath)) { throw 'Falta la configuracion del monitor anterior. No se cambio su tarea.' }
if(Test-Path -LiteralPath $previousPath) {
    $previous=Get-Content -LiteralPath $previousPath -Raw|ConvertFrom-Json
    foreach($field in @('protocol','Repository','Device','PublisherLogin','GhExecutable','InstallDirectory','ConfigPath','StateDirectory')) {
        if([string]$previous.$field -cne [string]$settings.$field) { throw 'La configuracion de soporte existente es distinta. Conserva el estado y revisa las rutas.' }
    }
}
$files=@('Diagnostico-POS-Cafe.ps1','Soporte-POS-GitHub.ps1','SupportCore.psm1','Monitor-POS-GitHub.ps1','Instalar-Soporte-GitHub.ps1','LEEME.txt')
foreach($name in $files) {
    $source=Join-Path $PSScriptRoot $name
    if(!(Test-Path -LiteralPath $source -PathType Leaf)) { throw ('Kit incompleto: '+$name) }
    $destination=Join-Path $agentDirectory $name
    if(Test-Path -LiteralPath $destination) {
        if((Get-FileHash -LiteralPath $source).Hash -cne (Get-FileHash -LiteralPath $destination).Hash) { throw 'Ya hay otra version del monitor. No se sobrescribio.' }
    }
}
$null=New-Item -ItemType Directory -Path $agentDirectory -Force
foreach($name in $files) { if(!(Test-Path -LiteralPath (Join-Path $agentDirectory $name))) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $agentDirectory $name) } }
if(!(Test-Path -LiteralPath $settingsPath)) { Write-PosSupportJson -Path $settingsPath -Value $settings }
$xml=New-PosSupportTaskXml -ShellPath $shell -MonitorPath (Join-Path $agentDirectory 'Monitor-POS-GitHub.ps1') -SettingsPath $settingsPath -UserSid $identity.User.Value -Device $Device
if(!$existing) { $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $xml }
elseif($legacyTask) { $null=Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $xml -Force }
try {
    $initial=Invoke-PosSupportCycle -Settings $settings -AgentDirectory $agentDirectory -Force:$legacyTask
    [pscustomobject]@{Installed=$true;Task=$taskName;DailyAt='08:00';Report=$initial;Requires='PC encendida, internet y sesion Windows de esta cuenta iniciada; puede quedar bloqueada.'}
} catch {
    [pscustomobject]@{Installed=$true;Task=$taskName;DailyAt='08:00';FirstReportConfirmed=$false;Message='La tarea diaria quedo instalada. Revisa gh y el estado local; falta confirmar el primer informe.'}
}
