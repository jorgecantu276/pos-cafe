import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const endpoint = 'tcp://127.0.0.1:2375';
const ports = [58000, 55432, 55541, 55542, 55543, 55544];
const contained = (parent, child) => { const relative = path.relative(parent, child); return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const localAbsolute = value => typeof value === 'string' && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value);
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

async function inspectDocker(docker, env) {
  try {
    const result = await execute(docker, ['info', '--format', '{{json .}}'], {
      env, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  } catch { throw Error('The attested hosted WSL Docker engine is unavailable.'); }
}

/**
 * The sole exception to ordinary local-Docker guards is this owned hosted VM.
 * @param {{env?: Record<string, string | undefined>, platform?: string, inspectActual?: typeof inspectDocker, now?: Date}} [options]
 */
export async function verifyHostedWslEngine({ env = process.env, platform = process.platform,
  inspectActual = inspectDocker, now = new Date() } = {}) {
  assert.ok(platform === 'win32' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
    && env.RUNNER_OS === 'Windows' && /^win25(?:-vs2026)?$/.test(env.ImageOS || '')
    && env.POS_ACCEPTANCE_DISPOSABLE === '1' && env.POS_TEST_WSL_ENGINE === '1'
    && typeof env.GITHUB_RUN_ID === 'string' && env.GITHUB_RUN_ID.length > 0
    && typeof env.RUNNER_TRACKING_ID === 'string' && env.RUNNER_TRACKING_ID.length > 0,
  'A fresh explicitly enrolled GitHub-hosted Windows 2025 job is required.');
  assert.ok(env.DOCKER_HOST === endpoint && !env.DOCKER_CONTEXT,
    'Use only the exact owned Windows-loopback Docker TCP endpoint without a context override.');
  assert.ok(now instanceof Date && Number.isFinite(now.getTime()), 'The hosted verification clock is invalid.');
  const temporary = env.RUNNER_TEMP, receiptFile = env.POS_TEST_WSL_RECEIPT, docker = env.POS_CAFE_REAL_DOCKER;
  assert.ok(localAbsolute(temporary) && localAbsolute(receiptFile) && localAbsolute(docker),
    'The hosted temporary root, receipt and official Docker executable must be absolute local paths.');
  const root = path.resolve(temporary), file = path.resolve(receiptFile);
  assert.ok(contained(root, file) && path.basename(file) === 'engine.json', 'Use the owned engine receipt beneath RUNNER_TEMP.');
  const temporaryInfo = await lstat(root);
  assert.ok(temporaryInfo.isDirectory() && !temporaryInfo.isSymbolicLink(), 'The runner temporary root cannot be redirected.');
  for (let parent = path.dirname(file); parent !== root; parent = path.dirname(parent)) {
    assert.ok(contained(root, parent), 'The receipt escaped its owned temporary root.');
    const info = await lstat(parent);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'The receipt cannot traverse redirected directories.');
  }
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 65_536, 'Use a bounded regular engine receipt.');
  assert.ok(contained(await realpath(root), await realpath(file)), 'The real engine receipt must remain beneath RUNNER_TEMP.');
  const bytes = await readFile(file);
  assert.ok(bytes.length <= 65_536, 'The engine receipt exceeds its size limit.');
  let receipt;
  try { receipt = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('The owned engine receipt is not valid JSON.'); }
  assert.ok(receipt.version === 1 && /^[a-f0-9]{32}$/.test(receipt.owner)
    && typeof receipt.daemonId === 'string' && receipt.daemonId.length > 0 && receipt.daemonId.length <= 128
    && receipt.distribution === 'Ubuntu-24.04' && receipt.transport === endpoint && receipt.windowsHostUnchanged === true,
  'The receipt must identify the owned WSL engine while preserving the Windows host.');
  assert.ok(typeof receipt.kernel === 'string' && /^[A-Za-z0-9._+()-]{1,128}$/.test(receipt.kernel)
    && receipt.kernel.includes('microsoft-standard-WSL2'), 'A genuine WSL2 kernel identity is required.');
  const completed = Date.parse(receipt.completedAt);
  assert.ok(Number.isFinite(completed) && completed >= now.getTime() - 3_600_000 && completed <= now.getTime() + 300_000,
    'The owned WSL receipt must be fresh for this job.');
  const parity = receipt.parity;
  assert.ok(parity && /^[a-f0-9]{64}$/.test(parity.composeBindSha256)
    && parity.composeBindSha256 === parity.rawBindSha256 && parity.composeBindSha256 === parity.binaryCopySha256,
  'Compose, raw-CLI bind and binary-copy parity must all be verified.');
  assert.ok(Array.isArray(parity.loopbackPorts) && parity.loopbackPorts.length === ports.length
    && ports.every(port => parity.loopbackPorts.includes(port)), 'All required Windows-loopback ports need genuine container parity.');
  assert.ok(localAbsolute(receipt.docker) && path.basename(docker).toLowerCase() === 'docker.exe', 'Use the official absolute Windows Docker executable.');
  const dockerInfo = await lstat(docker);
  assert.ok(dockerInfo.isFile() && !dockerInfo.isSymbolicLink(), 'The Docker executable cannot be redirected.');
  assert.ok(samePath(await realpath(docker), await realpath(receipt.docker)), 'The receipt Docker executable differs from the selected real CLI.');
  const actual = await inspectActual(docker, env);
  assert.ok(actual?.OSType === 'linux' && actual.ID === receipt.daemonId && actual.KernelVersion === receipt.kernel
    && Array.isArray(actual.Labels) && actual.Labels.includes(`mx.pos-hosted-rehearsal=${receipt.owner}`),
  'The actual Docker daemon does not match its owned WSL receipt.');
  return { state: 'verified', host: 'github-hosted-windows-2025', image: env.ImageOS,
    engine: 'linux', distribution: 'Ubuntu-24.04', kernel: receipt.kernel, transport: endpoint, windowsHostUnchanged: true,
    parity: { composeBind: 'verified', rawCliBind: 'verified', binaryCopy: 'verified', windowsLoopbackPorts: [...ports] } };
}

async function main() {
  try { assert.equal(process.argv.length, 2); console.log(JSON.stringify(await verifyHostedWslEngine())); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Hosted WSL engine verification failed.'); process.exitCode = 1; }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
