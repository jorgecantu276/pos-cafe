import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelLegacySale } from '../lib/cancellation';

test('cancellation uses the administrator transaction, never a browser table update', async () => {
  let calls=0;
  const client={rpc:async(name:string,args:unknown)=>{calls++;assert.equal(name,'pos_cancel_sale');assert.deepEqual(args,{p_order:'order'});return {error:null};}} as unknown as Pick<SupabaseClient,'rpc'>;
  await cancelLegacySale(client,'order');assert.equal(calls,1);
});
test('denied cancellation surfaces the database error', async () => {
  const client={rpc:async()=>({error:{message:'Administrator required'}})} as unknown as Pick<SupabaseClient,'rpc'>;
  await assert.rejects(cancelLegacySale(client,'order'),/Administrator required/);
});
