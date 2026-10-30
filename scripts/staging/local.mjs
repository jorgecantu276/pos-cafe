import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootstrap, verifyIdentity } from './bootstrap.mjs';
import { work, prepare, cliRun, dockerCheck, ensureNetwork, settings } from './runtime.mjs';
import { Client } from 'pg';
import { startApp } from './app.mjs';

const action = process.argv[2];
if (!['prepare', 'start', 'stop', 'app', 'test'].includes(action)) throw new Error('Use prepare, start, stop, app or test');
await prepare(action === 'stop');
if (action === 'prepare') { console.log('Dedicated local configuration prepared. No hosted project linked.'); }
else if (action === 'stop') {
  await dockerCheck();
  await cliRun(['stop']); // no --no-backup, no reset, no remote commands
  console.log('Dedicated local containers stopped; synthetic volumes retained.');
} else {
  if (action === 'start') {
    await dockerCheck(); await ensureNetwork();
    console.log('Starting isolated Supabase Auth/PostgREST/PostgreSQL. Initial image downloads can take several minutes.');
    const ticker = setInterval(() => console.log('Local Supabase startup is still running…'), 20_000);
    try { await cliRun(['start', '--exclude', 'realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor']); }
    finally { clearInterval(ticker); }
    let config;
    try { config = await settings(); }
    catch (error) {
      // A failed binding/identity check must not leave an exposed test stack.
      await cliRun(['stop']).catch(() => {});
      throw error;
    }
    await bootstrap(config);
    console.log('Local staging ready. Studio: http://127.0.0.1:55453 · app: npm run staging:app');
  } else {
    const config = await settings();
    const db = new Client({ connectionString: config.database });
    await db.connect();
    try { await verifyIdentity(db); } finally { await db.end(); }
    if (action === 'test') {
      const { stagingTests } = await import('./suite.mjs');
      await stagingTests(config);
    } else {
      // Clone source into scratch WITHOUT .env files, builds, Git or modules.
      // Explicit environment takes precedence over Next env loading; never read
      // the café .env.local and never rewrite the normal development preview.
      const { admin } = JSON.parse(await readFile(path.join(work, 'credentials.json'), 'utf8'));
      await writeFile(path.join(work, 'app-access.txt'), `LOCAL SYNTHETIC STAGING ONLY\nhttp://127.0.0.1:3101\nUsername: ${admin.username}\nPassword: ${admin.password}\n`, { mode: 0o600 });
      console.log('Starting owner UI against LOCAL staging only, port 3101. Local credentials are in .staging-local/app-access.txt (ignored).');
      const app = await startApp(config);
      await app.ready();
      console.log('Staging UI ready: http://127.0.0.1:3101');
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.stop(); });
    }
  }
}
