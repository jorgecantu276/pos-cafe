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
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-2_000_000); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2_000_000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(command)} failed (${code}): ${redact(stderr || stdout)}`)));
  });
}
function redact(value) {
  return value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]').slice(-5000);
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
