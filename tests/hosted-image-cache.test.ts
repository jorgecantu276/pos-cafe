import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { cacheExactImages, equalImageProof, hostedCacheEnvironment, originalImages, ownedPath, registryReader, selectedChild } from '../scripts/testing/hosted-image-cache.mjs';

const hash = (value: string | Buffer) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const refs = ['postgres:17.11.0.018','gotrue:v2.197.0','postgrest:v16.5','storage-api:v1.90.1','kong:2.8.1'].map(value => 'public.ecr.aws/supabase/' + value);
function fixture(name: string) {
  const child = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', size: 123, digest: hash(name + '-config') },
    layers: [1,2].map(number => ({ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', size: 42 + number, digest: hash(name + '-layer-' + number) })) }));
  const descriptor = { mediaType: 'application/vnd.oci.image.manifest.v1+json', size: child.length, digest: hash(child), platform: { os: 'linux', architecture: 'amd64' } };
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [descriptor,
    { ...descriptor, digest: hash('other-architecture'), platform: { os: 'linux', architecture: 'arm64' } }] }));
  return { index, child, descriptor, config: hash(name + '-config') };
}

test('owned cache paths accept real Windows short/long spellings and refuse linked ancestors/root', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos image cache paths '));
  const folder = path.join(directory, 'original content'); await mkdir(folder);
  const file = path.join(folder, 'compose.yml'); await writeFile(file, 'synthetic public image fixture');
  await ownedPath(file, directory, true); await ownedPath(path.join(folder, 'new-proof.json'), directory, false);
  const aliasScript = path.join(directory, 'aliases.ps1');
  await writeFile(aliasScript, 'param($Root,$FilePath)\n$shell=New-Object -ComObject Scripting.FileSystemObject\n@{root=$shell.GetFolder($Root).ShortPath;file=$shell.GetFile($FilePath).ShortPath}|ConvertTo-Json -Compress');
  const result = await promisify(execFile)(path.join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-File',aliasScript,directory,file], { windowsHide: true, timeout: 10_000 });
  const aliases = JSON.parse(result.stdout);
  if (aliases.root.toLowerCase() !== directory.toLowerCase() || aliases.file.toLowerCase() !== file.toLowerCase()) {
    await ownedPath(aliases.file, aliases.root, true); t.diagnostic('Actual Windows8.3 alias accepted.');
  } else t.diagnostic('This volume did not expose a distinct8.3 alias; normal-path and link checks still exercised.');
  await assert.rejects(ownedPath(path.join(directory, '..', 'outside.yml'), directory, true));
  const link = path.join(directory, 'redirected');
  await symlink(folder, link, 'junction');
  await assert.rejects(ownedPath(path.join(link, 'compose.yml'), directory, true));
  await assert.rejects(ownedPath(path.join(link, 'compose.yml'), link, true));
});

test('official-image proof checks raw child hashes, unique platform, exact config and ordered layers', () => {
  const image = originalImages(refs)[0], value = fixture(image.name);
  const proof = equalImageProof(image, value.index, value.child, value.index, value.child);
  assert.equal(proof.configDigest, value.config); assert.equal(proof.childDigest, hash(value.child));
  assert.throws(() => equalImageProof(image, value.index, value.child, value.index, Buffer.from(value.child.toString() + ' ')), /hash/);
  const duplicate = JSON.parse(value.index.toString()); duplicate.manifests.push(duplicate.manifests[0]);
  assert.throws(() => selectedChild(Buffer.from(JSON.stringify(duplicate))), /unambiguous/);
  const absent = { ...duplicate, manifests: [] }; assert.throws(() => selectedChild(Buffer.from(JSON.stringify(absent))), /unambiguous/);
  const changed = JSON.parse(value.child.toString()); changed.layers.reverse();
  const changedChild = Buffer.from(JSON.stringify(changed));
  const changedIndex = JSON.parse(value.index.toString()); changedIndex.manifests[0] = { ...value.descriptor, digest: hash(changedChild), size: changedChild.length };
  assert.throws(() => equalImageProof(image, value.index, value.child, Buffer.from(JSON.stringify(changedIndex)), changedChild), /digests differ/);
  for (const invalid of [[...refs.slice(0,4)], [...refs.slice(0,4), refs[0]], [...refs.slice(0,4), 'ghcr.io/supabase/kong:2.8.1'], [...refs.slice(0,4), 'public.ecr.aws/supabase/kong:latest']]) assert.throws(() => originalImages(invalid));
});

function environment(options: { missingProof?: string; existingMismatch?: boolean; wrongLoadedArch?: boolean; wrongLoadedId?: boolean } = {}) {
  const records = new Map(originalImages(refs).map(image => [image.name, fixture(image.name)]));
  const images = new Map<string, { Id: string; Os: string; Architecture: string; RepoDigests: string[] }>();
  const events: string[] = [];
  if (options.existingMismatch) images.set(refs[4], { Id: hash('foreign'), Os: 'linux', Architecture: 'amd64', RepoDigests: [] });
  const metadata = async (_registry: string, name: string, reference: string) => {
    events.push('metadata'); if (options.missingProof === name) throw Error('Missing original proof');
    return reference.startsWith('sha256:') ? records.get(name)!.child : records.get(name)!.index;
  };
  const docker = async (args: string[]) => {
    events.push(args[0]);
    if (args[0] === 'pull') {
      assert.equal(events.filter(value => value === 'metadata').length, 20, 'All five proofs must precede mutation.');
      assert.deepEqual(args.slice(1,3), ['--platform','linux/amd64']);
      const ref = args[3], name = ref.split('/').at(-1)!.split('@')[0];
      assert.match(ref, /^ghcr\.io\/supabase\/[a-z-]+@sha256:[a-f0-9]{64}$/);
      images.set(ref, { Id: options.wrongLoadedId ? hash('wrong-loaded') : records.get(name)!.config,
        Os: 'linux', Architecture: options.wrongLoadedArch ? 'arm64' : 'amd64', RepoDigests: [ref] });
      return '';
    }
    if (args[0] === 'tag') {
      assert.match(args[1], /^sha256:[a-f0-9]{64}$/, 'Tag only the verified immutable image ID.');
      assert.ok(!images.has(args[2]), 'Never replace an existing original alias.');
      const found = [...images.values()].find(value => value.Id === args[1]); assert.ok(found); images.set(args[2], found); return '';
    }
    if (args[1] === 'inspect') { assert.ok(images.has(args[2])); return JSON.stringify([images.get(args[2])]); }
    assert.equal(args[1], 'ls'); const original = args.at(-1)!.slice('reference='.length);
    if (!images.has(original)) return '';
    const split = original.lastIndexOf(':'); return JSON.stringify({ Repository: original.slice(0,split), Tag: original.slice(split + 1) });
  };
  return { metadata, docker, hostCheck: async () => { events.push('host'); }, events, images };
}

test('exact cache verifies all five proofs then pulls immutable children and tags only absent original aliases', async () => {
  const io = environment(); const proofs = await cacheExactImages(refs, io);
  assert.equal(proofs.length, 5); assert.equal(io.events.filter(value => value === 'pull').length, 5); assert.equal(io.events.filter(value => value === 'tag').length, 5);
  for (const proof of proofs) assert.equal(io.images.get(proof.original)?.Id, proof.configDigest);
  const repeated = await cacheExactImages(refs, io);
  assert.equal(repeated.filter(value => value.cacheAction === 'existing-identical').length, 5);
  assert.equal(io.events.filter(value => value === 'pull').length, 5, 'An identical existing alias needs no new pull or retag.');
});

test('missing upstream proof, foreign original, wrong loaded config and wrong platform fail closed', async () => {
  for (const options of [{ missingProof: 'kong' }, { existingMismatch: true }]) {
    const io = environment(options); await assert.rejects(cacheExactImages(refs, io));
    assert.equal(io.events.filter(value => value === 'pull' || value === 'tag').length, 0);
  }
  for (const options of [{ wrongLoadedArch: true }, { wrongLoadedId: true }]) {
    const io = environment(options); await assert.rejects(cacheExactImages(refs, io));
    assert.equal(io.events.filter(value => value === 'tag').length, 0);
  }
  const io = environment(); await assert.rejects(cacheExactImages(refs, { ...io, hostCheck: async () => { throw Error('foreign host'); } }));
  assert.equal(io.events.length, 0);
  assert.throws(() => hostedCacheEnvironment({}, 'win32'));
  assert.throws(() => hostedCacheEnvironment({}, 'linux'));
});

test('registry metadata is paced/serialized, bounded and retries only explicit HTTP429', async () => {
  const waits: number[] = [], calls: string[] = []; let attempts = 0, active = 0, peak = 0;
  const bytes = fixture('postgres').index;
  const reader = registryReader({ pause: async (duration: number) => { waits.push(duration); }, fetcher: async (url: string | URL) => {
    calls.push(String(url)); active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (new URL(url).pathname.startsWith('/token')) return new Response(JSON.stringify({ token: 'anonymous-private-token' }));
    if (attempts++ === 0) return new Response('', { status: 429 });
    return new Response(bytes, { headers: { 'docker-content-digest': hash(bytes) } });
  } });
  const result = await Promise.all([reader('public.ecr.aws','postgres','tag'), reader('ghcr.io','postgres','tag')]);
  assert.equal(peak, 1); assert.equal(result.length, 2); assert.ok(waits.includes(15_000)); assert.ok(waits.filter(value => value === 1250).length >= calls.length);
  let forbiddenCalls = 0;
  const denied = registryReader({ pause: async () => {}, fetcher: async () => { forbiddenCalls++; return new Response('', { status: 403 }); } });
  await assert.rejects(denied('public.ecr.aws','postgres','tag'), /HTTP 403/); assert.equal(forbiddenCalls, 1);
  let throttledCalls = 0;
  const throttled = registryReader({ pause: async () => {}, fetcher: async () => { throttledCalls++; return new Response('', { status: 429 }); } });
  await assert.rejects(throttled('public.ecr.aws','postgres','tag'), /HTTP 429/); assert.equal(throttledCalls, 3);
  const oversized = registryReader({ pause: async () => {}, fetcher: async () => new Response(Buffer.alloc(1_048_577)) });
  await assert.rejects(oversized('public.ecr.aws','postgres','tag'), /bound/);
});
