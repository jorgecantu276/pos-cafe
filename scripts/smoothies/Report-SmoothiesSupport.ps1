[CmdletBinding()]
param([string]$Root=$PSScriptRoot,[switch]$Force,[switch]$BindingOnly)
$ErrorActionPreference='Stop'
try {
    $Root=[IO.Path]::GetFullPath($Root)
    $release=Get-Content -LiteralPath (Join-Path $Root 'release.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($release.product -cne 'smoothies' -or $release.id -cnotmatch '^[a-f0-9]{16}$'){throw 'invalid_release'}
    $module=Join-Path $Root ('versiones\'+$release.id+'\app\scripts\smoothies\SmoothiesSupport.psm1')
    Import-Module $module -Force -DisableNameChecking
    if($BindingOnly){$binding=Get-SmoothiesSupportBinding $Root;@{machineSha256=$binding.machineSha256;backendIdentitySha256=$binding.backendIdentitySha256;packageId=$binding.packageId}|ConvertTo-Json;return}
    Invoke-SmoothiesSupportCycle -Root $Root -Force:$Force|ConvertTo-Json -Depth 5
} catch { Write-Output 'No se confirmo el informe. Conserva la configuracion y el informe pendiente para revision.';exit 1 }
