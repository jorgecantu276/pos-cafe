import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { localDemoAccess, webDemoContract } from '@/lib/operations-demo.mjs';
import { operationsDemoAuth } from '@/lib/operations-demo-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const access = await localDemoAccess(request, { post: true });
    const role = (await request.formData()).get('role');
    if (role !== 'admin' && role !== 'cashier') throw Error();
    const actor = access.actors[role];
    const response = NextResponse.redirect(new URL(role === 'admin' ? '/admin' : '/', webDemoContract(access.identity.product).app), 303);
    const client = createServerClient(access.config.api, access.config.anon, { ...operationsDemoAuth(access.config.api), cookies: {
      getAll: () => [], setAll: values => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    } });
    const { data, error } = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
    if (error || data.user?.id !== actor.id) throw Error();
    return response;
  } catch { return Response.json({ error: 'No se pudo abrir esta demostración.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }); }
}
