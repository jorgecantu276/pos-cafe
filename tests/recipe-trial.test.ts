import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { readRecipeTrial, recipeTrialKey, writeRecipeTrial } from '../lib/recipe-trial';

const values = { name: 'Mango', ingredients: '150 g mango', method: 'Mezclar', changes: 'Menos hielo' };
function fixture() {
  const records = new Map<string, string>(), calls: Record<string, unknown>[] = [], trials = new Map<string, object>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, raw: string) => { records.set(key, raw); }, removeItem: (key: string) => { records.delete(key); } };
  let actor = 'a', outcome = 'lost';
  const client = { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: actor }, access_token: `token-${actor}` } }, error: null }) }, rpc: (_name: string, args: Record<string, unknown>) => {
    const result = (async () => {
    calls.push(args);
    if (outcome === 'hang') return new Promise(() => {});
    if (outcome === 'reject') return { data: null, error: { code: 'P0001', message: 'Rechazado' } };
    if (outcome === 'permission') return { data: null, error: { code: '42501', message: 'Sin permiso' } };
    const id = args.p_trial as string;
    if (!trials.has(id)) trials.set(id, { id, recipe_id: args.p_recipe, number: 1, ingredients: args.p_ingredients, method: args.p_method, changes: args.p_changes, created_at: '2026-11-25T12:00:00Z' });
    return outcome === 'lost' ? { data: null, error: { code: '', message: 'Respuesta perdida' } } : { data: trials.get(id), error: null };
    })();
    return Object.assign(result, { setHeader: (name: string, value: string) => { assert.equal(name, 'Authorization'); assert.equal(value, `Bearer token-${actor}`); return result; } });
  } } as unknown as SupabaseClient;
  return { storage, client, calls, trials, actor: (value: string) => { actor = value; }, outcome: (value: string) => { outcome = value; } };
}
const locks = { request: async (_key: string, _options: unknown, action: (lock: object) => unknown) => action({}) };
test('recipe trial retains exact payload after committed lost response and reload; new saves cannot replace it', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  try {
    const f = fixture();
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a', { values }), /perdida/);
    const persisted = readRecipeTrial(f.storage, 'a')!;
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a', { values: { ...values, name: 'Otro' } }), /pendiente/);
    assert.equal(f.calls.length, 1);
    f.outcome('ok');
    const recovered = await writeRecipeTrial(f.client, f.storage, 'a');
    assert.deepEqual(recovered.pending, persisted);
    assert.deepEqual(f.calls[1], f.calls[0]);
    assert.equal(f.trials.size, 1);
    assert.equal(readRecipeTrial(f.storage, 'a'), null);
  } finally { if (old) Object.defineProperty(globalThis, 'navigator', old); else Reflect.deleteProperty(globalThis, 'navigator'); }
});
test('recipe recovery isolates actors, retains permission uncertainty and releases hung waits', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  try {
    const f = fixture(); f.outcome('hang');
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a', { values }, 5), /conexión/);
    assert.ok(f.storage.getItem(recipeTrialKey('a')));
    f.actor('b');
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a'), /sesión/);
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'b'), /No hay/);
    assert.equal(f.calls.length, 1);
    f.actor('a'); f.outcome('permission');
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a'), /permiso/);
    assert.ok(readRecipeTrial(f.storage, 'a'));
    f.outcome('reject');
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a'), /Rechazado/);
    assert.equal(readRecipeTrial(f.storage, 'a'), null);
    f.storage.setItem = () => { throw new Error('Storage full'); };
    await assert.rejects(writeRecipeTrial(f.client, f.storage, 'a', { values }), /Storage full/);
    assert.equal(f.calls.length, 3);
  } finally { if (old) Object.defineProperty(globalThis, 'navigator', old); else Reflect.deleteProperty(globalThis, 'navigator'); }
});

test('recipe RPC pins the original actor token even if SDK authentication changes before fetch', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  try {
    const f = fixture(); let sent = false;
    const sdk = createClient('http://127.0.0.1:59999', 'fixture-anon', {
      accessToken: async () => 'new-account-token',
      global: { fetch: async (_url, init) => {
        sent = true;
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer original-account-token');
        const args = JSON.parse(String(init?.body));
        assert.ok(!f.storage.getItem(recipeTrialKey('a'))!.includes('token'));
        return new Response(JSON.stringify({ id: args.p_trial, recipe_id: args.p_recipe, number: 1,
          ingredients: args.p_ingredients, method: args.p_method, changes: args.p_changes, created_at: '2026-11-25T12:00:00Z' }), { headers: { 'Content-Type': 'application/json' } });
      } },
    });
    const client = { rpc: sdk.rpc.bind(sdk), auth: {
      getUser: async () => ({ data: { user: { id: 'a' } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: 'a' }, access_token: 'original-account-token' } }, error: null }),
    } } as unknown as SupabaseClient;
    await writeRecipeTrial(client, f.storage, 'a', { values });
    assert.equal(sent, true);
    client.auth.getSession = async () => ({ data: { session: { user: { id: 'b' }, access_token: 'other-account-token' } }, error: null }) as never;
    sent = false;
    await assert.rejects(writeRecipeTrial(client, f.storage, 'a', { values }), /sesión/);
    assert.equal(sent, false);
  } finally { if (old) Object.defineProperty(globalThis, 'navigator', old); else Reflect.deleteProperty(globalThis, 'navigator'); }
});
