import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateSite, sitePlan, liveChecklist, readSite } from '../scripts/smoothies/site-plan.mjs';

const template = async () => JSON.parse(await readFile(new URL('../config/smoothies-site.example.json', import.meta.url), 'utf8'));

test('blank site values remain explicitly pending and cannot configure a pretend installation', async () => {
  const site = await template(), plan = sitePlan(site);
  assert.equal(plan.configurationReady, false); assert.equal(plan.liveAcceptance, 'pending');
  assert.ok(plan.pending.includes('pc.lanAddress')); assert.ok(plan.pending.includes('menu.openingCountsConfirmed'));
  assert.throws(() => sitePlan(site, { requireAddress: true }), /IP privada/);
  assert.ok(liveChecklist(site).observations.every((item: {result: string; evidence: unknown}) => item.result === 'pending' && item.evidence === null));
});

test('validated values configure existing installer inputs while equipment observations stay unaccepted', async () => {
  const site = await template(); site.pc.lanAddress = '192.168.2.20'; site.printing.required = false;
  const plan = sitePlan(site, { requireAddress: true });
  assert.equal(plan.lanAddress, '192.168.2.20'); assert.equal(plan.lanPort, 3443);
  assert.equal(plan.configurationReady, true); assert.equal(plan.backupExportDirectory, null);
  assert.equal(plan.pending.includes('printing.required'), false);
  const checklist = liveChecklist(site, '0123456789abcdef');
  assert.equal(checklist.packageId, '0123456789abcdef');
  assert.equal(checklist.observations.find((item: {id:string}) => item.id === 'physical-print')?.result, 'not-required');
  assert.equal(checklist.observations.find((item: {id:string}) => item.id === 'cash-sale')?.result, 'pending');
  assert.notEqual(plan.siteSha256, sitePlan(await template()).siteSha256);
});

test('site parser refuses public/bind-all IPs, injected fields, fake placeholders and unsupported paths', async () => {
  for (const address of ['0.0.0.0', '8.8.8.8', '192.168.2.20:3443', '<PC-IP>']) {
    const site = await template(); site.pc.lanAddress = address; assert.throws(() => validateSite(site));
  }
  const secret = await template(); secret.password = 'must-never-enter-this-file'; assert.throws(() => validateSite(secret));
  const placeholder = await template(); placeholder.ipad.model = '<actual iPad>'; assert.throws(() => validateSite(placeholder));
  const port = await template(); port.network.port = 58000; assert.throws(() => validateSite(port));
  const relative = await template(); relative.backup.externalDirectory = 'backup'; assert.throws(() => validateSite(relative));
  const invalidConfirmation = await template(); invalidConfirmation.menu.approved = 'yes'; assert.throws(() => validateSite(invalidConfirmation));
});

test('real CLI initializes private placeholders and writes a package-bound checklist without overwriting observed evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'smoothies-site-'));
  const siteFile = path.join(directory, 'site.json'), checklistFile = path.join(directory, 'acceptance.json');
  const script = path.resolve('scripts/smoothies/site-plan.mjs'), run = promisify(execFile);
  const invoke = (...args: string[]) => run(process.execPath, [script, ...args], { windowsHide: true });
  await invoke('init', siteFile);
  assert.equal((await readSite(siteFile)).pc.lanAddress, null);
  await assert.rejects(invoke('install', siteFile));
  const site = await readSite(siteFile); site.pc.lanAddress = '10.30.40.50'; await writeFile(siteFile, JSON.stringify(site));
  const plan = JSON.parse((await invoke('install', siteFile)).stdout); assert.equal(plan.lanAddress, '10.30.40.50');
  await invoke('checklist', siteFile, checklistFile, '0123456789abcdef');
  const receipt = JSON.parse(await readFile(checklistFile, 'utf8')); assert.equal(receipt.siteSha256, plan.siteSha256);
  assert.ok(receipt.observations.every((item: { result:string }) => item.result === 'pending'));
  await writeFile(checklistFile, 'previous-observed-evidence');
  await assert.rejects(invoke('checklist', siteFile, checklistFile));
  assert.equal(await readFile(checklistFile, 'utf8'), 'previous-observed-evidence');
  await assert.rejects(invoke('init', siteFile));
});

test('the shipped helper refuses to save live values inside either the app or its immutable package', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'smoothies-site-package-'));
  const release = path.join(scratch, 'candidate'), app = path.join(release, 'app');
  for (const directory of ['scripts/smoothies', 'scripts/customer', 'config']) await mkdir(path.join(app, directory), { recursive: true });
  for (const file of ['scripts/smoothies/site-plan.mjs', 'scripts/customer/lan.mjs', 'config/smoothies-site.example.json']) await cp(path.resolve(file), path.join(app, file));
  await writeFile(path.join(release, 'release.json'), '{"product":"smoothies"}');
  const script = path.join(app, 'scripts/smoothies/site-plan.mjs'), run = promisify(execFile);
  for (const destination of [path.join(release, 'site.json'), path.join(app, 'config', 'real-site.json')]) {
    await assert.rejects(run(process.execPath, [script, 'init', destination], { windowsHide: true }), /fuera del codigo/);
  }
  const privateSite = path.join(scratch, 'site.json');
  await run(process.execPath, [script, 'init', privateSite], { windowsHide: true });
  assert.equal(JSON.parse(await readFile(privateSite, 'utf8')).pc.lanAddress, null);
});
