import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostedDockerContext, localDocker, localSettings, project } from './safety.mjs';
import assert from 'node:assert/strict';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const work = path.join(root, '.staging-local');
const require = createRequire(import.meta.url);
const localDockerBin = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin');
// Existing terminals may predate the installer PATH update.
if (process.platform === 'win32' && localDockerBin && existsSync(path.join(localDockerBin, 'docker.exe'))) {
  process.env.PATH = `${localDockerBin}${path.delimiter}${process.env.PATH || ''}`;
}
const cliPackage = require('supabase/package.json');
const cli = path.join(path.dirname(require.resolve('supabase/package.json')), cliPackage.bin.supabase);
// Pre-create the primary network; Windows also needs explicit published IPs.
export const network = `supabase_network_${project}`;

export function realDockerExecutable() {
  const executable = process.env.POS_CAFE_REAL_DOCKER || (localDockerBin && path.join(localDockerBin, 'docker.exe'));
  assert.ok(executable && path.isAbsolute(executable) && existsSync(executable), 'A configured installed Docker CLI is required');
  return executable;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = outputCapture(), stderr = outputCapture();
    let settled = false, drain;
    const complete = (code, incomplete = false) => {
      if (settled) return;
      settled = true; clearTimeout(drain);
      if (incomplete) { child.stdout.destroy(); child.stderr.destroy(); }
      finishCapture(stdout); finishCapture(stderr);
      if (code === 0 && !incomplete) return resolve(stdout.tail);
      const details = [diagnosticCapture(stderr, 'stderr'), diagnosticCapture(stdout, 'stdout')].filter(Boolean).join('\n');
      reject(new Error(`${path.basename(command)} failed (${code}): ${details}${incomplete ? '\n[owned output drain exceeded 1000ms]' : ''}`));
    };
    child.stdout.on('data', data => appendCapture(stdout, data));
    child.stderr.on('data', data => appendCapture(stderr, data));
    child.once('error', error => { if (!settled) { settled = true; clearTimeout(drain); reject(error); } });
    // 'exit' can precede final pipe bytes, while an inherited writer can keep
    // 'close' pending indefinitely. Wait for close under a post-root deadline.
    child.once('exit', code => { drain = setTimeout(() => complete(code, true), 1000); });
    child.once('close', code => complete(code));
  });
}
function outputCapture() { return { tail: '', pending: '', critical: [], following: 0 }; }
function captureLine(capture, line) {
  if (/\b(?:error|fatal|panic|failed to|registry|daemon|rate exceeded|unexpected status|ERR_ASSERTION)\b/i.test(line) && capture.critical.length < 4) {
    capture.critical.push([redact(line).slice(0, 512)]); capture.following = 2;
  } else if (capture.following > 0) {
    capture.critical[capture.critical.length - 1].push(redact(line).slice(0, 512)); capture.following--;
  }
}
function appendCapture(capture, data) {
  const text = data.toString();
  capture.tail = (capture.tail + text).slice(-2_000_000);
  const lines = (capture.pending + text).split(/\r?\n/);
  capture.pending = lines.pop() || '';
  for (const line of lines) captureLine(capture, line);
  while (capture.pending.length > 16_384) {
    captureLine(capture, capture.pending.slice(0, 16_384)); capture.pending = capture.pending.slice(16_384);
  }
}
function finishCapture(capture) { if (capture.pending) captureLine(capture, capture.pending); capture.pending = ''; }
function diagnosticCapture(capture, name) {
  if (!capture.tail && !capture.critical.length) return '';
  // Keep early critical lines before the bounded tail evicts them. Redact each
  // retained window and the tail BEFORE truncating their projected text.
  return `[${name}]\n${capture.critical.map(window => window.join('\n')).join('\n')}\n${redact(capture.tail).slice(-2500)}`;
}
function redact(value) {
  return value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]');
}
export async function prepare(allowStoppedConfigDrift = false) {
  await mkdir(path.join(work, 'supabase'), { recursive: true });
  const target = path.join(work, 'supabase/config.toml');
  const source = await readFile(path.join(root, 'supabase/staging/config.toml'), 'utf8');
  if (existsSync(path.join(work, 'supabase/.temp/project-ref'))) throw new Error('Refusing a linked project directory');
  if (existsSync(target) && await readFile(target, 'utf8') !== source) {
    const previous = await readFile(target, 'utf8');
    if (allowStoppedConfigDrift && /^project_id = "pos-cafe-staging-local"$/m.test(previous)) return;
    throw new Error('Local config changed; run staging:stop, then copy the reviewed staging config into .staging-local/supabase/config.toml');
  }
  await writeFile(target, source);
}
export async function cliRun(args) {
  let env = { ...process.env };
  if (process.platform === 'win32') {
    const real = realDockerExecutable();
    const bin = path.join(work, 'docker-bin'); await mkdir(bin, { recursive: true });
    const launcher = path.join(bin, 'docker.exe');
    const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const source = path.join(root, 'scripts/staging/docker-loopback.cs');
    const sourceHash = (await import('node:crypto')).createHash('sha256').update(await readFile(source)).digest('hex');
    const stamp = path.join(bin, 'source.sha256');
    if (!existsSync(launcher) || !existsSync(stamp) || await readFile(stamp, 'utf8') !== sourceHash) {
      await run(compiler, ['/nologo', '/target:exe', `/out:${launcher}`, source]);
      await writeFile(stamp, sourceHash);
    }
    await run(launcher, ['--pos-cafe-self-test']);
    env = { ...env, POS_CAFE_REAL_DOCKER: real, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  }
  return run(process.execPath, [cli, ...args, '--workdir', work], { env });
}
export async function dockerCheck() {
  // Explicitly avoid environment redirects to another Docker host/context.
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error('Unset DOCKER_HOST/DOCKER_CONTEXT before local staging');
  const context = JSON.parse(await run('docker', ['context', 'inspect']));
  assert.equal(context.length, 1, 'One explicit Docker context is required.');
  if (context[0].Endpoints.docker.Host.startsWith('tcp://')) {
    const temporary = path.resolve(process.env.RUNNER_TEMP || '');
    const file = process.env.POS_TEST_WSL_RECEIPT;
    assert.ok(file && path.isAbsolute(file) && path.basename(file) === 'engine.json');
    const relative = path.relative(temporary, file);
    assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
    let ancestor = path.resolve(file);
    for (;;) {
      const stat = await lstat(ancestor); assert.equal(stat.isSymbolicLink(), false, 'Redirected hosted Docker receipt refused.');
      if (ancestor === path.resolve(file)) assert.ok(stat.isFile() && stat.size <= 65536);
      if (ancestor.toLowerCase() === temporary.toLowerCase()) break;
      const parent = path.dirname(ancestor); assert.notEqual(parent, ancestor); ancestor = parent;
    }
    const engine = JSON.parse(await run('docker', ['info', '--format', '{{json .}}']));
    hostedDockerContext(context[0], engine, JSON.parse(await readFile(file, 'utf8')));
  } else localDocker(context[0].Endpoints.docker.Host);
  if ((await run('docker', ['info', '--format', '{{.OSType}}'])).trim() !== 'linux') throw new Error('Docker Linux containers must be running');
}
export async function ensureLoopbackNetwork({ name, label, owner }, execute = run) {
  const names = (await execute('docker', ['network', 'ls', '--format', '{{.Name}}'])).trim().split(/\r?\n/);
  // Docker allocates a free subnet atomically. Random fixed CIDRs can collide
  // with another disposable stack or a runner's pre-existing networks.
  if (!names.includes(name)) await execute('docker', ['network', 'create', '--driver', 'bridge', '--label', `${label}=${owner}`,
    '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', name]);
  const [info] = JSON.parse(await execute('docker', ['network', 'inspect', name]));
  if (info.Labels?.[label] !== owner || info.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1') throw new Error('Dedicated Docker network identity/binding mismatch');
  return info;
}
export async function ensureNetwork() {
  await ensureLoopbackNetwork({ name: network, label: 'pos-cafe.staging', owner: project });
}
export async function settings() {
  await prepare();
  await dockerCheck();
  const value = localSettings(JSON.parse(await cliRun(['status', '-o', 'json'])));
  // Docker must actually publish each stack port only on loopback.
  const ids = (await run('docker', ['ps', '--filter', `name=_${project}$`, '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  assert.ok(ids.length, 'Dedicated stack containers are missing');
  const containers = JSON.parse(await run('docker', ['inspect', ...ids]));
  const published = new Set();
  for (const container of containers) {
    assert.ok(container.Name.endsWith(`_${project}`) && container.NetworkSettings.Networks[network], 'Container/network identity mismatch');
    for (const bindings of Object.values(container.NetworkSettings.Ports || {})) for (const binding of bindings || []) {
      assert.ok(['127.0.0.1', '::1'].includes(binding.HostIp), `Staging binding rejected: ${container.Name} ${binding.HostIp}:${binding.HostPort}`);
      published.add(binding.HostPort);
    }
  }
  assert.ok(published.has('55451') && published.has('55452'), 'Dedicated API and database ports must be present');
  return value;
}
