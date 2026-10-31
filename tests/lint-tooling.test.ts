import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('the actual lint command rejects hook, TypeScript and accessibility mistakes', () => {
  const cli = path.resolve('node_modules/oxlint/bin/oxlint');
  const directory = mkdtempSync(path.join(tmpdir(),'pos-lint-probe-'));
  const fixture = path.join(directory,'probe.tsx');
  try {
  for (const [source, diagnostic] of [
    ["import {useState} from 'react'; export default function Example({show}:{show:boolean}) {if(show)useState(0);return <button>OK</button>}", 'rules-of-hooks'],
    ["export const value: any = 1;", 'no-explicit-any'],
    ["export default function Example(){return <img src='/test.jpg'/>}", 'alt-text'],
  ]) {
    writeFileSync(fixture, source);
    const result = spawnSync(process.execPath, [cli, '-c', path.resolve('.oxlintrc.json'), fixture, '--max-warnings', '0', '--format', 'json'],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout + result.stderr, new RegExp(diagnostic));
  }
  } finally { unlinkSync(fixture); rmdirSync(directory); }
});
