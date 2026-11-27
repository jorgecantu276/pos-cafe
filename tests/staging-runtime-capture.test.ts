import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../scripts/staging/runtime.mjs';

test('actual staging subprocess waits for delayed pipe bytes and keeps both redacted failure streams', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-runtime-capture-'));
  const writer = path.join(directory, 'finite-writer.cjs');
  const parent = path.join(directory, 'failed-parent.cjs');
  const token = 'eyJ' + 'a'.repeat(40) + '.' + 'b'.repeat(40) + '.' + 'c'.repeat(40);
  await writeFile(writer, `setTimeout(()=>{process.stdout.write('LATE-STDOUT-FATAL ${token}');process.stderr.write('LATE-STDERR-FATAL postgres://user:private-fixture@127.0.0.1/db');},150);setTimeout(()=>process.exit(0),250);`);
  await writeFile(parent, `const cp=require('node:child_process');const child=cp.spawn(process.execPath,[process.argv[2]],{detached:true,stdio:'inherit',windowsHide:true});child.unref();process.stderr.write('root pull progress');process.exit(7);`);
  await assert.rejects(run(process.execPath, [parent, writer]), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /failed \(7\)/);
    for (const text of ['[stdout]', '[stderr]', 'LATE-STDOUT-FATAL', 'LATE-STDERR-FATAL', 'root pull progress', '[token]', '[database URL]']) assert.ok(error.message.includes(text), text);
    assert.ok(!error.message.includes(token) && !error.message.includes('private-fixture'));
    return true;
  });
});

test('actual staging capture preserves early critical causes before progress evicts both 2MB tails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-runtime-progress-'));
  const fixture = path.join(directory, 'progress.cjs');
  const token = 'eyJ' + 'a'.repeat(40) + '.' + 'b'.repeat(40) + '.' + 'c'.repeat(40);
  // Neutral progress separates the real failure from any context retained for
  // ordinary chatter, so the pre-fix four-window saturation truly loses it.
  await writeFile(fixture, `const fs=require('node:fs'),nl=String.fromCharCode(10);fs.writeSync(2,['registry download progress','daemon starting image','registry image metadata','daemon image ready','download progress one','download progress two','download progress three','FATAL early stderr cause ${token}',''].join(nl));fs.writeSync(1,'Error: early stdout cause postgres://user:private-canary@127.0.0.1/db'+nl);const progress='pull progress '.repeat(160000)+nl;fs.writeSync(2,progress);fs.writeSync(1,progress);process.exit(9);`);
  await assert.rejects(run(process.execPath, [fixture]), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /failed \(9\)/);
    assert.match(error.message, /FATAL early stderr cause/); assert.match(error.message, /Error: early stdout cause/);
    assert.ok(!error.message.includes(token) && !error.message.includes('private-canary'));
    assert.ok(error.message.length < 18_000, 'Projected causes must stay bounded despite megabytes of progress.');
    return true;
  });
});

test('actual staging subprocess returns complete successful output and bounds inherited writer EOF', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pos-runtime-drain-'));
  const writer = path.join(directory, 'writer.cjs'), parent = path.join(directory, 'parent.cjs');
  await writeFile(writer, `process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});setTimeout(()=>process.stdout.write('late-complete-output'),150);setTimeout(()=>process.exit(0),Number(process.argv[2]));`);
  await writeFile(parent, `const cp=require('node:child_process');const child=cp.spawn(process.execPath,[process.argv[2],process.argv[3]],{detached:true,stdio:'inherit',windowsHide:true});child.unref();process.exit(Number(process.argv[4]));`);
  assert.equal(await run(process.execPath, [parent, writer, '250', '0']), 'late-complete-output');
  const started = Date.now();
  // This owned writer self-terminates at2s even if the assertion fails; no
  // unowned process is located or killed to exercise the inherited-pipe case.
  await assert.rejects(run(process.execPath, [parent, writer, '2000', '7']), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /failed \(7\)/); assert.match(error.message, /output drain exceeded 1000ms/);
    assert.match(error.message, /late-complete-output/); return true;
  });
  assert.ok(Date.now() - started < 1800, 'Root exit must not wait indefinitely for descendant EOF.');
  await new Promise(resolve => setTimeout(resolve, 1100));
});
