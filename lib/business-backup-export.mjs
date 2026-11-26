import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { backupFilename, maximumBackupBytes, sha256 } from './business-backup-format.mjs';

const execute = promisify(execFile);
const inside = (child, parent) => { const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const overlap = (left, right) => inside(left, right) || inside(right, left);
export function backupDestinationId(directory) {
  const absolute = path.resolve(directory);
  return sha256(Buffer.from(process.platform === 'win32' ? absolute.toLowerCase() : absolute, 'utf8'));
}

async function verifiedFile(file, success) {
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size === success.bytes, 'La copia no coincide con el archivo confirmado.');
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024, signal: AbortSignal.timeout(30_000) })) {
    bytes += chunk.length; assert.ok(bytes <= maximumBackupBytes); digest.update(chunk);
  }
  assert.equal(bytes, success.bytes); assert.equal(digest.digest('hex'), success.sha256, 'No se pudo verificar la copia cifrada.');
}

async function publishCopy(source, destination, sourceRoot) {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    await execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(sourceRoot, 'scripts/smoothies/Publish-BackupCopy.ps1'), '-Source', source, '-Destination', destination],
    { windowsHide: true, timeout: 30_000 });
  } else {
    // Native no-clobber publication for Linux verification; Windows uses the
    // shipped File.Move helper so USB filesystems do not need hardlinks.
    await link(source, destination); await unlink(source);
  }
}

/** Copies the already verified encrypted archive only. Never reads/exports its key. */
export async function copyBusinessBackupArchive({ directory, keyFile, exportDirectory, sourceRoot = process.cwd() }, success) {
  assert.ok(typeof exportDirectory === 'string' && path.isAbsolute(exportDirectory) && !/^(?:\\\\|\/\/)/.test(exportDirectory), 'El destino externo debe ser una carpeta local absoluta elegida explícitamente.');
  assert.ok(success && backupFilename.test(success.filename) && Number.isInteger(success.bytes) && success.bytes > 32
    && success.bytes <= maximumBackupBytes && /^[a-f0-9]{64}$/.test(success.sha256), 'Falta un respaldo cifrado confirmado para copiar.');
  const info = await lstat(exportDirectory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'El destino externo debe existir y no puede ser un enlace.');
  // Resolve aliases before checking separation. An unplugged/unmounted
  // destination fails here rather than creating a replacement on the PC.
  const [external, local, release, keyParent] = await Promise.all([
    realpath(exportDirectory), realpath(directory), realpath(sourceRoot), realpath(path.dirname(keyFile)),
  ]);
  assert.ok(!overlap(external, local) && !overlap(external, release) && !overlap(external, keyParent),
    'El destino externo debe estar separado de la versión, respaldos locales y clave de recuperación.');
  const source = path.join(local, success.filename), destination = path.join(external, success.filename);
  await verifiedFile(source, success);
  const existing = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) { await verifiedFile(destination, success); return { ...success }; }
  const pending = path.join(external, `.pos-backup-${randomUUID()}.partial`);
  let input, output, owned = false;
  try {
    input = await open(source, 'r'); output = await open(pending, 'wx', 0o600); owned = true;
    const buffer = Buffer.alloc(64 * 1024), deadline = Date.now() + 30_000;
    let position = 0;
    while (position < success.bytes) {
      assert.ok(Date.now() < deadline, 'El destino externo no respondió a tiempo.');
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, success.bytes - position), position);
      assert.ok(bytesRead > 0);
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written);
        assert.ok(result.bytesWritten > 0); written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await output.sync(); await output.close(); output = undefined; await input.close(); input = undefined;
    await verifiedFile(pending, success);
    try { await publishCopy(pending, destination, release); }
    catch (error) {
      // Another owned retry may have published identical bytes after our
      // preflight. Verify that archive; never replace a conflicting file.
      const published = await lstat(destination).catch(() => null);
      if (!published) throw error;
      await verifiedFile(destination, success);
    }
    await verifiedFile(destination, success);
    return { ...success };
  } finally {
    await input?.close(); await output?.close();
    if (owned) await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Bound external-device IO independently of the register and local backup job. */
export async function exportBusinessBackup(config, success, { timeout = 45_000 } = {}) {
  const sourceRoot = config.sourceRoot || process.cwd();
  const payload = JSON.stringify({ version: 1, config: { directory: config.directory, keyFile: config.keyFile,
    exportDirectory: config.exportDirectory, sourceRoot }, success });
  assert.ok(Buffer.byteLength(payload) <= 64 * 1024 && timeout > 0 && timeout <= 45_000);
  const env = Object.fromEntries(['WINDIR', 'SystemRoot', 'TEMP', 'TMP', 'PATH', 'COMSPEC']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const result = await new Promise((resolve, reject) => {
    const worker = execFile(process.execPath, [path.join(sourceRoot, 'scripts/smoothies/export-backup.mjs')],
      { cwd: sourceRoot, env, windowsHide: true, timeout, maxBuffer: 16 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    worker.stdin.on('error', () => {}); worker.stdin.end(payload);
  });
  const copied = JSON.parse(result);
  assert.ok(copied.filename === success.filename && copied.bytes === success.bytes && copied.sha256 === success.sha256 && copied.createdAt === success.createdAt,
    'No se confirmó la copia externa.');
  return copied;
}
