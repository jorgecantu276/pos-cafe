$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$profile = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'machine-profile.json') | ConvertFrom-Json
$rows = @()
foreach ($purpose in @('customer','barista')) {
    $expected = $profile.$purpose
    $printer = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -ceq $expected.queue })
    $forms = @(); $driverInfo = $null; $driverFileVersion = $null
    if ($printer.Count -eq 1) {
        $settings = [System.Drawing.Printing.PrinterSettings]::new()
        $settings.PrinterName = $expected.queue
        $forms = @($settings.PaperSizes | ForEach-Object { @{ name=$_.PaperName; widthMm=[math]::Round($_.Width*0.254,2); heightMm=[math]::Round($_.Height*0.254,2) } })
        try {
            $driverInfo = Get-PrinterDriver -Name $printer[0].DriverName
            if ($driverInfo.DriverPath -and (Test-Path -LiteralPath $driverInfo.DriverPath)) {
                $driverFileVersion = (Get-Item -LiteralPath $driverInfo.DriverPath).VersionInfo.FileVersion
            }
        } catch { $driverInfo = $null }
    }
    $rows += @{
        purpose=$purpose; expectedQueue=$expected.queue; found=($printer.Count -eq 1)
        driver=if($printer.Count){$printer[0].DriverName}else{$null}
        port=if($printer.Count){$printer[0].PortName}else{$null}
        driverFileVersion=$driverFileVersion; expectedDriverVersionObserved=$expected.driverVersionObserved
        matchesProfile=($printer.Count -eq 1 -and $printer[0].DriverName -ieq $expected.driver -and $printer[0].PortName.TrimEnd(':') -ieq $expected.port.TrimEnd(':'))
        workOffline=if($printer.Count){$printer[0].WorkOffline}else{$null}
        queueStatus=if($printer.Count){$printer[0].PrinterStatus}else{$null}
        advertisedForms=$forms
    }
}
$usb = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_4B43.PID_3830' })
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$report = @{
    capturedAtUtc=[DateTime]::UtcNow.ToString('o'); scope='Consulta del equipo y las impresoras.'
    windows=@{caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; architecture=$os.OSArchitecture}
    hardware=@{cpu=$cpu.Name; physicalCores=$cpu.NumberOfCores; logicalProcessors=$cpu.NumberOfLogicalProcessors; ramGB=[math]::Round($computer.TotalPhysicalMemory/1GB,2)}
    interactiveDesktop=[Environment]::UserInteractive
    usb=@{vid='4B43';pid='3830';matchingInterfaces=$usb.Count;anyReportsOK=(@($usb | Where-Object Status -eq 'OK').Count -gt 0)}
    printers=$rows
    bluetooth=@{expectedDevice='Y813BT-E08D';expectedPort='COM3:';note='Enciende la impresora y comprueba la conexion Bluetooth; una cola vacia no confirma la conexion.'}
    loadedLabels=@{physicallyVerified=$false;selectedWidthMm=$profile.barista.selectedWidthMm;selectedHeightMm=$profile.barista.selectedHeightMm;instruction='Confirma que esta cargado el rollo Hybsk de 57.15 x 31.75 mm.'}
}
$directory = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$destination = Join-Path $directory 'hardware-report.json'
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $destination -Encoding UTF8
$rows | Select-Object @{Name='Queue';Expression={$_.expectedQueue}},@{Name='Found';Expression={$_.found}},@{Name='Driver';Expression={$_.driver}},@{Name='Port';Expression={$_.port}},@{Name='Matches';Expression={$_.matchesProfile}} | Format-Table -AutoSize
Write-Host "Reporte de consulta: $destination"
Write-Host 'Consulta terminada sin imprimir. Confirma el rollo Hybsk de 57.15 x 31.75 mm antes de la prueba.'
exit 0
