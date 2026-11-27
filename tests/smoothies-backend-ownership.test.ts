import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('actual PS5.1 first-install guard refuses unlabelled or foreign exact-name volumes without touching Docker', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'smoothies-volume-ownership-'));
  const script = path.join(directory, 'verify.ps1');
  await writeFile(script, String.raw`
param([string]$ModulePath)
$ErrorActionPreference='Stop'
Import-Module $ModulePath -Force -DisableNameChecking
$instance='01234567-89ab-cdef-0123-456789abcdef'
function New-Compose {
    $volumes=[ordered]@{}
    foreach($logical in @('db-data','db-config','photos')) {
        $volumes[$logical]=[pscustomobject]@{name=('pos-smoothies_'+$logical);labels=[pscustomobject]@{'mx.pos-smoothies.instance'=$instance}}
    }
    [pscustomobject]@{volumes=[pscustomobject]$volumes}
}
function New-Observed([string]$name) {
    [pscustomobject]@{Name=$name;Labels=[pscustomobject]@{
      'com.docker.compose.project'='pos-smoothies';'com.docker.compose.volume'=$name.Substring('pos-smoothies_'.Length);'mx.pos-smoothies.instance'=$instance}}
}
function Assert-Refused([scriptblock]$Action) {
    $refused=$false
    try{& $Action}catch{$refused=$true}
    if(!$refused){throw 'Expected ownership refusal'}
}
Assert-SmoothiesManagedVolumes -Compose (New-Compose) -Instance $instance -ExistingNames @() -Inspect {throw 'Fresh storage must not inspect another volume'}
$names=@('pos-smoothies_db-data','pos-smoothies_db-config','pos-smoothies_photos','unrelated-data')
Assert-SmoothiesManagedVolumes -Compose (New-Compose) -Instance $instance -ExistingNames $names -Inspect {param($name) New-Observed $name}
foreach($logical in @('db-data','db-config','photos')) {
    $target='pos-smoothies_'+$logical
    $unlabelled=New-Observed $target;$unlabelled.Labels=[pscustomobject]@{}
    Assert-Refused {Assert-SmoothiesManagedVolumes -Compose (New-Compose) -Instance $instance -ExistingNames @($target) -Inspect {param($name) $unlabelled}}
    foreach($label in @('com.docker.compose.project','com.docker.compose.volume','mx.pos-smoothies.instance')) {
        $foreign=New-Observed $target;$foreign.Labels.$label='foreign'
        Assert-Refused {Assert-SmoothiesManagedVolumes -Compose (New-Compose) -Instance $instance -ExistingNames @($target) -Inspect {param($name) $foreign}}
    }
}
Assert-Refused {Assert-SmoothiesManagedVolumes -Compose (New-Compose) -Instance $instance -ExistingNames @('pos-smoothies_db-data') -Inspect {throw 'Engine inspection failed'}}
$badConfig=New-Compose;$badConfig.volumes.'db-data'.labels.'mx.pos-smoothies.instance'='foreign'
Assert-Refused {Assert-SmoothiesManagedVolumes -Compose $badConfig -Instance $instance -ExistingNames @() -Inspect {throw 'Must fail before inspection'}}
'PASS fresh and retained-owned storage; all three unlabelled names and every wrong ownership label refused; engine errors fail closed'
`);
  const powershell = path.join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-ModulePath', path.resolve('scripts/smoothies/BackendOwnership.psm1')], { windowsHide: true, timeout: 20_000 });
  assert.match(result.stdout, /PASS fresh and retained-owned storage/);
});
