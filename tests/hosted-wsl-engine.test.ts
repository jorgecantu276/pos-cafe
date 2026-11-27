import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyHostedWslEngine } from '../scripts/testing/hosted-wsl-engine.mjs';

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'hosted-engine-'));
  const temporary = path.join(base, 'runner'), owned = path.join(temporary, 'owned'); await mkdir(owned, { recursive: true });
  const docker = path.join(temporary, 'docker.exe'); await writeFile(docker, 'Synthetic fixture file; never executed.');
  const receiptFile = path.join(owned, 'engine.json');
  const now = new Date('2026-11-26T12:00:00Z'), owner = 'a'.repeat(32), hash = 'b'.repeat(64);
  const receipt = { version: 1, owner, distribution: 'Ubuntu-24.04', kernel: '6.6.87.2-microsoft-standard-WSL2', daemonId: 'private-fixture-daemon-id',
    docker, transport: 'tcp://127.0.0.1:2375', windowsHostUnchanged: true, completedAt: now.toISOString(), privatePath: 'PRIVATE-PATH-CANARY', proxyPid: 1234,
    parity: { composeBindSha256: hash, rawBindSha256: hash, binaryCopySha256: hash, loopbackPorts: [58000, 55432, 55541, 55542, 55543, 55544] } };
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', ImageOS: 'win25', GITHUB_RUN_ID: '123456', RUNNER_TRACKING_ID: 'hosted-fixture',
    POS_ACCEPTANCE_DISPOSABLE: '1', POS_TEST_WSL_ENGINE: '1', DOCKER_HOST: 'tcp://127.0.0.1:2375', RUNNER_TEMP: temporary, POS_TEST_WSL_RECEIPT: receiptFile, POS_CAFE_REAL_DOCKER: docker };
  const actual = { OSType: 'linux', ID: receipt.daemonId, KernelVersion: receipt.kernel, Labels: [`mx.pos-hosted-rehearsal=${owner}`], DockerRootDir: 'PRIVATE-PATH-CANARY' };
  let calls = 0;
  const inspectActual = async (executable: string, selected: typeof env) => {
    calls++; assert.equal(executable, docker); assert.equal(selected.DOCKER_HOST, env.DOCKER_HOST);
    return structuredClone(actual);
  };
  await writeFile(receiptFile, JSON.stringify(receipt));
  return { base, temporary, receiptFile, docker, receipt, env, actual, now, inspectActual,
    get calls() { return calls; }, write: (value: unknown) => writeFile(receiptFile, JSON.stringify(value)),
    clean: () => rm(base, { recursive: true, force: true }) };
}

test('hosted exception verifies the actual owned Linux daemon and returns only sanitized parity metadata', async () => {
  const f = await fixture();
  try {
    const proof = await verifyHostedWslEngine({ env: f.env, platform: 'win32', inspectActual: f.inspectActual, now: f.now });
    assert.equal(f.calls, 1); assert.equal(proof.state, 'verified'); assert.equal(proof.windowsHostUnchanged, true);
    assert.equal(proof.transport, 'tcp://127.0.0.1:2375'); assert.equal(proof.kernel, f.receipt.kernel);
    assert.deepEqual(proof.parity.windowsLoopbackPorts, f.receipt.parity.loopbackPorts);
    for (const privateValue of [f.base, f.receipt.owner, f.receipt.daemonId, 'PRIVATE-PATH-CANARY', 'proxyPid']) assert.ok(!JSON.stringify(proof).includes(privateValue));
    await verifyHostedWslEngine({ env: { ...f.env, ImageOS: 'win25-vs2026' }, platform: 'win32', inspectActual: f.inspectActual, now: f.now });
  } finally { await f.clean(); }
});

test('ordinary, self-hosted, un-enrolled and redirected Docker environments refuse before any engine inspection', async () => {
  const f = await fixture();
  try {
    for (const override of [
      { GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_OS: 'Linux' }, { ImageOS: 'win22' },
      { GITHUB_RUN_ID: '' }, { RUNNER_TRACKING_ID: '' }, { POS_ACCEPTANCE_DISPOSABLE: '0' }, { POS_TEST_WSL_ENGINE: '0' },
      { DOCKER_HOST: 'tcp://192.168.1.5:2375' }, { DOCKER_HOST: 'tcp://localhost:2375' }, { DOCKER_HOST: 'npipe:////./pipe/docker_engine' }, { DOCKER_CONTEXT: 'default' },
    ]) await assert.rejects(verifyHostedWslEngine({ env: { ...f.env, ...override }, platform: 'win32', inspectActual: f.inspectActual, now: f.now }));
    await assert.rejects(verifyHostedWslEngine({ env: f.env, platform: 'linux', inspectActual: f.inspectActual, now: f.now }));
    assert.equal(f.calls, 0);
  } finally { await f.clean(); }
});

test('receipt freshness, identity, unchanged-host and complete parity are required before the actual-engine comparison', async () => {
  const f = await fixture();
  try {
    for (const override of [
      { completedAt: '2026-11-26T10:59:59Z' }, { completedAt: '2026-11-26T12:05:01Z' }, { owner: 'invalid' }, { windowsHostUnchanged: false },
      { transport: 'npipe:////./pipe/docker_engine' }, { distribution: 'Other-Linux' }, { kernel: 'PRIVATE-PATH-CANARY' },
      { parity: { ...f.receipt.parity, binaryCopySha256: 'c'.repeat(64) } }, { parity: { ...f.receipt.parity, loopbackPorts: [58000, 55432] } },
      { parity: { ...f.receipt.parity, loopbackPorts: [58000, 55432, 55541, 55542, 55543, 55543] } },
    ]) {
      await f.write({ ...f.receipt, ...override });
      await assert.rejects(verifyHostedWslEngine({ env: f.env, platform: 'win32', inspectActual: f.inspectActual, now: f.now }));
    }
    assert.equal(f.calls, 0);
  } finally { await f.clean(); }
});

test('a valid-looking receipt cannot authorize a different actual daemon, kernel, engine type or owner label', async () => {
  const f = await fixture();
  try {
    for (const override of [{ ID: 'another-daemon' }, { OSType: 'windows' }, { KernelVersion: 'different-kernel' }, { Labels: [] }]) {
      await assert.rejects(verifyHostedWslEngine({ env: f.env, platform: 'win32', now: f.now, inspectActual: async () => ({ ...f.actual, ...override }) }), /actual Docker daemon/);
    }
    const other = path.join(f.temporary, 'another.exe'); await writeFile(other, 'Never executed.');
    await f.write({ ...f.receipt, docker: other });
    await assert.rejects(verifyHostedWslEngine({ env: f.env, platform: 'win32', inspectActual: f.inspectActual, now: f.now }), /Docker executable differs/);
    assert.equal(f.calls, 0);
  } finally { await f.clean(); }
});

test('receipt files stay bounded and inside the owned temporary tree without parent-junction aliases', async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.base, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'engine.json'), JSON.stringify(f.receipt));
    await assert.rejects(verifyHostedWslEngine({ env: { ...f.env, POS_TEST_WSL_RECEIPT: path.join(outside, 'engine.json') }, platform: 'win32', inspectActual: f.inspectActual, now: f.now }), /beneath RUNNER_TEMP/);
    const alias = path.join(f.temporary, 'alias'); await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(verifyHostedWslEngine({ env: { ...f.env, POS_TEST_WSL_RECEIPT: path.join(alias, 'engine.json') }, platform: 'win32', inspectActual: f.inspectActual, now: f.now }), /redirected directories/);
    await writeFile(f.receiptFile, 'x'.repeat(65_537));
    await assert.rejects(verifyHostedWslEngine({ env: f.env, platform: 'win32', inspectActual: f.inspectActual, now: f.now }), /bounded regular/);
    assert.equal(f.calls, 0);
  } finally { await f.clean(); }
});
