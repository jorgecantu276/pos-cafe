param([string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'pos-cafe-config.json'), [switch]$NoBrowser, [switch]$DesktopApp, [switch]$MaintenanceProbe)
$ErrorActionPreference = 'Stop'
if ($MaintenanceProbe) { $NoBrowser = $true; $DesktopApp = $false }
# Cafe retains its direct backend and loopback-only launcher contract.
Remove-Item Env:POS_LAN_MODE, Env:POS_PUBLIC_ORIGIN -ErrorAction SilentlyContinue

function Get-CafeHash([string]$Value) {
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { return -join ($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) | ForEach-Object { $_.ToString('x2') }) } finally { $hash.Dispose() }
}
function Get-CafeExternalLocalPath([string]$Value, [string]$Label) {
  if ($Value -notmatch '^[A-Za-z]:[\\/]') { throw ($Label + ' requiere una ruta absoluta en un disco local.') }
  $resolved = [IO.Path]::GetFullPath($Value)
  if ($resolved.TrimEnd('\').Equals($releaseDirectory.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) -or $resolved.StartsWith($releaseDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw ($Label + ' debe guardarse fuera de la carpeta de version.') }
  return $resolved
}
function Get-CafeListeners {
  return @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -eq $port })
}
function Test-CafeProcess($ProcessId, [string]$StartTicks, [string]$Executable = '') {
  try {
    $process = Get-Process -Id ([int]$ProcessId) -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -cne $StartTicks) { return $false }
    if ($Executable -and -not $process.Path.Equals($Executable, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    return -not $process.HasExited
  } catch { return $false }
}
function Test-CafeInstance($Owner) {
  if (-not $Owner -or $Owner.protocol -ne 1 -or $Owner.releaseId -cne $releaseId -or $Owner.configId -cne $configId -or -not $Owner.instanceToken) { return $false }
  if (-not (Test-CafeProcess $Owner.launcherId ([string]$Owner.launcherStartTicks))) { return $false }
  if (-not (Test-CafeProcess $Owner.processId ([string]$Owner.processStartTicks) $node)) { return $false }
  try {
    $response = Invoke-WebRequest -Uri ($baseUrl + '/api/local-instance') -UseBasicParsing -TimeoutSec 2 -Headers @{ 'Cache-Control' = 'no-cache' }
    $identity = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -ne 200 -or $identity.protocol -ne 1 -or $identity.instanceToken -cne $Owner.instanceToken -or $identity.processId -ne $Owner.processId -or $identity.releaseId -cne $releaseId -or $identity.configId -cne $configId) { return $false }
    $listeners = @(Get-CafeListeners)
    return $listeners.Count -gt 0 -and @($listeners | Where-Object { $_.OwningProcess -ne $Owner.processId -or $_.LocalAddress -ne '127.0.0.1' }).Count -eq 0
  } catch { return $false }
}
function Read-CafeOwner {
  try { return Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json } catch { return $null }
}
function Write-CafeOwner($Owner) {
  $temporary = $statePath + '.' + $PID + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, ($Owner | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

$releaseText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw
$release = $releaseText | ConvertFrom-Json
$releaseDirectory = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
if (-not [IO.Path]::IsPathRooted($ConfigPath)) { throw 'La configuracion requiere una ruta absoluta fuera de esta version.' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
if ($ConfigPath.StartsWith($releaseDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'Guarda la configuracion privada fuera de la carpeta de esta version.' }
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Falta pos-cafe-config.json fuera de la carpeta de esta version. Usa la plantilla de configuracion del negocio.' }
$configText = Get-Content -LiteralPath $ConfigPath -Raw
$config = $configText | ConvertFrom-Json
$keyHash = Get-CafeHash ([string]$config.SupabaseAnonKey)
if (([string]$config.SupabaseUrl).TrimEnd('/') -cne $release.supabaseUrl -or $keyHash -cne $release.publicKeySha256) { throw 'Esta version corresponde a otra base de datos. Pide una version preparada para este negocio; cambiar la configuracion local no es suficiente.' }
$port = 3000
if ($null -ne $config.Port) { $port = [int]$config.Port }
if ($port -lt 1024 -or $port -gt 65535) { throw 'Puerto invalido.' }
$dataDirectory = [string]$config.PrintDataDirectory
if (-not $dataDirectory) { $dataDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'pos-cafe-data' }
if (-not [IO.Path]::IsPathRooted($dataDirectory)) { throw 'PrintDataDirectory requiere una ruta absoluta.' }
$dataDirectory = [IO.Path]::GetFullPath($dataDirectory)
if ($dataDirectory.StartsWith('\\') -or $dataDirectory.TrimEnd('\').Equals($releaseDirectory.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) -or $dataDirectory.StartsWith($releaseDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'El registro de impresion debe estar en un disco local, fuera de la carpeta de version.' }
if ($config.PrintMode -notin @('mock', 'windows')) { throw 'PrintMode requiere mock o windows.' }
if ($config.RequireExistingPrintJournal -eq $true -and -not (Test-Path -LiteralPath (Join-Path $dataDirectory ($config.PrintMode + '-jobs.sqlite')) -PathType Leaf)) { throw 'No se encontro el registro anterior de impresion. Revisa la ruta antes de abrir esta version.' }
if ($release.fixtureOnly -and $config.PrintMode -eq 'windows') { throw 'Una compilacion de prueba local no puede activar impresion fisica.' }
if ($config.ReceiptIssuerFile -and -not [IO.Path]::IsPathRooted([string]$config.ReceiptIssuerFile)) { throw 'ReceiptIssuerFile requiere una ruta absoluta.' }
if ($config.PrintMode -eq 'windows' -and (-not $config.ReceiptIssuerFile -or -not (Test-Path -LiteralPath $config.ReceiptIssuerFile -PathType Leaf))) { throw 'Configura los datos fiscales del emisor antes de imprimir tickets de venta.' }
$backupDirectory = [string]$config.BackupDirectory
if (-not $backupDirectory) { $backupDirectory = Join-Path (Split-Path -Parent $ConfigPath) 'pos-cafe-backups' }
$backupDirectory = Get-CafeExternalLocalPath $backupDirectory 'BackupDirectory'
$backupKeyFile = [string]$config.BackupRecoveryKeyFile
if (-not $backupKeyFile) { $backupKeyFile = Join-Path (Split-Path -Parent $ConfigPath) 'pos-cafe-backup-recovery.key' }
$backupKeyFile = Get-CafeExternalLocalPath $backupKeyFile 'BackupRecoveryKeyFile'
if ($backupKeyFile.Equals($backupDirectory, [StringComparison]::OrdinalIgnoreCase) -or $backupKeyFile.StartsWith($backupDirectory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Guarda la clave de recuperacion fuera de la carpeta de respaldos.' }
$node = Join-Path $PSScriptRoot 'node.exe'
$clipToken = ''
if ($config.ClipTokenFile) {
  $clipTokenPath = Get-CafeExternalLocalPath ([string]$config.ClipTokenFile) 'ClipTokenFile'
  if (-not (Test-Path -LiteralPath $clipTokenPath -PathType Leaf)) { throw 'No se encontro el archivo privado del token CLIP.' }
  $clipToken = [IO.File]::ReadAllText($clipTokenPath).Trim()
}
$server = Join-Path $PSScriptRoot 'app\server.js'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $server -PathType Leaf)) { throw 'Esta version esta incompleta. Pide de nuevo el paquete preparado para Windows.' }
$baseUrl = "http://127.0.0.1:$port"
function Open-CafeWindow {
  if (-not $DesktopApp) { Start-Process $baseUrl; return }
  $browser = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $browser) { throw 'No se encontró Microsoft Edge para abrir Cariñito Mío POS.' }
  $profile = Join-Path $env:LOCALAPPDATA 'CarinitoMioPOS\Ventana'
  Start-Process -FilePath $browser -ArgumentList @("--app=$baseUrl", '--disable-background-mode', ('--user-data-dir="' + $profile + '"')) -PassThru
}
$configId = Get-CafeHash ($ConfigPath.ToLowerInvariant() + "`n" + $configText + "`n" + $clipToken)
$releaseId = Get-CafeHash ($releaseDirectory.ToLowerInvariant() + "`n" + $releaseText)
$statePath = $ConfigPath + '.instance.json'
$instanceToken = [Guid]::NewGuid().ToString('N')
$mutex = New-Object Threading.Mutex($false, ('Local\POSCafe-' + (Get-CafeHash $ConfigPath.ToLowerInvariant())))
$ownsMutex = $false
$child = $null
$job = $null
$startupReported = $false
$updateReadyToken = $env:POS_UPDATE_READY_TOKEN
$savedEnvironment = @{}
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) {
    if ($updateReadyToken -match '^[0-9a-f-]{36}$') { Write-Output "POS_UPDATE_BUSY $updateReadyToken" }
    if ($MaintenanceProbe) { throw 'Caja esta abierta. Se omite la comprobacion de mantenimiento.' }
    Write-Host 'La caja ya se esta iniciando. Comprobando la ventana existente...'
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      $owner = Read-CafeOwner
      if ($owner -and ($owner.releaseId -cne $releaseId -or $owner.configId -cne $configId)) { throw 'Ya hay otra version o configuracion de esta caja abierta. Cierra su ventana antes de cambiar de version o configuracion.' }
      if (Test-CafeInstance $owner) {
        Write-Host 'La caja ya estaba abierta. Se abre la misma caja en el navegador.'
        if (-not $NoBrowser) { Open-CafeWindow | Out-Null }
        return
      }
      Start-Sleep -Milliseconds 500
    }
    throw 'La caja existente no responde con una identidad valida. Conserva sus datos y pide ayuda; no se inicio otra copia.'
  }
  if (@(Get-CafeListeners).Count -gt 0) {
    if ($updateReadyToken -match '^[0-9a-f-]{36}$') { Write-Output "POS_UPDATE_BUSY $updateReadyToken" }
    throw 'El puerto ya esta ocupado por otra aplicacion o version. No se cerro ningun programa. Pide ayuda para revisar la caja o su puerto.'
  }

  # A Windows job kills only this launcher's child tree even if its window is closed.
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class CafeProcessJob : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long PerProcess, PerJob; public uint Flags; public UIntPtr Minimum, Maximum; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  IntPtr handle;
  public CafeProcessJob() {
    handle=CreateJobObject(IntPtr.Zero, null);
    if(handle==IntPtr.Zero) throw new Win32Exception();
    var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000;
    if(!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits))) { var error=Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error); }
  }
  public void Add(IntPtr process) { if(!AssignProcessToJobObject(handle,process)) throw new Win32Exception(); }
  public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
}
"@
  $job = New-Object CafeProcessJob
  $environment = @{
    NODE_ENV='production'; HOSTNAME='127.0.0.1'; PORT=[string]$port
    NEXT_PUBLIC_SUPABASE_URL=[string]$config.SupabaseUrl; NEXT_PUBLIC_SUPABASE_ANON_KEY=[string]$config.SupabaseAnonKey
    SUPABASE_SERVICE_ROLE_KEY=[string]$config.SupabaseServiceRoleKey
    POS_CLIP_ENABLED=$(if ($config.ClipEnabled -eq $true) { '1' } else { '0' })
    POS_CLIP_TOKEN=$clipToken; POS_CLIP_SERIAL=[string]$config.ClipSerial; POS_CLIP_WEBHOOK_URL=[string]$config.ClipWebhookUrl
    POS_PRINT_MODE=[string]$config.PrintMode; POS_PRINT_DATA_DIR=$dataDirectory
    POS_PRINT_CUSTOMER_QUEUE='POS80 Printer'; POS_PRINT_BARISTA_QUEUE='Y813BT Sticker'
    POS_PRINT_BARISTA_STOCK_CONFIRMED=$(if ($config.StickerStockConfirmed -eq $true) { '1' } else { '0' })
    POS_RECEIPT_ISSUER_FILE=[string]$config.ReceiptIssuerFile
    POS_LAUNCH_INSTANCE_TOKEN=$instanceToken; POS_LAUNCH_RELEASE_ID=$releaseId; POS_LAUNCH_CONFIG_ID=$configId
    POS_BACKUP_DIR=$backupDirectory; POS_BACKUP_KEY_FILE=$backupKeyFile
    POS_DATABASE_CONTRACT_DIR=(Join-Path $PSScriptRoot 'database-migrations'); POS_RELEASE_COMMIT=[string]$release.sourceCommit
    POS_UPDATE_READY_TOKEN=$null
  }
  foreach ($name in $environment.Keys) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process') }
  $browserOpened = $false
  for ($restart = 0; $restart -le 3; $restart++) {
    if ($restart -gt 0) {
      $delay = [int][Math]::Pow(2, $restart - 1)
      Write-Host "La aplicacion se detuvo. Reintentando en $delay segundos ($restart de 3)."
      Start-Sleep -Seconds $delay
    }
    if (@(Get-CafeListeners).Count -gt 0) { throw 'El puerto fue ocupado por otro programa. No se inicio otra copia; pide ayuda.' }
    Write-Host 'Iniciando caja... Conserva esta ventana abierta; puedes minimizarla.'
    $child = Start-Process -FilePath $node -ArgumentList @(('"' + $server + '"')) -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden -PassThru -RedirectStandardOutput ($ConfigPath + '.server.log') -RedirectStandardError ($ConfigPath + '.server-error.log')
    try {
      $child.Refresh()
      if ($child.HasExited) { continue }
      $job.Add($child.Handle)
      $processStartTicks = $child.StartTime.ToUniversalTime().Ticks.ToString()
    } catch {
      $child.Refresh()
      if ($child.HasExited) { continue }
      throw
    }
    $owner = [ordered]@{ protocol=1; instanceToken=$instanceToken; releaseId=$releaseId; configId=$configId; launcherId=$PID; launcherStartTicks=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString(); processId=$child.Id; processStartTicks=$processStartTicks }
    Write-CafeOwner $owner
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      $child.Refresh()
      if ($child.HasExited) { break }
      if (Test-CafeInstance $owner) { $ready = $true; break }
      Start-Sleep -Milliseconds 500
    }
    if ($ready) {
      Write-Host "Caja disponible en $baseUrl - cierra esta ventana para detenerla."
      if ($config.PrintMode -eq 'mock') { Write-Host 'Impresion de prueba: no imprime en papel.' }
      if (-not $NoBrowser -and -not $browserOpened) { $cafeWindow = Open-CafeWindow; $browserOpened = $true }
      if (!$startupReported -and $updateReadyToken -match '^[0-9a-f-]{36}$') {
        Write-Output "POS_UPDATE_READY $updateReadyToken"
        $startupReported = $true
      }
      if ($MaintenanceProbe) { return }
      while (-not $child.HasExited) {
        if ($DesktopApp -and $cafeWindow -and $cafeWindow.HasExited) { return }
        Start-Sleep -Milliseconds 250
        $child.Refresh()
      }
    } elseif (-not $child.HasExited) {
      Stop-Process -Id $child.Id -ErrorAction SilentlyContinue
      $child.WaitForExit(5000) | Out-Null
    }
  }
  throw 'La caja no pudo mantenerse abierta tras 3 reintentos. Conserva los registros y pide ayuda. Detalle tecnico: archivo .server-error.log junto a la configuracion privada.'
} finally {
  if ($child -and -not $child.HasExited) {
    Stop-Process -Id $child.Id -ErrorAction SilentlyContinue
    $child.WaitForExit(5000) | Out-Null
  }
  if ($job) { $job.Dispose() }
  if ($ownsMutex) {
    $owner = Read-CafeOwner
    if ($owner -and $owner.instanceToken -ceq $instanceToken) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
