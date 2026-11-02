import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as management from '../lib/user-management';
import { acknowledgeStaffPending, readStaffPending, saveStaffChange, StaffRequestUncertain, staffPendingKey } from '../lib/staff-requests';

const id = '00000000-0000-4000-8000-000000000001';
const person = { id, username: 'ana', role: 'cashier', avatar_url: '/staff-avatars/avatar-2.svg', is_active: true, password: 'new-test-password' };
function routeHarness(options: { profileError?: { message: string; code: string }; authError?: boolean } = {}) {
  const calls: unknown[] = [];
  const caller = { auth: { getUser: async () => ({ data: { user: { id: 'responsible' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'admin', is_active: true }, error: null }) }) }) }),
    rpc: async (name: string, args: unknown) => { calls.push(['profile', name, args]); return { error: options.profileError ?? null }; },
  } as unknown as SupabaseClient;
  const privileged = { auth: { admin: { updateUserById: async (target: string, args: unknown) => {
    calls.push(['password', target, args]); return { error: options.authError ? { message: 'Provider unavailable' } : null, data: { user: { id: target } } };
  } } } };
  const source = readFileSync(new URL('../app/api/users/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const require = (name: string) => {
    if (name === '@supabase/supabase-js') return { createClient: () => { calls.push(['privileged']); return privileged; } };
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/lib/supabase-server') return { serverSupabase: async () => caller };
    if (name === '@/lib/user-management') return management;
    throw new Error(name);
  };
  new Function('require', 'exports', compiled)(require, exports);
  return { calls, patch: (payload: unknown) => exports.PATCH({ json: async () => payload } as Request) };
}

test('actual staff PATCH changes Auth password only after the protected profile update succeeds', async () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-server-secret';
  try {
    const h = routeHarness(); const result = await h.patch(person);
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { success: true, password_changed: true });
    assert.deepEqual(h.calls, [['privileged'], ['profile', 'pos_manage_profile', {
      p_id: id, p_name: 'ana', p_username: 'ana', p_role: 'cashier', p_avatar: person.avatar_url, p_active: true,
    }], ['password', id, { password: person.password }]]);
    const denied = routeHarness({ profileError: { code: 'P0001', message: 'Cuenta con caja abierta' } });
    assert.equal((await denied.patch(person)).status, 400); assert.equal(denied.calls.some(call => (call as unknown[])[0] === 'password'), false);
  } finally { if (previous == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous; }
});

test('staff edit validates optional passwords, requires server configuration before mutations and reports partial failure', async () => {
  for (const password of ['123', 12345, 'x'.repeat(129)]) assert.throws(() => management.userInput({ ...person, password }, false));
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const missing = routeHarness(); assert.equal((await missing.patch(person)).status, 503); assert.deepEqual(missing.calls, []);
    const unchanged = routeHarness(); const result = await unchanged.patch({ ...person, password: '' });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { success: true, password_changed: false });
    assert.equal(unchanged.calls.length, 1);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-server-secret';
    const failed = await routeHarness({ authError: true }).patch(person); assert.equal(failed.status, 502);
    const body = await failed.json(); assert.equal(body.uncertain, true); assert.match(body.error, /perfil se guardó.*no se confirmó/i);
    assert.equal(JSON.stringify(body).includes(person.password), false);
  } finally { if (previous == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous; }
});

test('current staff editor uses revisioned profile-only RPC and never forwards its stale active flag', async () => {
  const h=routeHarness();
  const response=await h.patch({...person,password:'',management_revision:2});
  assert.equal(response.status,200);
  assert.deepEqual(h.calls,[['profile','pos_edit_staff_profile',{
    p_id:id,p_name:'ana',p_username:'ana',p_role:'cashier',p_avatar:person.avatar_url,p_revision:2,
  }]]);
  const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-server-secret';
  try {
    const denied=routeHarness({profileError:{code:'P0001',message:'El equipo cambió. Actualiza antes de guardar'}});
    assert.equal((await denied.patch({...person,management_revision:2})).status,400);
    assert.equal(denied.calls.some(call=>(call as unknown[])[0]==='password'),false);
  } finally {if(previous==null)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});

function storageHarness() {
  const values = new Map<string, string>();
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } };
}
const pending = { operation: 'create' as const, username: 'ana' };
test('lost staff responses survive reload, persist no password and block duplicate creation until reviewed', async () => {
  const h = storageHarness(); let calls = 0;
  const hung = (() => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch;
  await assert.rejects(saveStaffChange(h.storage, pending, person, { fetch: hung, timeoutMs: 10 }), StaffRequestUncertain);
  assert.deepEqual(readStaffPending(h.storage), pending); assert.equal(h.values.get(staffPendingKey)?.includes(person.password), false);
  await assert.rejects(saveStaffChange(h.storage, pending, person, { fetch: hung }), /sin confirmar/); assert.equal(calls, 1);
  acknowledgeStaffPending(h.storage);
  await saveStaffChange(h.storage, pending, person, { fetch: async () => Response.json({ success: true, user: { id } }) });
  assert.equal(readStaffPending(h.storage), null);
});

test('staff recovery distinguishes rejected writes from an unconfirmed password change', async () => {
  const h = storageHarness();
  await assert.rejects(saveStaffChange(h.storage, pending, person, { fetch: async () => Response.json({ error: 'Usuario inválido' }, { status: 400 }) }), /inválido/);
  assert.equal(readStaffPending(h.storage), null);
  const edit = { operation: 'edit' as const, username: 'ana', id };
  await assert.rejects(saveStaffChange(h.storage, edit, person, { fetch: async () => Response.json({ error: 'Perfil guardado, contraseña sin confirmar', uncertain: true }, { status: 502 }) }), StaffRequestUncertain);
  assert.deepEqual(readStaffPending(h.storage), edit);
  acknowledgeStaffPending(h.storage);
  // A stale API that silently ignores passwords must not produce a success UI.
  await assert.rejects(saveStaffChange(h.storage, edit, person, { fetch: async () => Response.json({ success: true }) }), /No se confirmaron los cambios/);
  assert.deepEqual(readStaffPending(h.storage), edit);
});

test('a storage failure prevents sending a staff change', async () => {
  const h = storageHarness(); let calls = 0;
  await assert.rejects(saveStaffChange({ ...h.storage, setItem: () => { throw Error('Storage unavailable'); } }, pending, person, { fetch: async () => { calls++; return Response.json({ success: true }); } }));
  assert.equal(calls, 0);
});
