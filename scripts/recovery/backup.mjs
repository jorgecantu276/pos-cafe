import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { work, run } from '../staging/runtime.mjs';
import { verifyIdentity } from '../staging/bootstrap.mjs';
import { project } from '../staging/safety.mjs';
import { databaseFingerprint } from './fingerprint.mjs';
import { seal, unseal, sha256 } from './artifacts.mjs';

export const sourceContainer = `supabase_db_${project}`;
async function dumpFile(args, file) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', sourceContainer, ...args], { windowsHide: true, stdio: ['ignore', handle.fd, 'pipe'] });
      let error = ''; child.stderr.on('data', value => { error += value; });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Local backup failed (${code}): ${error.slice(-2000)}`)));
    });
  } finally { await handle.close(); }
}
export async function createBackup(config, runId) {
  const directory = path.join(work, 'recovery', runId);
  await mkdir(directory, { recursive: true });
  const db = new Client({ connectionString: config.database }); await db.connect();
  const files = {}, raw = [];
  try {
    const source = await verifyIdentity(db);
    await db.query('begin isolation level repeatable read read only');
    const snapshot = (await db.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
    const baseline = await databaseFingerprint(db);
    const bootstrapRole = (await db.query('select rolname from pg_roles where oid=10')).rows[0].rolname;
    const locale = (await db.query('select datcollate,datctype,datlocprovider,datlocale,daticurules,datcollversion,pg_encoding_to_char(encoding) encoding from pg_database where datname=current_database()')).rows[0];
    const databaseAcl = (await db.query(`select grantor::regrole::text grantor,case when grantee=0 then 'PUBLIC' else grantee::regrole::text end grantee,privilege_type,is_grantable from pg_database d,aclexplode(d.datacl) where datname=current_database() order by 1,2,3`)).rows;
    const dbSettings = (await db.query(`select r.rolname,s.setconfig from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole where s.setdatabase=(select oid from pg_database where datname=current_database()) order by r.rolname nulls first`)).rows;
    for (const [name, args] of [
      ['database.dump', ['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom', '--snapshot', snapshot]],
      ['roles.sql', ['pg_dumpall', '-U', 'supabase_admin', '--roles-only']],
    ]) {
      const file = path.join(directory, name); raw.push(file); await dumpFile(args, file);
      const bytes = await readFile(file); files[name] = { base64: bytes.toString('base64'), sha256: sha256(bytes) };
    }
    await db.query('commit');
    const services = {};
    for (const [name, container] of [['database', sourceContainer], ['auth', `supabase_auth_${project}`], ['rest', `supabase_rest_${project}`]]) {
      const [info] = JSON.parse(await run('docker', ['inspect', container]));
      services[name] = { image: info.Image, config: info.Config };
    }
    const credentials = JSON.parse(await readFile(path.join(work, 'credentials.json'), 'utf8'));
    const payload = { runId, contract: source.hash, createdAt: new Date().toISOString(), files, baseline, dbSettings, services, credentials, config, bootstrapRole, locale, databaseAcl };
    const key = randomBytes(32), envelope = seal(payload, key);
    const encrypted = path.join(directory, 'backup.aes-gcm.json');
    const keys = path.join(work, 'recovery', 'keys'); await mkdir(keys, { recursive: true });
    const keyFile = path.join(keys, `${runId}.key`);
    await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
    await writeFile(encrypted, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
    const restored = unseal(JSON.parse(await readFile(encrypted, 'utf8')), await readFile(keyFile));
    for (const file of raw) await unlink(file); // exact newly-created files only
    const manifest = { runId, createdAt: payload.createdAt, contract: source.hash, encryptedSha256: sha256(await readFile(encrypted)),
      source: 'guarded local Supabase only', counts: baseline.counts, schemaSha256: baseline.schema, members: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, value.sha256])) };
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { payload: restored, manifest, directory, encrypted, keyFile };
  } finally {
    await db.end();
    for (const file of raw) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
