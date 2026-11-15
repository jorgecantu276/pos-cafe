import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve(import.meta.dirname, '../..');
const output = process.argv[2];
assert.ok(process.platform === 'win32' && process.arch === 'x64');
assert.equal(process.version, 'v24.22.2', 'Empaqueta con Node 24.22.2 x64.');
assert.ok(output && path.isAbsolute(output) && !existsSync(output), 'Indica una carpeta de salida nueva y absoluta.');
const nodeLicense = process.env.SMOOTHIES_NODE_LICENSE || path.join(path.dirname(process.execPath), 'LICENSE');
assert.ok(existsSync(nodeLicense), 'Hace falta la licencia del runtime oficial de Node.');
const stage = mkdtempSync(path.join(source, '.build-check-smoothies-'));
const runtimePath = path.join(output, 'app');

function copy(src, into, names) {
  for (const name of names) {
    const target = path.join(into, name);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(src, name), target, { recursive: true, dereference: true, filter: file => !path.basename(file).startsWith('.env') });
  }
}

function linkDependencies(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const input = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) linkDependencies(input, destination);
    else if (entry.isSymbolicLink()) cpSync(input, destination, { recursive: true, dereference: true });
    else linkSync(input, destination);
  }
}

const copied = new Map();
function recoveryDependency(name, parent = path.join(source, 'package.json')) {
  const resolver = createRequire(parent);
  const folder = resolver.resolve.paths(name)?.map(directory => path.join(directory, name))
    .find(directory => existsSync(path.join(directory, 'package.json')));
  assert.ok(folder, `No se encontró el paquete ${name}.`);
  const manifest = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'));
  if (copied.has(name)) {
    assert.equal(copied.get(name), manifest.version, `Versiones incompatibles de ${name}.`);
    return;
  }
  copied.set(name, manifest.version);
  const target = path.join(runtimePath, 'node_modules', name);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(folder, target, { recursive: true, dereference: true, filter: file => path.basename(file) !== 'node_modules' });
  for (const dependency of Object.keys(manifest.dependencies || {})) recoveryDependency(dependency, path.join(folder, 'package.json'));
}

try {
  copy(source, stage, ['app','components','lib','public','store','types','config/cafe-printers.json','config/receipt-branding.json',
    'instrumentation.ts','middleware.ts','next.config.ts','postcss.config.mjs','tsconfig.json','package.json','package-lock.json']);
  linkDependencies(path.join(source, 'node_modules'), path.join(stage, 'node_modules'));
  const env = { ...process.env, NEXT_PUBLIC_POS_PROFILE: 'smoothies', NEXT_TELEMETRY_DISABLED: '1', POS_RELEASE_BUILD: '1', NEXT_PUBLIC_SMOOTHIES_PORTABLE: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:58000', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'smoothies-runtime-config' };
  for (const key of Object.keys(env)) {
    if (/^SMOOTHIES_|^SUPABASE_|^POS_(?:CLIP|PRINT|BACKUP|DATABASE|RECEIPT|LAUNCH)/.test(key)) delete env[key];
  }
  const result = spawnSync(process.execPath, [path.join(stage, 'node_modules/next/dist/bin/next'), 'build', '--webpack'],
    { cwd: stage, env, stdio: 'inherit' });
  assert.equal(result.status, 0, 'No se generó el paquete de producción.');
  const standalone = path.join(stage, '.next/standalone');
  assert.ok(existsSync(path.join(standalone, 'server.js')), 'Falta el servidor portable de Next.');
  cpSync(standalone, runtimePath, { recursive: true, dereference: true, filter: file => !path.basename(file).startsWith('.env') });
  copy(stage, runtimePath, ['public', '.next/static']);
  rmSync(path.join(runtimePath, 'public/receipt-branding'), { recursive: true, force: true });
  copy(source, runtimePath, ['supabase/migrations', 'supabase/smoothies', 'supabase/schema.snapshot.json',
    'scripts/printing/windows-print.ps1', 'scripts/printing/DesktopPrinter.cs', 'scripts/staging/safety.mjs',
    'scripts/backups/restore-business.mjs', 'lib/business-backup-format.mjs', 'lib/smoothies-backup-assets.mjs',
    ...['Install-Smoothies.ps1','Launch-Smoothies.ps1','install-local.mjs','prepare-local.mjs',
      'provision-supabase.mjs','restore-local.mjs','start-local.mjs','stop-local.mjs','supabase']
      .map(name => `scripts/smoothies/${name}`)]);
  recoveryDependency('pg');
  recoveryDependency('@supabase/supabase-js');
  cpSync(process.execPath, path.join(output, 'node.exe'));
  cpSync(nodeLicense, path.join(output, 'Node-LICENSE.txt'));
  copy(source, output, ['Instalar POS Smoothies.cmd']);
  cpSync(path.join(source, 'docs/smoothies-local.md'), path.join(output, 'Guia PC e iPad.md'));
  const build = readFileSync(path.join(runtimePath, '.next/BUILD_ID'), 'utf8').trim();
  const migrations = ['migrations', 'smoothies'].flatMap(folder => readdirSync(path.join(runtimePath, 'supabase', folder))
    .filter(file => file.endsWith('.sql')).map(file => [file, folder])).sort(([left], [right]) => left.localeCompare(right));
  const databaseContract = createHash('sha256').update(JSON.stringify([
    readFileSync(path.join(runtimePath, 'supabase/schema.snapshot.json'), 'utf8'),
    ...migrations.map(([file, folder]) => [file, readFileSync(path.join(runtimePath, 'supabase', folder, file), 'utf8')]),
  ])).digest('hex');
  const id = createHash('sha256').update(`${build}\n${databaseContract}`).digest('hex').slice(0, 16);
  writeFileSync(path.join(output, 'release.json'), JSON.stringify({ version: 1, build, id, databaseContract }));
  console.log(`POS Smoothies ${id}: ${output}`);
} finally { rmSync(stage, { recursive: true, force: true }); }
