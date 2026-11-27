param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','Install','Rollback')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$Bootstrap,
  [string]$ExpectedHash = 'absent',
  [string]$PreviousXmlBase64
)
$ErrorActionPreference = 'Stop'
foreach ($value in @($ConfigPath,$Bootstrap)) {
  if ($value -notmatch '^[A-Za-z]:[\\/]' -or $value -match '["\r\n]') { throw 'Usa rutas locales absolutas conocidas.' }
}
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$Bootstrap = [IO.Path]::GetFullPath($Bootstrap)
function Get-UpdateHash([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}
$name = 'POSCafe-AutoUpdate-' + (Get-UpdateHash $ConfigPath.ToLowerInvariant()).Substring(0,16)
$description = 'POSCafe scheduled updater v1|' + $ConfigPath.ToLowerInvariant() + '|' + $Bootstrap.ToLowerInvariant()
$executable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $Bootstrap 'Open-Caja.ps1') + '" -ConfigPath "' + $ConfigPath + '" -ScheduledUpdate'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$existing = Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
$xml = $null
if ($existing) {
  try {
    $existingUser = if ([string]$existing.Principal.UserId -match '^S-1-') { [string]$existing.Principal.UserId }
      else { ([Security.Principal.NTAccount]([string]$existing.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value }
  } catch { throw 'No se verifico la cuenta de la tarea existente; se conserva.' }
  if ($existing.Description -cne $description -or @($existing.Actions).Count -ne 1 -or
      $existing.Actions[0].Execute -ine $executable -or $existing.Actions[0].Arguments -cne $arguments -or $existing.Actions[0].WorkingDirectory -ine $Bootstrap -or
      $existingUser -ine $identity -or $existing.Principal.LogonType -ne 'Interactive' -or
      $existing.Principal.RunLevel -ne 'Limited') { throw 'La tarea existente no pertenece a esta instalacion; se conserva.' }
  $boundaries = @($existing.Triggers | ForEach-Object {
    if ([string]$_.StartBoundary -notmatch '(Z|[+-]\d{2}:\d{2})$') { throw 'La tarea no conserva limites UTC explicitos.' }
    ([DateTimeOffset]$_.StartBoundary).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  } | Sort-Object)
  if ($boundaries.Count -ne 2 -or $boundaries[0] -cne '2026-01-01T10:00:00Z' -or $boundaries[1] -cne '2026-01-01T11:00:00Z' -or
      @($existing.Triggers | Where-Object { $_.DaysInterval -ne 1 -or $_.Enabled -ne $true -or $_.Repetition.Interval -or $_.RandomDelay -notin @($null,'','PT0S') }).Count -ne 0 -or
      $existing.Settings.StartWhenAvailable -ne $false -or $existing.Settings.MultipleInstances -ne 'IgnoreNew' -or
      $existing.Settings.ExecutionTimeLimit -cne 'PT15M' -or $existing.Settings.Enabled -ne $true -or
      $existing.Settings.RestartCount -gt 0) { throw 'El horario existente no coincide con las 05:00 Central; se conserva.' }
  $xml = Export-ScheduledTask -TaskName $name -TaskPath '\'
}
$currentHash = if ($xml) { Get-UpdateHash $xml } else { 'absent' }
if ($Mode -eq 'Inspect') {
  @{name=$name;hash=$currentHash;xml=$xml;at='05:00';timeZone='America/Matamoros';missedRun='skip'} | ConvertTo-Json -Compress
  return
}
if ($currentHash -cne $ExpectedHash) { throw 'La tarea cambio desde la inspeccion; no se modifico.' }
if ($Mode -eq 'Rollback') {
  if ($PreviousXmlBase64) {
    $previous = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PreviousXmlBase64))
    $null = Register-ScheduledTask -TaskName $name -TaskPath '\' -Xml $previous -Force
  } elseif ($existing) {
    Unregister-ScheduledTask -TaskName $name -TaskPath '\' -Confirm:$false
  }
  @{name=$name;state='restored'} | ConvertTo-Json -Compress
  return
}
$action = New-ScheduledTaskAction -Execute $executable -Argument $arguments -WorkingDirectory $Bootstrap
# Fixed UTC boundaries avoid dependence on the register's Windows timezone.
# Only the boundary that is 05:00 America/Matamoros passes the runtime gate.
$summerTrigger = New-ScheduledTaskTrigger -Daily -At '05:00'
$summerTrigger.StartBoundary = '2026-01-01T10:00:00Z'
$winterTrigger = New-ScheduledTaskTrigger -Daily -At '05:00'
$winterTrigger.StartBoundary = '2026-01-01T11:00:00Z'
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$settings.StartWhenAvailable = $false
$settings.Hidden = $true
$task = New-ScheduledTask -Action $action -Trigger @($summerTrigger,$winterTrigger) -Principal $principal -Settings $settings -Description $description
try {
  $null = Register-ScheduledTask -TaskName $name -TaskPath '\' -InputObject $task -Force
  $installedXml = Export-ScheduledTask -TaskName $name -TaskPath '\'
} catch {
  $failure = $_
  $current = Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
  if ($current -and $current.Description -ceq $description -and $current.Actions[0].Arguments -ceq $arguments) {
    if ($xml) { $null = Register-ScheduledTask -TaskName $name -TaskPath '\' -Xml $xml -Force }
    else { Unregister-ScheduledTask -TaskName $name -TaskPath '\' -Confirm:$false }
  }
  throw $failure
}
@{name=$name;hash=(Get-UpdateHash $installedXml);at='05:00';timeZone='America/Matamoros';missedRun='skip'} | ConvertTo-Json -Compress
