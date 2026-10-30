import EmbeddedPostgres from 'embedded-postgres';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const execute = promisify(execFile);

// Windows hosted runners are elevated. pg_ctl starts the postmaster with the
// restricted token PostgreSQL requires; direct postgres.exe spawning cannot.
// All paths belong to the caller's newly-created disposable test directory.
export function createTestPostgres(options) {
  if (process.platform !== 'win32') return new EmbeddedPostgres({ ...options,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'] });
  const directory = options.databaseDir;
  const log = path.join(path.dirname(directory), 'postgres-startup.log');
  let startAttempted = false;
  async function run(binary, args, background = false) {
    try {
      if (background) {
        // A daemonized postmaster must not inherit Node's captured pipes.
        await new Promise((resolve, reject) => {
          const child = spawn(binary, args, { windowsHide: true, stdio: 'ignore',
            timeout: 45_000, env: { ...process.env, LC_MESSAGES: 'C' } });
          child.once('error', reject);
          child.once('exit', (code, signal) => code === 0 ? resolve()
            : reject(Object.assign(new Error(`Launcher exited with ${code ?? signal}`), { code })));
        });
        return;
      }
      return await execute(binary, args, { windowsHide: true, timeout: 45_000,
        maxBuffer: 128 * 1024, env: { ...process.env, LC_MESSAGES: 'C' } });
    } catch (failure) {
      const detail = `${failure.message}\n${failure.stdout || ''}\n${failure.stderr || ''}`.replaceAll(options.password, '[test password]').slice(-8000);
      throw new Error(`${path.basename(binary)} failed (code ${failure.code ?? 'unknown'}): ${detail}`, { cause: failure });
    }
  }
  return {
    async initialise() {
      const { initdb } = await import('@embedded-postgres/windows-x64');
      const passwordFile = path.join(path.dirname(directory), 'initdb-password');
      await writeFile(passwordFile, options.password + '\n', { flag: 'wx', mode: 0o600 });
      try {
        await run(initdb, ['-D', directory, '--username=postgres', '--auth=scram-sha-256',
          `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C', '--lc-messages=C']);
      } finally { await unlink(passwordFile); }
    },
    async start() {
      const { pg_ctl } = await import('@embedded-postgres/windows-x64');
      startAttempted = true;
      try {
        await run(pg_ctl, ['-D', directory, '-l', log, '-o', `-p ${options.port} -h 127.0.0.1`, '-w', '-t', '30', 'start'], true);
      } catch (failure) {
        const tail = await readFile(log, 'utf8').catch(() => 'No startup log was created.');
        throw new Error(`${failure.message}\n${tail.replaceAll(options.password, '[test password]').slice(-8000)}`, { cause: failure });
      }
    },
    async stop() {
      if (!startAttempted || !existsSync(path.join(directory, 'postmaster.pid'))) return;
      const { pg_ctl } = await import('@embedded-postgres/windows-x64');
      await run(pg_ctl, ['-D', directory, '-m', 'fast', '-w', '-t', '30', 'stop']);
    },
  };
}
