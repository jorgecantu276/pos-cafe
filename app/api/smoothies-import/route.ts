import { posProfile } from '@/lib/pos-profile';
import { createClient } from '@supabase/supabase-js';
import { serverSupabase } from '@/lib/supabase-server';
import { AccessError, requireAdministrator } from '@/lib/user-management';
import { parseSmoothiesForm } from '@/lib/smoothies-import';

const maxBytes = 24_000_000;
const loopback = ['127.0.0.1','localhost','[::1]'];

export async function POST(request: Request) {
  if (posProfile.id !== 'smoothies') return new Response(null, { status: 404 });
  try {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    const authority = new URL(`${url.protocol}//${request.headers.get('host') || url.host}`);
    if (!loopback.includes(url.hostname) || !loopback.includes(authority.hostname)
      || (origin && origin !== authority.origin) || request.headers.get('x-pos-import') !== '1') {
      throw new AccessError('Abre la importación desde el catálogo del POS.', 403);
    }
    const caller = await serverSupabase();
    await requireAdministrator(caller);
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new AccessError('Inicia sesión.', 401);
    const endpoint = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !key) {
      throw new AccessError('El importador requiere la base local de smoothies.', 503);
    }
    if (Number(request.headers.get('content-length')) > maxBytes || !request.body) throw new AccessError('El archivo es demasiado grande o está vacío.', 400);
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let raw = '';
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AccessError('El archivo es demasiado grande.', 400);
      }
      raw += decoder.decode(value, {stream:true});
    }
    raw += decoder.decode();
    let data;
    try {
      data = parseSmoothiesForm(JSON.parse(raw));
    } catch (error) {
      throw new AccessError(error instanceof SyntaxError ? 'Selecciona el archivo JSON que descargaste del formulario.' : (error as Error).message, 400);
    }
    const service = createClient(endpoint.origin, key, {auth:{autoRefreshToken:false,persistSession:false}});
    const result = await service.rpc('pos_import_smoothies', {p_actor:user.id,p_data:data});
    if (result.error) {
      if (result.error.code === 'P0001') throw new AccessError(result.error.message, 409);
      throw new AccessError('No se confirmó la importación. Puedes volver a cargar el mismo archivo.', 503);
    }
    if (typeof result.data?.unchanged !== 'boolean') throw new AccessError('No se confirmó la importación. Puedes volver a cargar el mismo archivo.', 503);
    return Response.json(result.data);
  } catch (error) {
    return Response.json({error: error instanceof AccessError ? error.message : 'No se pudo cargar el formulario.'},
      {status:error instanceof AccessError ? error.status : 500});
  }
}
