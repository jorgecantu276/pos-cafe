import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { createServer } from 'node:http';
import { run, network } from '../staging/runtime.mjs';
import { restoreTarget, sha256 } from './artifacts.mjs';

export async function restoreBackup(backup) {
  const { payload } = backup;
  const runId = payload.runId, prefix = `pos-cafe-recovery-${runId.slice(0, 8)}`;
  const name = `${prefix}-db`, created = [];
  const password = randomBytes(24).toString('base64url');
  assert.equal(payload.bootstrapRole, 'supabase_admin', 'Restore must match the source cluster bootstrap identity');
  let proxy;
  async function inspect(container) { return JSON.parse(await run('docker', ['inspect', '--type', 'container', container]))[0]; }
  async function owned(container) {
    const info = await inspect(container);
    assert.equal(info.Config.Labels?.['pos-cafe.recovery'], runId, 'Refusing an unowned recovery container');
    assert.ok(info.Name.startsWith(`/${prefix}-`)); return info;
  }
  const cleanup = async () => {
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    for (const container of [...created].reverse()) { await owned(container); await run('docker', ['rm', '-f', container]); }
  };
  try {
    // Fresh cluster from the exact source image; no source volumes reused.
    // tmpfs is deliberate: this target contains disposable restore fixtures only.
    await run('docker', ['run', '-d', '--name', name, '--label', `pos-cafe.recovery=${runId}`,
      '--network', network, '--publish', '127.0.0.1:55462:5432', '--user', 'postgres',
      '--tmpfs', '/restore:rw,uid=100,gid=101,mode=0700', '--env', 'RECOVERY_BOOTSTRAP_PASSWORD',
      '--entrypoint', '/bin/sh', payload.services.database.image, '-c',
      'printf %s "$RECOVERY_BOOTSTRAP_PASSWORD" > /restore/password; initdb -D /restore/db -U supabase_admin --pwfile=/restore/password --auth-local=trust --auth-host=scram-sha-256 > /restore/init.log && printf "\\nhost all all samenet scram-sha-256\\n" >> /restore/db/pg_hba.conf && exec postgres -D /restore/db -c listen_addresses=\'*\' -c port=5432'],
    { env: { ...process.env, RECOVERY_BOOTSTRAP_PASSWORD: password } });
    created.push(name);
    const adminOptions = { host: '127.0.0.1', port: 55462, user: 'supabase_admin', password, database: 'postgres', connectionTimeoutMillis: 2000 };
    let admin, lastError;
    for (let attempt = 0; attempt < 20; attempt++) {
      const connection = new Client(adminOptions);
      try { await connection.connect(); admin = connection; break; }
      catch (error) { lastError = error.message; await connection.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!admin) throw new Error(`Fresh recovery PostgreSQL did not start: ${lastError}\n${await run('docker', ['logs', '--tail', '15', name])}`);
    try {
      restoreTarget(await owned(name), runId, 'restored_pos');
      for (const [key, file] of [['roles.sql', '/restore/restore-roles.sql'], ['database.dump', '/restore/restore-database.dump']]) {
        const originalBytes = Buffer.from(payload.files[key].base64, 'base64'); assert.equal(sha256(originalBytes), payload.files[key].sha256);
        let bytes = originalBytes;
        if (key === 'roles.sql') {
          const sql = originalBytes.toString('utf8');
          assert.equal(sql.match(/^CREATE ROLE supabase_admin;$/gm)?.length, 1);
          bytes = Buffer.from(sql.replace(/^CREATE ROLE supabase_admin;$/m, '-- Matching initdb bootstrap role already exists; ALTER ROLE and memberships follow unchanged.'));
        }
        await new Promise((resolve, reject) => {
          const child = spawn('docker', ['exec', '-i', name, 'sh', '-c', `umask 077; cat > ${file}`], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
          let error = ''; child.stderr.on('data', value => { error += value; });
          child.on('error', reject); child.stdin.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Recovery stream transfer failed: ${error}`)));
          child.stdin.end(bytes);
        });
        const actual = (await run('docker', ['exec', name, 'sha256sum', file])).split(' ')[0];
        assert.equal(actual, sha256(bytes), 'Restored archive stream changed in transit');
      }
      // Match the original bootstrap role so GRANTED BY chains retain their
      // PostgreSQL 17 membership semantics; skip only its duplicate CREATE.
      await run('docker', ['exec', name, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '/restore/restore-roles.sql']);
      const literal = value => `'${value.replaceAll("'", "''")}'`;
      assert.ok(['c', 'i', 'b'].includes(payload.locale.datlocprovider));
      const provider = { c: 'libc', i: 'icu', b: 'builtin' }[payload.locale.datlocprovider];
      const extra = provider === 'icu' ? `icu_locale ${literal(payload.locale.datlocale)}${payload.locale.daticurules ? ` icu_rules ${literal(payload.locale.daticurules)}` : ''}`
        : provider === 'builtin' ? `builtin_locale ${literal(payload.locale.datlocale)}` : '';
      await admin.query(`create database restored_pos owner postgres template template0 encoding ${literal(payload.locale.encoding)} lc_collate ${literal(payload.locale.datcollate)} lc_ctype ${literal(payload.locale.datctype)} locale_provider ${provider} ${extra}`);
      const probeUrl = new URL(payload.config.database); probeUrl.port = '55462'; probeUrl.pathname = '/restored_pos';
      const probeDb = new Client({ connectionString: probeUrl.href }); await probeDb.connect();
      try {
        await probeDb.query('create table public.profiles(restore_conflict integer)');
        await assert.rejects(run('docker', ['exec', name, 'pg_restore', '-U', 'supabase_admin', '-d', 'restored_pos', '--exit-on-error', '--single-transaction', '/restore/restore-database.dump']));
        assert.equal((await probeDb.query("select to_regnamespace('auth') present")).rows[0].present, null, 'Failed restore must roll back earlier schema creation');
        assert.equal((await probeDb.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='restore_conflict'")).rows[0].n, 1);
        await probeDb.query('drop table public.profiles');
      } finally { await probeDb.end(); }
      await run('docker', ['exec', name, 'pg_restore', '-U', 'supabase_admin', '-d', 'restored_pos', '--exit-on-error', '--single-transaction', '/restore/restore-database.dump']);
      await admin.query('revoke all on database restored_pos from public');
      for (const acl of payload.databaseAcl) {
        assert.ok(['CREATE', 'CONNECT', 'TEMPORARY'].includes(acl.privilege_type));
        const q = text => `"${text.replaceAll('"', '""')}"`;
        await admin.query('begin');
        try {
          await admin.query(`set local role ${q(acl.grantor)}`);
          await admin.query(`grant ${acl.privilege_type} on database restored_pos to ${acl.grantee === 'PUBLIC' ? 'public' : q(acl.grantee)}${acl.is_grantable ? ' with grant option' : ''}`);
          await admin.query('commit');
        } catch (error) { await admin.query('rollback'); throw error; }
      }
      for (const setting of payload.dbSettings) for (const value of setting.setconfig) {
        const separator = value.indexOf('='), key = value.slice(0, separator), config = value.slice(separator + 1);
        const q = text => `"${text.replaceAll('"', '""')}"`;
        const literal = text => `'${text.replaceAll("'", "''")}'`;
        await admin.query(`${setting.rolname ? `alter role ${q(setting.rolname)} in database` : 'alter database'} restored_pos set ${q(key)} to ${literal(config)}`);
      }
    } finally { await admin.end(); }
    const dbUrl = new URL(payload.config.database); dbUrl.port = '55462'; dbUrl.pathname = '/restored_pos';
    const config = { ...payload.config, api: 'http://127.0.0.1:55460', database: dbUrl.href };
    const db = new Client({ connectionString: config.database }); await db.connect();
    await db.end(); // Prove the restored original PostgreSQL role password works.

    async function service(kind, port, internalPort, dbKey) {
      const original = payload.services[kind], container = `${prefix}-${kind}`;
      const env = Object.fromEntries(original.config.Env.map(pair => { const i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)]; }));
      // Keep the Windows launcher PATH; the exact image already supplies the
      // original Linux PATH inside the service container.
      delete env.PATH;
      const connection = new URL(env[dbKey]); connection.hostname = name; connection.port = '5432'; connection.pathname = '/restored_pos';
      env[dbKey] = connection.href;
      if (kind === 'auth') { env.API_EXTERNAL_URL = `${config.api}/auth/v1`; env.GOTRUE_SITE_URL = 'http://127.0.0.1:3110'; }
      const args = ['run', '-d', '--name', container, '--label', `pos-cafe.recovery=${runId}`, '--network', network,
        '--publish', `127.0.0.1:${port}:${internalPort}`, ...Object.keys(env).flatMap(key => ['--env', key])];
      assert.ok(!original.config.Entrypoint?.length, 'Recovery service entrypoint needs explicit handling');
      await run('docker', [...args, original.image, ...original.config.Cmd], { env: { ...process.env, ...env } });
      created.push(container);
      const info = await owned(container);
      for (const bindings of Object.values(info.NetworkSettings.Ports || {})) for (const binding of bindings || []) assert.equal(binding.HostIp, '127.0.0.1');
    }
    const startServices = async () => {
      await service('auth', 55463, 9999, 'GOTRUE_DB_DATABASE_URL');
      await service('rest', 55464, 3000, 'PGRST_DB_URI');
      // Thin local routing adapter only; Auth and RLS are the real restored
      // services. This does not emulate Kong's rate limits/TLS behavior.
      proxy = createServer(async (request, response) => {
        const auth = request.url.startsWith('/auth/v1/'), rest = request.url.startsWith('/rest/v1/');
        if (!auth && !rest) { response.writeHead(404); response.end(); return; }
        const body = []; for await (const chunk of request) body.push(chunk);
        try {
          const headers = { ...request.headers }; delete headers.host; delete headers.connection;
          const result = await fetch(`http://127.0.0.1:${auth ? 55463 : 55464}${request.url.slice(8)}`, {
            method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(body), redirect: 'manual', signal: AbortSignal.timeout(10_000),
          });
          response.writeHead(result.status, Object.fromEntries([...result.headers].filter(([key]) => !['transfer-encoding', 'content-encoding', 'content-length'].includes(key))));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch { response.writeHead(503); response.end('Local recovery service unavailable'); }
      });
      await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(55460, '127.0.0.1', resolve); });
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          const ready = await fetch(`${config.api}/auth/v1/health`, { signal: AbortSignal.timeout(1000) });
          const rest = await fetch(`${config.api}/rest/v1/`, { headers: { authorization: `Bearer ${config.anon}` }, signal: AbortSignal.timeout(1000) });
          if (ready.ok && rest.ok) return;
        } catch { /* Restored services are still starting. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('Restored Auth/PostgREST services did not become healthy');
    };
    return { config, name, startServices, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
