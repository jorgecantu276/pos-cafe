import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedOrder } from './checkout';
import type { PrintJournal } from './print-journal-server';
import type { PrintConfig } from './windows-print-server';
import { AccessError, isAuthUnavailable } from './user-management';
import { readReceiptIssuer } from './receipt-issuer-server';
import { withDeadline } from './request-deadline';
import {dispatchPhonePreparation,ensurePhonePreparation,readPhonePreparation} from './phone-preparation-server';

export function requireLocalPrintRequest(request: Request) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  // Next may normalize request.url to its listening hostname (localhost), while
  // Chrome used 127.0.0.1. Compare Origin to the actual loopback Host header.
  const authority = new URL(`${url.protocol}//${request.headers.get('host') || url.host}`);
  const local = ['127.0.0.1', 'localhost', '[::1]'];
  if (!local.includes(url.hostname) || !local.includes(authority.hostname)
    || (origin && origin !== authority.origin) || request.headers.get('x-pos-print') !== '1')
    throw new AccessError('Abre el POS en la PC de caja para imprimir automáticamente.', 403);
}

export async function handlePrintRequest(request: Request, client: SupabaseClient, journal: PrintJournal, config: PrintConfig) {
  requireLocalPrintRequest(request);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const { data: { user }, error } = await withDeadline(() => client.auth.getUser(), { signal });
  if (isAuthUnavailable(error)) throw new AccessError('No se pudo comprobar la sesión de impresión.', 503);
  if (error || !user) throw new AccessError('Inicia sesión para consultar la impresión.', 401);
  const profile = await withDeadline(() => client.from('profiles').select('role,is_active').eq('id', user.id).abortSignal(signal).single(), { signal });
  if (profile.error) throw new AccessError('No se pudo comprobar el perfil de impresión.', 503);
  if (!profile.data?.is_active || !['admin', 'cashier', 'barista'].includes(profile.data.role)) throw new AccessError('Sin acceso a impresión.', 403);
  const administrator = profile.data.role === 'admin';
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'scope') || (params.has('scope') && params.get('scope') !== 'all'))
      throw new AccessError('Consulta de impresión inválida.',400);
    if (params.get('scope') === 'all') {
      if (!administrator) throw new AccessError('El responsable debe revisar las copias de otros cajeros.',403);
      const jobs = journal.listAll(), history = journal.recoveryHistory();
      // Hardware acceptance shares this preserved journal, but its local owner
      // and review identities are not Supabase UUIDs. Keep those rows/history;
      // sending them to profiles.id would reject the entire manager read.
      const ids = [...new Set([...jobs.map(job => job.cashierId),...history.flatMap(item=>[item.owner,item.actor])])]
        .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const names = ids.length ? await withDeadline(() => client.from('profiles').select('id,full_name').in('id',ids).abortSignal(signal),{signal}) : {data:[],error:null};
      if (names.error) throw new AccessError('No se pudieron consultar los nombres de los cajeros. Actualiza la lista.',503);
      return { mode: config.mode, canManage: true, actorId: user.id, jobs, history, cashiers:names.data??[] };
    }
    return { mode: config.mode, canManage: administrator, jobs: journal.listRegister(user.id) };
  }
  const raw = await request.text();
  if (raw.length > 1024) throw new AccessError('Solicitud de impresión inválida.', 400);
  let input;
  try { input = JSON.parse(raw); } catch { throw new AccessError('Solicitud de impresión inválida.', 400); }
  if (!input || typeof input.orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.orderId)
    || (input.audience !== undefined && !['customer', 'barista'].includes(input.audience))
    || (input.action !== undefined && !['retry','confirm_printed','replace_missing'].includes(input.action))
    || Object.keys(input).some(key => !['orderId', 'audience','action','requestId','reason','confirmed'].includes(key))) throw new AccessError('Solicitud de impresión inválida.', 400);
  const recovery = input.action !== undefined;
  if (recovery && (!administrator || !input.audience)) throw new AccessError('Solo el responsable puede revisar una copia. Selecciona el ticket o la etiqueta.',403);
  if (recovery && (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
    || typeof input.reason !== 'string' || input.reason.trim().length<10 || input.reason.length>300
    || (input.action !== 'retry' && input.confirmed !== true))) throw new AccessError('Confirma que revisaste el papel y la cola de Windows. Escribe un motivo de 10 a 300 caracteres.',400);
  if (!recovery && ['requestId','reason','confirmed'].some(key => key in input)) throw new AccessError('Solicitud de impresión inválida.',400);
  // Browser supplies only identity, never prices, preparation text, queue names or paths.
  const sale = await withDeadline(() => client.from('orders').select('id,ticket_number,status,cashier_id,receipt_snapshot').eq('id', input.orderId).abortSignal(signal).single(), { signal });
  if (sale.error) throw new AccessError('No se pudo consultar la venta. Actualiza la impresión; no vuelvas a cobrar.', sale.error.code === 'PGRST116' ? 404 : 503);
  if (!sale.data || (sale.data.cashier_id !== user.id && !administrator)) throw new AccessError('La venta no pertenece a esta caja.', 403);
  const owner = sale.data.cashier_id;
  if (owner !== user.id && (!recovery || !journal.get(owner,input.orderId).length))
    throw new AccessError('El responsable puede recuperar copias existentes desde Administración → Impresión.',403);
  if (recovery && !journal.get(owner,input.orderId).some(job => job.audience === input.audience))
    throw new AccessError('No existe esta copia en el registro local.',409);
  if (recovery && input.action === 'confirm_printed' && ['completed','cancelled','canceled'].includes(sale.data.status)) {
    try { journal.authorizeRecovery({ requestId: input.requestId,actor: user.id,owner,orderId: input.orderId,audience: input.audience,action:input.action,reason:input.reason.trim() }); }
    catch (error) { throw new AccessError(error instanceof Error ? error.message : 'No se pudo resolver esta copia.',409); }
    return { mode: config.mode,canManage: administrator,jobs:journal.get(owner,input.orderId) };
  }
  if (sale.data.status !== 'completed') {
    if (['cancelled', 'canceled'].includes(sale.data.status)) journal.cancel(owner, input.orderId);
    throw new AccessError('La venta no está completada. No se enviaron copias nuevas.', 409);
  }
  const order = { ...sale.data.receipt_snapshot, id: sale.data.id, ticket_number: sale.data.ticket_number, status: sale.data.status } as SavedOrder;
  let issuer;
  try { issuer = readReceiptIssuer(); }
  catch { /* The customer job is visibly withheld; a fiscal-config error must not stop barista instructions. */ }
  // A saving cashier may have lost the response before recording a local print
  // intent. Payment must also establish that original preparation in this journal.
  const phoneSale=typeof sale.data.receipt_snapshot?.phone_order_id==='string';
  if(phoneSale&&input.audience==='barista')throw new AccessError('La preparación del pedido está en su comanda por teléfono.',409);
  journal.ensure(owner, order, config.queues, { issuer },phoneSale?'customer':undefined);
  const preparation=phoneSale&&!recovery?await readPhonePreparation(client,order.phone_order_id!,request.signal):null;
  if(preparation){
    if(preparation.status!=='paid'||preparation.paid_order_id!==order.id||preparation.paid_sale_status!=='completed')throw new AccessError('No se pudo confirmar el pedido pagado antes de imprimir.',409);
    ensurePhonePreparation(journal,preparation,config);
  }
  if (recovery) {
    try { journal.authorizeRecovery({ requestId: input.requestId,actor: user.id,owner,orderId: input.orderId,audience: input.audience,action:input.action,reason:input.reason.trim() }); }
    catch (error) { throw new AccessError(error instanceof Error ? error.message : 'No se pudo resolver esta copia.',409); }
  }
  const [jobs]=await Promise.all([journal.dispatch(owner, order.id, phoneSale?'customer':input.audience, async () => {
    const guardSignal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    const current = await withDeadline(() => client.from('orders').select('status,cashier_id').eq('id', order.id).abortSignal(guardSignal).single(), { signal: guardSignal });
    if (current.error || !current.data || current.data.cashier_id !== owner)
      throw new Error('No se pudo comprobar la venta. Reintenta esta copia; no vuelvas a cobrar.');
    return current.data.status === 'completed';
  }),preparation?dispatchPhonePreparation(client,journal,preparation,request.signal):Promise.resolve()]);
  return { mode: config.mode, canManage: administrator,...(phoneSale?{expectedCopies:1}:{}),jobs};
}
