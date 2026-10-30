import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabase-server';
import { AccessError, createStaff, requireAdministrator, userInput } from '@/lib/user-management';

export async function POST(request: Request) {
  try {
    const caller = await serverSupabase();
    await requireAdministrator(caller);
    const input = userInput(await request.json(), true);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AccessError('Falta configurar la administración de usuarios en el servidor.', 503);
    const privileged = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const user = await createStaff(privileged, input);
    return NextResponse.json({ success: true, user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo crear el usuario.' }, { status: error instanceof AccessError ? error.status : 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const caller = await serverSupabase();
    await requireAdministrator(caller);
    const raw = await request.json();
    const input = userInput(raw, false);
    if (typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.id) || typeof raw.is_active !== 'boolean') throw new AccessError('Perfil inválido.', 400);
    const { error } = await caller.rpc('pos_manage_profile', {
      p_id: raw.id, p_name: input.full_name, p_username: raw.username,
      p_role: input.role, p_avatar: input.avatar_url, p_active: raw.is_active,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo guardar el usuario.' }, { status: error instanceof AccessError ? error.status : 400 });
  }
}
