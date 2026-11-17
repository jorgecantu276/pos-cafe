import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../lib/business-backup-format.mjs';

export async function verifyRestoreContract(contract, contractDirectory) {
  const migrations = (await Promise.all(['migrations', 'smoothies'].map(async folder =>
    (await readdir(path.join(contractDirectory, folder))).filter(name => /^\d+_[a-zA-Z0-9_]+\.sql$/.test(name))
      .map(name => ({ logical: `migrations/${name}`, physical: path.join(folder, name) }))))).flat();
  const physicalFiles = new Map([['schema.snapshot.json', 'schema.snapshot.json'], ...migrations.map(row => [row.logical, row.physical])]);
  assert.equal(physicalFiles.size, migrations.length + 1, 'Hay migraciones con el mismo nombre en dos carpetas.');
  assert.deepEqual([...physicalFiles.keys()].sort(), Object.keys(contract.files).sort(),
    'La lista de migraciones de esta version no coincide con la copia.');
  for (const [name, file] of Object.entries(contract.files)) {
    assert.equal(sha256(await readFile(path.join(contractDirectory, physicalFiles.get(name)))), file.sha256,
      `La version local no coincide con la copia: ${name}`);
  }
}
