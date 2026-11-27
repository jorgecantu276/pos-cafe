#Requires -Version 7.2
[CmdletBinding()]
param([string]$WorkDirectory)
$ErrorActionPreference = 'Stop'

# Never enroll an owner's PC, an existing WSL distro or a nonempty Docker host.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
    $env:POS_ACCEPTANCE_DISPOSABLE -cne '1' -or !$env:GITHUB_RUN_ID -or !$env:GITHUB_JOB -or !$env:RUNNER_TEMP -or !$env:GITHUB_ENV) {
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
$createdDistro = $false; $keepAlive = $null; $ownedContext = $null

function Native {
    param([Parameter(Position=0)][string]$Executable, [Parameter(Position=1,ValueFromRemainingArguments=$true)][string[]]$Arguments,
        [ValidateRange(1,900)][int]$TimeoutSeconds = 600, [switch]$CloseInput,
        [ValidatePattern('^1\.[0-9]+$')][string]$ApiVersion)
    # Docker emits pull progress on stderr even when create succeeds. Keep its
    # machine-readable stdout (IDs/hashes/JSON) separate from diagnostics.
    $label = (Split-Path -Leaf $Executable) + ' ' + (($Arguments | Select-Object -First 2) -join ' ')
    Write-Host "Owned host check: $label"
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $CloseInput.IsPresent
    if ($ApiVersion) { $start.Environment['DOCKER_API_VERSION'] = $ApiVersion }
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    try {
        [void]$process.Start()
        if ($CloseInput) { $process.StandardInput.Close() }
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true); $process.WaitForExit()
            throw "Owned host command exceeded its ${TimeoutSeconds}s deadline: $label"
        }
        $result = $stdout.GetAwaiter().GetResult(); $diagnostics = $stderr.GetAwaiter().GetResult()
        $event = @{ command = $label; exitCode = $process.ExitCode; stdoutCharacters = $result.Length; stderrCharacters = $diagnostics.Length;
            stderrSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($diagnostics))).ToLowerInvariant() }
        [IO.File]::AppendAllText((Join-Path $WorkDirectory 'bootstrap-events.jsonl'), ($event | ConvertTo-Json -Compress) + "`n", [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $WorkDirectory 'native-stderr.log'), $diagnostics)
        if ($process.ExitCode -ne 0) { throw "$(Split-Path -Leaf $Executable) failed: $diagnostics $result" }
        return $result.Replace([string][char]0, '').TrimEnd("`r", "`n")
    } finally {
        $process.Dispose()
    }
}
function Docker {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    Native -Executable $docker -Arguments $Arguments
}
function Canary-Hash([string]$Output, [string]$Expected, [string]$Boundary) {
    # Do not assume a CLI's first space-delimited token is the file digest.
    # These are synthetic-only bytes: log only measured digests/lengths when a
    # transport failure occurs, never arbitrary container output.
    $lines = @($Output -split '\r?\n' | Where-Object { $_.Trim() })
    if ($lines.Count -ne 1 -or $lines[0] -cnotmatch '^([a-f0-9]{64})[ \t]+\*?/[^\r\n]+$') {
        throw "$Boundary returned invalid SHA-256 output (characters=$($Output.Length), lines=$($lines.Count))."
    }
    $actual = $Matches[1]
    if ($actual -cne $Expected) { throw "$Boundary differs: expected SHA-256 $Expected; observed SHA-256 $actual." }
    return $actual
}
function Canary-Measurement([string]$Output, [string]$Expected) {
    $exact = $Output.Trim() -cmatch '^([a-f0-9]{64})[ \t]+\*?/[^\r\n]+$' -and $Matches[1] -ceq $Expected
    return @{ characters = $Output.Length; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Output))).ToLowerInvariant(); exactCanaryBytes = [bool]$exact }
}
function Private-IPv4([string]$Value) {
    $address = $null
    if (![Net.IPAddress]::TryParse($Value, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        $address.ToString() -cne $Value -or $Value -cnotmatch '^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)') { throw 'The diagnostic requires exact private WSL IPv4 addresses.' }
    return $Value
}
function Write-LinuxScript([string]$Path, [string]$Text) {
    $linuxText = $Text.Replace("`r`n", "`n")
    if ($linuxText.Contains("`r")) { throw 'Unexpected carriage return in a Linux script.' }
    [IO.File]::WriteAllText($Path, $linuxText.TrimEnd("`n") + "`n", [Text.UTF8Encoding]::new($false))
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
    $bootstrapLinuxScript = @'
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
'@.Replace('__OWNER__', $owner)
    Write-LinuxScript $guestScript $bootstrapLinuxScript
    [void](Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'bash', '-n', (Guest-Path $guestScript)))
    [void](Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $guestScript)))
    $keepAlive = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--distribution', $distribution, '--user', 'root', '--', 'sleep', 'infinity') -WindowStyle Hidden -PassThru
    $linuxInfo = Wait-Native { (Docker @('--host', 'tcp://127.0.0.1:2375', 'info', '--format', '{{json .}}')) | ConvertFrom-Json } 120 'Waiting for the owned WSL Linux engine on Windows loopback.'
    if ($linuxInfo.OSType -cne 'linux' -or "mx.pos-hosted-rehearsal=$owner" -cnotin $linuxInfo.Labels) { throw 'The guest daemon identity was not established.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 2375 -ErrorAction Stop)
    if (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) { throw 'The Docker API must not be exposed off Windows loopback.' }

    # Use the official CLI's native TCP transport to this owned loopback-only
    # engine. Do not replace docker_engine or emulate upgraded/binary streams.
    $contextName = 'pos-hosted-' + $owner
    if (@((Docker @('context', 'ls', '--format', '{{.Name}}')) -split '\r?\n') -ccontains $contextName) { throw 'The owned context name already exists.' }
    [void](Docker @('context', 'create', $contextName, '--docker', 'host=tcp://127.0.0.1:2375'))
    $ownedContext = $contextName
    [void](Docker @('context', 'use', $contextName))
    $selectedContext = (Docker @('context', 'inspect')) | ConvertFrom-Json
    if (@($selectedContext).Count -ne 1 -or $selectedContext[0].Name -cne $contextName -or
        $selectedContext[0].Endpoints.docker.Host -cne 'tcp://127.0.0.1:2375') { throw 'The selected owned Docker context differs.' }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $observed = Docker @('info', '--format', '{{json .}}') | ConvertFrom-Json
    if ($observed.ID -cne $linuxInfo.ID -or $observed.OSType -cne 'linux' -or
        "mx.pos-hosted-rehearsal=$owner" -cnotin $observed.Labels) { throw 'Official Windows Docker CLI does not reach the owned Linux daemon.' }
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
        $composeOutput = Docker @('exec', $canaryId, 'sha256sum', '/fixture/canary.txt')
        $composeStderr = Get-Content -LiteralPath (Join-Path $WorkDirectory 'native-stderr.log') -Raw
        if (!$composeOutput.Length) {
            # Genuine independent controls locate empty attach output without
            # treating an alternative path as accepted installation evidence.
            $diagnostic = [ordered]@{ windowsExecCharacters = 0; guestBind = 'unavailable'; archiveBind = 'unavailable'; interactiveCharacters = $null; ttyCharacters = $null }
            $diagnostic.windowsExecStderr = Canary-Measurement $composeStderr $expectedHash
            try {
                $guestOutput = Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'docker', 'exec', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30
                [void](Canary-Hash $guestOutput $expectedHash 'Guest Linux CLI canary bind')
                $diagnostic.guestBind = 'exact-bytes'
            } catch { $diagnostic.guestBind = 'failed' }
            try {
                $observedCanary = Join-Path $WorkDirectory 'observed-canary.txt'
                [void](Native -Executable $docker -Arguments @('cp', "${canaryId}:/fixture/canary.txt", $observedCanary) -TimeoutSeconds 30)
                $diagnostic.archiveBind = if ((Get-FileHash -LiteralPath $observedCanary -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expectedHash) { 'exact-bytes' } else { 'different-bytes' }
            } catch { $diagnostic.archiveBind = 'failed' }
            try { $diagnostic.interactiveCharacters = (Native -Executable $docker -Arguments @('exec', '-i', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30).Length } catch { }
            try { $diagnostic.ttyCharacters = (Native -Executable $docker -Arguments @('exec', '-t', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30).Length } catch { }
            try {
                $closedInput = Native -Executable $docker -Arguments @('exec', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30 -CloseInput
                $diagnostic.closedStdin = Canary-Measurement $closedInput $expectedHash
                $diagnostic.closedStdinStderr = Canary-Measurement (Get-Content -LiteralPath (Join-Path $WorkDirectory 'native-stderr.log') -Raw) $expectedHash
            } catch { $diagnostic.closedStdin = 'failed' }
            try {
                $versions = Native -Executable $docker -Arguments @('version', '--format', '{{json .}}') -TimeoutSeconds 30 | ConvertFrom-Json
                $diagnostic.clientVersion = [string]$versions.Client.Version
                $diagnostic.serverVersion = [string]$versions.Server.Version
                $apiVersion = [string]$versions.Server.MinAPIVersion
                if ($apiVersion -cnotmatch '^1\.[0-9]+$') { $apiVersion = [string]$versions.Server.ApiVersion }
                if ($apiVersion -cmatch '^1\.[0-9]+$') {
                    $apiOutput = Native -Executable $docker -Arguments @('exec', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30 -ApiVersion $apiVersion
                    $diagnostic.serverApiVersion = $apiVersion
                    $diagnostic.serverApiStdout = Canary-Measurement $apiOutput $expectedHash
                    $diagnostic.serverApiStderr = Canary-Measurement (Get-Content -LiteralPath (Join-Path $WorkDirectory 'native-stderr.log') -Raw) $expectedHash
                }
            } catch { }
            try {
                # Optional client-version control, independently pinned from the
                # official HTTPS static distribution. Never replaces the selected
                # installed CLI or qualifies an alternative installation path.
                $clientArchive = Join-Path $WorkDirectory 'docker-29.9.2.zip'
                Invoke-WebRequest -Uri 'https://download.docker.com/win/static/stable/x86_64/docker-29.9.2.zip' -OutFile $clientArchive -TimeoutSec 90
                if ((Get-FileHash -LiteralPath $clientArchive -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'b2be959bfed1281ddaf665c0972cba9a62ce30c542b6bcce82f055bf8886bc7d') { throw 'Official client control archive differs.' }
                $clientFolder = Join-Path $WorkDirectory 'official-client-control'
                Expand-Archive -LiteralPath $clientArchive -DestinationPath $clientFolder
                $clientControl = Join-Path $clientFolder 'docker/docker.exe'
                if ((Get-FileHash -LiteralPath $clientControl -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'dd40364e3e71395fb082d91227b76bf83adfcdab4ecc719803a0ef4579a27d24') { throw 'Official client control executable differs.' }
                $controlOutput = Native -Executable $clientControl -Arguments @('--host', 'tcp://127.0.0.1:2375', 'exec', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30 -CloseInput
                $diagnostic.client2992Stdout = Canary-Measurement $controlOutput $expectedHash
                $diagnostic.client2992Stderr = Canary-Measurement (Get-Content -LiteralPath (Join-Path $WorkDirectory 'native-stderr.log') -Raw) $expectedHash
            } catch { $diagnostic.client2992Stdout = 'unavailable' }
            $guestControlPid = $null
            try {
                # Diagnostic only: compare Windows against the same WSL daemon
                # without the localhost-forwarder. The temporary guest listener
                # binds only its actual eth0 address and accepts only the exact
                # Windows/WSL default gateway. No installed endpoint is changed.
                $guestInterfaces = Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'ip', '-j', '-4', 'address', 'show', 'eth0') -TimeoutSeconds 30 | ConvertFrom-Json
                $guestRoutes = Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'ip', '-j', '-4', 'route', 'show', 'default') -TimeoutSeconds 30 | ConvertFrom-Json
                $guestAddresses = @($guestInterfaces[0].addr_info | Where-Object { $_.family -ceq 'inet' -and $_.scope -ceq 'global' })
                if (@($guestInterfaces).Count -ne 1 -or $guestInterfaces[0].ifname -cne 'eth0' -or $guestAddresses.Count -ne 1 -or
                    @($guestRoutes).Count -ne 1 -or $guestRoutes[0].dev -cne 'eth0') { throw 'The owned WSL network was not uniquely identified.' }
                $guestAddress = Private-IPv4 ([string]$guestAddresses[0].local)
                $windowsGateway = Private-IPv4 ([string]$guestRoutes[0].gateway)
                if ($guestAddress -ceq $windowsGateway) { throw 'The WSL guest and its Windows gateway must differ.' }
                $guestControlScript = Join-Path $WorkDirectory 'guest-transport-control.sh'
                $guestControlText = @'
#!/bin/bash
set -euo pipefail
test "$(cat /etc/pos-hosted-rehearsal)" = "$3"
pidfile="/run/pos-transport-$3.pid"
if [ "$4" = start ]; then
  test ! -e "$pidfile"
  test -z "$(ss -ltnH 'sport = :2376')"
  socat "TCP4-LISTEN:2376,bind=$1,range=$2/32,reuseaddr,fork" UNIX-CONNECT:/var/run/docker.sock </dev/null >"/run/pos-transport-$3.log" 2>&1 &
  child=$!
  printf '%s\n' "$child" > "$pidfile"
  sleep 0.2
  kill -0 "$child"
  printf '%s\n' "$child"
else
  child=$(cat "$pidfile")
  test "$child" = "$5"
  test "$(cat "/proc/$child/comm")" = socat
  arguments=$(tr '\0' ' ' < "/proc/$child/cmdline")
  case "$arguments" in *"TCP4-LISTEN:2376,bind=$1,range=$2/32,reuseaddr,fork"*) ;; *) exit 8 ;; esac
  kill -- "$child"
  rm -- "$pidfile"
fi
'@
                Write-LinuxScript $guestControlScript $guestControlText
                [void](Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'bash', '-n', (Guest-Path $guestControlScript)) -TimeoutSeconds 30)
                $guestControlPid = (Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $guestControlScript), $guestAddress, $windowsGateway, $owner, 'start') -TimeoutSeconds 30).Trim()
                if ($guestControlPid -cnotmatch '^[1-9][0-9]*$') { throw 'The temporary guest listener ownership is unavailable.' }
                $directEndpoint = 'tcp://' + $guestAddress + ':2376'
                $directEngine = Native -Executable $docker -Arguments @('--host', $directEndpoint, 'info', '--format', '{{json .}}') -TimeoutSeconds 30 | ConvertFrom-Json
                if ($directEngine.ID -cne $observed.ID -or $directEngine.OSType -cne 'linux' -or "mx.pos-hosted-rehearsal=$owner" -cnotin $directEngine.Labels) { throw 'The direct diagnostic endpoint is not the exact owned daemon.' }
                $directOutput = Native -Executable $docker -Arguments @('--host', $directEndpoint, 'exec', $canaryId, 'sha256sum', '/fixture/canary.txt') -TimeoutSeconds 30 -CloseInput
                $diagnostic.directGuestDaemon = 'same-owned-daemon'
                $diagnostic.directGuestStdout = Canary-Measurement $directOutput $expectedHash
                $diagnostic.directGuestStderr = Canary-Measurement (Get-Content -LiteralPath (Join-Path $WorkDirectory 'native-stderr.log') -Raw) $expectedHash
            } catch { $diagnostic.directGuestStdout = 'unavailable' }
            finally {
                if ($guestControlPid -cmatch '^[1-9][0-9]*$') {
                    try {
                        [void](Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $guestControlScript), $guestAddress, $windowsGateway, $owner, 'stop', $guestControlPid) -TimeoutSeconds 30)
                        $diagnostic.directGuestListenerRemoved = $true
                    } catch { $diagnostic.directGuestListenerRemoved = $false }
                }
            }
            Write-Host ('Synthetic canary transport diagnostics: ' + ($diagnostic | ConvertTo-Json -Compress))
            [IO.File]::WriteAllText((Join-Path $WorkDirectory 'transport-diagnostic.json'), ($diagnostic | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        }
        $composeHash = Canary-Hash $composeOutput $expectedHash 'Actual Windows Compose bind'
        [void](Docker @('cp', $canary, "${canaryId}:/tmp/pipe-copy.txt"))
        [void](Canary-Hash (Docker @('exec', $canaryId, 'sha256sum', '/tmp/pipe-copy.txt')) $expectedHash 'Binary Docker API copy')
        foreach ($port in @(58000, 55432, 55541, 55542, 55543, 55544)) {
            [void](Wait-Native { $body = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/canary.txt" -TimeoutSec 2).Content; if ($body -ceq $canaryText) { $true } } 45 "Waiting for real container port $port through Windows loopback.")
        }
        $rawWrapper = Join-Path $WorkDirectory 'DockerLoopbackRaw.exe'
        [void](Native $compiler @('/nologo', '/target:exe', "/out:$rawWrapper", (Join-Path $PSScriptRoot '../staging/docker-loopback.cs')))
        [void](Native $rawWrapper @('--pos-cafe-self-test'))
        $rawId = (Native $rawWrapper @('create', '--name', $rawName, '--label', "mx.pos-hosted-rehearsal=$owner", '-v', "${canary}:/fixture/canary.txt:ro", 'alpine:3.22', 'sha256sum', '/fixture/canary.txt')).Trim()
        $rawHash = Canary-Hash (Docker @('start', '--attach', $rawId)) $expectedHash 'Attested raw Docker CLI bind'
    } finally {
        if ($rawId) {
            $rawOwner = (Docker @('inspect', '--format', '{{index .Config.Labels "mx.pos-hosted-rehearsal"}}', $rawId)).Trim()
            if ($rawOwner -cne $owner) { throw 'Refusing to remove an unowned canary container.' }
            [void](Docker @('rm', $rawId))
        }
        if (Test-Path -LiteralPath $composeFile) { [void](Docker @('compose', '--project-name', $project, '-f', $composeFile, 'down', '--volumes')) }
    }
    $receipt = Join-Path $WorkDirectory 'engine.json'
    @{ version = 2; owner = $owner; distribution = $distribution; kernel = $kernel.Trim(); daemonId = $observed.ID;
       docker = $docker; context = $contextName; endpoint = 'tcp://127.0.0.1:2375'; runId = $env:GITHUB_RUN_ID; job = $env:GITHUB_JOB;
       keepAlivePid = $keepAlive.Id; completedAt = [DateTimeOffset]::UtcNow.ToString('o');
       parity = @{ composeBindSha256 = $composeHash; rawBindSha256 = $rawHash; binaryCopySha256 = $expectedHash; loopbackPorts = @(58000,55432,55541,55542,55543,55544) } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
    foreach ($entry in @("POS_CAFE_REAL_DOCKER=$docker", 'POS_TEST_WSL_ENGINE=1', 'COMPOSE_CONVERT_WINDOWS_PATHS=1', "POS_TEST_WSL_RECEIPT=$receipt")) {
        Add-Content -LiteralPath $env:GITHUB_ENV -Value $entry -Encoding utf8NoBOM
    }
    Write-Host "Owned real WSL Docker engine ready; parity receipt: $receipt"
} catch {
    if ($ownedContext) {
        if ((Docker @('context', 'show')).Trim() -ceq $ownedContext) { [void](Docker @('context', 'use', 'default')) }
        $contextInfo = Docker @('context', 'inspect', $ownedContext) | ConvertFrom-Json
        if (@($contextInfo).Count -eq 1 -and $contextInfo[0].Name -ceq $ownedContext -and
            $contextInfo[0].Endpoints.docker.Host -ceq 'tcp://127.0.0.1:2375') { [void](Docker @('context', 'rm', $ownedContext)) }
    }
    if ($keepAlive -and !$keepAlive.HasExited) { $keepAlive.Kill($true); $keepAlive.WaitForExit() }
    if ($createdDistro) { & wsl.exe --terminate $distribution | Out-Null }
    throw
}
