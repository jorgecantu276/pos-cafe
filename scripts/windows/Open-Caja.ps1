param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'Start-POS.ps1') -ConfigPath $ConfigPath -DesktopApp
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show(
        $_.Exception.Message, 'Cariñito Mío POS',
        [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
