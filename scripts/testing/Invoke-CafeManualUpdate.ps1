param([string]$PlanFile,[string]$PlanSha256,[string]$ReceiptPath,[switch]$FunctionsOnly)
$ErrorActionPreference='Stop'
$script:CafeManualOperatorPath=[IO.Path]::GetFullPath($PSCommandPath)
$script:CafeRuntimeHelperPath=Join-Path $PSScriptRoot 'Legacy-CafeRuntime.ps1'
$script:CafeRuntimeHelperSha256='ca7327ccb2d5261ba8ec58e6b75d2ead28941289986729d9ab2c35fe731985c1'
$script:CafeShiftSnapshotSha256=$null
$script:CafeAcceptedShiftSnapshotSha256=$null

function Get-CafeHash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() }
function Get-CafeTextHash([string]$Value) {
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Get-CafeMachineSha256 {
    $guid=[string](Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
    if ($guid -notmatch '^[a-fA-F0-9-]{32,36}$') { throw 'No se pudo verificar la identidad de esta PC.' }
    return Get-CafeTextHash $guid.ToLowerInvariant()
}
function Get-CafePath([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]' -or $Value.Contains('"') -or $Value.Substring(2).Contains(':')) { throw 'Se requiere una ruta local absoluta sin redirecciones.' }
    $path=[IO.Path]::GetFullPath($Value).TrimEnd('\')
    for ($item=$path; $item; $item=[IO.Path]::GetDirectoryName($item)) {
        if (Test-Path -LiteralPath $item) {
            if ((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se permiten vinculos ni puntos de redireccion en las rutas.' }
        }
        if ($item -eq [IO.Path]::GetPathRoot($item).TrimEnd('\')) { break }
    }
    return $path
}
function Assert-CafeExternal([string]$Path,[string[]]$Versions) {
    $path=Get-CafePath $Path
    foreach ($version in $Versions) {
        if ($path.Equals($version,[StringComparison]::OrdinalIgnoreCase) -or $path.StartsWith($version+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Los datos privados deben permanecer fuera de las carpetas de version.' }
    }
    return $path
}
function Read-CafeJson([string]$Path) { try { return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { throw 'No se pudo leer un archivo JSON requerido.' } }
function Read-CafePrivateEvidence([string]$OperationsRoot,$Reference,[string[]]$Versions) {
    $file=[string]$Reference.file
    if (![IO.Path]::IsPathRooted($file)) { $file=Join-Path $OperationsRoot $file }
    $file=Assert-CafeExternal $file $Versions
    if (!$file.StartsWith($OperationsRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'La evidencia debe permanecer en el directorio privado de operaciones.' }
    Assert-CafeHash $file ([string]$Reference.sha256)
    return Read-CafeJson $file
}
function Get-CafeManualBinding($Value) {
    $keys=@('change','machineSha256','runtimeConfigurationSha256','predecessorCommit','predecessorIndexSha256','packageIndexSha256','backendPlanSha256','operatorScriptSha256','publication','latest','automaticEnrollment','familyPromotion') | Sort-Object
    $actual=if ($Value -is [Collections.IDictionary]) { @($Value.Keys) } else { @($Value.PSObject.Properties.Name) }
    if (@(Compare-Object ($actual | Sort-Object) $keys -CaseSensitive).Count) { throw 'El contrato de mantenimiento manual tiene campos distintos.' }
    $binding=[ordered]@{}; foreach ($key in $keys) { $binding[$key]=$Value.$key }
    return $binding | ConvertTo-Json -Compress
}
function Test-CafeFixtureAdmission($Plan,$Evidence) {
    if ($Plan.testOnly -is [bool] -and $Plan.testOnly -eq $true) {
        if ($Plan.purpose -cne 'hosted-isolated-guard-fixture' -or $Plan.client -cne 'synthetic-cafe-hosted' -or $Evidence.testOnly -isnot [bool] -or $Evidence.testOnly -ne $true -or $Evidence.purpose -cne $Plan.purpose -or $Evidence.client -cne $Plan.client) { throw 'Los marcadores de aislamiento sintetico no coinciden en plan y evidencia.' }
    } else {
        if (($null -ne $Plan.testOnly -and ($Plan.testOnly -isnot [bool] -or $Plan.testOnly)) -or $Plan.purpose -or $Plan.client -match '^synthetic-' -or ($null -ne $Evidence.testOnly -and ($Evidence.testOnly -isnot [bool] -or $Evidence.testOnly)) -or $Evidence.purpose -or $Evidence.client -match '^synthetic-') { throw 'La evidencia sintetica requiere admision explicita y no puede aceptar una PC productiva.' }
    }
}
function Test-CafeAcceptedPlan($Plan,[string[]]$Versions) {
    $operationsRoot=Assert-CafeExternal ([string]$Plan.operationsHome) $Versions
    if (!(Test-Path -LiteralPath $operationsRoot -PathType Container)) { throw 'Falta el directorio privado de operaciones.' }
    $record=Read-CafePrivateEvidence $operationsRoot $Plan.qualification $Versions
    Test-CafeFixtureAdmission $Plan $record
    if ($record.format -cne 'pos-qualification-v1' -or $record.state -cne 'customer-package-qualified' -or $record.product -cne 'cafe' -or $record.preset -cne 'cafe' -or $record.tier -ne 1 -or $record.edition -cne 'customer' -or $record.deliveryScope -cne 'cafe-manual-maintenance-v1' -or $record.artifact.kind -cne 'windows-package') { throw 'Falta la calificacion exacta de mantenimiento manual de Cafe.' }
    $qualifiedAt=[DateTimeOffset]::MinValue
    if ($record.client -cnotmatch '^[a-z][a-z0-9-]{0,63}$' -or $record.qualificationId -cnotmatch '^[a-z][a-z0-9-]{0,63}$' -or ![DateTimeOffset]::TryParse([string]$record.qualifiedAt,[ref]$qualifiedAt)) { throw 'La calificacion no identifica cliente, registro y fecha validos.' }
    $binding=Get-CafeManualBinding $Plan.manualMaintenance
    if ((Get-CafeManualBinding $record.manualMaintenance) -cne $binding) { throw 'La calificacion corresponde a otro dispositivo, configuracion o transicion.' }
    $manual=$Plan.manualMaintenance
    if ($manual.change -cne 'brownie-syrup-v1' -or $manual.publication -cne 'manual-cafe-prerelease' -or $manual.latest -ne $false -or $manual.automaticEnrollment -ne $false -or $manual.familyPromotion -ne $false) { throw 'El alcance manual no permite activar canales automaticos ni promover la familia.' }
    foreach ($flag in @('latest','automaticEnrollment','familyPromotion')) { if ($manual.$flag -isnot [bool]) { throw 'Los indicadores del contrato manual deben ser booleanos.' } }
    foreach ($key in @('machineSha256','runtimeConfigurationSha256','predecessorIndexSha256','packageIndexSha256','backendPlanSha256','operatorScriptSha256')) { if ($manual.$key -cnotmatch '^[a-f0-9]{64}$') { throw 'Falta una huella exacta del contrato manual.' } }
    if ($manual.machineSha256 -cne $Plan.machineSha256 -or $manual.runtimeConfigurationSha256 -cne $Plan.configSha256 -or $manual.predecessorCommit -cne $Plan.predecessor.sourceCommit -or $manual.predecessorIndexSha256 -cne $Plan.predecessor.filesSha256 -or $manual.packageIndexSha256 -cne $Plan.candidate.filesSha256 -or $manual.operatorScriptSha256 -cne (Get-CafeHash $script:CafeManualOperatorPath)) { throw 'El plan no coincide con las identidades aceptadas de PC, programa y transicion.' }
    if (@($record.supportedPredecessors).Count -ne 1 -or $record.supportedPredecessors[0] -cne $Plan.predecessor.sourceCommit -or $record.artifact.sha256 -cne $Plan.candidate.zipSha256 -or $record.sourceCommit -cne $Plan.candidate.sourceCommit -or $record.familySourceCommit -cne $record.sourceCommit -or $record.familyRelease -cnotmatch '^pos-v\d+\.\d+\.\d+(?:-rc\.\d+)?$') { throw 'El paquete, version comun o predecesor no coincide con la calificacion.' }
    $fields=@('product','preset','tier','edition','deliveryScope','client','qualificationId','sourceCommit','sourceTree','contentSha256','databaseContractSha256','configurationSha256','backendIdentitySha256','familyRelease','familySourceCommit')
    foreach ($field in $fields) { if ($Plan.$field -cne $record.$field) { throw ('El plan difiere de la calificacion en '+$field+'.') } }
    foreach ($field in @('sourceCommit','sourceTree','familySourceCommit')) { if ($record.$field -cnotmatch '^[a-f0-9]{40}$') { throw 'Identidad fuente incompleta.' } }
    foreach ($field in @('contentSha256','databaseContractSha256','configurationSha256','backendIdentitySha256')) { if ($record.$field -cnotmatch '^[a-f0-9]{64}$') { throw 'Huella de calificacion incompleta.' } }
    if ($Plan.backendIdentitySha256 -cne (Get-CafeTextHash ($Plan.backendOrigin+"`n"+$Plan.publicKeySha256))) { throw 'La identidad de backend del plan no corresponde a la configuracion.' }
    foreach ($reference in @($record.checks,$record.independentReview)) {
        $proof=Read-CafePrivateEvidence $operationsRoot $reference $Versions
        Test-CafeFixtureAdmission $Plan $proof
        foreach ($field in $fields) { if ($proof.$field -cne $record.$field) { throw ('La evidencia difiere de la calificacion en '+$field+'.') } }
        if ((Get-CafeManualBinding $proof.manualMaintenance) -cne $binding -or $proof.artifactSha256 -cne $record.artifact.sha256) { throw 'La evidencia acepta otro paquete o contrato manual.' }
    }
    $checks=Read-CafePrivateEvidence $operationsRoot $record.checks $Versions
    foreach ($name in @('unit','types','lint','build','package','database','browser','new-install','retained-upgrade','recovery','install-guard','backup','journal','provider-config','migration-plan','device-preflight')) { if ($checks.results.$name -cne 'passed') { throw ('Falta la comprobacion de Cafe: '+$name+'.') } }
    if ($checks.results.family -cne 'not-promoted') { throw 'El mantenimiento no puede declarar una promocion de familia.' }
    $review=Read-CafePrivateEvidence $operationsRoot $record.independentReview $Versions
    if ($review.independent -isnot [bool] -or $review.independent -ne $true -or $review.verdict -cne 'ACCEPT') { throw 'Falta la aceptacion independiente del paquete exacto.' }
    $operator=[string]$record.operatorScript.file; if (![IO.Path]::IsPathRooted($operator)) { $operator=Join-Path $operationsRoot $operator }; $operator=Assert-CafeExternal $operator $Versions
    if (!$operator.StartsWith($operationsRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or !$operator.Equals($script:CafeManualOperatorPath,[StringComparison]::OrdinalIgnoreCase) -or $record.operatorScript.sha256 -cne $manual.operatorScriptSha256) { throw 'El script actual no corresponde al operador aceptado.' }
    Assert-CafeHash $operator $record.operatorScript.sha256
    $maintenance=Read-CafePrivateEvidence $operationsRoot $Plan.maintenance $Versions
    Test-CafeFixtureAdmission $Plan $maintenance
    if ($maintenance.format -cne 'cafe-backend-maintenance-applied-v1' -or $maintenance.state -cne 'applied' -or $maintenance.backendOrigin -cne $Plan.backendOrigin -or $maintenance.publicKeySha256 -cne $Plan.publicKeySha256 -or $maintenance.backendPlanSha256 -cne $manual.backendPlanSha256 -or $maintenance.predecessorCommit -cne $manual.predecessorCommit) { throw 'Falta evidencia de mantenimiento de backend aplicado para este plan.' }
    foreach ($field in $fields) { if ($maintenance.$field -cne $record.$field) { throw ('El mantenimiento aplicado difiere en '+$field+'.') } }
    if ((Get-CafeManualBinding $maintenance.manualMaintenance) -cne $binding) { throw 'El mantenimiento aplicado corresponde a otro contrato manual.' }
    if ($Plan.testOnly -ne $true) {
        if ($maintenance.shiftSnapshotSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Falta la huella revisada del turno conservado por el mantenimiento.' }
        $script:CafeAcceptedShiftSnapshotSha256=[string]$maintenance.shiftSnapshotSha256
    }
    return $operationsRoot
}
function Assert-CafeHash([string]$Path,[string]$Expected) {
    if ($Expected -cnotmatch '^[a-f0-9]{64}$' -or (Get-CafeHash $Path) -cne $Expected) { throw 'Un archivo no coincide con su huella aprobada.' }
}
function Get-CafeTreeFiles([string]$Directory) {
    $pending=New-Object 'Collections.Generic.Stack[string]'; $pending.Push($Directory)
    $files=New-Object 'Collections.Generic.List[string]'
    while ($pending.Count) {
        foreach ($item in (Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'La version contiene un vinculo no permitido.' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) } else { $files.Add($item.FullName) }
            if ($files.Count -gt 100000 -or $pending.Count -gt 20000) { throw 'La carpeta excede los limites del paquete.' }
        }
    }
    return $files.ToArray()
}
function Test-CafeIndexedFiles([string]$Directory,[string]$ExpectedIndex,[switch]$Exact) {
    $Directory=Get-CafePath $Directory
    Assert-CafeHash (Join-Path $Directory 'SHA256.json') $ExpectedIndex
    # Windows PowerShell 5.1 emits a root JSON array as one pipeline object.
    $entries=Read-CafeJson (Join-Path $Directory 'SHA256.json')
    if ($entries -isnot [array]) { $entries=@($entries) }
    if (!$entries.Count -or $entries.Count -gt 20000) { throw 'Lista de archivos vacia o demasiado grande.' }
    $expected=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [void]$expected.Add('SHA256.json')
    foreach ($entry in $entries) {
        $name=[string]$entry.file
        if (!$name -or $name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or @($name.Split('/') | Where-Object { !$_ -or $_ -eq '.' -or $_ -eq '..' }).Count -or !$expected.Add($name)) { throw 'Ruta repetida o no permitida en la lista de archivos.' }
        $file=Get-CafePath (Join-Path $Directory $name)
        if (!$file.StartsWith($Directory+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archivo fuera de la version.' }
        Assert-CafeHash $file ([string]$entry.sha256)
    }
    foreach ($required in @('release.json','node.exe','Start-POS.ps1','Open-Caja.ps1','app/server.js')) { if (!$expected.Contains($required)) { throw 'Falta un componente de Caja en la lista aprobada.' } }
    $actual=@(Get-CafeTreeFiles $Directory)
    if ($Exact) {
        if ($actual.Count -ne $expected.Count) { throw 'El paquete contiene archivos no aprobados.' }
        foreach ($file in $actual) { if (!$expected.Contains($file.Substring($Directory.Length+1).Replace('\','/'))) { throw 'El paquete contiene archivos no aprobados.' } }
    }
    return $entries.Count
}
function Expand-CafeArchive([string]$ZipPath,[string]$Destination,[string]$ExpectedZip) {
    Assert-CafeHash (Get-CafePath $ZipPath) $ExpectedZip
    $Destination=Get-CafePath $Destination
    if (Test-Path -LiteralPath $Destination) { throw 'La carpeta de preparacion ya existe; se conserva.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        if (!$zip.Entries.Count -or $zip.Entries.Count -gt 25000) { throw 'Cantidad de archivos ZIP no permitida.' }
        $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        [long]$total=0
        foreach ($entry in $zip.Entries) {
            $name=$entry.FullName.TrimEnd('/')
            if (!$name -or $name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or @($name.Split('/') | Where-Object { !$_ -or $_ -eq '.' -or $_ -eq '..' }).Count -or !$seen.Add($name)) { throw 'Ruta ZIP duplicada o no permitida.' }
            if (($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960 -or ($entry.ExternalAttributes -band 1024)) { throw 'El ZIP contiene un vinculo no permitido.' }
            $total+=$entry.Length
            if ($entry.Length -gt 536870912 -or $total -gt 2147483648 -or ($entry.CompressedLength -gt 0 -and $entry.Length/$entry.CompressedLength -gt 1000)) { throw 'El ZIP excede los limites permitidos.' }
            $file=[IO.Path]::GetFullPath((Join-Path $Destination $name))
            if (!$file.StartsWith($Destination+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'El ZIP intenta salir de la preparacion.' }
        }
        $null=New-Item -ItemType Directory -Path $Destination
        foreach ($entry in $zip.Entries) {
            $file=Join-Path $Destination $entry.FullName.TrimEnd('/')
            if ($entry.FullName.EndsWith('/')) { $null=[IO.Directory]::CreateDirectory($file); continue }
            $null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$file,$false)
        }
    } finally { $zip.Dispose() }
}
function Test-CafeManifest($Manifest,$Plan,[string]$Source,[switch]$New) {
    if ($Manifest.product -cne 'cafe' -or $Manifest.sourceCommit -cne $Source -or $Manifest.sourceDirty -ne $false -or $Manifest.fixtureOnly -ne $false -or $Manifest.familySourceDirty -ne $false) { throw 'El manifiesto no es la version limpia aprobada de Cafe.' }
    foreach ($flag in @('sourceDirty','fixtureOnly','familySourceDirty')) { if ($Manifest.$flag -isnot [bool]) { throw 'El manifiesto contiene indicadores no validos.' } }
    if ($Manifest.supabaseUrl -cne $Plan.backendOrigin -or $Manifest.publicKeySha256 -cne $Plan.publicKeySha256) { throw 'La version corresponde a otro backend o clave publica.' }
    if ($New -and @($Manifest.catalogRules) -cnotcontains 'brownie-syrup-v1') { throw 'La version no reconoce la regla de un solo jarabe.' }
}
function Assert-CafeStopped([string]$Directory,$Config) {
    $node=Join-Path $Directory 'node.exe'
    $nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)
    foreach ($process in $nodes) {
        if (!$process.ExecutablePath) { throw 'No se puede identificar un proceso Node; no se cambia Caja.' }
        if ($process.ExecutablePath.Equals($node,[StringComparison]::OrdinalIgnoreCase)) { throw 'Caja sigue ejecutandose. Cierra Caja de forma normal; no se detuvo ningun proceso.' }
    }
    $port=3000; if ($null -ne $Config.Port) { $port=[int]$Config.Port }
    if ($port -lt 1024 -or $port -gt 65535) { throw 'El puerto de Caja no es valido.' }
    if (@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $port }).Count) { throw 'El puerto de Caja esta ocupado; no se detuvo ni reutilizo su proceso.' }
    try { $handle=[IO.File]::Open($node,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $handle.Dispose() }
    catch { throw 'El ejecutable instalado esta bloqueado. No se cambio Caja.' }
}
function Test-CafeReady($Plan) {
    $probeNode=Get-CafePath ([string]$Plan.probeNodePath)
    Assert-CafeHash $probeNode ([string]$Plan.probeNodeSha256)
    if ((Get-CafeTextHash ([string]$env:NODE_OPTIONS)) -cne $Plan.nodeOptionsSha256) { throw 'El entorno Node no coincide con el plan aprobado.' }
    $code=@'
const fs=require('node:fs'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite'),path=require('node:path');
const [file,origin,keyHash,mode]=process.argv.slice(1);
(async()=>{let db;try{const c=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
if(new URL(c.SupabaseUrl).origin!==origin||crypto.createHash('sha256').update(c.SupabaseAnonKey).digest('hex')!==keyHash||c.PrintMode!==mode||!c.SupabaseServiceRoleKey)throw Error();
db=new DatabaseSync(path.join(c.PrintDataDirectory,mode+'-jobs.sqlite'),{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error();
const pending=db.prepare("SELECT count(*) AS n FROM jobs WHERE state IS NULL OR state NOT IN ('submitted','cancelled')").get().n;db.close();db=null;
if(pending!==0)throw Error();
const key=c.SupabaseServiceRoleKey,headers={apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key})};
const r=await fetch(new URL('/rest/v1/cash_registers?select=*&order=id.asc',origin),{headers:{...headers,Prefer:'count=exact'},redirect:'error',signal:AbortSignal.timeout(3500)});
if(!r.ok)throw Error();const rows=await r.json();if(!Array.isArray(rows))throw Error();
const range=r.headers.get('content-range');const total=range&&range.match(/\/(\d+)$/);if(!total||Number(total[1])!==rows.length)throw Error();
const stable=rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])));
console.log(JSON.stringify({ready:true,pendingPrints:0,shiftSnapshotSha256:crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex'),openShifts:rows.filter(row=>row.status==='open').length}));
}catch{console.log(JSON.stringify({ready:false}));process.exitCode=1;}finally{db?.close();}})();
'@
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code))
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$probeNode
    $start.Arguments='-e "eval(Buffer.from('''+$encoded+''',''base64'').toString(''utf8''))" "'+$Plan.configPath+'" "'+$Plan.backendOrigin+'" "'+$Plan.publicKeySha256+'" "'+$Plan.printMode+'"'
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process; $process.StartInfo=$start
    try {
        $null=$process.Start(); $probeId=$process.Id; $probeStarted=$process.StartTime.ToUniversalTime().Ticks
        $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(15000)) {
            $owned=Get-Process -Id $probeId -ErrorAction Stop
            if ($owned.StartTime.ToUniversalTime().Ticks -ne $probeStarted -or !$owned.Path.Equals($probeNode,[StringComparison]::OrdinalIgnoreCase)) { throw 'La identidad del subproceso de revision cambio; se conserva para inspeccion.' }
            $process.Kill(); $null=$process.WaitForExit(5000)
            throw 'La revision de seguridad no respondio; se cerro solo su propio subproceso y Caja no se cambia.'
        }
        $output=[string]$stdout.Result; $null=$stderr.Result
        if ($process.ExitCode -ne 0) { throw 'No se confirmo el turno conservado y el diario de impresion libre.' }
    } finally { $process.Dispose() }
    try { $result=$output | ConvertFrom-Json } catch { throw 'La revision no devolvio evidencia valida.' }
    if ($result.ready -ne $true -or $result.pendingPrints -ne 0 -or $result.shiftSnapshotSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'La revision de seguridad rechazo el cambio.' }
    if ($script:CafeAcceptedShiftSnapshotSha256 -and $script:CafeAcceptedShiftSnapshotSha256 -cne $result.shiftSnapshotSha256) { throw 'El turno actual difiere del recibo de mantenimiento; preparar evidencia vigente.' }
    if ($script:CafeShiftSnapshotSha256 -and $script:CafeShiftSnapshotSha256 -cne $result.shiftSnapshotSha256) { throw 'El turno cambio durante el mantenimiento; detener y revisar antes de continuar.' }
    $script:CafeShiftSnapshotSha256=[string]$result.shiftSnapshotSha256
}
function Get-CafeExternalSnapshot($Plan,$Config,[string[]]$Versions) {
    $files=@([string]$Plan.configPath,[string]$Config.ReceiptIssuerFile,[string]$Config.BackupRecoveryKeyFile)
    foreach ($field in @('ClipTokenFile','AutoUpdatePublicKeyFile')) { if ($Config.$field) { $files+=[string]$Config.$field } }
    foreach ($shortcut in @($Plan.shortcutPaths)) { if ($shortcut) { $files+=[string]$shortcut } }
    $data=Assert-CafeExternal ([string]$Config.PrintDataDirectory) $Versions
    $journal=Join-Path $data ($Plan.printMode+'-jobs.sqlite')
    $files+=$journal
    if (Test-Path -LiteralPath ($journal+'-wal')) { $files+=($journal+'-wal') }
    $backup=Assert-CafeExternal ([string]$Config.BackupDirectory) $Versions
    if (!(Test-Path -LiteralPath $backup -PathType Container)) { throw 'Falta la carpeta original de respaldos.' }
    $files+=@(Get-CafeTreeFiles $backup)
    $result=[ordered]@{}
    foreach ($file in @($files | Sort-Object -Unique)) { $path=Assert-CafeExternal $file $Versions; if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Falta un archivo privado original requerido.' }; $result[$path]=Get-CafeHash $path }
    return $result
}
function Write-CafeReceipt([string]$Path,$Receipt) {
    $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($temporary,($Receipt | ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Invoke-CafeManualUpdate {
    param([Parameter(Mandatory=$true)]$Plan,[Parameter(Mandatory=$true)][string]$ReceiptPath)
    if ($Plan.format -cne 'cafe-manual-maintenance-v1' -or $Plan.deliveryScope -cne 'cafe-manual-maintenance-v1') { throw 'Falta un plan privado calificado de mantenimiento manual de Cafe.' }
    $script:CafeShiftSnapshotSha256=$null
    $script:CafeAcceptedShiftSnapshotSha256=$null
    Test-CafeFixtureAdmission $Plan $Plan
    if ($Plan.machineSha256 -cne (Get-CafeMachineSha256)) { throw 'El plan corresponde a otra PC.' }
    if ($Plan.predecessor.sourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $Plan.candidate.sourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $Plan.predecessor.sourceCommit -ceq $Plan.candidate.sourceCommit) { throw 'Identidad de versiones no valida.' }
    if ($Plan.printMode -cnotin @('windows','mock')) { throw 'Modo de impresion no admitido.' }
    $app=Get-CafePath ([string]$Plan.installDirectory); $parent=[IO.Path]::GetDirectoryName($app)
    if (!$parent -or !(Test-Path -LiteralPath $app -PathType Container)) { throw 'No se encontro una instalacion existente verificable.' }
    $stage=Join-Path $parent ('CarinitoMioPOS-preparacion-'+[guid]::NewGuid().ToString('N'))
    $previous=Join-Path $parent ('CarinitoMioPOS-anterior-'+[guid]::NewGuid().ToString('N'))
    $versions=@($app,$stage,$previous)
    foreach ($version in $versions) { if (![IO.Path]::GetDirectoryName((Get-CafePath $version)).Equals($parent,[StringComparison]::OrdinalIgnoreCase)) { throw 'Las carpetas de version deben ser hermanas verificadas.' } }
    $configPath=Assert-CafeExternal ([string]$Plan.configPath) $versions
    Assert-CafeHash $configPath ([string]$Plan.configSha256)
    $config=Read-CafeJson $configPath
    $url=[Uri]([string]$config.SupabaseUrl)
    if (!$url.IsAbsoluteUri -or $url.UserInfo -or $url.Query -or $url.Fragment -or $url.AbsolutePath -cne '/' -or $url.GetLeftPart([UriPartial]::Authority) -cne $Plan.backendOrigin -or (Get-CafeTextHash ([string]$config.SupabaseAnonKey)) -cne $Plan.publicKeySha256) { throw 'La configuracion no corresponde al backend aprobado.' }
    if ($config.AutoUpdate -isnot [bool] -or $config.AutoUpdate -ne $false -or $config.RequireExistingPrintJournal -isnot [bool] -or $config.RequireExistingPrintJournal -ne $true -or $config.PrintMode -cne $Plan.printMode) { throw 'Se debe conservar actualizacion automatica OFF, diario original y modo de impresion esperado.' }
    $operationsHome=Test-CafeAcceptedPlan $Plan $versions
    $ReceiptPath=Assert-CafeExternal $ReceiptPath $versions
    if (!$ReceiptPath.StartsWith($operationsHome+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'El recibo debe permanecer dentro de operaciones privadas.' }
    $receiptParent=Get-CafePath ([IO.Path]::GetDirectoryName($ReceiptPath)); if (!(Test-Path -LiteralPath $receiptParent -PathType Container)) { throw 'Prepara primero la carpeta privada del recibo.' }
    $installed=Read-CafeJson (Join-Path $app 'release.json')
    if ($installed.sourceCommit -ceq $Plan.candidate.sourceCommit) {
        Test-CafeManifest $installed $Plan $Plan.candidate.sourceCommit -New
        $null=Test-CafeIndexedFiles $app $Plan.candidate.filesSha256 -Exact
        return [pscustomobject]@{state='already-installed-verified';sourceCommit=$Plan.candidate.sourceCommit;receiptPath=$ReceiptPath}
    }
    Test-CafeManifest $installed $Plan $Plan.predecessor.sourceCommit
    $null=Test-CafeIndexedFiles $app $Plan.predecessor.filesSha256
    if (Test-Path -LiteralPath $ReceiptPath) { throw 'Ya existe un recibo de mantenimiento. Conserva esa evidencia y revisa su estado.' }
    # Use the previously deployed rc.6 ownership-verified stop procedure only
    # for the real supervised entry. Synthetic fixtures never stop applications.
    Assert-CafeHash ([string]$Plan.candidate.zipPath) ([string]$Plan.candidate.zipSha256)
    if ($Plan.testOnly -ne $true) {
        Assert-CafeHash $script:CafeRuntimeHelperPath $script:CafeRuntimeHelperSha256
        . $script:CafeRuntimeHelperPath -FunctionsOnly -ConfigPath $configPath -InstallDirectory $app
        $runtime=Get-CafeRecoverySnapshot $app $configPath
        Assert-CafeStopPlan $runtime
        $confirmation=Read-Host 'PAUSA todas las pestanas y dispositivos de Caja. Termina cobros, espera impresiones y deja los carritos vacios. DEJA EL TURNO ABIERTO. No uses Caja hasta reabrirla. Escribe CONTINUAR para reiniciar solo Caja e instalar el menu'
        if ($confirmation -cne 'CONTINUAR') { throw 'Mantenimiento cancelado; Caja no se detuvo.' }
        # Recheck the exact selected target after human readiness confirmation.
        Assert-CafeHash $configPath ([string]$Plan.configSha256)
        Test-CafeReady $Plan
        Stop-CafeVerifiedInstances $app $configPath
    }
    Assert-CafeStopped $app $config
    $before=Get-CafeExternalSnapshot $Plan $config $versions
    Test-CafeReady $Plan
    $afterProbe=Get-CafeExternalSnapshot $Plan $config $versions
    if (($before | ConvertTo-Json -Compress) -cne ($afterProbe | ConvertTo-Json -Compress)) { throw 'Los datos externos cambiaron durante la revision; no se mueve Caja.' }
    $zip=Assert-CafeExternal ([string]$Plan.candidate.zipPath) $versions
    $receipt=[ordered]@{format='cafe-manual-maintenance-receipt-v1';state='verified-before-staging';client=$Plan.client;qualificationId=$Plan.qualificationId;sourceCommit=$Plan.candidate.sourceCommit;predecessor=$Plan.predecessor.sourceCommit;manualMaintenance=$Plan.manualMaintenance;machineSha256=$Plan.machineSha256;configSha256=$Plan.configSha256;candidateZipSha256=$Plan.candidate.zipSha256;backendIdentitySha256=$Plan.backendIdentitySha256;installDirectory=$app;stageDirectory=$stage;previousDirectory=$previous;before=$before;startedAt=[DateTime]::UtcNow.ToString('o');shiftBeforeSha256=$script:CafeShiftSnapshotSha256}
    Write-CafeReceipt $ReceiptPath $receipt
    $moved=$false
    try {
        Expand-CafeArchive $zip $stage $Plan.candidate.zipSha256
        $null=Test-CafeIndexedFiles $stage $Plan.candidate.filesSha256 -Exact
        Test-CafeManifest (Read-CafeJson (Join-Path $stage 'release.json')) $Plan $Plan.candidate.sourceCommit -New
        $receipt.state='staged-verified'; Write-CafeReceipt $ReceiptPath $receipt
        Assert-CafeStopped $app $config
        Test-CafeReady $Plan
        if (($before | ConvertTo-Json -Compress) -cne ((Get-CafeExternalSnapshot $Plan $config $versions) | ConvertTo-Json -Compress)) { throw 'Los datos externos cambiaron; no se mueve Caja.' }
        $null=Test-CafeIndexedFiles $app $Plan.predecessor.filesSha256
        # As in the existing supervised updater, close the exclusive probe before
        # Directory.Move: Windows refuses a parent rename with an open child file.
        Assert-CafeStopped $app $config
        $receipt.state='switch-prepared'; Write-CafeReceipt $ReceiptPath $receipt
        [IO.Directory]::Move($app,$previous); $moved=$true
        try { [IO.Directory]::Move($stage,$app) }
        catch { [IO.Directory]::Move($previous,$app); $moved=$false; throw }
        $null=Test-CafeIndexedFiles $app $Plan.candidate.filesSha256 -Exact
        $after=Get-CafeExternalSnapshot $Plan $config $versions
        if (($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)) { throw 'La conservacion de datos requiere revision; no abras Caja hasta reconciliar el recibo.' }
        Test-CafeReady $Plan
        $receipt.shiftAfterSha256=$script:CafeShiftSnapshotSha256
        $receipt.after=$after; $receipt.state='installed-verified-not-started'; $receipt.completedAt=[DateTime]::UtcNow.ToString('o'); Write-CafeReceipt $ReceiptPath $receipt
        return [pscustomobject]@{state=$receipt.state;sourceCommit=$Plan.candidate.sourceCommit;previousDirectory=$previous;receiptPath=$ReceiptPath}
    } catch {
        $receipt.state=if ($moved) { 'attention-after-switch' } else { 'stopped-with-predecessor-preserved' }
        $receipt.failureAt=[DateTime]::UtcNow.ToString('o'); Write-CafeReceipt $ReceiptPath $receipt
        throw
    }
}

if ($FunctionsOnly) { return }
if (!$PlanFile -or !$PlanSha256 -or !$ReceiptPath) { throw 'Usa el comando aprobado con plan privado, huella y recibo.' }
$PlanFile=Get-CafePath $PlanFile
Assert-CafeHash $PlanFile $PlanSha256
$plan=Read-CafeJson $PlanFile
if (($null -ne $plan.testOnly -and ($plan.testOnly -isnot [bool] -or $plan.testOnly)) -or $plan.purpose -or $plan.client -match '^synthetic-') { throw 'La entrada de produccion rechaza planes y clientes sinteticos de laboratorio.' }
if ($plan.printMode -cne 'windows' -or $plan.nodeOptionsSha256 -cne (Get-CafeTextHash '') -or $env:NODE_OPTIONS) { throw 'La entrada de produccion exige impresion Windows y entorno Node sin preloads.' }
if (([Uri]$plan.backendOrigin).Scheme -cne 'https') { throw 'La entrada de produccion exige el backend HTTPS aprobado.' }
$privateHome=Get-CafePath ([string]$plan.operationsHome)
if (!$PlanFile.StartsWith($privateHome+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'El plan debe permanecer dentro de operaciones privadas.' }
Invoke-CafeManualUpdate -Plan $plan -ReceiptPath $ReceiptPath | ConvertTo-Json -Depth 5
