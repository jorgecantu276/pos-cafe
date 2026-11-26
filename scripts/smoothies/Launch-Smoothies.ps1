[CmdletBinding()]
param([switch]$Background, [switch]$Stop, [switch]$Support)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$url = 'http://127.0.0.1:3180'
$healthUrl = $url
$settings = Join-Path $root 'caja.env'
$logs = Join-Path $root 'diagnostico'
[void](New-Item -ItemType Directory -Path $logs -Force)
$launcherLog = Join-Path $logs 'inicio.log'

function Read-Instance {
    try { Invoke-RestMethod -Uri "$healthUrl/api/local-instance" -TimeoutSec 2 }
    catch { $null }
}

function Write-LaunchLog([string]$Message) {
    if ((Test-Path -LiteralPath $launcherLog) -and (Get-Item -LiteralPath $launcherLog).Length -gt 1MB) {
        Move-Item -LiteralPath $launcherLog -Destination (Join-Path $logs 'inicio.anterior.log') -Force
    }
    Add-Content -LiteralPath $launcherLog -Value ('{0:s} {1}' -f (Get-Date), $Message) -Encoding UTF8
}

try {
    $active = Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw | ConvertFrom-Json
    if ($active.version -ne 1 -or $active.id -notmatch '^[a-f0-9]{16}$') { throw 'Falta la version activa del POS.' }
    $release = Join-Path (Join-Path $root 'versiones') $active.id
    $node = Join-Path $release 'node.exe'
    $app = Join-Path $release 'app'
    $launcher = Join-Path $app 'scripts\smoothies\start-local.mjs'
    $publicOrigin = & $node "--env-file=$settings" -p 'process.env.SMOOTHIES_LAN_ORIGIN || String()'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la configuración de red.' }
    if ($publicOrigin) { $url = $publicOrigin }
    if ($Support) {
        $instance = Read-Instance
        $online = $instance -and $instance.packageId -eq $active.id
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))
        $backupDir = & $node "--env-file=$settings" -p 'process.env.SMOOTHIES_BACKUP_DIR || String()'
        $keyFile = & $node "--env-file=$settings" -p 'process.env.SMOOTHIES_BACKUP_KEY_FILE || String()'
        $status = if ($backupDir) {
            Get-Content -LiteralPath (Join-Path $backupDir 'status.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
        }
        $lastSuccess = if ($status.lastSuccess) { [DateTimeOffset]::Parse($status.lastSuccess.createdAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm') } else { 'Pendiente' }
        $key = if ($keyFile -and (Test-Path -LiteralPath $keyFile -PathType Leaf)) { 'presente' } else { 'pendiente' }
        $report = @(
            'POS Smoothies'
            $(if ($active.appVersion) { "Version $($active.appVersion) ($($active.id))" } else { "Version $($active.id)" })
            ('Estado: ' + $(if ($online) { 'Servidor abierto' } else { 'Servidor detenido o iniciando' }))
            ('Espacio libre: {0:N1} GB' -f ($drive.AvailableFreeSpace / 1GB))
            "Ultimo respaldo local: $lastSuccess"
            "Clave de recuperacion local: $key"
            "Acceso de caja: $url"
            $(if ($status.lastError) { 'El ultimo intento de respaldo requiere revision.' })
            ''
            "Registros: $logs"
        )
        $reportPath = Join-Path $logs 'resumen.txt'
        $report | Set-Content -LiteralPath $reportPath -Encoding UTF8
        Start-Process -FilePath 'notepad.exe' -ArgumentList ('"{0}"' -f $reportPath)
        return
    }
    if ($Stop) {
        $privateSettings = if ($active.settingsPath) { $active.settingsPath } else { Join-Path $root 'instalacion.env' }
        & $node "--env-file=$privateSettings" (Join-Path $app 'scripts\smoothies\stop-local.mjs') $active.id $root
        if ($LASTEXITCODE -ne 0) { throw 'Confirma que el turno este cerrado y vuelve a intentar. Consulta el registro de soporte si el problema continua.' }
        return
    }
    $identifier = [Security.Cryptography.SHA256]::Create()
    try { $mutexId = [BitConverter]::ToString($identifier.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))) }
    finally { $identifier.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\POS-Smoothies-' + $mutexId))
    $held = $false
    try {
        try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
        if (-not $held -and $Background) { return }
        $instance = Read-Instance
        if ($instance -and $instance.packageId -ne $active.id) { throw 'El puerto esta ocupado por otra aplicacion.' }
        if ($held -and -not $instance) {
            Remove-Item -LiteralPath (Join-Path $root 'actualizaciones\stop-requested') -Force -ErrorAction SilentlyContinue
            $env:SMOOTHIES_PACKAGE_ID = $active.id
            $env:SMOOTHIES_DATA_HOME = $root
            $stdout = Join-Path $logs 'servidor.log'
            $stderr = Join-Path $logs 'servidor-error.log'
            foreach ($file in @($stdout,$stderr)) {
                if (Test-Path -LiteralPath $file -PathType Leaf) { Move-Item -LiteralPath $file -Destination "$file.anterior" -Force }
            }
            $processOptions = @{
                FilePath = $node; ArgumentList = ('"--env-file={0}" "--env-file={1}" "{2}" "{3}"' -f
                    $(if ($active.settingsPath) { $active.settingsPath } else { Join-Path $root 'instalacion.env' }),
                    $settings, (Join-Path $app 'scripts\smoothies\auto-update.mjs'), $root)
                WorkingDirectory = $app; RedirectStandardOutput = $stdout; RedirectStandardError = $stderr
                WindowStyle = 'Hidden'; PassThru = $true
            }
            $child = Start-Process @processOptions
            # PowerShell 5.1 loses ExitCode for a redirected process unless its handle is retained before it exits.
            $null = $child.Handle
        }
        $until = [DateTime]::UtcNow.AddSeconds(280)
        while ((-not $instance -or $instance.packageId -ne $active.id) -and [DateTime]::UtcNow -lt $until -and (-not $child -or -not $child.HasExited)) {
            Start-Sleep -Milliseconds 500
            $active = Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw | ConvertFrom-Json
            $instance = Read-Instance
        }
        if (-not $instance -or $instance.packageId -ne $active.id) { throw "POS Smoothies no pudo abrir. Consulta el registro en $logs." }
        if (-not $Background) { Start-Process $url }
        if ($child) {
            $child.WaitForExit()
            if ($child.ExitCode -ne 0) { throw "El servidor se detuvo. Reabre POS Smoothies. Registro en $logs." }
        }
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
} catch {
    Write-LaunchLog $_.Exception.Message
    if (-not $Background) {
        Add-Type -AssemblyName System.Windows.Forms
        [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'POS Smoothies',
            [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Warning)
    }
    exit 1
}
