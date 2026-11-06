param([Parameter(Mandatory=$true)][string]$ExistingKitRoot, [switch]$PrintTest)
$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'Falta node.exe en el paquete.' }
if ($PrintTest) {
    & $node (Join-Path $PSScriptRoot 'receipt-test.mjs') "--existing-root=$ExistingKitRoot" --print
} else {
    # Receipt-only inspection. No Bluetooth query, default change or print.
    Add-Type -AssemblyName System.Drawing
    $printer = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -ceq 'POS80 Printer' })
    if ($printer.Count -ne 1 -or $printer[0].DriverName -ine 'POS80' -or $printer[0].PortName.TrimEnd(':') -ine 'CP001') {
        throw 'No coincide la impresora esperada: POS80 Printer / POS80 / CP001. Revisa antes de imprimir.'
    }
    $settings = [System.Drawing.Printing.PrinterSettings]::new()
    $settings.PrinterName = 'POS80 Printer'
    $forms = @($settings.PaperSizes | Where-Object { [math]::Abs($_.Width*0.254-72) -le 1.5 -and [math]::Abs($_.Height*0.254-210) -le 1.5 })
    if ($forms.Count -eq 0) { throw 'Falta el formato de ticket de 72 x 210 mm.' }
    $printer | Select-Object Name,DriverName,PortName,WorkOffline,PrinterStatus,DetectedErrorState | Format-List
    & $node (Join-Path $PSScriptRoot 'receipt-test.mjs') "--existing-root=$ExistingKitRoot" --preview
}
exit $LASTEXITCODE
