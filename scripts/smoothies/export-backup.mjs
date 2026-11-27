import assert from 'node:assert/strict';
import { copyBusinessBackupArchive } from '../../lib/business-backup-export.mjs';

async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) { raw += chunk; assert.ok(Buffer.byteLength(raw) <= 64 * 1024); }
    const task = JSON.parse(raw); assert.equal(task.version, 1);
    console.log(JSON.stringify(await copyBusinessBackupArchive(task.config, task.success)));
  } catch {
    // No filesystem path, server secret or raw device error crosses this boundary.
    console.error('No se confirmó la copia externa del respaldo cifrado.'); process.exitCode = 1;
  }
}
void main();
