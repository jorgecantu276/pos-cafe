param([string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'pos-cafe-config.json'))
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($ConfigPath)) { throw 'Indica la ruta absoluta de la configuracion privada.' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$releaseDirectory = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
if ($ConfigPath.StartsWith($releaseDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'La configuracion privada debe estar fuera de la version.' }
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Primero prepara la configuracion privada del negocio.' }
$launcher = Join-Path $PSScriptRoot 'Open-POS.cmd'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release.json') -PathType Leaf)) { throw 'Usa este instalador desde una version preparada para Windows.' }
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$linkPath = Join-Path $desktop 'Caja POS Cafe.lnk'
if (Test-Path -LiteralPath $linkPath) { throw 'Ya existe Caja POS Cafe en el escritorio. Conserva o retira ese acceso manualmente antes de instalar otro.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $launcher
$shortcut.Arguments = '-ConfigPath "' + $ConfigPath + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Abrir la caja local de POS Cafe'
$shortcut.Save()
Write-Host 'Acceso Caja POS Cafe creado en el escritorio del usuario actual. No se instalaron servicios ni tareas automaticas.'
