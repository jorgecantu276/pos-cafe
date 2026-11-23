import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const storageMigration = '202611020022_catalog_photos.sql';

// Storage owns these platform tables. Ordinary application/restore fixtures
// explicitly exclude this one migration; a Storage fixture includes it in order.
export async function migrationContract({ directory = path.join(root, 'supabase/migrations'), storage = false } = {}) {
  const all = (await readdir(directory)).filter(name => /^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)).sort();
  assert.ok(all.length > 0, 'No application migrations found.');
  const omitted = storage ? [] : all.filter(name => name === storageMigration);
  const files = all.filter(name => !omitted.includes(name));
  const texts = await Promise.all(files.map(name => readFile(path.join(directory, name), 'utf8')));
  return { files, texts, migration: texts.join('\n'), omittedPlatformMigrations: omitted };
}
