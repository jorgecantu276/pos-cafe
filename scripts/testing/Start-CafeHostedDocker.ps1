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
$createdDistro = $false; $keepAlive = $null; $ownedContext = $null; $ownedProxy = $null

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
        if ($process.ExitCode -ne 0) {
            $failure = [InvalidOperationException]::new("$(Split-Path -Leaf $Executable) failed: $diagnostics $result")
            $failure.Data['ExitCode'] = $process.ExitCode
            throw $failure
        }
        return $result.Replace([string][char]0, '').TrimEnd("`r", "`n")
    } finally {
        $process.Dispose()
    }
}
function Docker {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    Native -Executable $docker -Arguments $Arguments -CloseInput
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

function Start-OwnedGuestDockerProxy {
    $interfaces = Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'ip', '-j', '-4', 'address', 'show', 'eth0') -TimeoutSeconds 30 | ConvertFrom-Json
    $routes = Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'ip', '-j', '-4', 'route', 'show', 'default') -TimeoutSeconds 30 | ConvertFrom-Json
    $addresses = @($interfaces[0].addr_info | Where-Object { $_.family -ceq 'inet' -and $_.scope -ceq 'global' })
    if (@($interfaces).Count -ne 1 -or $interfaces[0].ifname -cne 'eth0' -or $addresses.Count -ne 1 -or @($routes).Count -ne 1 -or $routes[0].dev -cne 'eth0') { throw 'The owned WSL network is ambiguous.' }
    $guestAddress = Private-IPv4 ([string]$addresses[0].local)
    $windowsGateway = Private-IPv4 ([string]$routes[0].gateway)
    $gateway = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $windowsGateway -ErrorAction SilentlyContinue)
    if ($guestAddress -ceq $windowsGateway -or $gateway.Count -ne 1) { throw 'The exact WSL gateway must belong to this Windows host.' }
    $proxyScript = Join-Path $WorkDirectory 'guest-transport-control.sh'
    $proxyText = @'
#!/bin/bash
set -euo pipefail
test "$(cat /etc/pos-hosted-rehearsal)" = "$3"
pidfile="/run/pos-transport-$3.pid"
unit="pos-transport-$3.service"
binding="TCP4-LISTEN:2376,bind=$1,range=$2/32,reuseaddr,fork"
if [ "$4" = stop ] && [ ! -e "$pidfile" ] && [ "$(systemctl show "$unit" --property=LoadState --value)" = not-found ]; then
  test -z "$(ss -ltnH 'sport = :2376')"
  exit 0
fi
if [ "$4" = start ]; then
  test ! -e "$pidfile"
  test -z "$(ss -ltnH 'sport = :2376')"
  test "$(systemctl show "$unit" --property=LoadState --value)" = not-found
  systemd-run --quiet --unit="$unit" --collect --description="POS hosted transport $3" /usr/bin/socat "$binding" UNIX-CONNECT:/var/run/docker.sock
  sleep 0.2
  child=$(systemctl show "$unit" --property=MainPID --value)
  test "$child" -gt 0
  printf '%s\n' "$child" > "$pidfile"
else
  child=$(cat "$pidfile")
  test "$child" = "$5"
fi
test "$(systemctl show "$unit" --property=Description --value)" = "POS hosted transport $3"
test "$(systemctl show "$unit" --property=MainPID --value)" = "$child"
systemctl is-active --quiet "$unit"
test "$(cat "/proc/$child/comm")" = socat
arguments=$(tr '\0' ' ' < "/proc/$child/cmdline")
test "$arguments" = "/usr/bin/socat $binding UNIX-CONNECT:/var/run/docker.sock "
entry=$(systemctl show "$unit" --property=ExecStart --value)
case "$entry" in "{ path=/usr/bin/socat ; argv[]=/usr/bin/socat $binding UNIX-CONNECT:/var/run/docker.sock ; "*) ;; *) exit 8 ;; esac
if [ "$4" = stop ]; then
  systemctl stop "$unit"
  rm -- "$pidfile"
  test -z "$(ss -ltnH 'sport = :2376')"
elif [ "$4" = start ]; then
  printf '%s\n' "$child"
elif [ "$4" = check ]; then
  printf 'owned-listener-active\n'
else
  exit 9
fi
'@
    Write-LinuxScript $proxyScript $proxyText
    [void](Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'bash', '-n', (Guest-Path $proxyScript)) -TimeoutSeconds 30)
    $proxyPid = (Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $proxyScript), $guestAddress, $windowsGateway, $owner, 'start') -TimeoutSeconds 30).Trim()
    if ($proxyPid -cnotmatch '^[1-9][0-9]*$') { throw 'The owned Docker proxy PID is unavailable.' }
    $proxy = @{ guestAddress = $guestAddress; windowsGateway = $windowsGateway; gatewayInterfaceIndex = $gateway[0].InterfaceIndex;
        guestPrefixLength = [int]$addresses[0].prefixlen; unit = ('pos-transport-' + $owner + '.service'); pid = [int]$proxyPid;
        script = $proxyScript; scriptSha256 = (Get-FileHash -LiteralPath $proxyScript -Algorithm SHA256).Hash.ToLowerInvariant();
        endpoint = ('tcp://' + $guestAddress + ':2376') }
    Invoke-OwnedGuestDockerProxy $proxy 'check'
    return $proxy
}
function Invoke-OwnedGuestDockerProxy($Proxy, [ValidateSet('check','stop')][string]$Action) {
    if ($Proxy.script -cne (Join-Path $WorkDirectory 'guest-transport-control.sh') -or
        (Get-FileHash -LiteralPath $Proxy.script -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Proxy.scriptSha256) { throw 'The owned proxy helper changed.' }
    $response = Native -Executable 'wsl.exe' -Arguments @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $Proxy.script), $Proxy.guestAddress, $Proxy.windowsGateway, $owner, $Action, ([string]$Proxy.pid)) -TimeoutSeconds 30
    if ($Action -ceq 'check' -and $response.Trim() -cne 'owned-listener-active') { throw 'The exact owned proxy did not confirm liveness.' }
}
function Get-CanaryWindowsConnections([int]$Port) {
    return @(Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object {
        $processName = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        @{ state = [string]$_.State; localAddress = [string]$_.LocalAddress; process = [string]$processName }
    })
}
function Write-CanaryForwardingDiagnostics([string]$Container, [string]$ExpectedHash, $Before) {
    # Synthetic-only failure evidence. Keep the failed strict loopback check;
    # guest success or a retry never qualifies installation acceptance.
    $report = @{ version = 1; ports = @(); before = $Before }
    try {
        $containerInfo = (Docker @('inspect', $Container) | ConvertFrom-Json)[0]
        if ($containerInfo.Config.Labels.'mx.pos-hosted-rehearsal' -cne $owner) { throw 'Unowned canary diagnostic refused.' }
        $report.container = @{ running = $containerInfo.State.Running; status = $containerInfo.State.Status; bindings = $containerInfo.NetworkSettings.Ports }
        $report.windowsDynamicTcpRange = (Native -Executable 'netsh.exe' -Arguments @('int','ipv4','show','dynamicport','tcp') -TimeoutSeconds 10)
        $report.windowsExcludedTcpRanges = (Native -Executable 'netsh.exe' -Arguments @('int','ipv4','show','excludedportrange','protocol=tcp') -TimeoutSeconds 10)
        foreach ($port in @(58000,55432,15541,15542,15543,15544)) {
            $row = @{ port = $port; windowsConnections = @(Get-CanaryWindowsConnections $port) }
            try {
                $body = Native -Executable 'wsl.exe' -Arguments @('--distribution',$distribution,'--user','root','--','docker','run','--rm','--network','host','--label',"mx.pos-hosted-rehearsal=$owner",'busybox:1.37','wget','-T','3','-q','-O','-',"http://127.0.0.1:$port/canary.txt") -TimeoutSeconds 10
                $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($body))).ToLowerInvariant()
                $row.guestBodySha256 = $digest; $row.guestExactBody = $digest -ceq $ExpectedHash
            } catch { $row.guestExactBody = $false; $row.guestFailure = $_.Exception.GetType().Name }
            $row.windowsRetries = @()
            foreach ($attempt in 1..2) {
                try {
                    $body = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/canary.txt" -TimeoutSec 3).Content
                    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($body))).ToLowerInvariant()
                    $row.windowsRetries += @{ sha256 = $digest; exactBody = $digest -ceq $ExpectedHash }
                } catch { $row.windowsRetries += @{ exactBody = $false; failure = $_.Exception.GetType().Name } }
            }
            $report.ports += $row
        }
    } catch { $report.failure = $_.Exception.GetType().Name }
    [IO.File]::WriteAllText((Join-Path $WorkDirectory 'canary-forwarding.json'), ($report | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
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
    Free-Ports @(2375, 3180, 58000, 55432, 15541, 15542, 15543, 15544)
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

    # The real byte-control proved this restricted same-host WSL path. Its
    # transient unit accepts only this Windows gateway; normal store transports
    # remain unchanged. Never emulate Docker API responses or streams.
    $ownedProxy = Start-OwnedGuestDockerProxy
    $proxyEngine = Docker @('--host', $ownedProxy.endpoint, 'info', '--format', '{{json .}}') | ConvertFrom-Json
    if ($proxyEngine.ID -cne $linuxInfo.ID -or $proxyEngine.OSType -cne 'linux' -or "mx.pos-hosted-rehearsal=$owner" -cnotin $proxyEngine.Labels) { throw 'The proxy must reach the same exact owned Linux daemon.' }
    $contextName = 'pos-hosted-' + $owner
    if (@((Docker @('context', 'ls', '--format', '{{.Name}}')) -split '\r?\n') -ccontains $contextName) { throw 'The owned context name already exists.' }
    [void](Docker @('context', 'create', $contextName, '--docker', ('host=' + $ownedProxy.endpoint)))
    $ownedContext = $contextName
    [void](Docker @('context', 'use', $contextName))
    $selectedContext = (Docker @('context', 'inspect')) | ConvertFrom-Json
    if (@($selectedContext).Count -ne 1 -or $selectedContext[0].Name -cne $contextName -or
        $selectedContext[0].Endpoints.docker.Host -cne $ownedProxy.endpoint) { throw 'The selected owned Docker context differs.' }
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
      - '127.0.0.1:15541:8080'
      - '127.0.0.1:15542:8080'
      - '127.0.0.1:15543:8080'
      - '127.0.0.1:15544:8080'
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
        $composeHash = Canary-Hash $composeOutput $expectedHash 'Actual Windows Compose bind'
        [void](Docker @('cp', $canary, "${canaryId}:/tmp/pipe-copy.txt"))
        [void](Canary-Hash (Docker @('exec', $canaryId, 'sha256sum', '/tmp/pipe-copy.txt')) $expectedHash 'Binary Docker API copy')
        $connectionsBefore = @(foreach ($port in @(58000,55432,15541,15542,15543,15544)) { @{ port = $port; connections = @(Get-CanaryWindowsConnections $port) } })
        try {
            foreach ($port in @(58000, 55432, 15541, 15542, 15543, 15544)) {
                [void](Wait-Native { $body = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/canary.txt" -TimeoutSec 2).Content; if ($body -ceq $canaryText) { $true } } 45 "Waiting for real container port $port through Windows loopback.")
            }
        } catch {
            Write-CanaryForwardingDiagnostics $canaryId $expectedHash $connectionsBefore
            throw
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
    Invoke-OwnedGuestDockerProxy $ownedProxy 'check'
    $receipt = Join-Path $WorkDirectory 'engine.json'
    @{ version = 3; owner = $owner; distribution = $distribution; kernel = $kernel.Trim(); daemonId = $observed.ID;
       docker = $docker; context = $contextName; endpoint = $ownedProxy.endpoint; proxy = $ownedProxy; runId = $env:GITHUB_RUN_ID; job = $env:GITHUB_JOB;
       keepAlivePid = $keepAlive.Id; completedAt = [DateTimeOffset]::UtcNow.ToString('o');
       parity = @{ composeBindSha256 = $composeHash; rawBindSha256 = $rawHash; binaryCopySha256 = $expectedHash; loopbackPorts = @(58000,55432,15541,15542,15543,15544) } } |
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
            $contextInfo[0].Endpoints.docker.Host -ceq $ownedProxy.endpoint) { [void](Docker @('context', 'rm', $ownedContext)) }
    }
    if ($ownedProxy) { try { Invoke-OwnedGuestDockerProxy $ownedProxy 'stop' } catch { Write-Host 'Owned proxy cleanup failed; the owned disposable distro will be terminated.' } }
    if ($keepAlive -and !$keepAlive.HasExited) { $keepAlive.Kill($true); $keepAlive.WaitForExit() }
    if ($createdDistro) { & wsl.exe --terminate $distribution | Out-Null }
    throw
}
