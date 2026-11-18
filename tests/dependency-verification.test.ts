import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/windows-verification.yml', import.meta.url), 'utf8');
const aggregate = workflow.slice(workflow.indexOf('  required-verification:'));
const jobs = [...workflow.slice(workflow.indexOf('\njobs:')).matchAll(/^  ([a-z0-9-]+):\r?$/gm)].map(match => match[1]).filter(job => job !== 'required-verification');
const needs = aggregate.match(/^    needs: \[([^\]]+)\]/m)![1].split(',').map(job => job.trim());
const script = aggregate.match(/node <<'NODE'\r?\n([\s\S]+?)          NODE/)![1].replace(/^          /gm, '');
const run = (value: unknown) => spawnSync(process.execPath, ['-e', script], {
  env: { ...process.env, VERIFICATION_RESULTS: JSON.stringify(value) }, encoding: 'utf8',
});
const passed = () => Object.fromEntries(jobs.map(job => [job, { result: 'success' }]));

test('required verification covers every CI job and succeeds only when all succeed', () => {
  assert.deepEqual([...needs].sort(), [...jobs].sort());
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregate, /permissions: \{\}/);
  assert.equal(run(passed()).status, 0);
});

test('required verification fails for failure, cancellation, skipped or missing results', () => {
  for (const job of jobs) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const values = passed();
      values[job].result = result;
      assert.equal(run(values).status, 1, `${job}=${result}`);
    }
    const values = passed();
    delete values[job];
    assert.equal(run(values).status, 1, `${job}=missing`);
  }
  assert.notEqual(run(null).status, 0);
  assert.notEqual(run({}).status, 0);
});
