param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\CarinitoMioPOS'),
    [string]$ConfigPath = 'C:\POS-Cafe\private\pos-cafe-config.json',
    [string]$OutputDirectory = (Join-Path $env:LOCALAPPDATA 'POSCafeSupport\reports'),
    [ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Device = 'cafe-caja-01',
    [ValidateRange(0,2147483647)][int]$IssueNumber = 0,
    [switch]$Enviar
)
$ErrorActionPreference = 'Stop'
$repository = 'jorgecantu276/pos-cafe'
$destination = 'github.com/' + $repository
$collector = Join-Path $PSScriptRoot 'Diagnostico-POS-Cafe.ps1'
if (!(Test-Path -LiteralPath $collector -PathType Leaf)) { throw 'Falta Diagnostico-POS-Cafe.ps1 junto a este archivo.' }
if (![IO.Path]::IsPathRooted($OutputDirectory)) { throw 'OutputDirectory requiere una ruta absoluta.' }
if ($Enviar) {
    if (!(Get-Command gh -ErrorAction SilentlyContinue)) { throw 'No se encontro GitHub CLI.' }
    $repoRaw = & gh api --hostname github.com --method GET ('repos/' + $repository) --jq '{private:.private,full_name:.full_name}' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI no pudo verificar el repositorio. Revisa su inicio de sesion.' }
    $repo = ($repoRaw -join "`n") | ConvertFrom-Json
    if ($repo.private -ne $true -or $repo.full_name -cne $repository) { throw 'El diagnostico solo se envia al repositorio privado esperado.' }
    if ($IssueNumber -gt 0) {
        $issueRaw = & gh api --hostname github.com --method GET ('repos/' + $repository + '/issues/' + $IssueNumber) --jq '{state:.state,pull_request:.pull_request}' 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la incidencia de destino.' }
        $issue = ($issueRaw -join "`n") | ConvertFrom-Json
        if ($issue.state -cne 'open' -or $issue.pull_request) { throw 'El destino debe ser una incidencia abierta, no un pull request.' }
    }
}
$raw = (& $collector -InstallDirectory $InstallDirectory -ConfigPath $ConfigPath | Out-String)
$diagnostic = $raw | ConvertFrom-Json
if ($diagnostic.scope -cne 'Read-only metadata. No business writes or paper.' -or !$diagnostic.checkedAtUtc) { throw 'Diagnostico incompleto. No se envio ningun informe.' }
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$jsonFile = Join-Path $OutputDirectory ($Device + '-' + $stamp + '.json')
$bodyFile = Join-Path $OutputDirectory ($Device + '-' + $stamp + '.txt')
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($jsonFile,($diagnostic | ConvertTo-Json -Depth 10),$utf8)
$body = @(
    ('<!-- pos-cafe-support:v1:' + $Device + ':' + $stamp + ' -->'),
    ('Equipo de soporte: ' + $Device),
    ('Fecha UTC: ' + $diagnostic.checkedAtUtc),
    '',
    'Diagnostico de metadatos. No incluye claves, ventas, nombres de clientes ni contenido de logs.',
    'No instala, reinicia, cobra ni imprime.',
    '',
    '```json',
    ($diagnostic | ConvertTo-Json -Depth 10),
    '```'
) -join "`n"
if ([Text.Encoding]::UTF8.GetByteCount($body) -gt 50000) { throw 'Informe demasiado grande. Conserva el JSON local; no se envio.' }
[IO.File]::WriteAllText($bodyFile,$body,$utf8)
if (!$Enviar) {
    [pscustomobject]@{ Sent=$false; Diagnostic=$jsonFile; Preview=$bodyFile; Repository=$repository; Message='Revisa el informe. Para enviarlo ejecuta de nuevo con -Enviar.' }
    return
}
# --body-file conserva saltos de linea; nunca se interpola contenido como codigo.
if ($IssueNumber -gt 0) {
    $result = & gh issue comment $IssueNumber --repo $destination --body-file $bodyFile 2>$null
} else {
    $result = & gh issue create --repo $destination --title ('Soporte POS - ' + $Device + ' - ' + $stamp) --body-file $bodyFile 2>$null
}
if ($LASTEXITCODE -ne 0) { throw ('No se confirmo el envio. Conserva ' + $jsonFile + ' y comprueba la incidencia antes de reenviar; el servidor pudo haberlo recibido.') }
[pscustomobject]@{ Sent=$true; Diagnostic=$jsonFile; Result=($result -join "`n"); Repository=$repository }
