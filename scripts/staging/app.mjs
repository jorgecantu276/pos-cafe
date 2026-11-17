import { cp, mkdir, mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'node:net';
import { root, work, run } from './runtime.mjs';

export async function startApp(config, { port = 3101, recoveryProbe = null, cashierFixture = null, printing = null, smoothies = false, backups = null } = {}) {
  if (smoothies ? port !== 3180 : ![3101, 3111, 3112].includes(port)) throw new Error('Only dedicated local preview/recovery ports are allowed');
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is occupied; stop that local preview before testing`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  await mkdir(work, { recursive: true });
  const app = await mkdtemp(path.join(work, 'app-'));
  const excluded = new Set(['.git', '.next', '.staging-local', '.print-data', 'node_modules', 'next-env.d.ts', 'tsconfig.tsbuildinfo']);
  for (const entry of await readdir(root)) {
    if (excluded.has(entry) || entry.startsWith('.env') || entry.startsWith('.build-check-')) continue;
    await cp(path.join(root, entry), path.join(app, entry), { recursive: true });
  }
  await symlink(path.join(root, 'node_modules'), path.join(app, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  if (cashierFixture) {
    // Browser-assisted acceptance page exists only in this disposable build.
    await mkdir(path.join(app, 'app/cashier-check'), { recursive: true });
    await writeFile(path.join(app, 'app/cashier-check/page.tsx'), cashierFixture);
  }
  if (recoveryProbe) {
    // Test-only authenticated route in the scratch copy, never in the owner's UI.
    await mkdir(path.join(app, 'recovery-probe'), { recursive: true });
    await mkdir(path.join(app, 'app/recovery-probe'), { recursive: true });
    await writeFile(path.join(app, 'app/recovery-probe/route.ts'), `import { existsSync } from 'node:fs';
export const dynamic = 'force-dynamic';
export function GET() { return Response.json({release:${JSON.stringify(recoveryProbe)}}, {status:existsSync('recovery-fault.flag')?503:200}); }`);
  }
  const require = createRequire(import.meta.url);
  const next = require.resolve('next/dist/bin/next');
  const env = { ...process.env, NEXT_PUBLIC_POS_PROFILE: (smoothies ? 'smoothies' : 'cafe'), NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: config.api,
    POS_CLIP_ENABLED: '0', POS_CLIP_TOKEN: '', POS_CLIP_SERIAL: '', POS_CLIP_WEBHOOK_URL: '',
    POS_PRINT_MODE: printing ? 'mock' : 'disabled', POS_PRINT_DATA_DIR: printing?.directory || '', POS_PRINT_MOCK_FAULTS: printing?.faults || '',
    POS_RECEIPT_ISSUER_FILE: printing?.issuer || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anon, SUPABASE_SERVICE_ROLE_KEY: config.service };
  const launcher = path.join(app, 'scripts/smoothies/start-local.mjs');
  if (smoothies) Object.assign(env, { SMOOTHIES_API_URL: config.api, SMOOTHIES_ANON_KEY: config.anon,
    SMOOTHIES_SERVICE_KEY: config.service, SMOOTHIES_PRINT_DIR: path.join(app, '.print-data'),
    SMOOTHIES_BACKUP_DIR: backups?.directory || '', SMOOTHIES_BACKUP_KEY_FILE: backups?.keyFile || '' });
  console.log('Building an isolated production app against local Supabase…');
  await run(process.execPath, smoothies ? [launcher, 'build'] : [next, 'build', '--webpack'], { cwd: app, env });
  let child;
  let logs = '';
  const collect = data => { logs = (logs + data).slice(-20_000); };
  function launch() {
    child = spawn(process.execPath, smoothies ? [launcher, 'start'] : [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', collect);
  }
  launch();
  await writeFile(path.join(app, 'local-only.txt'), 'Synthetic local staging. No café environment files were copied.\n');
  return {
    get child() { return child; }, app,
    async restart() {
      await this.stop();
      launch(); // Reuse the exact production artifact and local environment.
      await this.ready();
    },
    async ready() {
      for (let attempt = 0; attempt < 180; attempt++) {
        if (child.exitCode !== null) throw new Error(`Staging app failed: ${logs}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(2000) });
          if (response.status === 200) return;
        } catch { /* Local compilation/startup is still pending. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`Local app startup timed out: ${logs}`);
    },
    async stop() {
      if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') {
          await new Promise(resolve => { const stop = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); stop.on('exit', resolve); stop.on('error', resolve); });
        } else child.kill('SIGTERM');
      }
    },
  };
}
