import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectPackage, posVersions } from './version-info.mjs';

const sha = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const products = ['cafe', 'smoothies', 'papeleria'];
export const requiredFamilyChecks = products.flatMap(product =>
  ['new-install', 'retained-upgrade', 'recovery'].map(check => `${product}:${check}`));
export async function fileHash(file) {
  assert.ok((await lstat(file)).isFile(), 'Evidence must be a regular file.');
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
async function json(file) { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
function contained(root, relative) {
  assert.ok(typeof relative === 'string' && relative.length && !relative.includes('\\')
    && !path.isAbsolute(relative) && relative.split('/').every(part => part && !['.', '..'].includes(part)), 'Invalid candidate path.');
  const result = path.resolve(root, relative);
  assert.ok(path.relative(root, result).split(path.sep)[0] !== '..', 'Candidate path escapes its root.');
  return result;
}
async function tree(directory) {
  assert.ok((await lstat(directory)).isDirectory(), 'Package directory required.');
  // Windows runner TEMP may use a legitimate 8.3 alias (RUNNER~1). Compare
  // filesystem kinds, not path spelling, while refusing junctions at any level.
  for (let current = path.resolve(directory);;) {
    assert.equal((await lstat(current)).isSymbolicLink(), false, 'Packages cannot use directory links.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const entries = [];
  async function visit(folder, prefix = '') {
    for (const item of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = prefix + item.name, full = path.join(folder, item.name);
      assert.ok(!item.isSymbolicLink(), 'A package cannot contain links.');
      if (item.isDirectory()) await visit(full, file + '/');
      else { assert.ok(item.isFile(), 'Unexpected package entry.'); entries.push({ file, sha256: await fileHash(full) }); }
    }
  }
  await visit(directory);
  assert.ok(entries.length && entries.some(entry => entry.file === 'release.json'), 'Package manifest missing.');
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export async function inspectFamilyCandidate(root, layout) {
  root = path.resolve(root);
  const { version, familyRelease } = posVersions();
  const members = {};
  let sourceCommit;
  for (const product of products) {
    const directory = contained(root, layout[product]);
    const release = inspectPackage(directory);
    assert.equal(release.product, posVersions().products[product]);
    assert.equal(release.familyRelease, familyRelease);
    assert.equal(release.version, version);
    assert.equal(release.sourceDirty, false);
    assert.equal(release.familySourceDirty, false);
    assert.match(release.commit, commit);
    assert.match(release.familyCommit, commit);
    sourceCommit ??= release.familyCommit;
    assert.equal(release.familyCommit, sourceCommit, 'All three products must use the same family source.');
    if (product !== 'papeleria') assert.equal(release.commit, sourceCommit);
    members[product] = { directory: layout[product], sourceCommit: release.commit,
      treeSha256: await tree(directory) };
  }
  const cafe = await json(path.join(contained(root, layout.cafe), 'release.json'));
  assert.equal(typeof cafe.fixtureOnly, 'boolean');
  const archives = {};
  for (const [product, expected] of Object.entries({
    cafe: `POS-Cafe-${sourceCommit.slice(0, 7)}.zip`,
    smoothies: `POS-Smoothies-${version}.zip`,
    papeleria: `PapeleriaPOS-v${version}-Windows-x64.zip`,
  })) {
    assert.equal(path.basename(layout[`${product}Zip`]), expected);
    archives[product] = { file: layout[`${product}Zip`], sha256: await fileHash(contained(root, layout[`${product}Zip`])) };
  }
  return { format: 'pos-family-candidate-v1', version, familyRelease, sourceCommit,
    fixtureOnly: cafe.fixtureOnly, members, archives };
}

export async function writeFamilyCandidate(root, layout) {
  const candidate = await inspectFamilyCandidate(root, layout);
  const output = path.join(root, 'family-candidate.json');
  await writeFile(output, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  return output;
}

export async function verifyFamilyCandidate(candidateFile) {
  const candidate = await json(candidateFile), root = path.dirname(path.resolve(candidateFile));
  assert.equal(candidate.format, 'pos-family-candidate-v1');
  const layout = Object.fromEntries(products.flatMap(product => [
    [product, candidate.members[product].directory], [`${product}Zip`, candidate.archives[product].file],
  ]));
  assert.deepEqual(await inspectFamilyCandidate(root, layout), candidate, 'Candidate bytes changed; rebuild and qualify a new candidate.');
  return { candidate, root, layout, candidateSha256: await fileHash(candidateFile) };
}

// The named review is a private procedural attestation, not a cryptographic identity gate.
// Re-read exact evidence and all package bytes immediately before any signer/publisher.
export async function verifyAcceptedFamily({ candidateFile, acceptanceFile, sourceCommit, directories = null, product = null, zip = null }) {
  assert.ok(candidateFile && acceptanceFile, 'Pass the private exact-candidate acceptance before publication.');
  const verified = await verifyFamilyCandidate(candidateFile);
  const { candidate, candidateSha256, root } = verified;
  assert.equal(candidate.fixtureOnly, false, 'A rehearsal cannot be published to customers.');
  assert.equal(candidate.sourceCommit, sourceCommit, 'The accepted candidate is not this source commit.');
  const acceptance = await json(acceptanceFile);
  assert.equal(acceptance.format, 'pos-family-acceptance-v1');
  assert.equal(acceptance.candidateSha256, candidateSha256);
  assert.equal(acceptance.sourceCommit, sourceCommit);
  assert.ok(typeof acceptance.reviewer === 'string' && acceptance.reviewer.trim(), 'Name the independent reviewer.');
  assert.ok(Number.isFinite(Date.parse(acceptance.reviewedAt)), 'Review timestamp required.');
  assert.equal(acceptance.independentSourceReview, 'accepted');
  assert.equal(acceptance.state, 'customer-qualified');
  assert.deepEqual(acceptance.checks.map(check => check.name).sort(), [...requiredFamilyChecks].sort(), 'All three products need install, retained-upgrade and recovery evidence.');
  for (const check of acceptance.checks) {
    assert.equal(check.result, 'passed', `${check.name} has not passed.`);
    assert.ok(Array.isArray(check.evidence) && check.evidence.length, 'Each check requires exact evidence.');
    for (const evidence of check.evidence) {
      assert.ok(path.isAbsolute(evidence.file), 'Keep evidence in private absolute paths.');
      assert.match(evidence.sha256, sha);
      assert.equal(await fileHash(evidence.file), evidence.sha256, 'Acceptance evidence changed.');
    }
  }
  for (const name of products) if (directories) assert.equal(await realpath(directories[name]),
    await realpath(contained(root, candidate.members[name].directory)), 'Publisher selected another package.');
  if (product) assert.equal(await realpath(zip), await realpath(contained(root, candidate.archives[product].file)), 'Publisher selected another ZIP.');
  return { ...verified, acceptance };
}
