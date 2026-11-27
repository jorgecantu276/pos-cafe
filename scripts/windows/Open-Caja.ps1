param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
try {
    if (-not [IO.Path]::IsPathRooted($ConfigPath)) { throw 'Indica la ruta absoluta de la configuracion privada.' }
    $ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $updateState = Join-Path ($ConfigPath + '.updates') 'state.json'
    if ($config.AutoUpdate -eq $true -or (Test-Path -LiteralPath $updateState -PathType Leaf)) {
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $id = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($ConfigPath.ToLowerInvariant()))) }
        finally { $hash.Dispose() }
        $mutex = New-Object Threading.Mutex($false, ('Local\POSCafe-Update-' + $id))
        $held = $false
        try {
            try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
            if (!$held) { return }
            & (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'auto-update.mjs') $ConfigPath $PSScriptRoot
            if ($LASTEXITCODE -ne 0) { throw 'Caja no pudo abrir. Revisa el registro junto a la configuracion privada.' }
        } finally {
            if ($held) { $mutex.ReleaseMutex() }
            $mutex.Dispose()
        }
        return
    }
    & (Join-Path $PSScriptRoot 'Start-POS.ps1') -ConfigPath $ConfigPath -DesktopApp
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show(
        $_.Exception.Message, 'Cariñito Mío POS',
        [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
