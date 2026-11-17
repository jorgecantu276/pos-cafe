import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test('real Smoothies PowerShell launcher preserves redirected supervisor success and reports genuine nonzero exits',
  { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'smoothies-launch-exit-'));
    const powershell = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    try {
      for (const expected of [0, 7]) {
        const home = path.join(root, `exit-${expected}`);
        const id = 'e'.repeat(16);
        const app = path.join(home, 'versiones', id, 'app');
        await mkdir(path.join(app, 'scripts/smoothies'), { recursive: true });
        const node = path.join(home, 'versiones', id, 'node.exe');
        try { await link(process.execPath, node); } catch { await copyFile(process.execPath, node); }
        const port = await availablePort();
        const launcher = (await readFile('scripts/smoothies/Launch-Smoothies.ps1', 'utf8'))
          .replaceAll('http://127.0.0.1:3180', `http://127.0.0.1:${port}`);
        await writeFile(path.join(home, 'Launch-Smoothies.ps1'), launcher);
        await writeFile(path.join(home, 'instalacion.env'), '');
        await writeFile(path.join(home, 'caja.env'), '');
        await writeFile(path.join(home, 'release.json'), JSON.stringify({ version: 1, id }));
        await writeFile(path.join(app, 'scripts/smoothies/auto-update.mjs'), `
          import { createServer } from 'node:http';
          import { existsSync, writeFileSync } from 'node:fs';
          import path from 'node:path';
          const root=process.argv[2];
          const server=createServer((request,response)=>{
            response.setHeader('Content-Type','application/json');
            response.end(JSON.stringify({protocol:1,packageId:process.env.SMOOTHIES_PACKAGE_ID}));
            if((request.headers['user-agent']||'').includes('WindowsPowerShell'))
              writeFileSync(path.join(root,'ready-observed'),'yes');
          });
          server.listen(${port},'127.0.0.1');
          const timer=setInterval(()=>{
            if(!existsSync(path.join(root,'finish')))return;
            clearInterval(timer);server.close(()=>process.exit(${expected}));
          },25);
        `);
        const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', path.join(home, 'Launch-Smoothies.ps1'), '-Background'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', bytes => { output += bytes; });
        child.stderr.on('data', bytes => { output += bytes; });
        const finished = new Promise<number | null>((resolve, reject) => {
          child.once('error', reject); child.once('exit', code => resolve(code));
        });
        try {
          const deadline = Date.now() + 15_000;
          let observed = false;
          while (Date.now() < deadline && child.exitCode === null) {
            observed = await readFile(path.join(home, 'ready-observed'), 'utf8').then(() => true).catch(() => false);
            if (observed) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          assert.ok(observed, `The actual launcher did not observe its synthetic supervisor: ${output}`);
          await new Promise(resolve => setTimeout(resolve, 150));
          await writeFile(path.join(home, 'finish'), 'stop the owned fixture');
          const code = await Promise.race([finished, new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Launcher did not finish.')), 10_000);
            timer.unref();
          })]);
          assert.equal(code, expected === 0 ? 0 : 1, `Supervisor exit ${expected}: ${output}`);
          const log = await readFile(path.join(home, 'diagnostico/inicio.log'), 'utf8').catch(() => '');
          if (expected === 0) assert.doesNotMatch(log, /El servidor se detuvo/);
          else assert.match(log, /El servidor se detuvo/);
        } finally {
          if (child.exitCode === null && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
