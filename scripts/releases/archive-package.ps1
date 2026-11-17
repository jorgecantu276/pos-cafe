param(
    [Parameter(Mandatory=$true)][ValidateSet('Create','Extract')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$Source = [IO.Path]::GetFullPath($Source)
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw 'La salida del paquete ya existe.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if ($Mode -eq 'Create') {
    if (!(Test-Path -LiteralPath $Source -PathType Container)) { throw 'Falta la carpeta del paquete.' }
    $archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $prefix = $Source.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        foreach ($file in [IO.Directory]::EnumerateFiles($Source, '*', [IO.SearchOption]::AllDirectories)) {
            $name = $file.Substring($prefix.Length).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $name, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $archive.Dispose() }
} else {
    [IO.Compression.ZipFile]::ExtractToDirectory($Source, $Destination)
}
