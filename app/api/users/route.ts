import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { full_name, username, password, role, avatar_url } = body;

    // Usamos la llave maestra para saltarnos las reglas y NO cerrar tu sesión activa
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Supabase exige un correo obligatorio. Como quieres iniciar sesión con "Usuario",
    // le inventamos un correo interno automático para engañar al sistema.
    const fakeEmail = `${username.replace(/\s+/g, '').toLowerCase()}@carinitomio.local`;

    // 1. Crear usuario en la bóveda de Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: fakeEmail,
      password: password,
      email_confirm: true, // Auto-confirmado para que puedan entrar de inmediato
    });

    if (authError) throw authError;

    // 2. Crear su perfil visible en tu tabla de "profiles"
    // Usamos 'upsert' por si tienes algún trigger que ya haya creado la fila
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert([{
      id: authData.user.id,
      full_name,
      username,
      role,
      avatar_url
    }]);

    if (profileError) throw profileError;

    return NextResponse.json({ success: true, user: authData.user });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}