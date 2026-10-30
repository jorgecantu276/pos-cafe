import { readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { decryptBusinessArchive } from '../../lib/business-backup-format.mjs';

const [archiveFile,keyFile,output,...extra]=process.argv.slice(2);
try {
  if(!archiveFile||!keyFile||extra.length||(output&&!path.isAbsolute(output))) throw Error('Uso: node scripts/backups/inspect.mjs ARCHIVO.posbackup CLAVE.key [SALIDA_JSON_ABSOLUTA]');
  const archive=decryptBusinessArchive(await readFile(archiveFile),await readFile(keyFile));
  if(output) {
    const file=await open(output,'wx',0o600);
    try { await file.writeFile(JSON.stringify(archive)); await file.sync(); } finally { await file.close(); }
  }
  const snapshot=JSON.parse(archive.snapshotJson);
  console.log(JSON.stringify({verified:true,createdAt:archive.createdAt,sourceHost:archive.sourceHost,releaseCommit:archive.releaseCommit,
    tableCounts:Object.fromEntries(Object.entries(snapshot.tables).map(([name,table])=>[name,table.rows.length])),
    contractFiles:Object.keys(archive.contract.files).length,plaintextExported:Boolean(output)}));
} catch(error) { console.error(error instanceof Error?error.message:'No se pudo verificar el respaldo.');process.exitCode=1; }
