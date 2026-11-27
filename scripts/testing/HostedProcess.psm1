#Requires -Version 7.2

function Quote-WindowsArguments([string[]]$Values) {
    ($Values | ForEach-Object {
        # WSL option tokens must stay plain; escape only arguments that need it.
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

function Invoke-HostedProcess {
    param([Parameter(Mandatory)][string]$Executable, [string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$StdoutFile, [Parameter(Mandatory)][string]$StderrFile,
        [ValidateRange(1,3600)][int]$TimeoutSeconds = 600,
        [ValidateRange(1,2000)][int]$DrainMilliseconds = 500)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    $cancel = [Threading.CancellationTokenSource]::new()
    $stdout = $null; $stderr = $null; $copies = @(); $timedOut = $false; $drainTimedOut = $false; $exitCode = -1
    try {
        $stdout = [IO.FileStream]::new($StdoutFile, [IO.FileMode]::Create, [IO.FileAccess]::Write,
            [IO.FileShare]::ReadWrite, 81920, [IO.FileOptions]::Asynchronous)
        $stderr = [IO.FileStream]::new($StderrFile, [IO.FileMode]::Create, [IO.FileAccess]::Write,
            [IO.FileShare]::ReadWrite, 81920, [IO.FileOptions]::Asynchronous)
        [void]$process.Start()
        $copies = @($process.StandardOutput.BaseStream.CopyToAsync($stdout, 81920, $cancel.Token),
            $process.StandardError.BaseStream.CopyToAsync($stderr, 81920, $cancel.Token))
        if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
            $timedOut = $true
            # This object owns the root we started. Never kill a detached child
            # after that root has already exited just because a pipe stays open.
            if (!$process.HasExited) { $process.Kill($true); [void]$process.WaitForExit(2000) }
        }
        if ($process.HasExited) { $exitCode = $process.ExitCode }
        # A surviving app/browser can inherit a pipe. Parent exit is authoritative;
        # a short drain captures pending output without waiting for descendant EOF.
        try { $drainTimedOut = ![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$copies, $DrainMilliseconds) }
        catch { throw 'The owned process output capture failed.' }
    } finally {
        $cancel.Cancel()
        if ($copies.Count) {
            $process.StandardOutput.BaseStream.Dispose(); $process.StandardError.BaseStream.Dispose()
            try { [void][Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$copies, 100) } catch { }
        }
        if ($stdout) { $stdout.Dispose() }; if ($stderr) { $stderr.Dispose() }
        $cancel.Dispose(); $process.Dispose()
    }
    [pscustomobject]@{ ExitCode = $exitCode; TimedOut = $timedOut; DrainTimedOut = $drainTimedOut;
        StdoutFile = $StdoutFile; StderrFile = $StderrFile }
}

Export-ModuleMember -Function Quote-WindowsArguments, Invoke-HostedProcess
