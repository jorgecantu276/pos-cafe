#Requires -Version 7.2
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Hosted-LanTrust.psm1') -Force -DisableNameChecking
Assert-HostedLanTrustHost
$directory = Join-Path $env:RUNNER_TEMP ('pos-lan-trust-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $directory)
$identity = $null; $result = 'fail'; $phase = 'certificate'; $removed = $false
try {
    $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric,InterfaceMetric)
    $address = $null
    foreach ($route in $routes) {
        $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex | Where-Object {
            $_.AddressState -eq 'Preferred' -and !$_.SkipAsSource -and $_.IPAddress -match '^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)'
        })
        if ($addresses.Count) { $address = $addresses[0].IPAddress; break }
    }
    if (!$address) { throw 'No assigned private host IPv4.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Write-Host 'Hosted trust probe: starting bounded synthetic certificate generation.'
    $certificate = Invoke-HostedBoundedProcess -Executable $node -Arguments @((Join-Path $PSScriptRoot '../smoothies/provision-lan.mjs'),('https://' + $address + ':3443'),(Join-Path $directory 'https')) -Seconds 120 | ConvertFrom-Json
    Write-Host 'Hosted trust probe: certificate generation completed.'
    $identity = New-HostedLanTrustIdentity $certificate.publicCertificate
    $phase = 'machine-root-import'
    Write-Host 'Hosted trust probe: starting bounded exact synthetic machine-root import.'
    Add-HostedLanTrust $identity
    Write-Host 'Hosted trust probe: exact synthetic machine-root import completed.'
    $phase = 'verified-https'
    $httpsProbe = Join-Path $directory 'https-probe.mjs'
    [IO.File]::WriteAllText($httpsProbe, @'
import https from 'node:https';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [address, certFile, keyFile] = process.argv.slice(2);
const server = https.createServer({ cert: await readFile(certFile), key: await readFile(keyFile) }, (_, response) => response.end('owned-verified-https'));
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, address, resolve); });
try {
  const response = await fetch(`https://${address}:${server.address().port}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); assert.equal(await response.text(), 'owned-verified-https');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
'@, [Text.UTF8Encoding]::new($false))
    [void](Invoke-HostedBoundedProcess -Executable $node -Arguments @($httpsProbe,$address,$certificate.certFile,$certificate.keyFile) -Seconds 30 -ChildEnvironment @{ NODE_EXTRA_CA_CERTS = [IO.Path]::ChangeExtension($certificate.publicCertificate,'.pem') })
    $result = 'pass'
} finally {
    if ($identity) {
        try { Remove-HostedLanTrust $identity; $removed = $true; Write-Host 'Hosted trust probe: exact synthetic machine root removed.' }
        catch { $result = 'fail'; $phase = 'machine-root-cleanup' }
    }
    $proof = @{ version = 1; result = $result; phase = $phase; store = 'LocalMachine\Root'; removed = $removed; tlsVerification = 'enabled'; runId = $env:GITHUB_RUN_ID; job = $env:GITHUB_JOB }
    [IO.File]::WriteAllText((Join-Path $directory 'trust-probe.json'), ($proof | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Host ($proof | ConvertTo-Json -Compress)
}
if ($result -cne 'pass' -or !$removed) { throw 'The bounded hosted trust probe did not complete with exact cleanup.' }
