Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Assert-CafeHostedComputer {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
        $env:RUNNER_OS -cne 'Windows' -or $env:ImageOS -cnotmatch '^win25(?:-vs2026)?$' -or
        $env:POS_ACCEPTANCE_DISPOSABLE -cne '1' -or !$env:GITHUB_RUN_ID -or !$env:RUNNER_TRACKING_ID -or !$env:RUNNER_TEMP) {
        throw 'Cafe boundary requires a fresh explicitly enrolled GitHub-hosted Windows 2025 job.'
    }
    $principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Hosted boundary requires an elevated disposable runner.' }
}
function Assert-CafeOwnedDirectory([string]$Directory) {
    Assert-CafeHostedComputer
    $temp=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
    $resolved=[IO.Path]::GetFullPath($Directory).TrimEnd('\')
    if (!$resolved.StartsWith($temp+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Boundary state must stay beneath RUNNER_TEMP.' }
    for ($item=Get-Item -LiteralPath $resolved; $item; $item=$item.Parent) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Boundary state cannot use directory links.' }
    }
    return $resolved
}
function New-CafeHostedBoundary {
    param([Parameter(Mandatory)][string]$Directory,[Parameter(Mandatory)][string[]]$Programs)
    $directory=Assert-CafeOwnedDirectory $Directory
    $owner='pos-cafe-egress-'+[guid]::NewGuid().ToString('N')
    $receiptFile=Join-Path $directory 'boundary.private.json'
    if (Test-Path -LiteralPath $receiptFile) { throw 'Never overwrite a boundary receipt.' }
    $profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { @{name=[string]$_.Name;enabled=[string]$_.Enabled} })
    $service=Get-Service MpsSvc
    if ($service.Status -ne 'Running') { throw 'Windows Firewall service must already be running.' }
    $record=[ordered]@{format='cafe-hosted-egress-v1';owner=$owner;state='preparing';profilesBefore=$profiles;rules=@();programs=@();cohortStopped=$false;
        applicationLaunchAttempted=$false;attestationAccepted=$false;createdAt=[DateTime]::UtcNow.ToString('o')}
    $save={ $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptFile -Encoding utf8NoBOM }
    & $save
    try {
        # This strengthens only the newly allocated hosted VM, never a user computer.
        Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True
        if (@(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object {[string]$_.Enabled -cne 'True'}).Count) { throw 'Firewall profiles are not enforced.' }
        $addresses=@('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
        foreach ($program in @($Programs | Sort-Object -Unique)) {
            $file=Get-Item -LiteralPath $program
            if (!$file -or $file.PSIsContainer -or $file.Extension -ine '.exe' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Every network runtime must be a regular executable.' }
            $resolved=$file.FullName
            $allowedSystem=@((Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),(Get-Process -Id $PID).Path,
                (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),(Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'),
                (Join-Path $env:SystemRoot 'System32\conhost.exe'),(Join-Path $env:SystemRoot 'System32\cmd.exe'),
                (Join-Path $env:SystemRoot 'System32\WerFault.exe'),(Join-Path $env:SystemRoot 'System32\WerFaultSecure.exe'),(Join-Path $env:SystemRoot 'System32\wermgr.exe'))
            if (!$resolved.StartsWith(([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase) -and !($allowedSystem -icontains $resolved)) { throw 'Only copied owned runtimes and the controlled PowerShell parents may be restricted.' }
            $name=$owner+'-'+[guid]::NewGuid().ToString('N')
            New-NetFirewallRule -Name $name -DisplayName $name -Group $owner -Direction Outbound -Action Block -Program $resolved -RemoteAddress $addresses -Profile Any -Enabled True -Protocol Any | Out-Null
            $rule=Get-NetFirewallRule -Name $name -PolicyStore ActiveStore
            $filter=$rule | Get-NetFirewallApplicationFilter
            if ($rule.Action -ne 'Block' -or $rule.Direction -ne 'Outbound' -or [string]$rule.Enabled -cne 'True' -or $filter.Program -ine $resolved) { throw 'Scoped outbound rule did not become active.' }
            $record.rules+=@{name=$name;program=$resolved;remoteAddress=@(($rule | Get-NetFirewallAddressFilter).RemoteAddress)}
            $record.programs+=@{path=$resolved;sha256=(Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()}
            & $save
        }
        if ($record.programs.Count -lt 4) { throw 'Candidate, predecessor, browser and orchestrator runtimes are required.' }
        # Independent VM-wide denial closes the gap between an unexpected child's
        # creation and the later process audit. Downloads and provisioning are done.
        $globalName=$owner+'-'+[guid]::NewGuid().ToString('N')
        New-NetFirewallRule -Name $globalName -DisplayName $globalName -Group $owner -Direction Outbound -Action Block -RemoteAddress $addresses -Profile Any -Enabled True -Protocol Any | Out-Null
        $global=Get-NetFirewallRule -Name $globalName -PolicyStore ActiveStore
        if ($global.Action -ne 'Block' -or $global.Direction -ne 'Outbound' -or [string]$global.Enabled -cne 'True' -or ($global | Get-NetFirewallApplicationFilter).Program -cne 'Any') { throw 'VM-wide independent denial did not become active.' }
        $record.rules+=@{name=$globalName;program='Any';remoteAddress=@(($global | Get-NetFirewallAddressFilter).RemoteAddress)}
        $record.globalNonLoopbackBlock=$globalName
        $record.state='active';$record.profilesEnforced=@(Get-NetFirewallProfile -PolicyStore ActiveStore | Select-Object Name,Enabled);& $save
        return $receiptFile
    } catch { throw 'Hosted boundary setup failed. Its receipt must be reconciled before any rules are removed.' }
}
function Restore-CafeHostedBoundary {
    param([Parameter(Mandatory)][string]$ReceiptFile)
    Assert-CafeHostedComputer
    [void](Assert-CafeOwnedDirectory (Split-Path -Parent $ReceiptFile))
    $record=Get-Content -LiteralPath $ReceiptFile -Raw | ConvertFrom-Json
    if ($record.format -cne 'cafe-hosted-egress-v1' -or $record.owner -cnotmatch '^pos-cafe-egress-[a-f0-9]{32}$') { throw 'Invalid owned boundary identity.' }
    if ($record.cohortStopped -ne $true) { throw 'Egress remains denied until every owned application/browser runtime is proven stopped.' }
    foreach ($rule in @(Get-NetFirewallRule -Group $record.owner -ErrorAction SilentlyContinue)) {
        if ($rule.Name -cnotmatch ('^'+[regex]::Escape($record.owner)+'-[a-f0-9]{32}$') -or $rule.Direction -ne 'Outbound' -or $rule.Action -ne 'Block') { throw 'Boundary rule identity changed; inspect the disposable VM.' }
        Remove-NetFirewallRule -Name $rule.Name
    }
    foreach ($profile in $record.profilesBefore) {
        if ($profile.enabled -cnotin @('True','False')) { throw 'Unknown original firewall profile state.' }
        Set-NetFirewallProfile -Profile $profile.name -Enabled ($profile.enabled -ceq 'True')
    }
    if (@(Get-NetFirewallRule -Group $record.owner -ErrorAction SilentlyContinue).Count) { throw 'Owned boundary cleanup incomplete.' }
    $record.state='closed';$record | Add-Member -Force NoteProperty closedAt ([DateTime]::UtcNow.ToString('o'))
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptFile -Encoding utf8NoBOM
}
function Close-CafeHostedRuntimeCohort([string]$ReceiptFile) {
    Assert-CafeHostedComputer
    $directory=Assert-CafeOwnedDirectory (Split-Path -Parent $ReceiptFile)
    $record=Get-Content -LiteralPath $ReceiptFile -Raw | ConvertFrom-Json
    if ($record.format -cne 'cafe-hosted-egress-v1' -or $record.owner -cnotmatch '^pos-cafe-egress-[a-f0-9]{32}$') { throw 'Invalid boundary shutdown identity.' }
    if (!('CafeLabProcessHandle' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public sealed class CafeLabProcessIdentity { public int Id; public string Ticks; public string Path; }
public static class CafeLabProcessHandle {
 [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low,High; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out FileTime created,out FileTime exited,out FileTime kernel,out FileTime user);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder path,ref uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint code);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("shell32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CommandLineToArgvW(string command,out int count);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
 static CafeLabProcessIdentity Read(IntPtr handle,int id) {
  FileTime created,exited,kernel,user;if(!GetProcessTimes(handle,out created,out exited,out kernel,out user))throw new Win32Exception();
  var path=new StringBuilder(32768);uint length=(uint)path.Capacity;if(!QueryFullProcessImageName(handle,0,path,ref length))throw new Win32Exception();
  return new CafeLabProcessIdentity {Id=id,Ticks=DateTime.FromFileTimeUtc(((long)created.High<<32)|created.Low).Ticks.ToString(),Path=path.ToString()};
 }
 public static CafeLabProcessIdentity Capture(int id) {
  var handle=OpenProcess(0x101000,false,id);if(handle==IntPtr.Zero){if(Marshal.GetLastWin32Error()==87)return null;throw new Win32Exception();}
  try {if(WaitForSingleObject(handle,0)==0)return null;return Read(handle,id);} finally {CloseHandle(handle);}
 }
 public static void Stop(CafeLabProcessIdentity expected) {
  var handle=OpenProcess(0x101001,false,expected.Id);if(handle==IntPtr.Zero){if(Marshal.GetLastWin32Error()==87)return;throw new Win32Exception();}
  try {if(WaitForSingleObject(handle,0)==0)return;var actual=Read(handle,expected.Id);
   if(actual.Ticks!=expected.Ticks||!String.Equals(System.IO.Path.GetFullPath(actual.Path),System.IO.Path.GetFullPath(expected.Path),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Process identity changed; egress must remain denied.");
   if(!TerminateProcess(handle,0)&&WaitForSingleObject(handle,0)!=0)throw new Win32Exception();
   if(WaitForSingleObject(handle,10000)!=0)throw new InvalidOperationException("Owned runtime did not stop.");
  } finally {CloseHandle(handle);}
 }
 public static string[] Arguments(string command) {int count;var pointer=CommandLineToArgvW(command,out count);if(pointer==IntPtr.Zero)throw new Win32Exception();
  try{var result=new string[count];for(int i=0;i<count;i++)result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,i*IntPtr.Size));return result;}finally{LocalFree(pointer);}}
}
'@
    }
    $copied=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($program in $record.programs) { if ($program.path.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase)) { [void]$copied.Add([IO.Path]::GetFullPath($program.path)) } }
    $stopped=@()
    for ($attempt=0;$attempt -lt 4;$attempt++) {
        $cohort=@();$supervisors=@()
        foreach ($process in @(Get-CimInstance Win32_Process)) {
            if ($process.Name -in @('powershell.exe','pwsh.exe') -and $process.ProcessId -ne $PID -and $process.CommandLine -and $process.CommandLine.IndexOf($directory,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $argsList=@([CafeLabProcessHandle]::Arguments($process.CommandLine));$file=[array]::IndexOf($argsList,'-File');$config=[array]::IndexOf($argsList,'-ConfigPath')
                if ($file -lt 0 -or $config -lt 0 -or $file+1 -ge $argsList.Count -or $config+1 -ge $argsList.Count) { throw 'An owned-scope PowerShell process has an unrecognized command; retain egress denial.' }
                $script=[IO.Path]::GetFullPath($argsList[$file+1]);$configPath=[IO.Path]::GetFullPath($argsList[$config+1])
                if (!$script.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($script) -cne 'Start-POS.ps1' -or !$configPath.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'An owned-scope supervisor cannot be safely stopped; retain egress denial.' }
                $identity=[CafeLabProcessHandle]::Capture([int]$process.ProcessId);if ($identity) { $supervisors+=$identity }
            }
            if ($process.ExecutablePath -and $copied.Contains([IO.Path]::GetFullPath($process.ExecutablePath))) {
                $identity=[CafeLabProcessHandle]::Capture([int]$process.ProcessId)
                if ($identity) { if (!$copied.Contains([IO.Path]::GetFullPath($identity.Path))) { throw 'Runtime identity changed; retain egress denial.' };$cohort+=$identity }
            } elseif (!$process.ExecutablePath -and $process.Name -in @('node.exe','chrome.exe','msedge.exe')) { throw 'An uninspectable runtime may be alive; retain egress denial.' }
        }
        if ($supervisors.Count -eq 0 -and $cohort.Count -eq 0) {
            if ($record.applicationLaunchAttempted -eq $true -and $record.attestationAccepted -ne $true) { throw 'Complete descendant attestation is missing or failed; retain VM-wide egress denial even after known runtimes stop.' }
            $record.cohortStopped=$true;$record | Add-Member -Force NoteProperty stoppedCohort $stopped
            $record | Add-Member -Force NoteProperty stoppedAt ([DateTime]::UtcNow.ToString('o'))
            $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReceiptFile -Encoding utf8NoBOM
            return
        }
        foreach ($identity in @($supervisors)+@($cohort | Sort-Object Ticks)) { [CafeLabProcessHandle]::Stop($identity);$stopped+=@{pid=$identity.Id;createdTicks=$identity.Ticks;executable=$identity.Path} }
        Start-Sleep -Milliseconds 250
    }
    throw 'Owned application cohort did not settle; retain egress denial on the disposable VM.'
}
function Start-CafeHostedProcessAudit([string]$Directory) {
    $directory=Assert-CafeOwnedDirectory $Directory
    $backup=Join-Path $directory 'audit-policy.private.csv'
    if (Test-Path -LiteralPath $backup) { throw 'Never overwrite the disposable audit policy backup.' }
    & auditpol.exe /backup "/file:$backup" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot preserve original disposable audit policy.' }
    & auditpol.exe /set '/subcategory:Process Creation' /success:enable | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enable process creation evidence.' }
    return @{backup=$backup;sha256=(Get-FileHash -LiteralPath $backup).Hash;afterRecordId=(Get-WinEvent -LogName Security -MaxEvents 1).RecordId}
}
function Get-CafeHostedProcessAttestation {
    param([long]$RootProcessId,[long]$AfterRecordId,[string[]]$RestrictedPrograms)
    Assert-CafeHostedComputer
    $events=@(Get-WinEvent -LogName Security -FilterXPath "*[System[(EventID=4688) and (EventRecordID > $AfterRecordId)]]" -MaxEvents 5000 | Sort-Object RecordId)
    if ($events.Count -eq 0 -or $events.Count -ge 5000) { throw 'Missing or truncated process-creation evidence.' }
    $known=[Collections.Generic.HashSet[long]]::new();[void]$known.Add($RootProcessId)
    $allowed=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($program in $RestrictedPrograms) { [void]$allowed.Add([IO.Path]::GetFullPath($program)) }
    $observed=@();$rootObserved=$false
    foreach ($event in $events) {
        [xml]$xml=$event.ToXml();$fields=@{}
        foreach ($value in $xml.Event.EventData.Data) { $fields[$value.Name]=[string]$value.'#text' }
        $child=[Convert]::ToInt64($fields.NewProcessId.Replace('0x',''),16)
        $parent=[Convert]::ToInt64($fields.ProcessId.Replace('0x',''),16)
        if ($child -eq $RootProcessId) { $rootObserved=$true }
        elseif (!$known.Contains($parent)) { continue }
        if (!$fields.NewProcessName -or !$allowed.Contains([IO.Path]::GetFullPath($fields.NewProcessName))) { throw 'An observed child executable lacks the independently enforced egress boundary.' }
        [void]$known.Add($child)
        $observed+=@{pid=$child;parentPid=$parent;executable=$fields.NewProcessName;eventRecordId=$event.RecordId}
    }
    if (!$rootObserved -or $observed.Count -lt 3) { throw 'Incomplete executable-cohort evidence.' }
    return @{format='cafe-process-cohort-v1';rootPid=$RootProcessId;allObservedChildrenRestricted=$true;events=$observed}
}
function Restore-CafeHostedProcessAudit($Audit) {
    Assert-CafeHostedComputer
    [void](Assert-CafeOwnedDirectory (Split-Path -Parent $Audit.backup))
    if ((Get-FileHash -LiteralPath $Audit.backup).Hash -cne $Audit.sha256) { throw 'Disposable audit backup changed.' }
    & auditpol.exe /restore "/file:$($Audit.backup)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Disposable audit policy restore failed.' }
}
Export-ModuleMember -Function Assert-CafeHostedComputer,Assert-CafeOwnedDirectory,New-CafeHostedBoundary,Close-CafeHostedRuntimeCohort,Restore-CafeHostedBoundary,Start-CafeHostedProcessAudit,Get-CafeHostedProcessAttestation,Restore-CafeHostedProcessAudit
