param(
    [ValidateSet('Inspect','Plan','Apply','Rollback')][string]$Mode='Inspect',
    [string]$InstallDirectory=(Join-Path $env:LOCALAPPDATA 'Programs\CarinitoMioPOS'),
    [string]$ConfigPath='C:\POS-Cafe\private\pos-cafe-config.json',
    [string]$PlanFile
)
$ErrorActionPreference='Stop'
$installation=(Resolve-Path -LiteralPath $InstallDirectory).Path
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$release=Get-Content -LiteralPath (Join-Path $installation 'release.json') -Raw | ConvertFrom-Json
$sha=[Security.Cryptography.SHA256]::Create()
try { $keyHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$config.SupabaseAnonKey)))).Replace('-','').ToLowerInvariant() }
finally { $sha.Dispose() }
if ($release.fixtureOnly -ne $false -or $release.sourceDirty -ne $false -or $release.sourceCommit -notmatch '^[a-f0-9]{40}$' -or
    ([string]$config.SupabaseUrl).TrimEnd('/') -cne $release.supabaseUrl -or $keyHash -cne $release.publicKeySha256) {
    throw 'La instalacion y la configuracion no corresponden al mismo negocio verificado.'
}
$supported=@($release.catalogRules) -ccontains 'brownie-syrup-v1'
$entries=Get-Content -LiteralPath (Join-Path $installation 'SHA256.json') -Raw | ConvertFrom-Json
foreach ($entry in $entries) {
    if ([IO.Path]::IsPathRooted([string]$entry.file)) { throw 'Ruta invalida en la lista de archivos.' }
    $file=[IO.Path]::GetFullPath((Join-Path $installation $entry.file))
    if (!$file.StartsWith($installation.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archivo fuera de la instalacion.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $entry.sha256) { throw "Archivo instalado incompleto: $($entry.file)" }
}
$manifestEntry=@($entries | Where-Object { $_.file -ceq 'release.json' })
if ($manifestEntry.Count -ne 1) { throw 'Falta el manifiesto en la lista de archivos instalada.' }
if ($Mode -eq 'Inspect') {
    [ordered]@{ product='cafe'; source=$release.sourceCommit; version=$release.appVersion; syrupRuleSupported=$supported;
        inspectedAt=[DateTime]::UtcNow.ToString('o'); configurationMatches=$true; indexedFilesVerified=@($entries).Count } | ConvertTo-Json
    return
}
if (!$supported) { throw 'Esta Caja aun no admite un solo jarabe obligatorio. Instala primero el paquete aceptado; este script no instala programas ni migraciones.' }
$privateDirectory=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PosFamilyOps\cafe-menu')).TrimEnd('\')
if (!$PlanFile) {
    if ($Mode -ne 'Plan') { throw 'Usa el mismo PlanFile privado creado antes del ajuste.' }
    $null=New-Item -ItemType Directory -Path $privateDirectory -Force
    $PlanFile=Join-Path $privateDirectory ('brownie-'+[guid]::NewGuid().ToString('N')+'.json')
}
if (![IO.Path]::IsPathRooted($PlanFile)) { throw 'PlanFile requiere una ruta absoluta privada.' }
$PlanFile=[IO.Path]::GetFullPath($PlanFile)
if (![IO.Path]::GetDirectoryName($PlanFile).Equals($privateDirectory,[StringComparison]::OrdinalIgnoreCase)) { throw 'El plan debe quedar en PosFamilyOps\cafe-menu, fuera de los programas y repositorios.' }
$parent=Get-Item -LiteralPath $privateDirectory
while ($parent) {
    if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'El plan privado no puede usar vinculos de carpetas.' }
    $parent=$parent.Parent
}
if (!$env:POS_CATALOG_DATABASE_URL) {
    $secure=Read-Host 'Conexion PostgreSQL privada de este proyecto (no se guardara)' -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:POS_CATALOG_DATABASE_URL=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
try {
    & (Join-Path $installation 'node.exe') (Join-Path $PSScriptRoot 'brownie-syrup-cli.mjs') $Mode $installation ([string]$config.SupabaseUrl) $PlanFile
    if ($LASTEXITCODE -ne 0) { throw 'El ajuste no se confirmo. Conserva el plan privado.' }
    Write-Host "Plan privado: $PlanFile"
} finally { Remove-Item Env:POS_CATALOG_DATABASE_URL -ErrorAction SilentlyContinue }
