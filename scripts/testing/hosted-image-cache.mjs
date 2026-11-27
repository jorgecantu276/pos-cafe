import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dockerCheck, realDockerExecutable, run } from '../staging/runtime.mjs';

const repositories = new Set(['postgres', 'gotrue', 'postgrest', 'storage-api', 'kong']);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const indexes = new Set(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json']);
const manifests = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json']);
const accept = [...indexes, ...manifests].join(', ');
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** @param {string[]} values */
export function originalImages(values) {
  assert.equal(values.length, 5, 'Exactly the five managed Compose images are eligible.');
  const seen = new Set();
  return values.map(original => {
    const match = /^public\.ecr\.aws\/supabase\/([a-z-]+):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/.exec(original);
    assert.ok(match && repositories.has(match[1]) && match[2] !== 'latest', 'Only exact original managed Supabase tags are eligible.');
    assert.ok(!seen.has(match[1]), 'Duplicate managed repository.'); seen.add(match[1]);
    return { original, name: match[1], tag: match[2], mirror: 'ghcr.io/supabase/' + match[1] };
  });
}

function parsed(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1_048_576, 'Registry metadata exceeds its bound.');
  return JSON.parse(bytes.toString('utf8'));
}
export function selectedChild(indexBytes) {
  const index = parsed(indexBytes);
  assert.equal(index.schemaVersion, 2); assert.ok(indexes.has(index.mediaType), 'An explicit platform index is required.');
  assert.ok(Array.isArray(index.manifests));
  const candidates = index.manifests.filter(item => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64');
  assert.equal(candidates.length, 1, 'Require one unambiguous linux/amd64 child.');
  const child = candidates[0];
  assert.match(child.digest || '', digestPattern); assert.ok(manifests.has(child.mediaType));
  assert.ok(Number.isSafeInteger(child.size) && child.size > 0 && child.size <= 1_048_576);
  return child;
}
function checkedManifest(bytes, descriptor) {
  assert.equal(sha(bytes), descriptor.digest, 'Raw child manifest hash differs from its index.');
  assert.equal(bytes.length, descriptor.size);
  const manifest = parsed(bytes);
  assert.equal(manifest.schemaVersion, 2); assert.ok(manifests.has(manifest.mediaType));
  assert.match(manifest.config?.digest || '', digestPattern);
  assert.ok(Number.isSafeInteger(manifest.config.size) && manifest.config.size > 0);
  assert.ok(Array.isArray(manifest.layers) && manifest.layers.length > 0 && manifest.layers.length <= 256);
  for (const layer of manifest.layers) {
    assert.match(layer.digest || '', digestPattern);
    assert.ok(Number.isSafeInteger(layer.size) && layer.size >= 0 && typeof layer.mediaType === 'string');
  }
  return manifest;
}
export function equalImageProof(image, originalIndex, originalChild, mirrorIndex, mirrorChild) {
  const left = selectedChild(originalIndex), right = selectedChild(mirrorIndex);
  assert.equal(left.digest, right.digest, 'Original and official mirror child digests differ.');
  const original = checkedManifest(originalChild, left), mirror = checkedManifest(mirrorChild, right);
  assert.deepEqual(originalChild, mirrorChild, 'The raw child manifests must be byte-identical.');
  assert.deepEqual(original.config, mirror.config); assert.deepEqual(original.layers, mirror.layers);
  return { ...image, originalIndexDigest: sha(originalIndex), mirrorIndexDigest: sha(mirrorIndex),
    childDigest: left.digest, configDigest: original.config.digest, layerDigests: original.layers.map(layer => layer.digest) };
}

async function boundedBody(response) {
  const chunks = []; let length = 0;
  const reader = response.body?.getReader(); assert.ok(reader, 'Registry metadata body is missing.');
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; assert.ok(length <= 1_048_576, 'Registry metadata body exceeds its bound.'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
/** @param {{fetcher?: (url: string | URL, options?: RequestInit) => Promise<Response>, pause?: (milliseconds: number) => Promise<unknown>}} options */
export function registryReader({ fetcher = fetch, pause = sleep } = {}) {
  let queue = Promise.resolve(); const tokens = new Map();
  const request = (url, headers) => {
    const operation = queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await pause(1250);
        const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (response.status === 429 && attempt < 2) { await response.body?.cancel(); await pause(15_000 * (attempt + 1)); continue; }
        assert.equal(response.status, 200, `Registry metadata HTTP ${response.status}; no missing proof can be accepted.`);
        const bytes = await boundedBody(response);
        const declared = response.headers.get('docker-content-digest');
        if (declared) assert.equal(declared, sha(bytes), 'Registry digest header differs from raw metadata.');
        return bytes;
      }
      throw new Error('Registry metadata retries exhausted.');
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  return async (registry, name, reference) => {
    assert.ok(['public.ecr.aws', 'ghcr.io'].includes(registry) && repositories.has(name));
    assert.ok(digestPattern.test(reference) || /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(reference));
    const key = registry + '/' + name;
    if (!tokens.has(key)) {
      const tokenUrl = new URL(registry === 'public.ecr.aws' ? 'https://public.ecr.aws/token/' : 'https://ghcr.io/token');
      tokenUrl.searchParams.set('service', registry); tokenUrl.searchParams.set('scope', 'repository:supabase/' + name + ':pull');
      const reply = JSON.parse((await request(tokenUrl, { Accept: 'application/json' })).toString('utf8'));
      assert.ok(typeof reply.token === 'string' && reply.token.length > 0 && reply.token.length <= 16_384, 'Anonymous registry token is missing.');
      tokens.set(key, reply.token);
    }
    return request(`https://${registry}/v2/supabase/${name}/manifests/${reference}`, { Accept: accept, Authorization: 'Bearer ' + tokens.get(key) });
  };
}

function loadedImage(image, proof) {
  assert.equal(image?.Id, proof.configDigest, 'Loaded image config identity differs.');
  assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64');
}
export async function cacheExactImages(values, { metadata, docker, hostCheck }) {
  const images = originalImages(values), proofs = [];
  await hostCheck();
  // Finish every original/mirror comparison before the first cache mutation.
  for (const image of images) {
    const originalIndex = await metadata('public.ecr.aws', image.name, image.tag);
    const mirrorIndex = await metadata('ghcr.io', image.name, image.tag);
    const originalChild = await metadata('public.ecr.aws', image.name, selectedChild(originalIndex).digest);
    const mirrorChild = await metadata('ghcr.io', image.name, selectedChild(mirrorIndex).digest);
    proofs.push(equalImageProof(image, originalIndex, originalChild, mirrorIndex, mirrorChild));
  }
  const inspect = async reference => {
    const rows = JSON.parse(await docker(['image', 'inspect', reference])); assert.equal(rows.length, 1); return rows[0];
  };
  const exists = async proof => {
    const text = await docker(['image', 'ls', '--no-trunc', '--format', '{{json .}}', '--filter', 'reference=' + proof.original]);
    const rows = text.trim() ? text.trim().split(/\r?\n/).map(line => JSON.parse(line)) : [];
    assert.ok(rows.length <= 1, 'An original image alias is ambiguous.');
    if (rows.length) {
      assert.equal(rows[0].Repository + ':' + rows[0].Tag, proof.original);
      loadedImage(await inspect(proof.original), proof);
    }
    return rows.length === 1;
  };
  const present = [];
  for (const proof of proofs) present.push(await exists(proof));
  for (let index = 0; index < proofs.length; index++) {
    const proof = proofs[index]; if (present[index]) { proof.cacheAction = 'existing-identical'; continue; }
    await hostCheck();
    const immutable = proof.mirror + '@' + proof.childDigest;
    await docker(['pull', '--platform', 'linux/amd64', immutable]);
    const image = await inspect(immutable); loadedImage(image, proof);
    assert.ok(image.RepoDigests?.includes(immutable), 'The engine did not attest the pulled immutable child.');
    await hostCheck();
    if (!await exists(proof)) await docker(['tag', image.Id, proof.original]);
    loadedImage(await inspect(proof.original), proof);
    proof.cacheAction = 'loaded-identical';
  }
  return proofs;
}

/** @param {Record<string, string | undefined>} env */
export function hostedCacheEnvironment(env = process.env, platform = process.platform) {
  assert.equal(platform, 'win32'); assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.RUNNER_OS, 'Windows'); assert.match(env.ImageOS || '', /^win25(?:-vs2026)?$/);
  assert.equal(env.POS_ACCEPTANCE_DISPOSABLE, '1'); assert.equal(env.POS_TEST_WSL_ENGINE, '1');
  assert.ok(env.RUNNER_TEMP && env.RUNNER_TRACKING_ID && env.POS_TEST_WSL_RECEIPT && env.GITHUB_JOB);
  assert.match(env.GITHUB_RUN_ID || '', /^[1-9][0-9]*$/); assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40}$/);
  assert.ok(!env.DOCKER_HOST && !env.DOCKER_CONTEXT, 'Docker environment redirects are refused.');
}
export async function ownedPath(file, temporary, existing) {
  assert.ok(path.isAbsolute(file) && !file.startsWith('\\\\'));
    const root = await lstat(temporary); assert.ok(root.isDirectory() && !root.isSymbolicLink(), 'The temporary root must not be redirected.');
  const relative = path.relative(temporary, file); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  let ancestor = existing ? file : path.dirname(file);
  while (ancestor.toLowerCase() !== temporary.toLowerCase()) {
    const info = await lstat(ancestor); assert.ok(!info.isSymbolicLink());
    if (ancestor === file) assert.ok(info.isFile());
    const parent = path.dirname(ancestor); assert.notEqual(parent, ancestor); ancestor = parent;
  }
  const canonicalRoot = await realpath(temporary), canonicalParent = await realpath(path.dirname(file));
  const canonicalRelative = path.relative(canonicalRoot, canonicalParent);
  assert.ok(!canonicalRelative.startsWith('..') && !path.isAbsolute(canonicalRelative), 'The canonical cache directory escaped the temporary root.');
}
async function main() {
  hostedCacheEnvironment(); assert.equal(process.version, 'v24.22.2');
  const [compose, receiptFile, ...extra] = process.argv.slice(2); assert.ok(compose && receiptFile && !extra.length);
  const temporary = path.resolve(process.env.RUNNER_TEMP);
  await ownedPath(compose, temporary, true); await ownedPath(receiptFile, temporary, false);
  await dockerCheck();
  const executable = realDockerExecutable();
  const docker = args => run(executable, args);
  const values = String(await docker(['compose', '-f', compose, 'config', '--images'])).trim().split(/\r?\n/);
  const images = await cacheExactImages(values, { metadata: registryReader(), docker, hostCheck: dockerCheck });
  await dockerCheck();
  const engine = JSON.parse(await readFile(process.env.POS_TEST_WSL_RECEIPT, 'utf8'));
  await writeFile(receiptFile, JSON.stringify({ protocol: 1, result: 'pass', runId: process.env.GITHUB_RUN_ID, job: process.env.GITHUB_JOB,
    sourceCommit: process.env.GITHUB_SHA, owner: engine.owner, daemonId: engine.daemonId, images }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Verified byte-identical official cache for all five original managed images.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
