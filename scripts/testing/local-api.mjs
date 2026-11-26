import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { root, work, run, dockerCheck, ensureLoopbackNetwork } from '../staging/runtime.mjs';
import { baselineStatements } from '../staging/safety.mjs';
import { sourceFiles } from '../staging/bootstrap.mjs';
import { randomUUID } from 'node:crypto';
import { operationsLoopbackTool } from './operations-loopback.mjs';

// Separate fresh synthetic stack. Existing staging, archives and hosted data
// are never read or reconciled. Each run owns a new project and test volumes.
export async function freshLocalApi({ portBase = 55471, emptyWithStorage = false, storage = false, runtimeDirectory } = {}) {
  const storageEnabled = storage || emptyWithStorage;
  assert.ok([55471,55481,55501,55521,55541,55561,55901,55921].includes(portBase), 'Only dedicated loopback test/demo port families are allowed');
  if ([55901,55921].includes(portBase)) {
    assert.ok(runtimeDirectory && path.isAbsolute(runtimeDirectory), 'Operations demos require their private runtime directory.');
    const relative = path.relative(root, runtimeDirectory);
    assert.ok(relative.startsWith('..' + path.sep), 'Keep demo runtime state outside immutable source.');
  } else assert.equal(runtimeDirectory, undefined, 'Existing test directory policy is unchanged.');
  const portPrefix=String(portBase).slice(0,-1);
  await dockerCheck();
  const project = `pos-cafe-admin-${randomUUID().slice(0, 8)}`, network = `supabase_network_${project}`;
  const directory = path.join(runtimeDirectory || work, 'admin-api', project);
  const tool=process.platform==='win32'&&runtimeDirectory?await operationsLoopbackTool({sourceFile:path.join(root,'scripts/staging/docker-loopback.cs'),portPrefix}):null;
  const bin=tool?.bin||path.join(directory,'docker-bin');
  await mkdir(path.join(directory, 'supabase'), { recursive: true }); await mkdir(bin, { recursive: true });
  let configText = (await readFile(path.join(root, 'supabase/staging/config.toml'), 'utf8'))
    .replaceAll('pos-cafe-staging-local', project).replaceAll('5545', portPrefix);
  if (storageEnabled) {
    configText = configText.replace(/(\[storage\]\r?\nenabled = )false/, '$1true');
    assert.match(configText, /\[storage\]\r?\nenabled = true/);
  }
  await writeFile(path.join(directory, 'supabase/config.toml'), configText);
  const require = createRequire(import.meta.url), pkg = require('supabase/package.json');
  const cli = path.join(path.dirname(require.resolve('supabase/package.json')), pkg.bin.supabase);
  let env = { ...process.env };
  if (process.platform === 'win32') {
    if(!tool){
      const source = path.join(bin, 'loopback.cs'), launcher = path.join(bin, 'docker.exe');
      await writeFile(source, (await readFile(path.join(root, 'scripts/staging/docker-loopback.cs'), 'utf8')).replaceAll('5545', portPrefix));
      await run(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', `/out:${launcher}`, source]);
      await run(launcher, ['--pos-cafe-self-test']);
    }
    env = { ...env, POS_CAFE_REAL_DOCKER: path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe'), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  }
  const cliRun = args => run(process.execPath, [cli, ...args, '--workdir', directory], { env });
  await ensureLoopbackNetwork({ name: network, label: 'pos-cafe.admin-test', owner: project });
  const cleanupNetwork=async()=>{
    const [owned]=JSON.parse(await run('docker',['network','inspect',network]));
    assert.equal(owned.Labels?.['pos-cafe.admin-test'],project);
    assert.equal(Object.keys(owned.Containers||{}).length,0,'Never remove a network with active containers');
    await run('docker',['network','rm',owned.Id]);
  };
  let db;
  try {
    const excluded = ['realtime','imgproxy','edge-runtime','logflare','vector','supavisor','studio','inbucket'];
    if (!storageEnabled) excluded.push('storage-api');
    await cliRun(['start', '--exclude', excluded.join(',')]);
    const status = JSON.parse(await cliRun(['status', '-o', 'json']));
    assert.equal(status.API_URL, `http://127.0.0.1:${portBase}`);
    const dbUrl = new URL(status.DB_URL); assert.equal(dbUrl.hostname, '127.0.0.1'); assert.equal(dbUrl.port, String(portBase+1)); assert.equal(dbUrl.pathname, '/postgres');
    const containers = (await run('docker', ['ps', '--filter', `name=_${project}$`, '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(containers.length >= 4);
    for (const info of JSON.parse(await run('docker', ['inspect', ...containers]))) {
      assert.ok(info.Name.endsWith(`_${project}`) && info.NetworkSettings.Networks[network]);
      for (const bindings of Object.values(info.NetworkSettings.Ports || {})) for (const binding of bindings || []) assert.equal(binding.HostIp, '127.0.0.1');
    }
    db = new Client({ connectionString: status.DB_URL }); await db.connect();
    assert.equal(Number((await db.query("select count(*) n from pg_tables where schemaname='public'")).rows[0].n), 0, 'Requires a fresh empty test database; retained test volumes are never reset automatically');
    assert.equal(Number((await db.query('select count(*) n from auth.users')).rows[0].n), 0);
    const source = await sourceFiles({ storage: storageEnabled });
    if (!emptyWithStorage) for (const statement of baselineStatements(JSON.parse(source.snapshot))) await db.query(statement);
    const config = { api: status.API_URL, database: status.DB_URL, anon: status.ANON_KEY, service: status.SERVICE_ROLE_KEY };
    const service = createClient(config.api, config.service, { auth: { persistSession: false, autoRefreshToken: false } });
    const isolation = { project, network, containers: JSON.parse(await run('docker', ['inspect', ...containers])).map(value => ({ id: value.Id, image: value.Image })) };
    return { config, db, service, isolation, directory, disposeTools:async()=>tool?.dispose(), install: () => db.query(source.migration), async cleanup() { try{await db.end(); await cliRun(['stop', '--no-backup']); await cleanupNetwork();}finally{await tool?.dispose();} } };
  } catch (error) { await db?.end(); await cliRun(['stop']).then(cleanupNetwork).catch(() => {}); await tool?.dispose();throw error; }
}
