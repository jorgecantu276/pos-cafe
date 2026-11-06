param([Parameter(Mandatory=$true)][string]$ExistingKitRoot,[switch]$PrintTest)
$ErrorActionPreference = 'Stop'
$results = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Path $results -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
Start-Transcript -Path (Join-Path $results "console-$stamp.txt") | Out-Null
try {
    Add-Type -AssemblyName System.Drawing
    $expected = @(
        @{Queue='POS80 Printer';Driver='POS80';Port='CP001';Width=72;Height=210},
        @{Queue='Y813BT Sticker';Driver='Y813BT Label';Port='COM3';Width=57.15;Height=31.75}
    )
    $rows = @()
    foreach ($target in $expected) {
        $printer = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -ceq $target.Queue })
        if ($printer.Count -ne 1 -or $printer[0].DriverName -ine $target.Driver -or $printer[0].PortName.TrimEnd(':') -ine $target.Port) { throw "No coincide impresora/controlador/puerto: $($target.Queue)" }
        if ($printer[0].WorkOffline -or $printer[0].PrinterStatus -in @(6,7,8,9,11,16) -or $printer[0].DetectedErrorState -in @(4,6,7,8,9,10,11)) { throw "Windows indica una falla en $($target.Queue). No se imprimio." }
        $settings = [System.Drawing.Printing.PrinterSettings]::new(); $settings.PrinterName = $target.Queue
        $forms = @($settings.PaperSizes | Where-Object { [math]::Abs($_.Width*0.254-$target.Width) -le 1.5 -and [math]::Abs($_.Height*0.254-$target.Height) -le 1.5 })
        if ($forms.Count -eq 0) { throw "Falta el formato de papel esperado en $($target.Queue)" }
        $jobs = @(Get-PrintJob -PrinterName $target.Queue)
        $rows += @{Queue=$target.Queue;Driver=$printer[0].DriverName;Port=$printer[0].PortName;JobCount=$jobs.Count;Jobs=@($jobs | Select-Object ID,DocumentName,JobStatus,TotalPages,PagesPrinted)}
        if ($jobs.Count -gt 0) { throw "Hay trabajos pendientes en $($target.Queue). Revisa la cola antes de continuar; no canceles ni reenvies." }
    }
    $rows | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $results "queues-before-$stamp.json") -Encoding UTF8
    $node = Join-Path $PSScriptRoot 'node.exe'
    $runner = Join-Path $PSScriptRoot 'dual-test.mjs'
    if ($PrintTest) { & $node $runner "--existing-root=$ExistingKitRoot" --print }
    else { & $node $runner "--existing-root=$ExistingKitRoot" --preview }
    $testExit = $LASTEXITCODE
    $after = @()
    foreach ($target in $expected) { $after += @{Queue=$target.Queue;Jobs=@(Get-PrintJob -PrinterName $target.Queue | Select-Object ID,DocumentName,JobStatus,TotalPages,PagesPrinted)} }
    $after | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $results "queues-after-$stamp.json") -Encoding UTF8
} finally { Stop-Transcript | Out-Null }
exit $testExit
