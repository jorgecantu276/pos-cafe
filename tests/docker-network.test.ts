import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureLoopbackNetwork } from '../scripts/staging/runtime.mjs';

test('two disposable stacks use daemon allocation without colliding with an occupied explicit pool', async () => {
  const networks = new Map<string, { Labels: Record<string, string>; Options: Record<string, string>; subnet: string }>();
  const calls: string[][] = [];
  const run = async (file: string, args: string[]) => {
    assert.equal(file, 'docker'); calls.push(args);
    if (args[1] === 'ls') return [...networks.keys()].join('\n');
    if (args[1] === 'create') {
      if (args.includes('--subnet')) throw Error('invalid pool request: Pool overlaps with other one on this address space');
      const name = args.at(-1)!;
      const [label, owner] = args[args.indexOf('--label') + 1].split('=');
      networks.set(name, { Labels: { [label]: owner }, Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' }, subnet: `172.${18 + networks.size}.0.0/16` });
      return name;
    }
    assert.equal(args[1], 'inspect');
    return JSON.stringify([networks.get(args.at(-1)!)]);
  };
  const source = { name: 'supabase_network_pos-source', label: 'pos-cafe.admin-test', owner: 'pos-source' };
  const target = { name: 'supabase_network_pos-target', label: 'pos-cafe.admin-test', owner: 'pos-target' };
  const first = await ensureLoopbackNetwork(source, run), second = await ensureLoopbackNetwork(target, run);
  assert.notEqual(first.subnet, second.subnet);
  await ensureLoopbackNetwork(source, run);
  assert.equal(calls.filter(args => args[1] === 'create').length, 2, 'An identified retained network is reused.');
  assert.equal(networks.get(source.name)!.Labels[source.label], source.owner);
  assert.equal(networks.get(target.name)!.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  networks.get(source.name)!.Labels[source.label] = 'foreign';
  await assert.rejects(ensureLoopbackNetwork(source, run), /identity\/binding mismatch/);
  assert.equal(calls.filter(args => args[1] === 'create').length, 2);
  assert.ok(!calls.some(args => args[1] === 'rm'), 'Foreign or existing networks are never deleted.');
});
