import { createClient } from '@supabase/supabase-js';
import { serverSupabase } from '@/lib/supabase-server';
import { ClipGateway, ClipNotSent, clipProviderId, clipRpc, clipStaff } from '@/lib/clip-server';
import { clipSettings } from '@/lib/clip-config';
import { AccessError } from '@/lib/user-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (data: unknown, status = 200) => Response.json(data, {status,headers:{'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie'}});
function service() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AccessError('Falta configurar el servicio de pagos.', 503);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
}
const failure = (error: unknown) => reply({error:error instanceof AccessError ? error.message : 'No se confirmó el pago. Consulta el mismo pago antes de continuar.',...(error instanceof ClipNotSent ? {notSent:true} : {})},error instanceof AccessError ? error.status : 503);
export async function POST(request: Request) {
  try {
    const caller = await serverSupabase(), actor = await clipStaff(caller);
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new AccessError('Origen de solicitud inválido.',403);
    const raw = await request.text();
    if (raw.length > 256_000) throw new AccessError('Pedido demasiado grande.',400);
    const body = JSON.parse(raw);
    if (!body || typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new AccessError('Pago inválido.',400);
    const db = service(), gateway = new ClipGateway(db);
    if (body.action === 'reconcile') {
      if (!actor.admin) throw new AccessError('Revisión exclusiva del responsable.',403);
      if (!clipProviderId(body.providerId)) throw new AccessError('Identificador CLIP inválido.',400);
      return reply(await gateway.status(body.requestId,null,body.providerId));
    }
    if (body.action !== undefined || !body.payload || body.payload.payment_method !== 'tarjeta') throw new AccessError('Pedido CLIP inválido.',400);
    // Existing payments remain recoverable by GET even after switching integration off.
    if (!clipSettings().enabled) throw new AccessError('CLIP aún no está configurado o activado.',503);
    await clipRpc(caller,'pos_clip_prepare',{p_request:body.requestId,p_payload:body.payload});
    return reply(await gateway.start(body.requestId,actor.id));
  } catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  try {
    const caller = await serverSupabase(), actor = await clipStaff(caller);
    const requestId = new URL(request.url).searchParams.get('request');
    if (!requestId) {
      if (!actor.admin) throw new AccessError('Revisión exclusiva del responsable.',403);
      return reply({enabled:clipSettings().enabled,payments:await clipRpc(caller,'pos_clip_pending',{})});
    }
    return reply(await new ClipGateway(service()).status(requestId,actor.admin ? null : actor.id));
  } catch (error) { return failure(error); }
}
