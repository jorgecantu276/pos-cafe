# Trust enrollment is available only to a new explicitly disposable hosted VM.
function Assert-HostedLanTrustHost {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
        $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
        $env:POS_ACCEPTANCE_DISPOSABLE -cne '1' -or $env:GITHUB_RUN_ID -cnotmatch '^[1-9][0-9]*$' -or
        !$env:GITHUB_JOB -or !$env:RUNNER_TRACKING_ID -or !$env:RUNNER_TEMP) { throw 'Synthetic trust requires an explicitly disposable fresh hosted Windows 2025 job.' }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'The fresh hosted job must already have its administrator token; never request elevation.' }
}

function Invoke-HostedBoundedProcess {
    param([string]$Executable, [string[]]$Arguments, [ValidateRange(1,120)][int]$Seconds,
        [hashtable]$ChildEnvironment = @{})
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true; $start.RedirectStandardInput = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    foreach ($name in $ChildEnvironment.Keys) { $start.Environment[$name] = $ChildEnvironment[$name] }
    $child = [Diagnostics.Process]::new(); $child.StartInfo = $start
    try {
        [void]$child.Start(); $child.StandardInput.Close()
        $stdout = $child.StandardOutput.ReadToEndAsync(); $stderr = $child.StandardError.ReadToEndAsync()
        if (!$child.WaitForExit($Seconds * 1000)) {
            $child.Kill($true); $child.WaitForExit()
            throw 'The owned hosted child exceeded its deadline and its process tree was stopped.'
        }
        $result = $stdout.GetAwaiter().GetResult(); $diagnostics = $stderr.GetAwaiter().GetResult()
        if ($child.ExitCode -ne 0) { throw ('The owned hosted child failed with exit code ' + $child.ExitCode + '. ' + $diagnostics) }
        return $result
    } finally { $child.Dispose() }
}

function Get-HostedTrustCertificate([string]$Thumbprint) {
    if ($Thumbprint -cnotmatch '^[A-F0-9]{40}$') { throw 'Unexpected synthetic CA thumbprint.' }
    try { return Get-Item -LiteralPath ('Cert:\LocalMachine\Root\' + $Thumbprint) -ErrorAction Stop }
    catch [Management.Automation.ItemNotFoundException] { return $null }
}
function Get-HostedCertificateHash($Certificate) {
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Certificate.RawData)).ToLowerInvariant()
}
function New-HostedLanTrustIdentity([string]$CertificateFile) {
    Assert-HostedLanTrustHost
    $temporary = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
    $file = [IO.Path]::GetFullPath($CertificateFile)
    if (!$file.StartsWith($temporary + '\',[StringComparison]::OrdinalIgnoreCase) -or $file.StartsWith('\\')) { throw 'Only this job generated temporary CA is eligible.' }
    $ancestor = Split-Path -Parent $file
    while ($ancestor -ine $temporary) {
        $item = Get-Item -LiteralPath $ancestor -Force
        if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The generated CA cannot traverse redirected directories.' }
        $ancestor = Split-Path -Parent $ancestor
        if (!$ancestor) { throw 'The CA escaped its runner temporary owner.' }
    }
    $item = Get-Item -LiteralPath $file -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 16384) { throw 'Use the generated normal public CA file.' }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($file)
    if ($certificate.HasPrivateKey -or $certificate.Subject -cne 'CN=POS Smoothies Local CA' -or $certificate.Issuer -cne $certificate.Subject) { throw 'Unexpected synthetic public CA identity.' }
    $thumbprint = $certificate.Thumbprint
    if ((Get-HostedTrustCertificate $thumbprint) -or (Test-Path -LiteralPath ('Cert:\CurrentUser\Root\' + $thumbprint) -ErrorAction Stop)) { throw 'The generated synthetic CA must be absent before enrollment.' }
    # Return cleanup identity BEFORE import. Import timeout/lost acknowledgment
    # still requires the caller finally to inspect and remove this exact CA.
    return @{ thumbprint = $thumbprint; sha256 = (Get-HostedCertificateHash $certificate); file = $file; store = 'LocalMachine\Root'; runId = $env:GITHUB_RUN_ID; job = $env:GITHUB_JOB }
}
function Add-HostedLanTrust($Identity) {
    Assert-HostedLanTrustHost
    if ($Identity.runId -cne $env:GITHUB_RUN_ID -or $Identity.job -cne $env:GITHUB_JOB -or $Identity.store -cne 'LocalMachine\Root' -or $Identity.sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-HostedTrustCertificate $Identity.thumbprint)) { throw 'The synthetic enrollment identity is not new for this job.' }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([string]$Identity.file)
    if ($certificate.Thumbprint -cne $Identity.thumbprint -or (Get-HostedCertificateHash $certificate) -cne $Identity.sha256) { throw 'The generated public CA changed before import.' }
    [void](Invoke-HostedBoundedProcess -Executable (Join-Path $env:WINDIR 'System32/certutil.exe') -Arguments @('-addstore','Root',$Identity.file) -Seconds 60)
    $stored = Get-HostedTrustCertificate $Identity.thumbprint
    if (!$stored -or (Get-HostedCertificateHash $stored) -cne $Identity.sha256) { throw 'The actual machine root does not match the generated CA.' }
}
function Remove-HostedLanTrust($Identity) {
    Assert-HostedLanTrustHost
    if ($Identity.runId -cne $env:GITHUB_RUN_ID -or $Identity.job -cne $env:GITHUB_JOB -or $Identity.store -cne 'LocalMachine\Root' -or $Identity.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected synthetic cleanup identity.' }
    $stored = Get-HostedTrustCertificate $Identity.thumbprint
    if ($stored) {
        if ((Get-HostedCertificateHash $stored) -cne $Identity.sha256) { throw 'Leave a changed or unrelated trust entry intact.' }
        [void](Invoke-HostedBoundedProcess -Executable (Join-Path $env:WINDIR 'System32/certutil.exe') -Arguments @('-delstore','Root',$Identity.thumbprint) -Seconds 60)
    }
    if (Get-HostedTrustCertificate $Identity.thumbprint) { throw 'The exact synthetic machine root was not removed.' }
}
Export-ModuleMember -Function Assert-HostedLanTrustHost,Invoke-HostedBoundedProcess,New-HostedLanTrustIdentity,Add-HostedLanTrust,Remove-HostedLanTrust
