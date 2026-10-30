import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';

export class AccessError extends Error {
  constructor(message: string, public status: number, public uncertain = false) { super(message); }
}

export function isAuthUnavailable(error: { name?: string; status?: number } | null) {
  return !!error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status ?? 0) >= 500);
}

export async function requireAdministrator(client: SupabaseClient) {
  const { data: { user }, error } = await withDeadline(() => client.auth.getUser());
  if (isAuthUnavailable(error)) throw new AccessError('No se pudo comprobar el acceso. Intenta de nuevo.', 503);
  if (error || !user) throw new AccessError('Inicia sesión.', 401);
  const profile = await withDeadline(() => client.from('profiles').select('role,is_active').eq('id', user.id).single());
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
  if ((create || (v.password != null && v.password !== '')) && (typeof v.password !== 'string' || v.password.length < 8 || v.password.length > 128)) throw new AccessError('Usa una contraseña de 8 a 128 caracteres.', 400);
  return { full_name: v.full_name.trim(), username: v.username.toLowerCase(), role: v.role, avatar_url: (v.avatar_url as string) || null, password: (v.password as string) || '' };
}

export async function createStaff(client: SupabaseClient, input: ReturnType<typeof userInput>) {
  const { data, error } = await client.auth.admin.createUser({ email: `${input.username}@carinitomio.local`, password: input.password, email_confirm: true });
  if (error || !data.user) throw new AccessError('No se pudo crear el acceso. Revisa si el usuario ya existe.', error && error.status && error.status < 500 ? 409 : 502, !(error && error.status && error.status < 500));
  const profile = await client.from('profiles').insert({ id: data.user.id, full_name: input.full_name, username: input.username, role: input.role, avatar_url: input.avatar_url, is_active: true });
  if (profile.error) {
    const cleanup = await client.auth.admin.deleteUser(data.user.id);
    if (cleanup.error) throw new Error(`Perfil no guardado; el responsable debe revisar el acceso ${data.user.id}. No repitas la creación.`);
    throw new Error('No se guardó el perfil. El acceso incompleto fue eliminado.');
  }
  return { id: data.user.id };
}

// Profile and Auth are separate services: never report a password change unless
// Auth confirms it, and explain a partial result instead of inviting a blind retry.
export async function updateStaff(caller: SupabaseClient, privileged: SupabaseClient | null, id: string, active: boolean, input: ReturnType<typeof userInput>) {
  if (input.password && !privileged) throw new AccessError('Falta configurar la administración de usuarios en el servidor. No se guardó ningún cambio.', 503);
  const profile = await withDeadline(() => caller.rpc('pos_manage_profile', {
    p_id: id, p_name: input.full_name, p_username: input.username,
    p_role: input.role, p_avatar: input.avatar_url, p_active: active,
  }));
  if (profile.error) throw new AccessError(profile.error.message, ['P0001', '42501', '23505'].includes(profile.error.code) ? 400 : 502,
    !['P0001', '42501', '23505'].includes(profile.error.code));
  if (input.password) {
    try {
      const updated = await privileged!.auth.admin.updateUserById(id, { password: input.password });
      if (updated.error || updated.data.user?.id !== id) throw new Error('Auth did not confirm');
    } catch {
      throw new AccessError('El perfil se guardó, pero no se confirmó el cambio de contraseña. Verifica el acceso antes de repetir el cambio.', 502, true);
    }
  }
  return { password_changed: Boolean(input.password) };
}

// Bound provider calls; expiration cannot establish whether a write committed.
export const staffProviderFetch: typeof fetch = (input, init) => fetch(input, { ...init,
  signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
});
