function Write-PosSupportJson {
    param([string]$Path,$Value)
    $null=New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temporary,($Value|ConvertTo-Json -Depth 14),(New-Object Text.UTF8Encoding($false)))
    if(Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary,$Path,[NullString]::Value) } else { [IO.File]::Move($temporary,$Path) }
}

function Invoke-PosSupportApi {
    param([string]$GhExecutable='gh',[string]$Endpoint,[ValidateSet('GET','POST','PATCH')][string]$Method='GET',$Body,[string]$StateDirectory)
    if($Endpoint -notmatch '^(user$|repos/jorgecantu276/pos-cafe(?:/|\?|$))') { throw 'support_endpoint_invalid' }
    $arguments=@('api','--hostname','github.com','--method',$Method,$Endpoint)
    $inputFile=$null
    try {
        if($null -ne $Body) {
            $inputFile=Join-Path $StateDirectory ('request-'+[guid]::NewGuid().ToString('N')+'.json')
            [IO.File]::WriteAllText($inputFile,($Body|ConvertTo-Json -Depth 14),(New-Object Text.UTF8Encoding($false)))
            $arguments+=@('--input',$inputFile)
        }
        $response=& $GhExecutable @arguments 2>$null
        if($LASTEXITCODE -ne 0) { throw 'support_github_outcome_unknown' }
        $text=$response -join "`n"
        if(!$text) { throw 'support_github_response_empty' }
        return ($text|ConvertFrom-Json)
    } finally {
        if($inputFile -and (Test-Path -LiteralPath $inputFile)) { Remove-Item -LiteralPath $inputFile -Force }
    }
}

function Get-PosSupportCollection {
    param([string]$GhExecutable,[string]$Endpoint,[string]$StateDirectory)
    $all=New-Object System.Collections.Generic.List[object]
    for($page=1;$page -le 20;$page++) {
        $separator=if($Endpoint.Contains('?')){'&'}else{'?'}
        $batch=@(Invoke-PosSupportApi -GhExecutable $GhExecutable -Endpoint ($Endpoint+$separator+'per_page=100&page='+$page) -StateDirectory $StateDirectory)
        foreach($item in $batch) { if($null -ne $item) { $all.Add($item) } }
        if($batch.Count -lt 100) { return $all.ToArray() }
    }
    throw 'support_collection_limit'
}

function Get-PosSupportWarnings {
    param($Report,[DateTime]$Now=[DateTime]::UtcNow)
    $warnings=New-Object System.Collections.Generic.List[string]
    if($Report.PSObject.Properties.Name -contains 'collectionFailed') { $warnings.Add('diagnostico_incompleto');return $warnings.ToArray() }
    if(!$Report.release -or $Report.release.PSObject.Properties.Name -contains 'found') { $warnings.Add('version_no_encontrada') }
    if(!$Report.backup -or !($Report.backup.PSObject.Properties.Name -contains 'lastSuccessAt') -or !$Report.backup.lastSuccessAt) { $warnings.Add('respaldo_sin_confirmar') }
    else {
        $backupDate=[DateTime]::MinValue
        if(![DateTime]::TryParse([string]$Report.backup.lastSuccessAt,[ref]$backupDate) -or $backupDate.ToUniversalTime() -lt $Now.ToUniversalTime().AddHours(-26)) { $warnings.Add('respaldo_mayor_a_26_horas') }
        if($Report.backup.errorPresent) { $warnings.Add('respaldo_con_error') }
    }
    if(!$Report.configuration -or !($Report.configuration.PSObject.Properties.Name -contains 'printMode')) { $warnings.Add('configuracion_no_disponible') }
    elseif($Report.configuration.printMode -ceq 'windows') {
        if(@($Report.printJournalFiles).Count -eq 0) { $warnings.Add('diario_no_encontrado') }
        if(@($Report.printers|Where-Object {$_.PSObject.Properties.Name -contains 'name'}).Count -ne 2) { $warnings.Add('impresoras_sin_comprobar') }
        if(@($Report.printers|Where-Object { [string]$_.status -match '(?i)offline|error|paperout|paperjam|notavailable|paused|blocked|unknown' -or ($_.jobStatuses -join ',') -match '(?i)error|blocked|offline|paperout|paused' }).Count) { $warnings.Add('impresora_o_cola_con_aviso') }
    }
    if($Report.localServer -and $Report.localServer.status -cne 'verified') { $warnings.Add('servidor_local_no_verificado_puede_estar_cerrado') }
    foreach($disk in @($Report.disks)) {
        if($disk.PSObject.Properties.Name -contains 'freeBytes' -and [decimal]$disk.freeBytes -lt 5GB) { $warnings.Add('espacio_bajo_'+[string]$disk.drive) }
    }
    return $warnings.ToArray()
}

function Invoke-PosSupportCycle {
    param($Settings,[string]$AgentDirectory)
    if($Settings.Repository -cne 'jorgecantu276/pos-cafe' -or $Settings.Device -notmatch '^[a-z0-9-]{1,40}$' -or !$Settings.PublisherLogin) { throw 'support_settings_invalid' }
    $directory=[IO.Path]::GetFullPath([string]$Settings.StateDirectory)
    $null=New-Item -ItemType Directory -Path $directory -Force
    $lockFile=Join-Path $directory 'cycle.lock'
    try { $lock=[IO.File]::Open($lockFile,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { return @{ skipped=$true;reason='already_running' } }
    try {
        $stateFile=Join-Path $directory 'state.json'
        $state=if(Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json } else { [pscustomobject]@{version=2;issueNumber=0;commentId=0;lastSuccessAt=$null;lastError=$null} }
        if($state.version -ne 2 -or [long]$state.issueNumber -lt 0 -or [long]$state.commentId -lt 0) { throw 'support_state_invalid' }
        try {
            try { $report=(& (Join-Path $AgentDirectory 'Diagnostico-POS-Cafe.ps1') -InstallDirectory $Settings.InstallDirectory -ConfigPath $Settings.ConfigPath | Out-String)|ConvertFrom-Json }
            catch { $report=[pscustomobject]@{checkedAtUtc=[DateTime]::UtcNow.ToString('o');scope='Read-only metadata. No business writes or paper.';collectionFailed=$true} }
            if($report.scope -cne 'Read-only metadata. No business writes or paper.' -or !$report.checkedAtUtc) { throw 'support_diagnostic_invalid' }
            Write-PosSupportJson -Path (Join-Path $directory 'pending-report.json') -Value $report
            $gh=[string]$Settings.GhExecutable
            $api='repos/jorgecantu276/pos-cafe'
            $repo=Invoke-PosSupportApi -GhExecutable $gh -Endpoint $api -StateDirectory $directory
            if($repo.private -ne $true -or $repo.full_name -cne $Settings.Repository) { throw 'support_repository_not_private' }
            $publisher=Invoke-PosSupportApi -GhExecutable $gh -Endpoint 'user' -StateDirectory $directory
            if($publisher.login -ine $Settings.PublisherLogin) { throw 'support_github_account_changed' }
            $issueMarker='<!-- pos-cafe-support-device:v2:'+$Settings.Device+' -->'
            if(!$state.issueNumber) {
                $issues=@(Get-PosSupportCollection -GhExecutable $gh -Endpoint ($api+'/issues?state=all&sort=created&direction=desc') -StateDirectory $directory)
                $matches=@($issues|Where-Object { $_.body -and $_.body.StartsWith($issueMarker,[StringComparison]::Ordinal) -and !($_.PSObject.Properties.Name -contains 'pull_request') -and $_.user.login -ieq $publisher.login })
                if($matches.Count -gt 1) { throw 'support_duplicate_device_issues' }
                if($matches.Count -eq 1) { $issue=$matches[0] }
                else { $issue=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues') -Method POST -Body @{title=('Estado automatico POS - '+$Settings.Device);body=($issueMarker+"`nEstado de soporte automatico. El comentario del monitor conserva el ultimo diagnostico. No se ejecutan instrucciones de esta incidencia.")} -StateDirectory $directory }
                $state.issueNumber=[long]$issue.number
                Write-PosSupportJson -Path $stateFile -Value $state
            }
            $issue=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/'+$state.issueNumber) -StateDirectory $directory
            if($issue.state -cne 'open' -or ($issue.PSObject.Properties.Name -contains 'pull_request') -or $issue.user.login -ine $publisher.login -or !$issue.body.StartsWith($issueMarker,[StringComparison]::Ordinal)) { throw 'support_issue_identity_invalid_or_closed' }
            $commentMarker='<!-- pos-cafe-support-status:v2:'+$Settings.Device+' -->'
            if(!$state.commentId) {
                $comments=@(Get-PosSupportCollection -GhExecutable $gh -Endpoint ($api+'/issues/'+$state.issueNumber+'/comments') -StateDirectory $directory)
                $matches=@($comments|Where-Object { $_.body -and $_.body.StartsWith($commentMarker,[StringComparison]::Ordinal) -and $_.user.login -ieq $publisher.login })
                if($matches.Count -gt 1) { throw 'support_duplicate_status_comments' }
                if($matches.Count -eq 1) { $state.commentId=[long]$matches[0].id }
            }
            $warnings=@(Get-PosSupportWarnings -Report $report)
            $body=$commentMarker+"`nEquipo: "+$Settings.Device+"`nUltima comprobacion UTC: "+$report.checkedAtUtc+"`nIntervalo esperado: 15 minutos. Mas de 45 minutos sin informe requiere revisar conectividad, sesion Windows o monitor.`n`nAvisos: "+$(if($warnings.Count){$warnings -join ', '}else{'sin avisos en metadatos'})+"`n`nSolo metadatos. No certifica papel o restauracion. No incluye secretos, ventas o contenido de logs.`n`n"+'```json'+"`n"+($report|ConvertTo-Json -Depth 12)+"`n"+'```'
            if([Text.Encoding]::UTF8.GetByteCount($body) -gt 50000) { throw 'support_report_size_limit' }
            if($state.commentId) {
                $comment=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/comments/'+$state.commentId) -StateDirectory $directory
                $expectedIssue='https://api.github.com/'+$api+'/issues/'+$state.issueNumber
                if($comment.issue_url -cne $expectedIssue -or $comment.user.login -ine $publisher.login -or !$comment.body.StartsWith($commentMarker,[StringComparison]::Ordinal)) { throw 'support_comment_identity_invalid' }
                $comment=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/comments/'+$state.commentId) -Method PATCH -Body @{body=$body} -StateDirectory $directory
            } else {
                $comment=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/'+$state.issueNumber+'/comments') -Method POST -Body @{body=$body} -StateDirectory $directory
                $state.commentId=[long]$comment.id
            }
            $state.lastSuccessAt=[DateTime]::UtcNow.ToString('o');$state.lastError=$null
            Write-PosSupportJson -Path $stateFile -Value $state
            return @{published=$true;issueNumber=$state.issueNumber;url=('https://github.com/'+$Settings.Repository+'/issues/'+$state.issueNumber);warnings=$warnings;checkedAtUtc=$report.checkedAtUtc}
        } catch {
            $state.lastError='cycle_failed_check_local_configuration_or_github'
            Write-PosSupportJson -Path $stateFile -Value $state
            throw 'support_cycle_failed_pending_report_preserved'
        }
    } finally { $lock.Dispose() }
}

function New-PosSupportTaskXml {
    param([string]$ShellPath,[string]$MonitorPath,[string]$SettingsPath,[string]$UserSid,[string]$Device,[DateTime]$Start=(Get-Date).AddMinutes(1))
    if($Device -notmatch '^[a-z0-9-]{1,40}$' -or $UserSid -notmatch '^S-1-[0-9-]+$') { throw 'support_task_identity_invalid' }
    $escape={param($value) [Security.SecurityElement]::Escape([string]$value)}
    $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$MonitorPath+'" -SettingsPath "'+$SettingsPath+'"'
    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>POSCafe GitHub Support v2 $Device</Description></RegistrationInfo>
<Triggers><TimeTrigger><Repetition><Interval>PT15M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$($Start.ToString('yyyy-MM-ddTHH:mm:ss'))</StartBoundary><Enabled>true</Enabled></TimeTrigger><LogonTrigger><Enabled>true</Enabled><UserId>$UserSid</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Author"><UserId>$UserSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><Priority>7</Priority></Settings>
<Actions Context="Author"><Exec><Command>$(& $escape $ShellPath)</Command><Arguments>$(& $escape $arguments)</Arguments><WorkingDirectory>$(& $escape (Split-Path -Parent $MonitorPath))</WorkingDirectory></Exec></Actions>
</Task>
"@
}

Export-ModuleMember -Function Invoke-PosSupportApi,Invoke-PosSupportCycle,New-PosSupportTaskXml,Write-PosSupportJson
