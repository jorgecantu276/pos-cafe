function Assert-SmoothiesManagedVolumes {
    param(
        [Parameter(Mandatory=$true)]$Compose,
        [Parameter(Mandatory=$true)][string]$Instance,
        [Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$ExistingNames,
        [Parameter(Mandatory=$true)][scriptblock]$Inspect
    )
    $expected=@('db-data','db-config','photos')
    $declared=@($Compose.volumes.PSObject.Properties)
    if ($Instance -cnotmatch '^[a-f0-9-]{36}$' -or $declared.Count -ne $expected.Count -or
        @($declared | Where-Object { $expected -cnotcontains $_.Name }).Count) {
        throw 'smoothies_backend_volume_contract_invalid'
    }
    foreach ($volume in $declared) {
        $name=[string]$volume.Value.name
        if ($name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$' -or
            $volume.Value.labels.'mx.pos-smoothies.instance' -cne $Instance -or $volume.Value.external) {
            throw 'smoothies_backend_volume_contract_invalid'
        }
        if ($ExistingNames -ccontains $name) {
            $observed=& $Inspect $name
            if (!$observed -or $observed.Name -cne $name -or
                $observed.Labels.'com.docker.compose.project' -cne 'pos-smoothies' -or
                $observed.Labels.'com.docker.compose.volume' -cne $volume.Name -or
                $observed.Labels.'mx.pos-smoothies.instance' -cne $Instance) {
                throw 'Ya existe un disco con ese nombre sin la identidad de esta instalacion. Se conservaron sus datos; requiere revision.'
            }
        }
    }
}
Export-ModuleMember -Function Assert-SmoothiesManagedVolumes
