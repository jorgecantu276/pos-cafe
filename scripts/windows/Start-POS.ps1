param([string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'pos-cafe-config.json'), [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$release = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Falta pos-cafe-config.json fuera de la carpeta de version. Usa la plantilla preparada para este cliente.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$hash = [System.Security.Cryptography.SHA256]::Create()
try { $keyHash = -join ($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$config.SupabaseAnonKey)) | ForEach-Object { $_.ToString('x2') }) } finally { $hash.Dispose() }
if ($config.SupabaseUrl.TrimEnd('/') -cne $release.supabaseUrl -or $keyHash -cne $release.publicKeySha256) { throw 'Esta version se compilo para otra base de datos. Requiere una nueva compilacion; no basta cambiar la configuracion local.' }
$port = 3000
if ($null -ne $config.Port) { $port = [int]$config.Port }
if ($port -lt 1024 -or $port -gt 65535) { throw 'Puerto invalido.' }
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw 'El puerto ya esta ocupado. Conserva la aplicacion existente; usa otro puerto o revisa la instancia abierta.' }
$dataDirectory = [string]$config.PrintDataDirectory
if (-not $dataDirectory) { $dataDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'pos-cafe-data' }
if (-not [IO.Path]::IsPathRooted($dataDirectory)) { throw 'PrintDataDirectory requiere una ruta absoluta.' }
$dataDirectory = [IO.Path]::GetFullPath($dataDirectory)
$releaseDirectory = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
if ($dataDirectory.StartsWith('\\') -or $dataDirectory.TrimEnd('\').Equals($releaseDirectory.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) -or $dataDirectory.StartsWith($releaseDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'El registro de impresion debe estar en un disco local, fuera de la carpeta de version.' }
if ($config.PrintMode -notin @('mock', 'windows')) { throw 'PrintMode requiere mock o windows.' }
if ($release.fixtureOnly -and $config.PrintMode -eq 'windows') { throw 'Una compilacion de prueba local no puede activar impresion fisica.' }
if ($config.ReceiptIssuerFile -and -not [IO.Path]::IsPathRooted([string]$config.ReceiptIssuerFile)) { throw 'ReceiptIssuerFile requiere una ruta absoluta.' }
if ($config.PrintMode -eq 'windows' -and (-not $config.ReceiptIssuerFile -or -not (Test-Path -LiteralPath $config.ReceiptIssuerFile -PathType Leaf))) { throw 'Configura el perfil fiscal local antes de usar impresion fisica.' }
$environment = @{
  NODE_ENV='production'; HOSTNAME='127.0.0.1'; PORT=[string]$port
  NEXT_PUBLIC_SUPABASE_URL=[string]$config.SupabaseUrl; NEXT_PUBLIC_SUPABASE_ANON_KEY=[string]$config.SupabaseAnonKey
  SUPABASE_SERVICE_ROLE_KEY=[string]$config.SupabaseServiceRoleKey
  POS_PRINT_MODE=[string]$config.PrintMode; POS_PRINT_DATA_DIR=$dataDirectory
  POS_PRINT_CUSTOMER_QUEUE='POS80 Printer'; POS_PRINT_BARISTA_QUEUE='Y813BT Sticker'
  POS_PRINT_BARISTA_STOCK_CONFIRMED=$(if ($config.StickerStockConfirmed -eq $true) { '1' } else { '0' })
  POS_RECEIPT_ISSUER_FILE=[string]$config.ReceiptIssuerFile
}
$savedEnvironment = @{}
$child = $null
try {
  foreach ($name in $environment.Keys) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process') }
  $server = Join-Path $PSScriptRoot 'app\server.js'
  $child = Start-Process -FilePath (Join-Path $PSScriptRoot 'node.exe') -ArgumentList @(('"' + $server + '"')) -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden -PassThru
  $ready = $false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    if ($child.HasExited) { throw 'El servidor no pudo iniciar. Revisa esta version y la configuracion local.' }
    try { $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/manifest.json" -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'No se confirmo el inicio del servidor.' }
  Write-Host "POS disponible en http://127.0.0.1:$port - conserva esta ventana abierta."
  if ($config.PrintMode -eq 'mock') { Write-Host 'IMPRESION SIMULADA: no se enviara papel.' }
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$port" }
  $child.WaitForExit()
} finally {
  if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
