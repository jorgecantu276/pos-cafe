import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabase-server';
import { AccessError, createStaff, requireAdministrator, staffProviderFetch, updateStaff, userInput } from '@/lib/user-management';

export async function POST(request: Request) {
  try {
    const caller = await serverSupabase();
    await requireAdministrator(caller);
    const input = userInput(await request.json(), true);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AccessError('Falta configurar la administración de usuarios en el servidor.', 503);
    const privileged = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: staffProviderFetch } });
    const user = await createStaff(privileged, input);
    return NextResponse.json({ success: true, user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo crear el usuario.', uncertain: error instanceof AccessError ? error.uncertain : true }, { status: error instanceof AccessError ? error.status : 502 });
  }
}

export async function PATCH(request: Request) {
  try {
    const caller = await serverSupabase();
    await requireAdministrator(caller);
    const raw = await request.json();
    const input = userInput(raw, false);
    if (typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.id) || typeof raw.is_active !== 'boolean') throw new AccessError('Perfil inválido.', 400);
    if (input.password && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AccessError('Falta configurar la administración de usuarios en el servidor. No se guardó ningún cambio.', 503);
    const privileged = input.password ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: staffProviderFetch },
    }) : null;
    const result = await updateStaff(caller, privileged, raw.id, raw.is_active, input);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo guardar el usuario.', uncertain: error instanceof AccessError ? error.uncertain : true }, { status: error instanceof AccessError ? error.status : 502 });
  }
}
