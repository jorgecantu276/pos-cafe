import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabasePublicKey } from './supabase-public-config';
import { operationsDemoAuth } from './operations-demo-auth';

export async function serverSupabase() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabasePublicKey(), {
    ...operationsDemoAuth(process.env.NEXT_PUBLIC_SUPABASE_URL!),
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); }
        catch { /* Server Components are read-only; middleware refreshes cookies. */ }
      },
    },
  });
}
