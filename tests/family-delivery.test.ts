import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileHash, requiredFamilyChecks, writeFamilyCandidate, verifyFamilyCandidate, verifyAcceptedFamily } from '../scripts/releases/family-evidence.mjs';
import { acceptanceTemplate } from '../scripts/releases/family-delivery.mjs';
import { posVersions } from '../scripts/releases/version-info.mjs';

async function fixture(t: { after: (fn: () => Promise<void>) => void }, fixtureOnly = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'pos-family-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = 'a'.repeat(40), { version, familyRelease } = posVersions();
  const layout: Record<string, string> = {};
  for (const product of ['cafe', 'smoothies', 'papeleria']) {
    layout[product] = product;
    await mkdir(path.join(root, product));
    await writeFile(path.join(root, product, 'release.json'), JSON.stringify({ version: 1, product, appVersion: version,
      releaseLabel: `${product}-v${version}`, familyRelease, familySourceCommit: source,
      sourceCommit: product === 'papeleria' ? 'b'.repeat(40) : source, sourceDirty: false, familySourceDirty: false, fixtureOnly }));
    await writeFile(path.join(root, product, 'runtime.bin'), 'synthetic accepted package');
    layout[product + 'Zip'] = product === 'cafe' ? `POS-Cafe-${source.slice(0, 7)}.zip`
      : product === 'smoothies' ? `POS-Smoothies-${version}.zip` : `PapeleriaPOS-v${version}-Windows-x64.zip`;
    await writeFile(path.join(root, layout[product + 'Zip']), 'synthetic archive; real publishers also extract/verify ZIPs');
  }
  const candidateFile = await writeFamilyCandidate(root, layout);
  const acceptanceFile = path.join(root, 'acceptance.json');
  await acceptanceTemplate(candidateFile, acceptanceFile);
  const acceptance = JSON.parse(await readFile(acceptanceFile, 'utf8'));
  const proof = path.join(root, 'synthetic-proof.json'); await writeFile(proof, 'synthetic check result');
  Object.assign(acceptance, { reviewer: 'independent fixture reviewer', reviewedAt: new Date().toISOString(),
    independentSourceReview: 'accepted', state: 'customer-qualified',
    checks: requiredFamilyChecks.map(name => ({ name, result: 'passed', evidence: [{ file: proof, sha256: '' }] })) });
  const evidenceHash = await fileHash(proof);
  for (const check of acceptance.checks) check.evidence[0].sha256 = evidenceHash;
  const save = () => writeFile(acceptanceFile, JSON.stringify(acceptance)); await save();
  const options = { candidateFile, acceptanceFile, sourceCommit: source };
  return { root, layout, candidateFile, acceptance, proof, save, options };
}

test('family delivery binds every product tree, both web ZIPs, native ZIP and private acceptance evidence', async t => {
  const f = await fixture(t);
  assert.equal((await verifyAcceptedFamily(f.options)).candidate.sourceCommit, 'a'.repeat(40));
  await writeFile(path.join(f.root, 'papeleria', 'runtime.bin'), 'changed native runtime after acceptance');
  await assert.rejects(verifyAcceptedFamily(f.options), /Candidate bytes changed/);
});

test('missing member, mismatched family source and replacement ZIP cannot reuse acceptance', async t => {
  const f = await fixture(t);
  const native = path.join(f.root, 'papeleria', 'release.json');
  const old = await readFile(native, 'utf8'), changed = JSON.parse(old); changed.familySourceCommit = 'c'.repeat(40);
  await writeFile(native, JSON.stringify(changed));
  await assert.rejects(verifyFamilyCandidate(f.candidateFile), /same family source/);
  await writeFile(native, old);
  await writeFile(path.join(f.root, f.layout.cafeZip), 'replacement archive');
  await assert.rejects(verifyAcceptedFamily(f.options), /Candidate bytes changed/);
});

test('rehearsal, incomplete checks, failed checks, changed proof and wrong publisher source all refuse', async t => {
  const rehearsal = await fixture(t, true);
  await assert.rejects(verifyAcceptedFamily(rehearsal.options), /rehearsal/);
  const f = await fixture(t);
  await assert.rejects(verifyAcceptedFamily({ ...f.options, sourceCommit: 'd'.repeat(40) }), /not this source/);
  const check = f.acceptance.checks.pop(); await f.save();
  await assert.rejects(verifyAcceptedFamily(f.options), /All three/);
  f.acceptance.checks.push(check); f.acceptance.checks[0].result = 'NOT_RUN'; await f.save();
  await assert.rejects(verifyAcceptedFamily(f.options), /has not passed/);
  f.acceptance.checks[0].result = 'passed'; await f.save();
  await writeFile(f.proof, 'changed proof');
  await assert.rejects(verifyAcceptedFamily(f.options), /evidence changed/);
});

test('acceptance template never manufactures qualification and refuses to overwrite a review', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'new-private-review.json');
  await acceptanceTemplate(f.candidateFile, file);
  const template = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(template.state, 'NOT_QUALIFIED'); assert.equal(template.reviewer, null);
  assert.ok(template.checks.every((check: { result: string }) => check.result === 'NOT_RUN'));
  await assert.rejects(acceptanceTemplate(f.candidateFile, file), /exist/i);
});
