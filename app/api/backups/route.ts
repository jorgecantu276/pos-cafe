import { serverSupabase } from '@/lib/supabase-server';
import { handleBusinessBackupRequest } from '@/lib/business-backup-server';
import { AccessError } from '@/lib/user-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try { return await handleBusinessBackupRequest(request, await serverSupabase()); }
  catch (error) {
    return Response.json({ error: error instanceof AccessError ? error.message : 'No se pudo consultar o crear el respaldo. Revisa la configuración con el responsable.' },
      { status: error instanceof AccessError ? error.status : 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } });
  }
}
export const GET = handle;
export const POST = handle;
