import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { posVersions } from './version-info.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const [cafeTarget, nativeCheckout, outputDirectory] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.equal(process.version, 'v24.22.2');
assert.ok([cafeTarget, nativeCheckout, outputDirectory].every(value => value && path.isAbsolute(value)),
  'Use node build-family.mjs <cafe-target-json> <papeleria-native-checkout> <new-output-directory>.');
assert.ok(!existsSync(outputDirectory), 'Never overwrite an earlier release.');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Commit the reviewed source first.');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: nativeCheckout, encoding: 'utf8' }).trim(), '', 'Commit the native source first.');
// Check the native SDK before spending time building either web application.
execFileSync('dotnet', ['--version'], { cwd: nativeCheckout, stdio: 'inherit', windowsHide: true });
const { version, familyRelease } = posVersions();
const run = args => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
const archive = (mode, source, destination) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(root, 'scripts/releases/archive-package.ps1'), '-Mode', mode, '-Source', source, '-Destination', destination],
{ cwd: root, stdio: 'inherit', windowsHide: true });
mkdirSync(outputDirectory, { recursive: true });
const cafe = path.join(outputDirectory, 'cafe');
const smoothies = path.join(outputDirectory, 'smoothies');
const native = path.join(outputDirectory, 'native');
run(['scripts/windows/package-release.mjs', cafeTarget, cafe]);
run(['scripts/smoothies/package-windows.mjs', smoothies]);
run(['scripts/releases/package-papeleria.mjs', nativeCheckout, native]);
const nativeZip = path.join(native, 'PapeleriaPOS-v' + version + '-Windows-x64.zip');
const nativeExtracted = path.join(outputDirectory, 'native-extracted');
archive('Extract', nativeZip, nativeExtracted);
const papeleria = path.join(nativeExtracted, 'PapeleriaPOS');
run(['scripts/releases/versions.mjs', 'verify', cafe, smoothies, papeleria]);
const smoothiesZip = path.join(outputDirectory, 'POS-Smoothies-' + version + '.zip');
archive('Create', smoothies, smoothiesZip);
writeFileSync(path.join(outputDirectory, 'family-packages.json'), JSON.stringify({ version, familyRelease,
  cafe, smoothies, papeleria, smoothiesZip, nativeZip }, null, 2), { flag: 'wx' });
console.log('Built and synchronized ' + familyRelease + '. Installer acceptance must pass before publishing.');
