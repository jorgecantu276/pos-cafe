import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdministrator, createStaff, userInput } from '../lib/user-management';

function caller(user: boolean, role: string, active = true) {
  return { auth: { getUser: async () => ({ data: { user: user ? { id: 'caller' } : null }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role, is_active: active }, error: null }) }) }) }),
  } as unknown as SupabaseClient;
}
test('user-management boundary refuses anonymous, operational and deactivated accounts', async () => {
  for (const client of [caller(false,'admin'), caller(true,'cashier'), caller(true,'barista'), caller(true,'admin',false)]) await assert.rejects(requireAdministrator(client));
  await requireAdministrator(caller(true,'admin'));
});
test('user creation validates roles, login identity, password and avatar URL', () => {
  const input={full_name:'Ana',username:'ana.cm',password:'test-only-password',role:'barista',avatar_url:''};
  assert.equal(userInput(input,true).username,'ana.cm');
  for (const altered of [{role:'owner'},{username:'ana @host'},{password:'123'},{avatar_url:'javascript:alert(1)'}]) assert.throws(()=>userInput({...input,...altered},true));
});
test('profile insert failure removes the incomplete Auth account and exposes no password', async () => {
  let deleted='';
  const client={auth:{admin:{createUser:async()=>({data:{user:{id:'new-user'}},error:null}),deleteUser:async(id:string)=>{deleted=id;return {error:null};}}},from:()=>({insert:async()=>({error:{message:'database unavailable'}})})} as unknown as SupabaseClient;
  await assert.rejects(createStaff(client,userInput({full_name:'Ana',username:'ana',password:'test-password',role:'barista'},true)),/incompleto fue eliminado/);
  assert.equal(deleted,'new-user');
});
