param([string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'pos-cafe-config.json'))
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($ConfigPath)) { throw 'Indica la ruta absoluta de la configuracion privada.' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$releaseDirectory = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
if ($ConfigPath.StartsWith($releaseDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'La configuracion privada debe estar fuera de la version.' }
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Primero prepara la configuracion privada del negocio.' }
$launcher = Join-Path $PSScriptRoot 'Open-Caja.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release.json') -PathType Leaf)) { throw 'Usa este instalador desde una version preparada para Windows.' }
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$linkPath = Join-Path $desktop 'Cariñito Mío POS.lnk'
if (Test-Path -LiteralPath $linkPath) { throw 'Ya existe Cariñito Mío POS en el escritorio. Conserva o retira ese acceso manualmente antes de instalar otro.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -ConfigPath "' + $ConfigPath + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$icon = Join-Path $PSScriptRoot 'Carinito-Mio.ico'
if (Test-Path -LiteralPath $icon -PathType Leaf) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Description = 'Abrir la caja local de POS Cafe'
$shortcut.Save()
Write-Host 'Acceso Cariñito Mío POS creado en el escritorio del usuario actual. No se instalaron servicios ni tareas automaticas.'
