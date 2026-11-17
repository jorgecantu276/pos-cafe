import path from 'node:path';
import { tmpdir } from 'node:os';
import { lstat, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { backup, DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { journalNames, maximumAssetBytes, maximumPhotoBytes, photoName, sha256 } from './business-backup-format.mjs';

export const photoTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const photoPath = '/storage/v1/object/public/catalog-photos/';

export function localPhotoBucket(url, key) {
  const api = new URL(url);
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.pathname !== '/' || api.username || api.password || !key)
    throw Error('Se necesita el almacenamiento local del POS.');
  const client = createClient(api.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }) },
  });
  return client.storage.from('catalog-photos');
}

export function verifyJournal(filename) {
  const db = new DatabaseSync(filename, { readOnly: true, timeout: 5000 });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok'
      || db.prepare("select count(*) as n from sqlite_schema where type='table' and name in ('jobs','sale_sources','recovery_audit')").get().n !== 3)
      throw Error('El registro local de impresión no pasó la verificación.');
  } finally { db.close(); }
}

export async function collectSmoothiesAssets({ url, serviceKey, printDirectory }, snapshotJson) {
  const storage = localPhotoBucket(url, serviceKey);
  const files = [];
  const photos = new Set();
  let total = 0;
  function add(kind, name, bytes) {
    total += bytes.length;
    if (!bytes.length || total > maximumAssetBytes || (kind === 'photos' && bytes.length > maximumPhotoBytes))
      throw Error('Los archivos locales superan el tamaño admitido para el respaldo.');
    files.push({ kind, name, base64: bytes.toString('base64'), sha256: sha256(bytes) });
  }
  for (const row of JSON.parse(snapshotJson).tables['public.products'].rows) {
    if (!row.image_url) continue;
    let image;
    try { image = new URL(row.image_url, url); } catch { continue; }
    if (image.origin !== new URL(url).origin || !image.pathname.startsWith(photoPath)) continue;
    const name = image.pathname.slice(photoPath.length);
    if (!photoName.test(name)) throw Error('Una foto del catálogo tiene un nombre incompatible.');
    photos.add(name);
  }
  for (const name of photos) {
    const download = await storage.download(name);
    if (download.error) throw download.error;
    add('photos', name, Buffer.from(await download.data.arrayBuffer()));
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'smoothies-journal-'));
  try {
    for (const name of journalNames) {
      const source = path.join(printDirectory, name);
      const file = await lstat(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!file) continue;
      if (!file.isFile() || file.size > maximumAssetBytes) throw Error('El registro local de impresión supera el tamaño admitido.');
      const destination = path.join(temporary, name);
      const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
      try { await backup(db, destination); } finally { db.close(); }
      verifyJournal(destination);
      if ((await stat(destination)).size > maximumAssetBytes - total) throw Error('El registro local de impresión supera el tamaño admitido.');
      add('print', name, await readFile(destination));
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { version: 1, files };
}
