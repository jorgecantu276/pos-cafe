[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
# Same-directory rename on Windows, including USB/exFAT. File.Move refuses an
# existing destination; an interrupted copy never publishes a partial archive.
[IO.File]::Move($Source, $Destination)
