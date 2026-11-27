#Requires -Version 7.2
[CmdletBinding()]
param([string]$WorkDirectory, [switch]$Cleanup)
$ErrorActionPreference = 'Stop'

# Never enroll an owner's PC, an existing WSL distro or a nonempty Docker host.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
    $env:POS_ACCEPTANCE_DISPOSABLE -cne '1' -or !$env:GITHUB_RUN_ID -or !$env:RUNNER_TRACKING_ID -or !$env:RUNNER_TEMP -or !$env:GITHUB_ENV) {
    throw 'This bootstrap requires a fresh explicitly enrolled GitHub-hosted Windows 2025 job.'
}
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
function Quote-WindowsArguments([string[]]$Values) {
    ($Values | ForEach-Object {
        # WSL parses its own option tokens before launching Linux. Leave plain
        # flags/values unquoted; apply Windows escaping only when needed.
        if ($_.Length -gt 0 -and $_ -notmatch '[\s"]') { $_; return }
        $quoted = [Text.StringBuilder]::new('"'); $slashes = 0
        foreach ($character in $_.ToCharArray()) {
            if ($character -eq '\') { $slashes++; continue }
            if ($character -eq '"') { [void]$quoted.Append('\', $slashes * 2 + 1) }
            else { [void]$quoted.Append('\', $slashes) }
            [void]$quoted.Append($character); $slashes = 0
        }
        [void]$quoted.Append('\', $slashes * 2); [void]$quoted.Append('"'); $quoted.ToString()
    }) -join ' '
}
function Assert-OwnedKeepAlive($Process, $Receipt, [string]$ExpectedExecutable) {
    if ($Receipt.owner -cnotmatch '^[a-f0-9]{32}$' -or $Receipt.distribution -cne 'Ubuntu-24.04' -or
        $Receipt.keepAliveExecutable -ine $ExpectedExecutable -or $Process.ExecutablePath -ine $ExpectedExecutable -or
        $Process.ProcessId -ne $Receipt.keepAlivePid -or
        !$Process.CommandLine.Contains('POS_HOSTED_OWNER=' + $Receipt.owner) -or
        !$Process.CommandLine.Contains('--distribution') -or !$Process.CommandLine.Contains($Receipt.distribution) -or
        !$Process.CommandLine.Contains('/usr/bin/env') -or !$Process.CommandLine.Contains('sleep') -or !$Process.CommandLine.Contains('infinity') -or
        [Int64]::Parse($Receipt.keepAliveStartedTicks, [Globalization.CultureInfo]::InvariantCulture) -ne $Process.CreationDate.ToUniversalTime().Ticks) {
        throw 'Refusing to stop a reused or unowned WSL keepalive PID.'
    }
}
if ($Cleanup) {
    $receiptPath = [IO.Path]::GetFullPath($env:POS_TEST_WSL_RECEIPT)
    if (!$receiptPath.StartsWith($runnerTemp + '\', [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($receiptPath) -cne 'engine.json') { throw 'Cleanup requires the owned runner receipt.' }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $ownedDirectory = [IO.Path]::GetDirectoryName($receiptPath)
    $expectedSsh = (Get-Command ssh.exe -ErrorAction Stop).Source
    if ($receipt.version -ne 1 -or $receipt.transportCarrier -cne 'windows-openssh' -or
        $receipt.owner -cnotmatch '^[a-f0-9]{32}$' -or $receipt.sshExecutable -ine $expectedSsh -or
        $receipt.transport -cne 'tcp://127.0.0.1:2375') { throw 'The cleanup receipt is not an owned OpenSSH fixture.' }
    foreach ($entry in @(@{ property = 'keyFile'; name = 'fixture-ssh-key' }, @{ property = 'knownHostsFile'; name = 'fixture-known-hosts' })) {
        if ([IO.Path]::GetFullPath($receipt.($entry.property)) -ine (Join-Path $ownedDirectory $entry.name)) { throw 'The fixture key path is not owned.' }
    }
    $tunnelProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$receipt.tunnelPid)
    if ($tunnelProcess) {
        $ownedCommand = $tunnelProcess.CommandLine.Replace('\', '/')
        if ($tunnelProcess.ExecutablePath -ine $expectedSsh -or !$ownedCommand.Contains($receipt.keyFile.Replace('\', '/')) -or
            !$ownedCommand.Contains($receipt.knownHostsFile.Replace('\', '/'))) { throw 'Refusing to stop a reused or unowned tunnel PID.' }
        Stop-Process -Id ([int]$receipt.tunnelPid) -ErrorAction Stop
        Write-Host 'Stopped the verified owned OpenSSH tunnel.'
    } else {
        Write-Host 'The owned OpenSSH tunnel had already exited.'
    }
    foreach ($file in @($receipt.keyFile, ($receipt.keyFile + '.pub'), $receipt.knownHostsFile)) {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
    Write-Host 'Removed the owned OpenSSH fixture keys.'
    $expectedWsl = (Get-Command wsl.exe -ErrorAction Stop).Source
    if ($receipt.keepAlivePid -le 0) { throw 'The WSL keepalive identity is missing.' }
    $keepAliveProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$receipt.keepAlivePid)
    if ($keepAliveProcess) {
        Assert-OwnedKeepAlive $keepAliveProcess $receipt $expectedWsl
        Stop-Process -Id ([int]$receipt.keepAlivePid) -ErrorAction Stop
        Write-Host 'Stopped the verified owned WSL keepalive.'
    } else {
        Write-Host 'The owned WSL keepalive had already exited.'
    }
    return
}
$owner = [guid]::NewGuid().ToString('N')
if (!$WorkDirectory) { $WorkDirectory = Join-Path $runnerTemp "pos-wsl-engine-$owner" }
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
if (!$WorkDirectory.StartsWith($runnerTemp + '\', [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $WorkDirectory)) { throw 'Use a new owned directory beneath RUNNER_TEMP.' }
[void](New-Item -ItemType Directory -Path $WorkDirectory)
$docker = (Get-Command docker.exe -ErrorAction Stop).Source
if (![IO.Path]::IsPathRooted($docker)) { throw 'The official installed Windows Docker CLI is required.' }
$distribution = 'Ubuntu-24.04'
$createdDistro = $false; $keepAlive = $null; $tunnel = $null; $selectedLinux = $false

function Native {
    param([Parameter(Position=0)][string]$Executable, [Parameter(Position=1,ValueFromRemainingArguments=$true)][string[]]$Arguments,
        [ValidateRange(1,900)][int]$TimeoutSeconds = 600)
    # Docker emits pull progress on stderr even when create succeeds. Keep its
    # machine-readable stdout (IDs/hashes/JSON) separate from diagnostics.
    $label = (Split-Path -Leaf $Executable) + ' ' + (($Arguments | Select-Object -First 2) -join ' ')
    Write-Host "Owned host check: $label"
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true); $process.WaitForExit()
            throw "Owned host command exceeded its ${TimeoutSeconds}s deadline: $label"
        }
        $result = $stdout.GetAwaiter().GetResult(); $diagnostics = $stderr.GetAwaiter().GetResult()
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

function Write-OwnedFailureDiagnostics {
    # Observe before teardown. Never boot a stopped guest while investigating
    # whether WSL itself exited, and never read fixture private-key material.
    foreach ($entry in @(@{ name = 'ssh'; process = $tunnel }, @{ name = 'keepalive'; process = $keepAlive })) {
        if ($entry.process) {
            $entry.process.Refresh()
            $state = if ($entry.process.HasExited) { 'exited code ' + $entry.process.ExitCode } else { 'running' }
            Write-Host ('Owned failure snapshot: ' + $entry.name + ' PID ' + $entry.process.Id + ' ' + $state)
        }
        $logFile = Join-Path $WorkDirectory ($entry.name + '.stderr.log')
        if (Test-Path -LiteralPath $logFile) {
            foreach ($line in @(Get-Content -LiteralPath $logFile -Tail 15 -ErrorAction SilentlyContinue)) {
                if ($line -match '(?i)password|PRIVATE KEY|authorization|token|secret') { continue }
                Write-Host ('Owned ' + $entry.name + ' stderr: ' + $line.Substring(0, [Math]::Min(400, $line.Length)))
            }
        }
    }
    try {
        $running = Native 'wsl.exe' @('--list', '--running', '--quiet') -TimeoutSeconds 8
        $guestRunning = $distribution -cin @($running -split '\r?\n' | ForEach-Object { $_.Trim() })
        Write-Host ('Owned failure snapshot: guest already running = ' + $guestRunning)
        if ($createdDistro -and $guestRunning) {
            $probe = 'test "$(cat /etc/pos-hosted-rehearsal)" = "' + $owner + '" || exit 90; ' +
                'printf "Owned guest service state:\n"; systemctl is-active docker pos-hosted-ssh; ' +
                'journalctl --no-pager -n 25 -u docker -u pos-hosted-ssh; ' +
                'printf "Owned guest keepalive:\n"; pgrep -af "sleep infinity" || true'
            Write-Host (Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'bash', '-c', $probe) -TimeoutSeconds 10)
        }
    } catch { Write-Host ('Owned guest diagnostic unavailable: ' + $_.Exception.Message) }
}

try {
    if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw 'A preselected Docker override is not a fresh default runner.' }
    if ((Docker @('context', 'show')).Trim() -cne 'default') { throw 'Leave an existing nondefault Docker context intact.' }
    $endpoint = Docker @('context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}')
    if ($endpoint.Trim() -cne 'npipe:////./pipe/docker_engine') { throw 'The runner default Docker endpoint is unexpected.' }
    $windowsInfo = Docker @('--host', $endpoint.Trim(), 'info', '--format', '{{json .}}') | ConvertFrom-Json
    if ($windowsInfo.OSType -cne 'windows' -or !$windowsInfo.ID) { throw 'An existing Linux engine must be left intact.' }
    if ((Docker @('ps', '-aq')).Trim() -or (Docker @('volume', 'ls', '-q')).Trim()) { throw 'The runner has existing containers or volumes; leave them intact.' }
    $networks = (Docker @('network', 'ls', '--format', '{{.Name}}')) -split '\r?\n'
    if (@($networks | Where-Object { $_ -and $_ -cnotin @('nat', 'none') }).Count) { throw 'The runner Docker host has a nondefault network.' }
    $windowsDocker = Get-CimInstance Win32_Service -Filter "Name='docker'"
    if (!$windowsDocker -or $windowsDocker.PathName -notmatch 'dockerd\.exe' -or $windowsDocker.State -cne 'Running' -or !$windowsDocker.ProcessId) { throw 'The standard Windows Docker service was not identified.' }
    $windowsServicePid = $windowsDocker.ProcessId
    Free-Ports @(2375, 3180, 58000, 55432, 55541, 55542, 55543, 55544)
    $listed = (& wsl.exe --list --quiet 2>&1 | Out-String).Replace([string][char]0, '').Trim()
    if ($LASTEXITCODE -eq 0 -and $listed) { throw 'An existing WSL distribution must be left intact.' }
    if ($LASTEXITCODE -ne 0 -and $listed -notmatch 'no installed distributions') { throw 'Could not establish that the WSL host is empty.' }
    [void](Native 'wsl.exe' @('--install', '--distribution', $distribution, '--no-launch', '--web-download'))
    $createdDistro = $true
    $kernel = Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'uname', '-r')
    if ($kernel -notmatch 'microsoft-standard-WSL2') { throw 'The disposable distro did not boot a genuine WSL2 Linux kernel.' }
    $guestAddress = (Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'hostname', '-I')).Trim().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)[0]
    $parsedAddress = $null
    if (![Net.IPAddress]::TryParse($guestAddress, [ref]$parsedAddress) -or
        $guestAddress -notmatch '^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)') { throw 'The owned WSL guest did not expose a private IPv4 address.' }
    $ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
    $keygen = Join-Path ([IO.Path]::GetDirectoryName($ssh)) 'ssh-keygen.exe'
    $keyFile = Join-Path $WorkDirectory 'fixture-ssh-key'
    $knownHostsFile = Join-Path $WorkDirectory 'fixture-known-hosts'
    [void](Native $keygen @('-q', '-t', 'ed25519', '-N', '', '-f', $keyFile))
    $guestScript = Join-Path $WorkDirectory 'guest-bootstrap.sh'
    @'
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io openssh-server
for drive in c d; do
  if [ -d "/mnt/$drive" ]; then
    test ! -e "/$drive"
    ln -s "/mnt/$drive" "/$drive"
  fi
done
test "$(cat /proc/1/comm)" = systemd
install -d /etc/docker /etc/systemd/system/docker.service.d
printf '{"userland-proxy":true,"labels":["mx.pos-hosted-rehearsal=__OWNER__"]}\n' > /etc/docker/daemon.json
printf '[Service]\nExecStart=\nExecStart=%s -H fd:// -H tcp://127.0.0.1:2376 --tls=false --containerd=/run/containerd/containerd.sock\n' "$(command -v dockerd)" > /etc/systemd/system/docker.service.d/pos-hosted.conf
printf '__OWNER__\n' > /etc/pos-hosted-rehearsal
systemctl daemon-reload
systemctl enable --now containerd
systemctl restart docker
install -d -m 700 /root/.ssh /run/sshd
printf 'restrict,port-forwarding,permitopen="127.0.0.1:2376" __PUBLIC_KEY__\n' > /root/.ssh/pos-hosted-authorized
chmod 600 /root/.ssh/pos-hosted-authorized
cat > /etc/ssh/pos-hosted.conf <<'SSHCONFIG'
Port 22222
ListenAddress __GUEST_IP__
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /run/pos-hosted-sshd.pid
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
UsePAM yes
AuthorizedKeysFile /root/.ssh/pos-hosted-authorized
AllowUsers root
AllowTcpForwarding local
PermitOpen 127.0.0.1:2376
X11Forwarding no
AllowAgentForwarding no
PermitTTY no
SSHCONFIG
systemctl disable --now ssh.socket ssh.service || true
cat > /etc/systemd/system/pos-hosted-ssh.service <<'SSHUNIT'
[Unit]
After=network.target
[Service]
ExecStart=/usr/sbin/sshd -D -e -f /etc/ssh/pos-hosted.conf
Restart=on-failure
[Install]
WantedBy=multi-user.target
SSHUNIT
systemctl daemon-reload
sshd -t -f /etc/ssh/pos-hosted.conf
systemctl enable --now pos-hosted-ssh
docker info --format '{{.OSType}}'
'@.Replace('__OWNER__', $owner).Replace('__GUEST_IP__', $guestAddress).Replace('__PUBLIC_KEY__', (Get-Content -LiteralPath ($keyFile + '.pub') -Raw).Trim()).Replace("`r`n", "`n") | Set-Content -LiteralPath $guestScript -Encoding utf8NoBOM
    [void](Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'bash', (Guest-Path $guestScript)))
    $wslExecutable = (Get-Command wsl.exe -ErrorAction Stop).Source
    $keepAliveArguments = Quote-WindowsArguments @('--distribution', $distribution, '--user', 'root', '--',
        '/usr/bin/env', "POS_HOSTED_OWNER=$owner", 'sleep', 'infinity')
    $keepAlive = Start-Process -FilePath $wslExecutable -ArgumentList $keepAliveArguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $WorkDirectory 'keepalive.stdout.log') `
        -RedirectStandardError (Join-Path $WorkDirectory 'keepalive.stderr.log')
    $keepAliveIdentity = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $keepAlive.Id)
    if (!$keepAliveIdentity) { throw 'The owned WSL keepalive exited before its identity was captured.' }
    $keepAliveStartedTicks = $keepAliveIdentity.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
    $hostPublicKey = (Native 'wsl.exe' @('--distribution', $distribution, '--user', 'root', '--', 'cat', '/etc/ssh/ssh_host_ed25519_key.pub')).Trim()
    if ($hostPublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$') { throw 'The owned guest host key was not obtained.' }
    [IO.File]::WriteAllText($knownHostsFile, "[$guestAddress]:22222 $hostPublicKey`n", [Text.UTF8Encoding]::new($false))
    $sshArguments = @('-F', 'NUL', '-n', '-N', '-T', '-p', '22222', '-i', $keyFile,
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
        '-o', 'StrictHostKeyChecking=yes', '-o', ('UserKnownHostsFile="' + $knownHostsFile.Replace('\', '/') + '"'),
        '-o', 'GlobalKnownHostsFile=NUL', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-L', '127.0.0.1:2375:127.0.0.1:2376', "root@$guestAddress")
    # Start-Process owns file-backed stdio rather than the transient step's
    # console handles. Quote Windows argv explicitly, including embedded quotes
    # in OpenSSH options and any spaces in the owned temporary directory.
    $sshCommandLine = Quote-WindowsArguments $sshArguments
    $tunnel = Start-Process -FilePath $ssh -ArgumentList $sshCommandLine -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $WorkDirectory 'ssh.stdout.log') `
        -RedirectStandardError (Join-Path $WorkDirectory 'ssh.stderr.log')
    $linuxInfo = Wait-Native { (Docker @('--host', 'tcp://127.0.0.1:2375', 'info', '--format', '{{json .}}')) | ConvertFrom-Json } 120 'Waiting for the owned WSL Linux engine on Windows loopback.'
    if ($linuxInfo.OSType -cne 'linux' -or "mx.pos-hosted-rehearsal=$owner" -cnotin $linuxInfo.Labels) { throw 'The guest daemon identity was not established.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 2375 -ErrorAction Stop)
    if ($tunnel.HasExited -or @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' -or $_.OwningProcess -ne $tunnel.Id }).Count) { throw 'The Docker API must be owned by the OpenSSH tunnel on Windows loopback.' }

    # Use the official client's supported TCP transport. The existing Windows
    # Docker service, default context and named pipe remain entirely untouched.
    $env:DOCKER_HOST = 'tcp://127.0.0.1:2375'
    $selectedLinux = $true
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $observed = Docker @('info', '--format', '{{json .}}') | ConvertFrom-Json
    if ($observed.ID -cne $linuxInfo.ID -or $observed.OSType -cne 'linux') { throw 'Official Windows Docker CLI does not reach the owned Linux daemon.' }
    Write-Host (Docker @('version'))
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
    $rawName = 'pos-hosted-raw-' + $owner; $rawId = $null; $canaryFailure = $null
    try {
        [void](Docker @('compose', '--project-name', $project, '-f', $composeFile, 'up', '-d'))
        $canaryId = (Docker @('compose', '--project-name', $project, '-f', $composeFile, 'ps', '-q', 'canary')).Trim()
        $composeOutput = Docker @('exec', $canaryId, 'sha256sum', '/fixture/canary.txt')
        $composeHash = $composeOutput.Split(' ')[0]
        if ($composeHash -cne $expectedHash) {
            throw ('The actual Windows Compose bind does not expose the intended host bytes. Expected ' + $expectedHash + '; actual stdout ' + (ConvertTo-Json -InputObject $composeOutput -Compress))
        }
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
    } catch {
        $canaryFailure = $_
        throw
    } finally {
        $cleanupFailure = $null
        try {
            if ($rawId) {
                $rawOwner = (Native $docker @('inspect', '--format', '{{index .Config.Labels "mx.pos-hosted-rehearsal"}}', $rawId) -TimeoutSeconds 15).Trim()
                if ($rawOwner -cne $owner) { throw 'Refusing to remove an unowned canary container.' }
                [void](Native $docker @('rm', $rawId) -TimeoutSeconds 15)
            }
        } catch { $cleanupFailure = $_ }
        try {
            if (Test-Path -LiteralPath $composeFile) {
                [void](Native $docker @('compose', '--project-name', $project, '-f', $composeFile, 'down', '--volumes') -TimeoutSeconds 45)
            }
        } catch { if (!$cleanupFailure) { $cleanupFailure = $_ } }
        if ($cleanupFailure) {
            if ($canaryFailure) { Write-Host ('Secondary canary cleanup failure: ' + $cleanupFailure.Exception.Message) }
            else { throw $cleanupFailure }
        }
    }
    $windowsAfter = Docker @('--host', $endpoint.Trim(), 'info', '--format', '{{json .}}') | ConvertFrom-Json
    $serviceAfter = Get-CimInstance Win32_Service -Filter "Name='docker'"
    if ($windowsAfter.ID -cne $windowsInfo.ID -or $windowsAfter.OSType -cne 'windows' -or
        $serviceAfter.ProcessId -ne $windowsServicePid -or $serviceAfter.State -cne 'Running' -or
        (Docker @('--host', $endpoint.Trim(), 'ps', '-aq')).Trim() -or
        (Docker @('--host', $endpoint.Trim(), 'volume', 'ls', '-q')).Trim()) {
        throw 'The existing Windows Docker daemon did not remain unchanged and empty.'
    }
    $receipt = Join-Path $WorkDirectory 'engine.json'
    @{ version = 1; owner = $owner; distribution = $distribution; kernel = $kernel.Trim(); daemonId = $observed.ID;
       docker = $docker; transport = 'tcp://127.0.0.1:2375'; transportCarrier = 'windows-openssh';
       tunnelPid = $tunnel.Id; sshExecutable = $ssh; keyFile = $keyFile; knownHostsFile = $knownHostsFile;
       windowsHostUnchanged = $true;
       windowsDaemonId = $windowsInfo.ID; windowsServicePid = $windowsServicePid;
       keepAlivePid = $keepAlive.Id; keepAliveExecutable = $wslExecutable; keepAliveStartedTicks = $keepAliveStartedTicks;
       completedAt = [DateTimeOffset]::UtcNow.ToString('o');
       parity = @{ composeBindSha256 = $composeHash; rawBindSha256 = $rawHash; binaryCopySha256 = $expectedHash; loopbackPorts = @(58000,55432,55541,55542,55543,55544) } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
    foreach ($entry in @("POS_CAFE_REAL_DOCKER=$docker", 'POS_TEST_WSL_ENGINE=1', 'COMPOSE_CONVERT_WINDOWS_PATHS=1', 'DOCKER_HOST=tcp://127.0.0.1:2375', "POS_TEST_WSL_RECEIPT=$receipt")) {
        Add-Content -LiteralPath $env:GITHUB_ENV -Value $entry -Encoding utf8NoBOM
    }
    $env:POS_TEST_WSL_RECEIPT = $receipt
    Write-Host "Owned real WSL Docker engine ready; parity receipt: $receipt"
} catch {
    $bootstrapFailure = $_
    try { Write-OwnedFailureDiagnostics } catch { Write-Host 'Owned failure snapshot could not complete.' }
    try {
        if ($tunnel -and !$tunnel.HasExited) { $tunnel.Kill(); [void]$tunnel.WaitForExit(5000) }
    } catch { Write-Host 'Secondary teardown failure while stopping the owned SSH process.' }
    if ($keyFile) {
        foreach ($file in @($keyFile, ($keyFile + '.pub'), $knownHostsFile)) {
            if ($file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
        }
    }
    try {
        if ($keepAlive -and !$keepAlive.HasExited) { $keepAlive.Kill($true); [void]$keepAlive.WaitForExit(5000) }
    } catch { Write-Host 'Secondary teardown failure while stopping the owned WSL keepalive.' }
    if ($createdDistro) {
        try { [void](Native 'wsl.exe' @('--terminate', $distribution) -TimeoutSeconds 10) }
        catch { Write-Host 'Secondary teardown failure while terminating the owned guest.' }
    }
    if ($selectedLinux) { Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue }
    throw $bootstrapFailure
}
