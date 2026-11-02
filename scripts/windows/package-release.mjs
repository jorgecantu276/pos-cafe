import assert from 'node:assert/strict';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const [targetFile, destination] = process.argv.slice(2);
assert.equal(process.platform, 'win32', 'Build the Windows release on Windows.');
assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.22.2');
assert.ok(targetFile && path.isAbsolute(targetFile) && destination && path.isAbsolute(destination), 'Pass absolute target-config JSON and NEW output-folder paths.');
assert.ok(!existsSync(destination), 'Never overwrite a previous release or print journal.');
const target = JSON.parse(readFileSync(targetFile, 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(target.supabaseUrl);
assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)), 'Use HTTPS for the client Supabase project.');
const key = target.supabaseAnonKey;
assert.ok(typeof key === 'string' && key.length > 0, 'The target public key is required.');
if (url.protocol === 'https:') {
  if (!key.startsWith('sb_publishable_')) {
    let claims; try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch { /* Reject below. */ }
    assert.equal(claims?.role, 'anon', 'Only an anon/publishable key may be bundled. Never pass a service-role or secret key.');
  }
}
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const stage = mkdtempSync(path.join(root, '.build-check-release-'));
for (const file of files) {
  if (path.basename(file).startsWith('.env')) continue;
  mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
  cpSync(path.join(root, file), path.join(stage, file));
}
// A junction for the whole node_modules directory makes Next trace/copy every
// development dependency. Give the build real directories with immutable file
// hardlinks instead. The final copy contains ordinary relocatable files.
function stageDependencies(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) stageDependencies(from, to);
    else if (entry.isSymbolicLink()) cpSync(from, to, { recursive: true, dereference: true });
    else linkSync(from, to);
  }
}
stageDependencies(path.join(root, 'node_modules'), path.join(stage, 'node_modules'));
const env = { ...process.env, POS_RELEASE_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: url.origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: key };
delete env.SUPABASE_SERVICE_ROLE_KEY; delete env.SUPABASE_ACCESS_TOKEN; delete env.POS_RECEIPT_ISSUER_FILE;
for (const name of Object.keys(env)) if (name.startsWith('POS_CLIP_')) delete env[name];
const build = spawnSync(process.execPath, [path.join(stage, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: stage, env, stdio: 'inherit' });
assert.equal(build.status, 0, 'Production build failed; no release was created.');
const standalone = path.join(stage, '.next/standalone');
assert.ok(existsSync(path.join(standalone, 'server.js')), 'Standalone server missing.');
mkdirSync(destination);
const app = path.join(destination, 'app');
cpSync(standalone, app, { recursive: true, dereference: true, filter: source => !path.basename(source).startsWith('.env') });
cpSync(path.join(stage, 'public'), path.join(app, 'public'), { recursive: true });
cpSync(path.join(stage, '.next/static'), path.join(app, '.next/static'), { recursive: true });
mkdirSync(path.join(app, 'scripts/printing'), { recursive: true });
for (const file of ['windows-print.ps1', 'DesktopPrinter.cs']) cpSync(path.join(root, 'scripts/printing', file), path.join(app, 'scripts/printing', file));
cpSync(process.execPath, path.join(destination, 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
assert.ok(existsSync(nodeLicense), 'The official Node distribution LICENSE must accompany node.exe.');
cpSync(nodeLicense, path.join(destination, 'Node-LICENSE.txt'));
for (const file of ['Start-POS.ps1', 'Open-POS.cmd', 'Install-POS-shortcut.ps1']) cpSync(path.join(root, 'scripts/windows', file), path.join(destination, file));
cpSync(path.join(root, 'supabase/migrations'), path.join(destination, 'database-migrations'), { recursive: true });
cpSync(path.join(root, 'supabase/schema.snapshot.json'), path.join(destination, 'database-migrations/schema.snapshot.json'));
mkdirSync(path.join(destination, 'clip-setup'), {recursive:true});
cpSync(path.join(root, 'config/clip-token.example.txt'), path.join(destination, 'clip-setup/clip-token.example.txt'));
cpSync(path.join(root, 'docs/clip-payments.md'), path.join(destination, 'clip-setup/README.md'));
cpSync(path.join(root, 'supabase/functions/clip-webhook'), path.join(destination, 'clip-setup/clip-webhook'), {recursive:true});
mkdirSync(path.join(destination, 'backup-tools/scripts/backups'), { recursive: true });
mkdirSync(path.join(destination, 'backup-tools/lib'), { recursive: true });
cpSync(path.join(root, 'scripts/backups/inspect.mjs'), path.join(destination, 'backup-tools/scripts/backups/inspect.mjs'));
cpSync(path.join(root, 'lib/business-backup-format.mjs'), path.join(destination, 'backup-tools/lib/business-backup-format.mjs'));
cpSync(path.join(root, 'docs/business-backups.md'), path.join(destination, 'backup-tools/README.md'));
writeFileSync(path.join(destination, 'release.json'), JSON.stringify({ version: 1, builtAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version, supabaseUrl: url.origin, publicKeySha256: createHash('sha256').update(key).digest('hex'),
  fixtureOnly: url.protocol === 'http:',
}, null, 2));
writeFileSync(path.join(destination, 'pos-cafe-config.example.json'), JSON.stringify({ SupabaseUrl: url.origin, SupabaseAnonKey: key,
  SupabaseServiceRoleKey: '', Port: 3000, PrintMode: 'mock', PrintDataDirectory: '', ReceiptIssuerFile: '', StickerStockConfirmed: false,
  BackupDirectory: '', BackupRecoveryKeyFile: '',
  ClipEnabled: false, ClipTokenFile: '', ClipSerial: 'AA61B2325A1302219', ClipWebhookUrl: '',
}, null, 2));
// Ensure release contents are ordinary copied files, with no junction back to this PC.
function releaseFiles(folder, prefix = '') {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'A release cannot depend on development-PC symlinks.');
    const relative = path.join(prefix, entry.name), file = path.join(folder, entry.name);
    return entry.isDirectory() ? releaseFiles(file, relative) : [{ file: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }];
  });
}
writeFileSync(path.join(destination, 'SHA256.json'), JSON.stringify(releaseFiles(destination), null, 2));
console.log('Windows release prepared:', destination, url.protocol === 'http:' ? '(LOOPBACK FIXTURE ONLY)' : '(client target; verify matching database and private runtime configuration before installation)');
