import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedOrder } from './checkout';
import type { PrintJournal } from './print-journal-server';
import type { PrintConfig } from './windows-print-server';
import { AccessError, isAuthUnavailable } from './user-management';
import { readReceiptIssuer } from './receipt-issuer-server';

export function requireLocalPrintRequest(request: Request) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  // Next may normalize request.url to its listening hostname (localhost), while
  // Chrome used 127.0.0.1. Compare Origin to the actual loopback Host header.
  const authority = new URL(`${url.protocol}//${request.headers.get('host') || url.host}`);
  const local = ['127.0.0.1', 'localhost', '[::1]'];
  if (!local.includes(url.hostname) || !local.includes(authority.hostname)
    || (origin && origin !== authority.origin) || request.headers.get('x-pos-print') !== '1')
    throw new AccessError('La impresión automática solo está disponible desde esta caja local.', 403);
}

export async function handlePrintRequest(request: Request, client: SupabaseClient, journal: PrintJournal, config: PrintConfig) {
  requireLocalPrintRequest(request);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const { data: { user }, error } = await client.auth.getUser();
  if (isAuthUnavailable(error)) throw new AccessError('No se pudo comprobar la sesión de impresión.', 503);
  if (error || !user) throw new AccessError('Inicia sesión para consultar la impresión.', 401);
  const profile = await client.from('profiles').select('role,is_active').eq('id', user.id).abortSignal(signal).single();
  if (profile.error) throw new AccessError('No se pudo comprobar el perfil de impresión.', 503);
  if (!profile.data?.is_active || !['admin', 'cashier', 'barista'].includes(profile.data.role)) throw new AccessError('Sin acceso a impresión.', 403);
  if (request.method === 'GET') return { mode: config.mode, jobs: journal.list(user.id) };
  const raw = await request.text();
  if (raw.length > 1024) throw new AccessError('Solicitud de impresión inválida.', 400);
  let input;
  try { input = JSON.parse(raw); } catch { throw new AccessError('Solicitud de impresión inválida.', 400); }
  if (!input || typeof input.orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.orderId)
    || (input.audience !== undefined && !['customer', 'barista'].includes(input.audience))
    || Object.keys(input).some(key => !['orderId', 'audience'].includes(key))) throw new AccessError('Solicitud de impresión inválida.', 400);
  // Browser supplies only identity, never prices, preparation text, queue names or paths.
  const sale = await client.from('orders').select('id,ticket_number,status,cashier_id,receipt_snapshot').eq('id', input.orderId).abortSignal(signal).single();
  if (sale.error) throw new AccessError('No se pudo consultar la venta confirmada. Reintenta impresión; no vuelvas a cobrar.', sale.error.code === 'PGRST116' ? 404 : 503);
  if (!sale.data || sale.data.cashier_id !== user.id) throw new AccessError('La venta no pertenece a esta caja.', 403);
  if (sale.data.status !== 'completed') {
    if (['cancelled', 'canceled'].includes(sale.data.status)) journal.cancel(user.id, input.orderId);
    throw new AccessError('La venta no está completada. No se enviaron copias nuevas.', 409);
  }
  const order = { ...sale.data.receipt_snapshot, id: sale.data.id, ticket_number: sale.data.ticket_number, status: sale.data.status } as SavedOrder;
  let issuer;
  try { issuer = readReceiptIssuer(); }
  catch { /* The customer job is visibly withheld; a fiscal-config error must not stop barista instructions. */ }
  journal.ensure(user.id, order, config.queues, { issuer });
  return { mode: config.mode, jobs: await journal.dispatch(user.id, order.id, input.audience) };
}
