param([Parameter(Mandatory=$true)][string]$SettingsPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'SupportCore.psm1') -Force
try {
    $settings=Get-Content -LiteralPath $SettingsPath -Raw|ConvertFrom-Json
    Invoke-PosSupportCycle -Settings $settings -AgentDirectory $PSScriptRoot | ConvertTo-Json -Depth 5
} catch {
    Write-Output 'No se confirmo el informe automatico. La proxima ejecucion conserva y vuelve a comprobar el estado.'
    exit 1
}
