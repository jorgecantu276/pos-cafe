[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'POS Smoothies'),
    [string]$SettingsPath,
    [string]$SiteFile,
    [string]$BackupExportDirectory,
    [string]$LanAddress,
    [ValidateRange(1024,65535)][int]$LanPort = 3443,
    [switch]$RenewLanCertificate,
    [switch]$NoShortcuts,
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $OutputEncoding
$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$package = Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw | ConvertFrom-Json
if ($package.version -ne 1 -or $package.id -notmatch '^[a-f0-9]{16}$') { throw 'El paquete esta incompleto.' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
if (-not $SettingsPath) { $SettingsPath = Join-Path $DataDirectory 'instalacion.env' }
$SettingsPath = [IO.Path]::GetFullPath($SettingsPath)
if ($SiteFile) {
    if ($PSBoundParameters.ContainsKey('LanAddress') -or $PSBoundParameters.ContainsKey('LanPort') -or $PSBoundParameters.ContainsKey('BackupExportDirectory')) {
        throw 'Usa la ficha del sitio o los parametros directos, sin mezclar configuraciones.'
    }
    $SiteFile = [IO.Path]::GetFullPath($SiteFile)
    $siteJson = & (Join-Path $source 'node.exe') (Join-Path $source 'app\scripts\smoothies\site-plan.mjs') install $SiteFile
    if ($LASTEXITCODE -ne 0) { throw 'Completa la IP real en la ficha privada del sitio.' }
    $site = $siteJson | ConvertFrom-Json
    $LanAddress = $site.lanAddress
    $LanPort = $site.lanPort
    $BackupExportDirectory = $site.backupExportDirectory
}
if ($BackupExportDirectory) { $env:SMOOTHIES_BACKUP_EXPORT_DIR = $BackupExportDirectory }
$docker = Get-Command docker.exe -ErrorAction SilentlyContinue
if (-not $docker) { throw 'Instala Docker Desktop con el motor Linux (WSL 2). Abre Docker una vez y vuelve a ejecutar este instalador.' }

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Message) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw $Message }
}

[void](New-Item -ItemType Directory -Path $DataDirectory -Force)
$lockPath = Join-Path $DataDirectory 'instalacion.lock'
try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw 'Ya hay otra instalacion abierta.' }
$launchLock = $null
try {
    $identifier = [Security.Cryptography.SHA256]::Create()
    try { $mutexId = [BitConverter]::ToString($identifier.ComputeHash([Text.Encoding]::UTF8.GetBytes($DataDirectory.ToLowerInvariant()))) }
    finally { $identifier.Dispose() }
    $launchLock = New-Object Threading.Mutex($false, ('Local\POS-Smoothies-' + $mutexId))
    try { $launchHeld = $launchLock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $launchHeld = $true }
    if (-not $launchHeld) {
        $runningState = Get-Content -LiteralPath (Join-Path $DataDirectory 'release.json') -Raw | ConvertFrom-Json
        $runningInstance = Invoke-RestMethod -Uri 'http://127.0.0.1:3180/api/local-instance' -TimeoutSec 2
        if ($runningState.id -eq $package.id -and $runningInstance.packageId -eq $package.id) {
            if ($SiteFile -or $LanAddress -or $BackupExportDirectory -or $RenewLanCertificate) { throw 'Deten POS Smoothies antes de cambiar la configuracion del sitio.' }
            Write-Host 'Esta version ya esta instalada y abierta. Cierra POS Smoothies para reparar accesos.'
            return
        }
        throw 'Cierra POS Smoothies antes de instalar una version.'
    }
    $statePath = Join-Path $DataDirectory 'release.json'
    $previous = if (Test-Path -LiteralPath $statePath -PathType Leaf) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
    $releaseRoot = Join-Path (Join-Path $DataDirectory 'versiones') $package.id
    $repair = $previous -and $previous.id -eq $package.id
    if ($previous -and $previous.databaseContract -ne $package.databaseContract) {
        throw 'Esta actualizacion cambia la base. Pide a soporte que haga un respaldo y aplique el cambio.'
    }
    if (-not $repair -and (Get-NetTCPConnection -State Listen -LocalPort 3180 -ErrorAction SilentlyContinue)) {
        throw 'Cierra la caja mediante Herramientas de soporte antes de instalar una version.'
    }
    if (Test-Path -LiteralPath $releaseRoot) {
        $installedBuild = [IO.File]::ReadAllText((Join-Path $releaseRoot 'app\.next\BUILD_ID')).Trim()
        if ($installedBuild -ne $package.build) { throw 'Hay una copia incompleta de esta version. Contacta a soporte.' }
    } else {
        $staging = Join-Path $DataDirectory ('preparar-' + [guid]::NewGuid())
        [void](New-Item -ItemType Directory -Path $staging)
        foreach ($entry in @('app','node.exe','Node-LICENSE.txt','Guia PC e iPad.md','smoothies-lan.md','smoothies-site.example.json','smoothies-reporting.example.json','release.json','SHA256.json',
            'update-policy.json','update-public-key.pem','Instalar POS Smoothies.cmd')) {
            Copy-Item -LiteralPath (Join-Path $source $entry) -Destination $staging -Recurse
        }
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $releaseRoot) -Force)
        Move-Item -LiteralPath $staging -Destination $releaseRoot
    }
    $node = Join-Path $releaseRoot 'node.exe'
    $app = Join-Path $releaseRoot 'app'
    $env:SMOOTHIES_DATA_HOME = $DataDirectory
    $env:SMOOTHIES_PORTABLE = '1'
    if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
        Invoke-Checked $node @((Join-Path $app 'scripts\smoothies\provision-supabase.mjs'), $SettingsPath) 'No se pudo preparar la configuracion local.'
    }
    $startupSettings = Join-Path $DataDirectory 'caja.env'
    # Retained LAN configuration survives repairs and compatible packages. The
    # primary installation file remains authoritative for backend/key changes.
    $envArgs = @("--env-file-if-exists=$startupSettings", "--env-file=$SettingsPath")
    if ($RenewLanCertificate -and -not $LanAddress) { throw 'Indica la IP privada de esta PC para renovar HTTPS.' }
    if ($LanAddress) {
        $lanArgs = @((Join-Path $app 'scripts\smoothies\provision-lan.mjs'), "https://${LanAddress}:$LanPort", (Join-Path $DataDirectory 'https'))
        if ($RenewLanCertificate) { $lanArgs += '--renew' }
        $lanJson = & $node @lanArgs
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar HTTPS para la IP de esta PC.' }
        $lan = $lanJson | ConvertFrom-Json
        $env:SMOOTHIES_LAN_ORIGIN = $lan.origin
        $env:SMOOTHIES_LAN_CERT_FILE = $lan.certFile
        $env:SMOOTHIES_LAN_KEY_FILE = $lan.keyFile
        Write-Host "Acceso de PC/iPad: $($lan.origin)"
        Write-Host "Acepta manualmente la autoridad en ambos equipos: $($lan.publicCertificate)"
        Write-Host "Huella de la autoridad: $($lan.fingerprint)"
    }
    Invoke-Checked $node ($envArgs + @((Join-Path $app 'scripts\smoothies\install-local.mjs'), 'check')) 'Revisa la configuracion de la instalacion.'
    $composeFile = & $node @envArgs -p 'process.env.SMOOTHIES_COMPOSE_FILE'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la configuracion local.' }
    $managed = & $node @envArgs -p 'process.env.SMOOTHIES_MANAGED_SUPABASE'
    & $docker.Source info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked $docker.Source @('desktop','start','--timeout','90') 'Abre Docker Desktop, termina su configuracion y vuelve a ejecutar el instalador.'
    }
    if ($managed -eq '1') {
        $instance = & $node @envArgs -p 'process.env.SMOOTHIES_SUPABASE_INSTANCE'
        if ($instance -notmatch '^[a-f0-9-]{36}$') { throw 'Falta la identidad de la base local.' }
        $projectFilter = 'label=com.docker.compose.project=pos-smoothies'
        $projectContainers = @(& $docker.Source ps -aq --filter $projectFilter)
        if ($LASTEXITCODE -ne 0) { throw 'Docker no pudo comprobar la base.' }
        $ours = @(& $docker.Source ps -aq --filter $projectFilter --filter "label=mx.pos-smoothies.instance=$instance")
        if ($LASTEXITCODE -ne 0 -or $projectContainers.Count -ne $ours.Count) {
            throw 'Ya existe otra base de POS Smoothies. Contacta a soporte para conservar sus datos.'
        }
        $volumes = @(& $docker.Source volume ls -q --filter $projectFilter)
        if ($LASTEXITCODE -ne 0) { throw 'Docker no pudo comprobar sus discos.' }
        $ourVolumes = @(& $docker.Source volume ls -q --filter $projectFilter --filter "label=mx.pos-smoothies.instance=$instance")
        if ($LASTEXITCODE -ne 0 -or $volumes.Count -ne $ourVolumes.Count) {
            throw 'Ya existen discos de otra base de POS Smoothies. Contacta a soporte para conservar sus datos.'
        }
    }
    $composeArgs = @('compose','--project-name','pos-smoothies','-f',$composeFile)
    $resolvedCompose = & $docker.Source @composeArgs config --format json
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo validar el archivo Compose.' }
    $compose = ($resolvedCompose -join [Environment]::NewLine) | ConvertFrom-Json
    if ($managed -eq '1') {
        Import-Module (Join-Path $app 'scripts\smoothies\BackendOwnership.psm1') -Force -DisableNameChecking
        $allVolumeNames = @(& $docker.Source volume ls --format '{{.Name}}')
        if ($LASTEXITCODE -ne 0) { throw 'Docker no pudo comprobar los nombres de sus discos.' }
        Assert-SmoothiesManagedVolumes -Compose $compose -Instance $instance -ExistingNames $allVolumeNames -Inspect {
            param($name)
            $raw = & $docker.Source volume inspect $name
            if ($LASTEXITCODE -ne 0) { throw 'Docker no pudo verificar la identidad del disco existente.' }
            $details = @(($raw -join [Environment]::NewLine) | ConvertFrom-Json)
            if ($details.Count -ne 1) { throw 'Identidad de disco no disponible.' }
            return $details[0]
        }
    }
    $services = $compose.services.PSObject.Properties.Value
    $ports = @($services | ForEach-Object { $_.ports } | Where-Object { $_ })
    if ($ports.Count -lt 2 -or @($ports | Where-Object { $_.host_ip -ne '127.0.0.1' }).Count -gt 0 -or
        '58000' -notin $ports.published -or '55432' -notin $ports.published -or
        @($services | Where-Object { $_.network_mode -eq 'host' }).Count -gt 0) {
        throw 'El POS requiere que la API y PostgreSQL escuchen solo en la PC de caja.'
    }
    if ($previous -or ($managed -eq '1' -and $projectContainers.Count -eq $services.Count)) {
        Invoke-Checked $docker.Source ($composeArgs + @('start','--wait','--wait-timeout','180')) 'No se pudo reanudar la base instalada.'
    } else {
        Write-Host 'Preparando la base local. La primera vez Docker puede descargar componentes.'
        $firstStart = $composeArgs + @('up','-d','--wait','--wait-timeout','180')
        if ($Offline) { $firstStart += @('--pull','never') }
        Invoke-Checked $docker.Source $firstStart 'No se pudo preparar la base.'
    }
    $prepare = Join-Path $app 'scripts\smoothies\prepare-local.mjs'
    $needAdmin = & $node @envArgs $prepare --needs-admin
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la base local.' }
    $passwordInSettings = & $node @envArgs -p 'Boolean(process.env.SMOOTHIES_ADMIN_PASSWORD)'
    if ($needAdmin -eq 'yes' -and $passwordInSettings -ne 'true') {
        $password = Read-Host 'Crea la contrasena de admin (12 caracteres o mas)' -AsSecureString
        $secret = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
        try {
            $env:SMOOTHIES_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secret)
            if ($env:SMOOTHIES_ADMIN_PASSWORD.Length -lt 12) { throw 'La contrasena debe tener al menos 12 caracteres. Ejecuta de nuevo el instalador.' }
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secret) }
    }
    try { Invoke-Checked $node ($envArgs + @($prepare)) 'No se pudo preparar el POS. Si el intento ya creo tu cuenta, usa la misma contrasena.' }
    finally { Remove-Item Env:SMOOTHIES_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
    Invoke-Checked $node ($envArgs + @((Join-Path $app 'scripts\smoothies\install-local.mjs'), 'write', $startupSettings)) 'No se pudo guardar la configuracion de arranque.'

    $stableLaunch = Join-Path $DataDirectory 'Launch-Smoothies.ps1'
    Copy-Item -LiteralPath (Join-Path $app 'scripts\smoothies\Launch-Smoothies.ps1') -Destination $stableLaunch -Force
    $updates = Join-Path $DataDirectory 'actualizaciones'
    [void](New-Item -ItemType Directory -Path $updates -Force)
    $policyPath = Join-Path $updates 'policy.json'
    $keyPath = Join-Path $updates 'public-key.pem'
    if ((Test-Path -LiteralPath $policyPath) -xor (Test-Path -LiteralPath $keyPath)) {
        throw 'La configuracion de actualizaciones esta incompleta. Contacta a soporte.'
    }
    if (-not (Test-Path -LiteralPath $policyPath)) {
        Copy-Item -LiteralPath (Join-Path $source 'update-public-key.pem') -Destination $keyPath
        Copy-Item -LiteralPath (Join-Path $source 'update-policy.json') -Destination $policyPath
    }
    if (-not $NoShortcuts) {
        $shell = New-Object -ComObject WScript.Shell
        $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        function New-SmoothiesShortcut([string]$Folder, [string]$Name, [string]$Mode) {
            $shortcut = $shell.CreateShortcut((Join-Path $Folder ($Name + '.lnk')))
            $shortcut.TargetPath = $powershell
            $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$stableLaunch`" $Mode"
            $shortcut.WorkingDirectory = $DataDirectory
            $shortcut.Description = 'POS Smoothies en esta PC'
            $shortcut.Save()
        }
        New-SmoothiesShortcut ([Environment]::GetFolderPath('DesktopDirectory')) 'POS Smoothies' ''
        New-SmoothiesShortcut ([Environment]::GetFolderPath('Startup')) 'POS Smoothies (servidor)' '-Background'
        New-SmoothiesShortcut ([Environment]::GetFolderPath('Programs')) 'Diagnostico POS Smoothies' '-Support'
    }
    $pendingState = Join-Path $DataDirectory 'release.pending.json'
    $package | Add-Member -NotePropertyName settingsPath -NotePropertyValue $SettingsPath -Force
    $package | ConvertTo-Json | Set-Content -LiteralPath $pendingState -Encoding UTF8
    if ($previous) { [IO.File]::Replace($pendingState, $statePath, (Join-Path $DataDirectory 'release.previous.json')) }
    else { Move-Item -LiteralPath $pendingState -Destination $statePath }
    if ($SiteFile) {
        $savedSite = Join-Path $DataDirectory 'site.json'
        if ($SiteFile -ne $savedSite) { Copy-Item -LiteralPath $SiteFile -Destination $savedSite -Force }
        $acceptance = Join-Path $DataDirectory ('aceptacion-' + $package.id + '-' + $site.siteSha256 + '.json')
        if (-not (Test-Path -LiteralPath $acceptance)) {
            Invoke-Checked $node @((Join-Path $app 'scripts\smoothies\site-plan.mjs'), 'checklist', $savedSite, $acceptance, $package.id) 'No se pudo preparar la lista de pruebas del sitio.'
        }
        Write-Host 'Ficha privada guardada. Las pruebas de equipo siguen pendientes hasta observarlas.'
    }
    Write-Host 'Instalacion lista. Abre POS Smoothies desde el escritorio y entra como admin.'
} finally {
    if ($launchLock) { if ($launchHeld) { $launchLock.ReleaseMutex() }; $launchLock.Dispose() }
    $lock.Dispose()
}
