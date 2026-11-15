import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { decryptBusinessArchive, journalNames, sha256, validateBusinessArchive } from '../../lib/business-backup-format.mjs';
import { localPhotoBucket, photoTypes, verifyJournal } from '../../lib/smoothies-backup-assets.mjs';
import { restoreBusinessArchive, restoreTarget } from '../backups/restore-business.mjs';

const root = path.resolve(import.meta.dirname, '../..');

export async function restoreSmoothiesArchive(db, archive, { api, serviceKey, printDirectory, contractDirectory = path.join(root, 'supabase') }) {
  validateBusinessArchive(archive);
  assert.ok(archive.assets, 'Esta copia antigua contiene solo la base. Usa restore-business.mjs y conserva tus fotos y registro originales.');
  const migrations = (await Promise.all(['migrations', 'smoothies'].map(folder => readdir(path.join(contractDirectory, folder))))).flat()
    .filter(name => /^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)).map(name => `migrations/${name}`);
  assert.deepEqual(['schema.snapshot.json', ...migrations].sort(), Object.keys(archive.contract.files).sort(),
    'La lista de migraciones de esta versión no coincide con la copia.');
  for (const [name, file] of Object.entries(archive.contract.files)) {
    assert.equal(sha256(await readFile(path.join(contractDirectory, name))), file.sha256, `La versión local no coincide con la copia: ${name}`);
  }
  assert.ok(path.isAbsolute(printDirectory) && !/^(?:\\\\|\/\/)/.test(printDirectory), 'Indica una carpeta en el disco local para el registro.');
  const storage = localPhotoBucket(api, serviceKey);
  const expected = archive.assets.files;
  const stagedFiles = [];
  const publishedFiles = [];
  const uploaded = [];
  let databaseWillCommit = false;
  let uncertainUpload = false;
  await mkdir(printDirectory, { recursive: true });
  for (const name of journalNames.flatMap(name => [name, `${name}-wal`, `${name}-shm`, `${name}-journal`])) {
    const exists = await lstat(path.join(printDirectory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    assert.ok(!exists, 'Usa una carpeta nueva y vacía para el registro de impresión.');
  }
  const staging = await mkdtemp(path.join(printDirectory, '.restore-'));
  try {
    for (const file of expected.filter(file => file.kind === 'print')) {
      const source = path.join(staging, file.name);
      await writeFile(source, Buffer.from(file.base64, 'base64'), { flag: 'wx', mode: 0o600 });
      verifyJournal(source);
      stagedFiles.push({ source, destination: path.join(printDirectory, file.name), sha256: file.sha256 });
    }
    const result = await restoreBusinessArchive(db, archive, { failBeforeCommit: async () => {
      const existing = await storage.list('', { limit: 1 });
      if (existing.error) throw existing.error;
      assert.equal(existing.data.length, 0, 'El almacenamiento de destino ya tiene fotos. Usa una instalación vacía.');
      for (const file of expected.filter(file => file.kind === 'photos')) {
        const contentType = photoTypes[path.extname(file.name).slice(1)];
        uncertainUpload = true;
        const upload = await storage.upload(file.name, Buffer.from(file.base64, 'base64'), { contentType, upsert: false });
        if (upload.error) {
          const status = Number(upload.error.statusCode || upload.error.status);
          uncertainUpload = !(status >= 400 && status < 500);
          throw upload.error;
        }
        uploaded.push(file.name);
        uncertainUpload = false;
        const download = await storage.download(file.name);
        if (download.error) throw download.error;
        assert.equal(sha256(Buffer.from(await download.data.arrayBuffer())), file.sha256, 'La foto restaurada no coincide.');
        assert.equal((await db.query("select exists(select 1 from storage.objects where bucket_id='catalog-photos' and name=$1) as found", [file.name])).rows[0].found,
          true, 'La API de Storage y PostgreSQL corresponden a instalaciones distintas.');
      }
      for (const file of stagedFiles) {
        await copyFile(file.source, file.destination, constants.COPYFILE_EXCL);
        publishedFiles.push(file.destination);
        assert.equal(sha256(await readFile(file.destination)), file.sha256, 'El registro restaurado no coincide.');
      }
      databaseWillCommit = true;
    } });
    return { ...result, photos: uploaded.length, printJournals: stagedFiles.length };
  } catch (error) {
    if (databaseWillCommit) {
      throw Error('No se confirmó la restauración de la base. Deja la caja cerrada y verifica la base y los archivos antes de reintentar.', { cause: error });
    }
    const cleanup = [
      ...publishedFiles.map(file => rm(file, { force: true })),
      ...uploaded.map(async name => { const removed = await storage.remove([name]); if (removed.error) throw removed.error; }),
    ];
    if ((await Promise.allSettled(cleanup)).some(result => result.status === 'rejected') || uncertainUpload)
      throw Error('No se completó la restauración ni la limpieza del destino. Prepara un destino vacío antes de reintentar.', { cause: error });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  try {
    const [archiveFile, keyFile, configFile, ...extra] = process.argv.slice(2);
    assert.ok(archiveFile && keyFile && configFile && !extra.length,
      'Uso: node restore-local.mjs ARCHIVO.posbackup CLAVE DESTINO_PRIVADO.json');
    const archive = decryptBusinessArchive(await readFile(archiveFile), await readFile(keyFile));
    const config = JSON.parse((await readFile(configFile, 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(config.api, 'http://127.0.0.1:58000');
    const database = new URL(restoreTarget(config));
    assert.equal(database.hostname, '127.0.0.1');
    assert.equal(database.port, '55432');
    db = new Client({ connectionString: database.href, connectionTimeoutMillis: 5000 });
    await db.connect();
    console.log(JSON.stringify(await restoreSmoothiesArchive(db, archive, config)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se completó la restauración.');
    process.exitCode = 1;
  } finally { await db?.end(); }
}
