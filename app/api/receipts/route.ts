import { serverSupabase } from '@/lib/supabase-server';
import { handleReceiptRequest } from '@/lib/receipt-reprint-server';
import { AccessError } from '@/lib/user-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
export async function GET(request: Request) {
  try { return Response.json(await handleReceiptRequest(request, await serverSupabase()), { headers }); }
  catch (error) {
    return Response.json({ error: error instanceof AccessError ? error.message : 'No se pudo recuperar el comprobante. Revisa la conexión y la configuración del emisor.' },
      { status: error instanceof AccessError ? error.status : 503, headers });
  }
}
