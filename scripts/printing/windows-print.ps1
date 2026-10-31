param([switch]$LayoutOnly)
function Test-CafePrinterReady([object]$Printer) {
    # Win32_Printer.PrinterState is an obsolete ENUM, not the Winspool bitmask.
    # Its Printing=11 / Busy=10 values must not reject a healthy queued order.
    # Use the supported status and detected-error properties instead.
    return ($null -ne $Printer -and -not $Printer.WorkOffline -and
        $Printer.PrinterStatus -notin @(6,7,8,9,11,16) -and
        $Printer.DetectedErrorState -notin @(4,6,7,8,9,10,11))
}
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -Path (Join-Path $PSScriptRoot 'DesktopPrinter.cs') -ReferencedAssemblies System.Drawing
    $printInput = [Console]::ReadLine() | ConvertFrom-Json
    if ($printInput.receiptBranding) {
        if ($printInput.receiptBranding.version -ne 1) { throw 'Unsupported receipt branding version' }
        $logoPath = Join-Path $PSScriptRoot '..\..\public\receipt-branding\carinito-logo-v1.jpg'
        [CafeDesktopPrinter]::ConfigureBranding($logoPath, [string[]]$printInput.receiptBranding.qrRows)
    }
    [string[][]]$sections = @($printInput.sections | ForEach-Object { ,([string[]]$_) })
    [string[][]]$styles = $null
    if ($printInput.styles) { $styles = @($printInput.styles | ForEach-Object { ,([string[]]$_) }) }
    if ($LayoutOnly) {
        # No printer discovery, device context, or spooler call on this path.
        $pages = [CafeDesktopPrinter]::Preview($printInput.title, $sections, [float]$printInput.fontPoints, [float]$printInput.widthMm, [float]$printInput.heightMm, $styles, $printInput.previewDirectory, [bool]$printInput.verticalLabel)
        $preview = @($pages | ForEach-Object { @{ lines = @($_ | ForEach-Object { [string]$_ }) } })
        [Console]::WriteLine((ConvertTo-Json -InputObject $preview -Depth 10 -Compress))
        exit 0
    }
    $printer = @(Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -ceq $printInput.queue })
    if ($printer.Count -ne 1 -or -not (Test-CafePrinterReady $printer[0])) {
        throw 'Printer missing, offline, paused or in error'
    }
    if ($printer[0].DriverName -ine $printInput.identity.driver -or $printer[0].PortName.TrimEnd(':') -ine $printInput.identity.port.TrimEnd(':')) {
        throw 'Installed queue does not match the cafe driver/port profile'
    }
    [CafeDesktopPrinter]::Prepare($printInput.queue, $printInput.title, $sections, [float]$printInput.fontPoints,
        [float]$printInput.stock.widthMm, [float]$printInput.stock.heightMm, $styles, $printInput.layoutTitle, [bool]$printInput.verticalLabel)
    [Console]::WriteLine('{"state":"ready"}')
    # The parent has durably committed 'submitting' before granting permission.
    if ([Console]::ReadLine() -cne 'PRINT') { throw 'No dispatch permission' }
    [CafeDesktopPrinter]::Send()
    [Console]::WriteLine('{"state":"submitted"}')
} catch {
    [Console]::WriteLine('{"state":"error"}')
    exit 1
} finally {
    [CafeDesktopPrinter]::Dispose()
}
