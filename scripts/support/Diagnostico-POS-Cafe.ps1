param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\CarinitoMioPOS'),
    [string]$ConfigPath = 'C:\POS-Cafe\private\pos-cafe-config.json'
)
# Diagnostico de solo lectura. No imprime, instala, reinicia ni cambia datos.
# La salida contiene versiones, estados y metadatos; nunca valores de claves.
$ErrorActionPreference = 'Stop'
$report = [ordered]@{ checkedAtUtc = [DateTime]::UtcNow.ToString('o'); scope = 'Read-only metadata. No business writes or paper.' }
$releaseFile = Join-Path $InstallDirectory 'release.json'
if (Test-Path -LiteralPath $releaseFile -PathType Leaf) {
    $release = Get-Content -LiteralPath $releaseFile -Raw | ConvertFrom-Json
    $report.release = [ordered]@{ commit=$release.sourceCommit; node=$release.node; builtAt=$release.builtAt; sourceDirty=$release.sourceDirty; fixtureOnly=$release.fixtureOnly }
} else { $report.release = @{ found=$false } }
if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $report.configuration = [ordered]@{ found=$true; printMode=$config.PrintMode; requireExistingJournal=$config.RequireExistingPrintJournal; clipEnabled=$config.ClipEnabled; serviceKeyConfigured=([bool]$config.SupabaseServiceRoleKey); stockConfirmed=$config.StickerStockConfirmed }
    if ($config.PrintDataDirectory) {
        $report.printJournalFiles = @(Get-ChildItem -LiteralPath $config.PrintDataDirectory -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'windows-jobs.sqlite*' } | ForEach-Object { @{ name=$_.Name; bytes=$_.Length; modifiedUtc=$_.LastWriteTimeUtc.ToString('o') } })
    }
    $backupDir = [string]$config.BackupDirectory
    if (!$backupDir) { $backupDir = Join-Path (Split-Path -Parent $ConfigPath) 'pos-cafe-backups' }
    $statusFile = Join-Path $backupDir 'status.json'
    if (Test-Path -LiteralPath $statusFile -PathType Leaf) {
        $backup = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
        $report.backup = [ordered]@{ lastAttemptAt=$backup.lastAttemptAt; lastSuccessAt=$backup.lastSuccess.createdAt; bytes=$backup.lastSuccess.bytes; sha256=$backup.lastSuccess.sha256; errorPresent=([bool]$backup.lastError) }
    } else { $report.backup = @{ statusFound=$false } }
    $report.backupFiles = @(Get-ChildItem -LiteralPath $backupDir -Filter '*.posbackup' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 3 | ForEach-Object { @{ bytes=$_.Length; modifiedUtc=$_.LastWriteTimeUtc.ToString('o') } })
    $report.logs = @('.server.log','.server-error.log') | ForEach-Object { $f=Get-Item -LiteralPath ($ConfigPath+$_) -ErrorAction SilentlyContinue; if($f){ @{ kind=$_; bytes=$f.Length; modifiedUtc=$f.LastWriteTimeUtc.ToString('o') } } }
} else { $report.configuration = @{ found=$false } }
try {
    $report.printers = @(Get-Printer | Where-Object { $_.Name -in @('POS80 Printer','Y813BT Sticker') } | ForEach-Object {
        $printer=$_
        $jobs=@(Get-PrintJob -PrinterName $printer.Name -ErrorAction SilentlyContinue)
        @{ name=$printer.Name; driver=$printer.DriverName; port=$printer.PortName; status=[string]$printer.PrinterStatus; pendingJobs=$jobs.Count; jobStatuses=@($jobs | ForEach-Object { [string]$_.JobStatus }) }
    })
} catch { $report.printers = @{ readable=$false } }
try { $report.disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ drive=$_.DeviceID; freeBytes=$_.FreeSpace; totalBytes=$_.Size } }) } catch { $report.disks=@{ readable=$false } }
$report | ConvertTo-Json -Depth 7
