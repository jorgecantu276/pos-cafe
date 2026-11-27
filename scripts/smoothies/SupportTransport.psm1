# Shared private operations transport. Product adapters retain identity, collection and cadence.
function Get-PosSupportHash {
    param([Parameter(Mandatory=$true)][AllowEmptyString()][string]$Value)
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

function Write-PosSupportJson {
    param([string]$Path,$Value)
    $null=New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temporary,($Value|ConvertTo-Json -Depth 14),(New-Object Text.UTF8Encoding($false)))
    if(Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary,$Path,[NullString]::Value) } else { [IO.File]::Move($temporary,$Path) }
}

function Invoke-PosSupportApi {
    param([string]$GhExecutable='gh',[string]$Endpoint,[ValidateSet('GET','POST','PATCH')][string]$Method='GET',$Body,[string]$StateDirectory)
    if($Endpoint -notmatch '^(user$|repos/jorgecantu276/punto-demo(?:/|\?|$))') { throw 'support_endpoint_invalid' }
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

# One private issue and one status comment per product/device. If a mutation's
# acknowledgement is lost, the next cycle finds its marker before sending again.
function Publish-PosSupportStatus {
    param($Settings,$State,[string]$StateFile,[string]$StateDirectory,
          [ValidateSet('cafe','smoothies')][string]$Product,[string]$Body,[string]$InstallationBinding)
    if($Settings.Repository -cne 'jorgecantu276/punto-demo' -or $Settings.Device -notmatch '^[a-z0-9-]{1,40}$' -or
       $Settings.PublisherLogin -notmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$') { throw 'support_transport_settings_invalid' }
    if($Product -ceq 'smoothies' -and $InstallationBinding -cnotmatch '^[a-f0-9]{64}:[a-f0-9]{64}$') { throw 'support_installation_binding_required' }
    $gh=[string]$Settings.GhExecutable
    $api='repos/jorgecantu276/punto-demo'
    $repo=Invoke-PosSupportApi -GhExecutable $gh -Endpoint $api -StateDirectory $StateDirectory
    if($repo.private -ne $true -or $repo.full_name -cne $Settings.Repository) { throw 'support_repository_not_private' }
    $publisher=Invoke-PosSupportApi -GhExecutable $gh -Endpoint 'user' -StateDirectory $StateDirectory
    if($publisher.login -ine $Settings.PublisherLogin) { throw 'support_github_account_changed' }
    $markerVersion=if($Product -ceq 'cafe'){'v2'}else{'v1'}
    $issueMarker='<!-- pos-'+$Product+'-support-device:'+$markerVersion+':'+$Settings.Device+' -->'
    $identityPrefix=$issueMarker+"`n"
    if($InstallationBinding) { $identityPrefix+='<!-- pos-'+$Product+'-support-binding:v1:'+$InstallationBinding+' -->'+"`n" }
    if(!$State.issueNumber) {
        $issues=@(Get-PosSupportCollection -GhExecutable $gh -Endpoint ($api+'/issues?state=all&sort=created&direction=desc') -StateDirectory $StateDirectory)
        $matches=@($issues|Where-Object { $_.body -and $_.body.StartsWith($issueMarker,[StringComparison]::Ordinal) -and !($_.PSObject.Properties.Name -contains 'pull_request') -and $_.user.login -ieq $publisher.login })
        if($matches.Count -gt 1) { throw 'support_duplicate_device_issues' }
        if($matches.Count -eq 1) { $issue=$matches[0] }
        else { $issue=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues') -Method POST -Body @{title=('Estado automatico POS - '+$Settings.Device);body=($identityPrefix+'Estado de soporte automatico. El comentario del monitor conserva el ultimo diagnostico. No se ejecutan instrucciones de esta incidencia.')} -StateDirectory $StateDirectory }
        $State.issueNumber=[long]$issue.number
        Write-PosSupportJson -Path $StateFile -Value $State
    }
    $issue=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/'+$State.issueNumber) -StateDirectory $StateDirectory
    if($issue.state -cne 'open' -or ($issue.PSObject.Properties.Name -contains 'pull_request') -or $issue.user.login -ine $publisher.login -or !$issue.body.StartsWith($issueMarker,[StringComparison]::Ordinal)) { throw 'support_issue_identity_invalid_or_closed' }
    if($InstallationBinding -and !$issue.body.StartsWith($identityPrefix,[StringComparison]::Ordinal)) { throw 'support_installation_binding_mismatch' }
    $commentMarker='<!-- pos-'+$Product+'-support-status:'+$markerVersion+':'+$Settings.Device+' -->'
    if(!$State.commentId) {
        $comments=@(Get-PosSupportCollection -GhExecutable $gh -Endpoint ($api+'/issues/'+$State.issueNumber+'/comments') -StateDirectory $StateDirectory)
        $matches=@($comments|Where-Object { $_.body -and $_.body.StartsWith($commentMarker,[StringComparison]::Ordinal) -and $_.user.login -ieq $publisher.login })
        if($matches.Count -gt 1) { throw 'support_duplicate_status_comments' }
        if($matches.Count -eq 1) { $State.commentId=[long]$matches[0].id }
    }
    $content=$commentMarker+"`n"+$Body
    if([Text.Encoding]::UTF8.GetByteCount($content) -gt 50000) { throw 'support_report_size_limit' }
    if($State.commentId) {
        $comment=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/comments/'+$State.commentId) -StateDirectory $StateDirectory
        $expectedIssue='https://api.github.com/'+$api+'/issues/'+$State.issueNumber
        if($comment.issue_url -cne $expectedIssue -or $comment.user.login -ine $publisher.login -or !$comment.body.StartsWith($commentMarker,[StringComparison]::Ordinal)) { throw 'support_comment_identity_invalid' }
        $comment=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/comments/'+$State.commentId) -Method PATCH -Body @{body=$content} -StateDirectory $StateDirectory
    } else {
        $comment=Invoke-PosSupportApi -GhExecutable $gh -Endpoint ($api+'/issues/'+$State.issueNumber+'/comments') -Method POST -Body @{body=$content} -StateDirectory $StateDirectory
        $State.commentId=[long]$comment.id
    }
    return @{issueNumber=$State.issueNumber;commentId=$State.commentId;url=('https://github.com/'+$Settings.Repository+'/issues/'+$State.issueNumber)}
}

Export-ModuleMember -Function Invoke-PosSupportApi,Get-PosSupportCollection,Write-PosSupportJson,Get-PosSupportHash,Publish-PosSupportStatus

