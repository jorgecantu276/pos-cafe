import type { SupabaseClient } from '@supabase/supabase-js';

export class AccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function isAuthUnavailable(error: { name?: string; status?: number } | null) {
  return !!error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status ?? 0) >= 500);
}

export async function requireAdministrator(client: SupabaseClient) {
  const { data: { user }, error } = await client.auth.getUser();
  if (isAuthUnavailable(error)) throw new AccessError('No se pudo comprobar el acceso. Intenta de nuevo.', 503);
  if (error || !user) throw new AccessError('Inicia sesión.', 401);
  const profile = await client.from('profiles').select('role,is_active').eq('id', user.id).single();
  if (profile.error && !['PGRST116', '42501'].includes(profile.error.code)) {
    throw new AccessError('No se pudo comprobar el acceso. Intenta de nuevo.', 503);
  }
  if (profile.error || profile.data?.role !== 'admin' || profile.data?.is_active !== true) throw new AccessError('Acceso exclusivo del administrador.', 403);
}

export function userInput(value: unknown, create: boolean) {
  if (!value || typeof value !== 'object') throw new AccessError('Datos inválidos.', 400);
  const v = value as Record<string, unknown>;
  if (typeof v.full_name !== 'string' || !v.full_name.trim() || v.full_name.length > 100
    || typeof v.username !== 'string' || !/^[a-zA-Z0-9._-]{1,50}$/.test(v.username)
    || typeof v.role !== 'string' || !['admin', 'barista', 'cashier'].includes(v.role)
    || (v.avatar_url != null && (typeof v.avatar_url !== 'string' || v.avatar_url.length > 2000
      || (v.avatar_url !== '' && !/^https:\/\//i.test(v.avatar_url))))) throw new AccessError('Revisa nombre, usuario, rol y foto HTTPS.', 400);
  if (create && (typeof v.password !== 'string' || v.password.length < 8 || v.password.length > 128)) throw new AccessError('Usa una contraseña de 8 a 128 caracteres.', 400);
  return { full_name: v.full_name.trim(), username: v.username.toLowerCase(), role: v.role, avatar_url: (v.avatar_url as string) || null, password: v.password as string };
}

export async function createStaff(client: SupabaseClient, input: ReturnType<typeof userInput>) {
  const { data, error } = await client.auth.admin.createUser({ email: `${input.username}@carinitomio.local`, password: input.password, email_confirm: true });
  if (error || !data.user) throw new Error('No se pudo crear el acceso. Revisa si el usuario ya existe.');
  const profile = await client.from('profiles').insert({ id: data.user.id, full_name: input.full_name, username: input.username, role: input.role, avatar_url: input.avatar_url, is_active: true });
  if (profile.error) {
    const cleanup = await client.auth.admin.deleteUser(data.user.id);
    if (cleanup.error) throw new Error(`Perfil no guardado; el responsable debe revisar el acceso ${data.user.id}. No repitas la creación.`);
    throw new Error('No se guardó el perfil. El acceso incompleto fue eliminado.');
  }
  return { id: data.user.id };
}
