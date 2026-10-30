import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { startApp } from '../staging/app.mjs';
import { allowAppRollback, sha256 } from './artifacts.mjs';

async function artifactHash(directory) {
  const hashes = [];
  async function visit(relative) {
    const full = path.join(directory, relative);
    for (const entry of (await readdir(full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile()) hashes.push([next.replaceAll('\\', '/'), sha256(await readFile(path.join(directory, next)))]);
    }
  }
  for (const relative of ['.next/server', '.next/static']) await visit(relative);
  hashes.push(['BUILD_ID', await readFile(path.join(directory, '.next/BUILD_ID'), 'utf8')]);
  return sha256(JSON.stringify(hashes));
}

export async function deploymentDrill(config, contract, cookie, directory, transact) {
  const apps = [], events = [];
  let active, previous, gateway;
  async function release(id, port) {
    const process = await startApp(config, { port, recoveryProbe: id }); apps.push(process); await process.ready();
    return { id, port, app: process.app, process, contract, buildId: (await readFile(path.join(process.app, '.next/BUILD_ID'), 'utf8')).trim(), artifactHash: await artifactHash(process.app) };
  }
  async function health(candidate) {
    allowAppRollback(candidate, contract);
    assert.equal(await artifactHash(candidate.app), candidate.artifactHash, 'Retained artifact integrity changed');
    const response = await fetch(`http://127.0.0.1:${candidate.port}/recovery-probe`, { redirect: 'manual', headers: { cookie }, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, 'Candidate readiness failed'); assert.equal((await response.json()).release, candidate.id);
    const auth = await fetch(`http://127.0.0.1:${candidate.port}/admin`, { redirect: 'manual', headers: { cookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(auth.status, 200, 'Candidate cannot verify real restored Auth/admin access');
  }
  async function promote(candidate, reason) {
    await health(candidate);
    const state = { active: candidate.id, previous: active?.id ?? null, contract, buildId: candidate.buildId, artifactHash: candidate.artifactHash };
    const temp = path.join(directory, 'active.json.tmp'); await writeFile(temp, JSON.stringify(state, null, 2));
    await rename(temp, path.join(directory, 'active.json'));
    previous = active; active = candidate;
    events.push({ event: reason, active: active.id, previous: previous?.id ?? null });
  }
  async function request(request, response) {
    try {
      const body = []; for await (const chunk of request) body.push(chunk);
      const headers = { ...request.headers }; delete headers.host; delete headers.connection;
      const result = await fetch(`http://127.0.0.1:${active.port}${request.url}`, { method: request.method, headers, redirect: 'manual',
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(body), signal: AbortSignal.timeout(8000) });
      response.writeHead(result.status, Object.fromEntries([...result.headers].filter(([key]) => !['transfer-encoding', 'content-encoding', 'content-length'].includes(key))));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(503); response.end('Local release unavailable'); }
  }
  try {
    const r1 = await release('retained-compatible', 3111);
    const r2 = await release('candidate-compatible', 3112);
    assert.notEqual(r1.buildId, r2.buildId, 'Retain two independent production builds');
    await promote(r1, 'initial activation');
    gateway = createServer((req, res) => { void request(req, res); });
    await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(3110, '127.0.0.1', resolve); });
    const probe = async () => {
      const response = await fetch('http://127.0.0.1:3110/recovery-probe', { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); return (await response.json()).release;
    };
    assert.equal(await probe(), r1.id);
    const journal = await readFile(path.join(directory, 'active.json'), 'utf8');
    await writeFile(path.join(r2.app, 'recovery-fault.flag'), 'Injected readiness failure in scratch only.');
    await assert.rejects(promote(r2, 'must never activate'));
    assert.equal(await probe(), r1.id); assert.equal(await readFile(path.join(directory, 'active.json'), 'utf8'), journal);
    events.push({ event: 'failed readiness rejected before activation', active: r1.id });
    await unlink(path.join(r2.app, 'recovery-fault.flag'));
    await assert.rejects(promote({ ...r1, contract: 'unsafe-legacy-contract' }, 'must never activate'));
    events.push({ event: 'legacy/incompatible app rollback rejected', active: r1.id });
    await promote(r2, 'healthy candidate activation'); assert.equal(await probe(), r2.id);
    const receipt = await transact();
    await r2.process.stop(); // Simulated bad deployment/process crash after sale.
    await assert.rejects(health(r2));
    assert.equal(previous.id, r1.id);
    await promote(previous, 'rollback after candidate process failure');
    assert.equal(await probe(), r1.id);
    const replayed = await transact(true); assert.equal(replayed.id, receipt.id);
    assert.deepEqual(replayed, receipt, 'Rollback must preserve the exact confirmed receipt');
    events.push({ event: 'post-backup sale and idempotent receipt preserved after app rollback', orderId: receipt.id });
    return { events, builds: [r1, r2].map(({ id, buildId, artifactHash }) => ({ id, buildId, artifactHash })), restoredReceipt: receipt.id };
  } finally {
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    for (const app of apps.reverse()) await app.stop();
  }
}
