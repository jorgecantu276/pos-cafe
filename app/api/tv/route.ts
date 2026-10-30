import { serverSupabase } from '@/lib/supabase-server';
import { loadTvSnapshot } from '@/lib/tv-dashboard-server';
import { AccessError } from '@/lib/user-management';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    const snapshot = await loadTvSnapshot(await serverSupabase(), signal);
    return Response.json(snapshot, { headers });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 503;
    return Response.json({ error: status === 401 ? 'Inicia sesión para continuar.'
      : status === 403 ? 'Acceso exclusivo del administrador.' : 'No se pudo actualizar. Reintentando automáticamente.' }, { status, headers });
  }
}
