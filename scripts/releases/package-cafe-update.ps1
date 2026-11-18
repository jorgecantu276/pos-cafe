param(
 [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
 [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference='Stop'
$ReleaseDirectory=(Resolve-Path -LiteralPath $ReleaseDirectory).Path
if (![IO.Path]::IsPathRooted($Destination) -or (Test-Path -LiteralPath $Destination)) { throw 'Usa una carpeta nueva con ruta absoluta.' }
$manifest=Get-Content -LiteralPath (Join-Path $ReleaseDirectory 'release.json') -Raw | ConvertFrom-Json
if ($manifest.product -cne 'cafe' -or $manifest.fixtureOnly -ne $false -or $manifest.sourceDirty -ne $false -or $manifest.familySourceDirty -ne $false -or $manifest.sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'La version de Cafe debe estar limpia y verificada.' }
$checksum=(Get-FileHash -LiteralPath (Join-Path $ReleaseDirectory 'SHA256.json') -Algorithm SHA256).Hash
$template=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../windows/cafe-update-template.ps1'))
if (!$template.Contains('__RELEASE_COMMIT__') -or !$template.Contains('__FILE_MANIFEST_SHA256__')) { throw 'Plantilla de instalacion inesperada.' }
$null=New-Item -ItemType Directory -Path $Destination
Copy-Item -LiteralPath $ReleaseDirectory -Destination (Join-Path $Destination 'Caja') -Recurse
[IO.File]::WriteAllText((Join-Path $Destination 'Actualizar-Caja.ps1'),$template.Replace('__RELEASE_COMMIT__',$manifest.sourceCommit).Replace('__FILE_MANIFEST_SHA256__',$checksum))
$cmd="@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0Actualizar-Caja.ps1`"`r`nif errorlevel 1 echo La actualizacion se detuvo. Revisa el mensaje de arriba.`r`npause`r`n"
[IO.File]::WriteAllText((Join-Path $Destination 'Actualizar-Caja.cmd'),$cmd)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../docs/cafe-dashboard-install.txt') -Destination (Join-Path $Destination 'LEEME.txt')
Write-Host "Paquete de actualizacion preparado: $Destination"
