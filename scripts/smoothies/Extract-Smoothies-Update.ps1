param(
    [Parameter(Mandatory=$true)][string]$ZipPath,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { throw 'La carpeta de preparacion ya existe.' }
$Destination = [IO.Path]::GetFullPath($Destination)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    if ($archive.Entries.Count -gt 35000) { throw 'Demasiados archivos.' }
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.TrimEnd('/')
        if (-not $name -or $name.Length -ge 240) { throw 'Ruta de actualizacion invalida.' }
        foreach ($part in $name.Split('/')) {
            if (-not $part -or $part -in @('.','..') -or $part -match '[<>:"\\|?*\x00-\x1f]' -or
                $part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)') {
                throw 'Ruta de actualizacion invalida.'
            }
        }
        if (-not $seen.Add($name)) { throw 'Archivo duplicado.' }
        $target = [IO.Path]::GetFullPath((Join-Path $Destination $name))
        if (-not $target.StartsWith($Destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Archivo fuera del paquete.'
        }
        $total += $entry.Length
        if ($total -gt 2GB) { throw 'El paquete supera el limite.' }
        if (($entry.ExternalAttributes -band 0xF0000000) -eq 0xA0000000) { throw 'No se admiten enlaces.' }
    }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
