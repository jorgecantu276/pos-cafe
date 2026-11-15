[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'POS Smoothies'),
    [string]$SettingsPath,
    [switch]$NoShortcuts,
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$package = Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw | ConvertFrom-Json
if ($package.version -ne 1 -or $package.id -notmatch '^[a-f0-9]{16}$') { throw 'El paquete esta incompleto.' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
if (-not $SettingsPath) { $SettingsPath = Join-Path $DataDirectory 'instalacion.env' }
$SettingsPath = [IO.Path]::GetFullPath($SettingsPath)
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
try {
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
        foreach ($entry in @('app','node.exe','Node-LICENSE.txt','Guia PC e iPad.md')) {
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
    $envArg = "--env-file=$SettingsPath"
    Invoke-Checked $node @($envArg, (Join-Path $app 'scripts\smoothies\install-local.mjs'), 'check') 'Revisa la configuracion de la instalacion.'
    $composeFile = & $node $envArg -p 'process.env.SMOOTHIES_COMPOSE_FILE'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la configuracion local.' }
    $managed = & $node $envArg -p 'process.env.SMOOTHIES_MANAGED_SUPABASE'
    & $docker.Source info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked $docker.Source @('desktop','start','--timeout','90') 'Abre Docker Desktop, termina su configuracion y vuelve a ejecutar el instalador.'
    }
    if ($managed -eq '1') {
        $instance = & $node $envArg -p 'process.env.SMOOTHIES_SUPABASE_INSTANCE'
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
    $needAdmin = & $node $envArg $prepare --needs-admin
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la base local.' }
    $passwordInSettings = & $node $envArg -p 'Boolean(process.env.SMOOTHIES_ADMIN_PASSWORD)'
    if ($needAdmin -eq 'yes' -and $passwordInSettings -ne 'true') {
        $password = Read-Host 'Crea la contrasena de admin (12 caracteres o mas)' -AsSecureString
        $secret = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
        try {
            $env:SMOOTHIES_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secret)
            if ($env:SMOOTHIES_ADMIN_PASSWORD.Length -lt 12) { throw 'La contrasena debe tener al menos 12 caracteres. Ejecuta de nuevo el instalador.' }
        } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secret) }
    }
    try { Invoke-Checked $node @($envArg, $prepare) 'No se pudo preparar el POS. Si el intento ya creo tu cuenta, usa la misma contrasena.' }
    finally { Remove-Item Env:SMOOTHIES_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
    $startupSettings = Join-Path $DataDirectory 'caja.env'
    Invoke-Checked $node @($envArg, (Join-Path $app 'scripts\smoothies\install-local.mjs'), 'write', $startupSettings) 'No se pudo guardar la configuracion de arranque.'

    $stableLaunch = Join-Path $DataDirectory 'Launch-Smoothies.ps1'
    Copy-Item -LiteralPath (Join-Path $app 'scripts\smoothies\Launch-Smoothies.ps1') -Destination $stableLaunch -Force
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
    Write-Host 'Instalacion lista. Abre POS Smoothies desde el escritorio y entra como admin.'
} finally { $lock.Dispose() }
