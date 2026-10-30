param([switch]$PrintTest, [switch]$Simulate, [double]$LabelWidthMm = 0, [double]$LabelHeightMm = 0,
    [ValidatePattern('^(baseline|repeat-(0[2-9]|1\d|20)|bluetooth-offline|usb-offline|paper-out|long-notes)$')][string]$TestCase = 'baseline')
$ErrorActionPreference = 'Stop'
if ($PrintTest -and $Simulate) { throw 'Elige prueba fisica o simulacion, no ambas.' }
if (-not $PrintTest -and -not $Simulate) {
    & (Join-Path $PSScriptRoot 'Inspect-CafePrinters.ps1')
    exit $LASTEXITCODE
}
$node = Join-Path $PSScriptRoot 'node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'Falta node.exe del paquete verificado.' }
if ($PrintTest) {
    $profile = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'machine-profile.json') | ConvertFrom-Json
    if ($LabelWidthMm -eq 0) { $LabelWidthMm = $profile.barista.selectedWidthMm }
    if ($LabelHeightMm -eq 0) { $LabelHeightMm = $profile.barista.selectedHeightMm }
    if ($LabelWidthMm -le 0 -or $LabelHeightMm -le 0) { throw 'Mide primero las etiquetas. Usa -LabelWidthMm y -LabelHeightMm. No se imprimio nada.' }
    & $node (Join-Path $PSScriptRoot 'physical-test.mjs') --print "--width=$LabelWidthMm" "--height=$LabelHeightMm" "--case=$TestCase"
} else {
    & $node (Join-Path $PSScriptRoot 'physical-test.mjs') --simulate "--case=$TestCase"
}
exit $LASTEXITCODE
