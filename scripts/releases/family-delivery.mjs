import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requiredFamilyChecks, verifyFamilyCandidate, verifyAcceptedFamily } from './family-evidence.mjs';

export async function acceptanceTemplate(candidateFile, output) {
  assert.ok(path.isAbsolute(output), 'Save acceptance outside source with an absolute path.');
  const { candidate, candidateSha256 } = await verifyFamilyCandidate(candidateFile);
  const template = { format: 'pos-family-acceptance-v1', candidateSha256, sourceCommit: candidate.sourceCommit,
    reviewer: null, reviewedAt: null, independentSourceReview: 'NOT_RUN', state: 'NOT_QUALIFIED',
    checks: requiredFamilyChecks.map(name => ({ name, result: 'NOT_RUN', evidence: [] })) };
  await writeFile(output, JSON.stringify(template, null, 2) + '\n', { flag: 'wx' });
  return { state: 'acceptance-required', fixtureOnly: candidate.fixtureOnly, output };
}

async function publish(product, candidateFile, acceptanceFile, key, notes, predecessors) {
  assert.ok(['cafe', 'smoothies'].includes(product));
  const root = path.resolve(import.meta.dirname, '../..');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const { candidate, root: artifacts } = await verifyAcceptedFamily({ candidateFile, acceptanceFile, sourceCommit });
  const member = name => path.join(artifacts, candidate.members[name].directory);
  const zip = path.join(artifacts, candidate.archives[product].file);
  const envelope = path.join(artifacts, product === 'cafe' ? 'pos-update.json' : 'pilot.json');
  const args = product === 'cafe'
    ? [key, member('cafe'), member('smoothies'), member('papeleria'), zip, envelope, notes, ...predecessors]
    : [key, member('cafe'), member('smoothies'), member('papeleria'), zip, envelope, notes];
  execFileSync(process.execPath, [`scripts/releases/publish-${product}-release.mjs`, ...args], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, POS_FAMILY_CANDIDATE: path.resolve(candidateFile), POS_FAMILY_ACCEPTANCE: path.resolve(acceptanceFile) },
  });
}

async function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'inspect' && args.length === 1) {
      const { candidate, candidateSha256 } = await verifyFamilyCandidate(args[0]);
      console.log(JSON.stringify({ ...candidate, candidateSha256, qualified: false }, null, 2));
    } else if (command === 'acceptance-template' && args.length === 2) {
      console.log(JSON.stringify(await acceptanceTemplate(...args)));
    } else if (['publish-cafe', 'publish-smoothies'].includes(command) && args.length >= 4) {
      await publish(command.slice(8), ...args.slice(0, 4), args.slice(4));
    } else throw Error('Use family-delivery.mjs inspect <candidate.json>, acceptance-template <candidate.json> <new-private.json>, or publish-cafe|publish-smoothies <candidate.json> <acceptance.json> <key> <notes> [accepted-Cafe-predecessor-sha ...].');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) void main();
