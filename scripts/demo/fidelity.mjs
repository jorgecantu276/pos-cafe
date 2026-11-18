import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from './app.mjs';
import { baseline } from './menu.mjs';

export function canonicalBaselineBytes(file,bytes) {
  return /\.(png|jpe?g|webp|ico|gif|woff2?|ttf)$/i.test(file)?bytes:bytes.toString('utf8').replaceAll('\r\n','\n');
}

export async function verifyBaseline() {
  const manifest=JSON.parse(await readFile(new URL('./baseline-files.json',import.meta.url),'utf8'));
  assert.equal(manifest.commit,baseline);
  for(const [file,hash] of Object.entries(manifest.files)) {
    const bytes=await readFile(path.join(root,file));
    const canonical=canonicalBaselineBytes(file,bytes);
    assert.equal(createHash('sha256').update(canonical).digest('hex'),hash,`Pre-dashboard source changed: ${file}`);
  }
  async function walk(directory) {
    for(const e of await readdir(path.join(root,directory),{withFileTypes:true})) {
      const file=`${directory}/${e.name}`;
      if(e.isDirectory())await walk(file);
      else assert.ok(manifest.files[file],`Unexpected application file: ${file}`);
    }
  }
  for(const dir of ['app','components','lib','store','types','public','config','supabase/migrations'])await walk(dir);
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  assert.deepEqual(pkg.dependencies,manifest.dependencies);
  assert.deepEqual(pkg.devDependencies,manifest.devDependencies);
  assert.deepEqual(pkg.engines,manifest.engines);
  return Object.keys(manifest.files).length;
}
