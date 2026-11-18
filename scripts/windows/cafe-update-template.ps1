param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\CarinitoMioPOS'),
    [string]$ConfigPath = 'C:\POS-Cafe\private\pos-cafe-config.json'
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Caja'
$approvedManifest = '__FILE_MANIFEST_SHA256__'
$revision = '__RELEASE_COMMIT__'
function Get-ReleaseEntries([string]$Directory) {
    $checksums = Join-Path $Directory 'SHA256.json'
    if ((Get-FileHash -LiteralPath $checksums -Algorithm SHA256).Hash -cne $approvedManifest) {
        throw 'La lista de archivos no coincide con la version de Caja.'
    }
    Get-Content -LiteralPath $checksums -Raw | ConvertFrom-Json
}
if (![IO.Path]::IsPathRooted($InstallDirectory)) { throw 'La instalacion requiere una ruta absoluta.' }
$installed = Get-Item -LiteralPath $InstallDirectory
if (!$installed.PSIsContainer -or !$installed.Parent -or ($installed.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($installed.Parent.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'La ruta de Caja no es una carpeta de instalacion normal.'
}
$app = [IO.Path]::GetFullPath($installed.FullName).TrimEnd('\')
$parent = [IO.Path]::GetFullPath($installed.Parent.FullName).TrimEnd('\')
$stage = Join-Path $parent ('CarinitoMioPOS-preparacion-' + [guid]::NewGuid().ToString('N'))
$previous = Join-Path $parent ('CarinitoMioPOS-anterior-' + [guid]::NewGuid().ToString('N'))
foreach ($movePath in @($app,$stage,$previous)) {
    if (![IO.Path]::IsPathRooted($movePath) -or ![IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($movePath)).Equals($parent,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Las carpetas de actualizacion deben ser hermanas de la instalacion.'
    }
}
function Get-ExternalPath([string]$Value,[string]$Name) {
    if (!$Value -or ![IO.Path]::IsPathRooted($Value) -or $Value.StartsWith('\\')) { throw "$Name requiere una ruta local absoluta fuera de Caja." }
    $resolved = [IO.Path]::GetFullPath($Value).TrimEnd('\')
    foreach ($version in @($app,$stage,$previous)) {
        if ($resolved.Equals($version,[StringComparison]::OrdinalIgnoreCase) -or $resolved.StartsWith($version+'\',[StringComparison]::OrdinalIgnoreCase)) {
            throw "$Name debe estar fuera de las carpetas de version. No se ha movido Caja."
        }
    }
    return $resolved
}
$ConfigPath = Get-ExternalPath $ConfigPath 'ConfigPath'
if (!(Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Falta la configuracion privada existente.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.RequireExistingPrintJournal -ne $true -or $config.PrintMode -cne 'windows') { throw 'La configuracion debe conservar RequireExistingPrintJournal=true y PrintMode=windows.' }
$data = Get-ExternalPath ([string]$config.PrintDataDirectory) 'PrintDataDirectory'
if (!(Test-Path -LiteralPath (Join-Path $data 'windows-jobs.sqlite') -PathType Leaf)) { throw 'No se encontro el diario anterior de impresion. No se ha movido Caja.' }
foreach ($field in @('ReceiptIssuerFile','BackupRecoveryKeyFile')) {
    $externalFile = Get-ExternalPath ([string]$config.$field) $field
    if (!(Test-Path -LiteralPath $externalFile -PathType Leaf)) { throw "Falta el archivo externo $field. No se ha movido Caja." }
}
$backup = Get-ExternalPath ([string]$config.BackupDirectory) 'BackupDirectory'
if (!(Test-Path -LiteralPath $backup -PathType Container)) { throw 'Falta la carpeta externa de respaldos. No se ha movido Caja.' }
$oldRelease = Join-Path $app 'release.json'
$oldNode = Join-Path $app 'node.exe'
if (!(Test-Path -LiteralPath $oldRelease -PathType Leaf) -or !(Test-Path -LiteralPath $oldNode -PathType Leaf)) { throw 'No se encontro la instalacion actual de Caja.' }
function Test-ReleaseFiles([string]$Directory) {
    foreach ($entry in (Get-ReleaseEntries $Directory)) {
        if ([IO.Path]::IsPathRooted([string]$entry.file)) { throw 'Ruta invalida en la lista de archivos.' }
        $file = [IO.Path]::GetFullPath((Join-Path $Directory $entry.file))
        if (!$file.StartsWith($Directory+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archivo fuera de la version.' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Archivo incompleto: $($entry.file)" }
    }
}
$oldManifest = Get-Content -LiteralPath $oldRelease -Raw | ConvertFrom-Json
if ($oldManifest.fixtureOnly -ne $false -or $oldManifest.sourceDirty -ne $false) { throw 'La instalacion anterior no es la version verificada del cafe.' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $configKeyHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$config.SupabaseAnonKey)))).Replace('-','').ToLowerInvariant() }
finally { $sha.Dispose() }
if (([string]$config.SupabaseUrl).TrimEnd('/') -cne $oldManifest.supabaseUrl -or $configKeyHash -cne $oldManifest.publicKeySha256) { throw 'La configuracion y la instalacion anterior no corresponden al mismo negocio. No se ha movido Caja.' }
if ($oldManifest.sourceCommit -ceq $revision) {
    if ($oldManifest.fixtureOnly -ne $false -or $oldManifest.sourceDirty -ne $false) { throw 'La version instalada no es la version verificada del cafe.' }
    Test-ReleaseFiles $app
    Write-Host 'Caja Preparacion ya esta instalada. No se modifico ningun archivo.'
    return
}
if ($oldManifest.sourceCommit -cne '410ead49e40a5a9bd3dd119b8586a406e9783124') { throw 'La version instalada no es 410ead4. Revisa la carpeta antes de actualizar.' }
function Confirm-CajaClosed {
    try {
        $handle = [IO.File]::Open($oldNode,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $handle.Dispose()
    } catch { throw 'Cierra todas las ventanas de Caja y vuelve a intentar. La instalacion anterior sigue en su sitio.' }
}
Confirm-CajaClosed
$entries = Get-ReleaseEntries $source
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'SHA256.json') -Destination $stage
foreach ($entry in $entries) {
    if ([IO.Path]::IsPathRooted([string]$entry.file)) { throw 'Ruta invalida en la lista de archivos.' }
    $from = [IO.Path]::GetFullPath((Join-Path $source $entry.file))
    $to = [IO.Path]::GetFullPath((Join-Path $stage $entry.file))
    if (!$from.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase) -or
        !$to.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archivo fuera de la version.' }
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($to))
    [IO.File]::Copy($from, $to)
}
$manifest = Get-Content -LiteralPath (Join-Path $stage 'release.json') -Raw | ConvertFrom-Json
if ($manifest.sourceCommit -cne $revision -or $manifest.fixtureOnly -ne $false -or $manifest.sourceDirty -ne $false) { throw 'La carpeta no es la version de preparacion del cafe.' }
if ($manifest.supabaseUrl -cne $oldManifest.supabaseUrl -or $manifest.publicKeySha256 -cne $oldManifest.publicKeySha256) { throw 'La descarga corresponde a otra base de datos. La instalacion anterior sigue en su sitio.' }
Test-ReleaseFiles $stage
Confirm-CajaClosed
[IO.Directory]::Move($app,$previous)
try { [IO.Directory]::Move($stage,$app) }
catch { [IO.Directory]::Move($previous,$app); throw }
Write-Host 'Caja Preparacion actualizada. Abre el acceso habitual del escritorio.'
Write-Host "Version anterior conservada en $previous"
Write-Host 'La configuracion, diario de impresion y respaldos existentes se conservaron en sus rutas externas.'
