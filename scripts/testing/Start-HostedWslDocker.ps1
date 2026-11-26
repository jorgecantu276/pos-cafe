#Requires -Version 7.2
[CmdletBinding()]
param([string]$WorkDirectory)
$ErrorActionPreference = 'Stop'

# Never enroll an owner's PC, an existing WSL distro or a nonempty Docker host.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
    $env:POS_ACCEPTANCE_DISPOSABLE -cne '1' -or !$env:GITHUB_RUN_ID -or !$env:RUNNER_TEMP -or !$env:GITHUB_ENV) {
    throw 'This bootstrap requires a fresh explicitly enrolled GitHub-hosted Windows 2025 job.'
}
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$owner = [guid]::NewGuid().ToString('N')
if (!$WorkDirectory) { $WorkDirectory = Join-Path $runnerTemp "pos-wsl-engine-$owner" }
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
if (!$WorkDirectory.StartsWith($runnerTemp + '\', [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $WorkDirectory)) { throw 'Use a new owned directory beneath RUNNER_TEMP.' }
[void](New-Item -ItemType Directory -Path $WorkDirectory)
$docker = (Get-Command docker.exe -ErrorAction Stop).Source
if (![IO.Path]::IsPathRooted($docker)) { throw 'The official installed Windows Docker CLI is required.' }
$distribution = 'Ubuntu-24.04'
$serviceStopped = $false; $createdDistro = $false; $bridge = $null; $keepAlive = $null

function Native {
    param([Parameter(Position=0)][string]$Executable, [Parameter(Position=1,ValueFromRemainingArguments=$true)][string[]]$Arguments)
    # Docker emits pull progress on stderr even when create succeeds. Keep its
    # machine-readable stdout (IDs/hashes/JSON) separate from diagnostics.
    $stderrFile = Join-Path $WorkDirectory 'native-stderr.log'
    $result = & $Executable @Arguments 2> $stderrFile
    if ($LASTEXITCODE -ne 0) {
        $diagnostics = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
        throw "$(Split-Path -Leaf $Executable) failed: $diagnostics $($result -join [Environment]::NewLine)"
    }
    return (($result | ForEach-Object { [string]$_ }) -join "`n").Replace([string][char]0, '')
}
function Docker {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    Native -Executable $docker -Arguments $Arguments
}
function Free-Ports([int[]]$Ports) {
    foreach ($port in $Ports) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
            throw "Port $port already belongs to another process; it was left untouched."
        }
    }
}
function Guest-Path([string]$WindowsPath) {
    if ($WindowsPath -notmatch '^([A-Za-z]):[\\/](.*)$') { throw 'A local Windows drive path is required.' }
    return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/')
}
function Wait-Native([scriptblock]$Probe, [int]$Seconds, [string]$Message) {
    $until = [DateTime]::UtcNow.AddSeconds($Seconds); $nextLog = [DateTime]::MinValue
    while ([DateTime]::UtcNow -lt $until) {
        try { $result = & $Probe; if ($result) { return $result } } catch { }
        if ([DateTime]::UtcNow -ge $nextLog) { Write-Host $Message; $nextLog = [DateTime]::UtcNow.AddSeconds(30) }
        Start-Sleep -Seconds 2
    }
    throw $Message
}

try {
    if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw 'A preselected Docker override is not a fresh default runner.' }
    if ((Docker @('context', 'show')).Trim() -cne 'default') { throw 'Leave an existing nondefault Docker context intact.' }
    $endpoint = Docker @('context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}')
    if ($endpoint.Trim() -cne 'npipe:////./pipe/docker_engine') { throw 'The runner default Docker endpoint is unexpected.' }
    if ((Docker @('info', '--format', '{{.OSType}}')).Trim() -cne 'windows') { throw 'An existing Linux engine must be left intact.' }
    if ((Docker @('ps', '-aq')).Trim() -or (Docker @('volume', 'ls', '-q')).Trim()) { throw 'The runner has existing containers or volumes; leave them intact.' }
    $networks = (Docker @('network', 'ls', '--format', '{{.Name}}')) -split '\r?\n'
    if (@($networks | Where-Object { $_ -and $_ -cnotin @('nat', 'none') }).Count) { throw 'The runner Docker host has a nondefault network.' }
    $windowsDocker = Get-CimInstance Win32_Service -Filter "Name='docker'"
    if (!$windowsDocker -or $windowsDocker.PathName -notmatch 'dockerd\.exe') { throw 'The standard Windows Docker service was not identified.' }
    Free-Ports @(2375, 3180, 58000, 55432, 55541, 55542, 55543, 55544)
    $listed = (& wsl.exe --list --quiet 2>&1 | Out-String).Replace([string][char]0, '').Trim()
    if ($LASTEXITCODE -eq 0 -and $listed) { throw 'An existing WSL distribution must be left intact.' }
    if ($LASTEXITCODE -ne 0 -and $listed -notmatch 'no installed distributions') { throw 'Could not establish that the WSL host is empty.' }
    [void](Native 'wsl.exe' @('--install', '--distribution', $distribution, '--no-launch', '--web-download'))
    $createdDistro = $true
    $kernel = Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'uname', '-r')
    if ($kernel -notmatch 'microsoft-standard-WSL2') { throw 'The disposable distro did not boot a genuine WSL2 Linux kernel.' }
    $guestScript = Join-Path $WorkDirectory 'guest-bootstrap.sh'
    @'
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io socat
for drive in c d; do
  if [ -d "/mnt/$drive" ]; then
    test ! -e "/$drive"
    ln -s "/mnt/$drive" "/$drive"
  fi
done
test "$(cat /proc/1/comm)" = systemd
install -d /etc/docker /etc/systemd/system/docker.service.d
printf '{"userland-proxy":true,"labels":["mx.pos-hosted-rehearsal=__OWNER__"]}\n' > /etc/docker/daemon.json
printf '[Service]\nExecStart=\nExecStart=%s -H fd:// -H tcp://127.0.0.1:2375 --tls=false --containerd=/run/containerd/containerd.sock\n' "$(command -v dockerd)" > /etc/systemd/system/docker.service.d/pos-hosted.conf
printf '__OWNER__\n' > /etc/pos-hosted-rehearsal
systemctl daemon-reload
systemctl enable --now containerd
systemctl restart docker
docker info --format '{{.OSType}}'
'@.Replace('__OWNER__', $owner).Replace("`r`n", "`n") | Set-Content -LiteralPath $guestScript -Encoding utf8NoBOM
    [void](Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $guestScript)))
    $keepAlive = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--distribution', $distribution, '--user', 'root', '--', 'sleep', 'infinity') -WindowStyle Hidden -PassThru
    $linuxInfo = Wait-Native { (Docker @('--host', 'tcp://127.0.0.1:2375', 'info', '--format', '{{json .}}')) | ConvertFrom-Json } 120 'Waiting for the owned WSL Linux engine on Windows loopback.'
    if ($linuxInfo.OSType -cne 'linux' -or "mx.pos-hosted-rehearsal=$owner" -cnotin $linuxInfo.Labels) { throw 'The guest daemon identity was not established.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 2375 -ErrorAction Stop)
    if (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) { throw 'The Docker API must not be exposed off Windows loopback.' }

    # Only this fresh runner's identified empty Windows daemon is stopped.
    Stop-Service -Name docker -ErrorAction Stop
    (Get-Service docker).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    $serviceStopped = $true
    if (@([IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { [IO.Path]::GetFileName($_) -ceq 'docker_engine' }).Count) { throw 'Another process still owns the default Docker pipe.' }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $bridgeExe = Join-Path $WorkDirectory 'WslDockerPipe.exe'
    [void](Native $compiler @('/nologo', '/target:exe', "/out:$bridgeExe", (Join-Path $PSScriptRoot 'WslDockerPipe.cs')))
    $ready = Join-Path $WorkDirectory 'pipe-ready.txt'
    $bridge = Start-Process -FilePath $bridgeExe -ArgumentList ('"{0}"' -f $ready) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $WorkDirectory 'pipe.log') -RedirectStandardError (Join-Path $WorkDirectory 'pipe-error.log')
    [void](Wait-Native { if ($bridge.HasExited) { throw 'The owned Docker pipe process exited.' }; if (Test-Path -LiteralPath $ready) { (Get-Content -LiteralPath $ready -Raw).Trim() -eq [string]$bridge.Id } } 30 'Waiting for the owned Docker pipe relay.')
    $observed = Docker @('info', '--format', '{{json .}}') | ConvertFrom-Json
    if ($observed.ID -cne $linuxInfo.ID -or $observed.OSType -cne 'linux') { throw 'Default Windows Docker CLI does not reach the owned Linux daemon.' }
    $env:POS_CAFE_REAL_DOCKER = $docker
    $env:POS_TEST_WSL_ENGINE = '1'
    $env:COMPOSE_CONVERT_WINDOWS_PATHS = '1'

    # Genuine container proof for Compose /c,/d conversion, raw-CLI /mnt paths,
    # binary docker-cp transport and dynamically forwarded loopback test ports.
    $canary = Join-Path $WorkDirectory 'canary.txt'
    $canaryText = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($canary, $canaryText, [Text.UTF8Encoding]::new($false))
    $expectedHash = (Get-FileHash -LiteralPath $canary -Algorithm SHA256).Hash.ToLowerInvariant()
    $composeFile = Join-Path $WorkDirectory 'canary-compose.yml'
    $project = 'pos-hosted-canary-' + $owner
    @"
services:
  canary:
    image: busybox:1.37
    labels:
      mx.pos-hosted-rehearsal: '$owner'
    command: ['busybox', 'httpd', '-f', '-p', '8080', '-h', '/fixture']
    ports:
      - '127.0.0.1:58000:8080'
      - '127.0.0.1:55432:8080'
      - '127.0.0.1:55541:8080'
      - '127.0.0.1:55542:8080'
      - '127.0.0.1:55543:8080'
      - '127.0.0.1:55544:8080'
    volumes:
      - type: bind
        source: '$($WorkDirectory.Replace("'", "''"))'
        target: /fixture
        read_only: true
"@ | Set-Content -LiteralPath $composeFile -Encoding utf8NoBOM
    $rawName = 'pos-hosted-raw-' + $owner; $rawId = $null
    try {
        [void](Docker @('compose', '--project-name', $project, '-f', $composeFile, 'up', '-d'))
        $canaryId = (Docker @('compose', '--project-name', $project, '-f', $composeFile, 'ps', '-q', 'canary')).Trim()
        $composeHash = (Docker @('exec', $canaryId, 'sha256sum', '/fixture/canary.txt')).Split(' ')[0]
        if ($composeHash -cne $expectedHash) { throw 'The actual Windows Compose bind does not expose the intended host bytes.' }
        [void](Docker @('cp', $canary, "${canaryId}:/tmp/pipe-copy.txt"))
        if ((Docker @('exec', $canaryId, 'sha256sum', '/tmp/pipe-copy.txt')).Split(' ')[0] -cne $expectedHash) { throw 'Binary Docker API transport changed the canary.' }
        foreach ($port in @(58000, 55432, 55541, 55542, 55543, 55544)) {
            [void](Wait-Native { $body = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/canary.txt" -TimeoutSec 2).Content; if ($body -ceq $canaryText) { $true } } 45 "Waiting for real container port $port through Windows loopback.")
        }
        $rawWrapper = Join-Path $WorkDirectory 'DockerLoopbackRaw.exe'
        [void](Native $compiler @('/nologo', '/target:exe', "/out:$rawWrapper", (Join-Path $PSScriptRoot '../staging/docker-loopback.cs')))
        [void](Native $rawWrapper @('--pos-cafe-self-test'))
        $rawId = (Native $rawWrapper @('create', '--name', $rawName, '--label', "mx.pos-hosted-rehearsal=$owner", '-v', "${canary}:/fixture/canary.txt:ro", 'alpine:3.22', 'sha256sum', '/fixture/canary.txt')).Trim()
        $rawHash = (Docker @('start', '--attach', $rawId)).Split(' ')[0]
        if ($rawHash -cne $expectedHash) { throw 'The attested raw Docker CLI bind does not expose the intended host bytes.' }
    } finally {
        if ($rawId) {
            $rawOwner = (Docker @('inspect', '--format', '{{index .Config.Labels "mx.pos-hosted-rehearsal"}}', $rawId)).Trim()
            if ($rawOwner -cne $owner) { throw 'Refusing to remove an unowned canary container.' }
            [void](Docker @('rm', $rawId))
        }
        if (Test-Path -LiteralPath $composeFile) { [void](Docker @('compose', '--project-name', $project, '-f', $composeFile, 'down', '--volumes')) }
    }
    $receipt = Join-Path $WorkDirectory 'engine.json'
    @{ version = 1; owner = $owner; distribution = $distribution; kernel = $kernel.Trim(); daemonId = $observed.ID;
       docker = $docker; pipe = 'npipe:////./pipe/docker_engine'; proxyPid = $bridge.Id; proxyExecutable = $bridgeExe;
       keepAlivePid = $keepAlive.Id; completedAt = [DateTimeOffset]::UtcNow.ToString('o');
       parity = @{ composeBindSha256 = $composeHash; rawBindSha256 = $rawHash; binaryCopySha256 = $expectedHash; loopbackPorts = @(58000,55432,55541,55542,55543,55544) } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
    foreach ($entry in @("POS_CAFE_REAL_DOCKER=$docker", 'POS_TEST_WSL_ENGINE=1', 'COMPOSE_CONVERT_WINDOWS_PATHS=1', "POS_TEST_WSL_RECEIPT=$receipt")) {
        Add-Content -LiteralPath $env:GITHUB_ENV -Value $entry -Encoding utf8NoBOM
    }
    Write-Host "Owned real WSL Docker engine ready; parity receipt: $receipt"
} catch {
    if ($bridge -and !$bridge.HasExited) { $bridge.Kill($true); $bridge.WaitForExit() }
    if ($keepAlive -and !$keepAlive.HasExited) { $keepAlive.Kill($true); $keepAlive.WaitForExit() }
    if ($createdDistro) { & wsl.exe --terminate $distribution | Out-Null }
    if ($serviceStopped) { Start-Service docker -ErrorAction Continue }
    throw
}
