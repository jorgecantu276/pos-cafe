# Download-only preflight. Never launches packaged code or changes a release.
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or !$env:GH_TOKEN) { throw 'Hosted download token required.' }
$descriptorFile=Join-Path $PSScriptRoot 'cafe-qualification-input.json'
$descriptor=Get-Content -LiteralPath $descriptorFile -Raw | ConvertFrom-Json
if ($descriptor.state -cne 'reviewed-for-isolated-rehearsal' -or $descriptor.candidateAssetId -cnotmatch '^\d+$' -or $descriptor.sourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $descriptor.zipSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Reviewed numeric asset descriptor required.' }
$directory=Join-Path $env:RUNNER_TEMP ('cafe-artifacts-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $directory
$candidate=Join-Path $directory ('POS-Cafe-'+$descriptor.sourceCommit.Substring(0,7)+'.zip')
try {
    # GitHub documents Contents(read) for this numeric asset endpoint. It avoids
    # the draft tag lookup used by gh release download. Do not widen permission.
    Invoke-WebRequest -Uri ('https://api.github.com/repos/jorgecantu276/pos-cafe/releases/assets/'+$descriptor.candidateAssetId) -Headers @{Authorization=('Bearer '+$env:GH_TOKEN);Accept='application/octet-stream';'X-GitHub-Api-Version'='2022-11-28'} -OutFile $candidate -TimeoutSec 120
} catch {
    $status='unavailable';if ($_.Exception.Response) { $status=[string][int]$_.Exception.Response.StatusCode }
    throw ('Exact numeric candidate asset download failed; HTTP status '+$status+'. No package executed.')
}
if ((Get-FileHash -LiteralPath $candidate).Hash.ToLowerInvariant() -cne $descriptor.zipSha256) { throw 'Candidate bytes differ from the reviewed ZIP.' }
& gh release download cafe-v1.0.0-rc.6 --repo jorgecantu276/pos-cafe --pattern Caja-Cobro-Integrado-rc6.zip --dir $directory
if ($LASTEXITCODE -ne 0) { throw 'Published predecessor download failed.' }
$baseline=Join-Path $directory 'Caja-Cobro-Integrado-rc6.zip'
if ((Get-FileHash -LiteralPath $baseline).Hash.ToLowerInvariant() -cne '43256fed95fb3e49b82ed5e3a55d1da88e83ab76748625e54045c06187cca7e8') { throw 'Predecessor bytes differ from reviewed ZIP.' }
"POS_CAFE_HOSTED_ARTIFACTS=$directory" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8
Write-Host 'Exact candidate and predecessor archives downloaded and hash-verified; no package executed.'
