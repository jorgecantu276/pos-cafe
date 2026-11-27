import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedOrder } from './checkout';
import { saleDocuments, validReceiptIssuer, type ReceiptOptions, type SalePrintDocument } from './sale-printing';
import { AccessError, isAuthUnavailable } from './user-management';
import { withDeadline } from './request-deadline';
import { readReceiptIssuer } from './receipt-issuer-server';
import { printConfig } from './windows-print-server';
import type { SaleItem } from './pos-types';

function legacyReceipt(sale: { id: string; ticket_number: number; total: number; created_at: string; payment_method: string | null;
  tender_mxn: number | null; tender_usd: number | null; card_amount_mxn?: number | null; exchange_rate: number | null; change_mxn: number | null; order_items: SaleItem[] }, options: ReceiptOptions) {
  if (!sale.order_items?.length || sale.order_items.some(i => !Number.isFinite(Number(i.unit_price)) || !Number.isFinite(Number(i.total_price))
    || Math.round(Number(i.unit_price) * i.quantity * 100) !== Math.round(Number(i.total_price) * 100)))
    throw new AccessError('Esta venta antigua requiere conciliación del responsable.', 409);
  const order: SavedOrder = { id: sale.id, ticket_number: sale.ticket_number, total: Number(sale.total), status: 'completed', created_at: sale.created_at,
    customer_name: 'No registrado en el comprobante original', order_type: 'Tipo de entrega no registrado', order_note: '',
    payment_method: sale.payment_method || 'No registrado', tender_mxn: Number(sale.tender_mxn ?? 0), tender_usd: Number(sale.tender_usd ?? 0),
    card_amount_mxn: sale.card_amount_mxn == null ? undefined : Number(sale.card_amount_mxn),
    exchange_rate: Number(sale.exchange_rate ?? 0), change_mxn: Number(sale.change_mxn ?? 0),
    items: sale.order_items.map((item, index) => ({ id: String(index), quantity: item.quantity, product: {
      id: item.product_id || String(index), name: item.product_snapshot?.name || 'Producto histórico no identificado', price: Number(item.unit_price),
      category: '', note: item.notes || '',
    } })) };
  const document = saleDocuments(order, options).customer;
  document.sections[0] = document.sections[0].map(line => {
    if (sale.tender_mxn == null && line.startsWith('Recibido MXN:')) return 'Recibido MXN: no registrado';
    if (sale.change_mxn == null && line.startsWith('Cambio:')) return 'Cambio: no registrado';
    return line;
  });
  return document;
}

// Read the original local document without creating or changing its journal.
export function storedCustomerReceipt(owner: string, orderId: string): SalePrintDocument | undefined {
  if (!['mock', 'windows'].includes(process.env.POS_PRINT_MODE ?? '')) return undefined;
  const config = printConfig();
  const filename = path.join(config.directory, `${config.mode}-jobs.sqlite`);
  if (!existsSync(filename)) return undefined;
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const row = db.prepare("SELECT document FROM jobs WHERE owner=? AND order_id=? AND audience='customer'").get(owner, orderId) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as SalePrintDocument : undefined;
  } finally { db.close(); }
}

export async function handleReceiptRequest(request: Request, client: SupabaseClient,
  options: { stored?: typeof storedCustomerReceipt; issuer?: () => ReceiptOptions['issuer'] } = {}) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const { data: { user }, error } = await withDeadline(() => client.auth.getUser(), { signal });
  if (isAuthUnavailable(error)) throw new AccessError('No se pudo comprobar el acceso.', 503);
  if (error || !user) throw new AccessError('Inicia sesión.', 401);
  const profile = await withDeadline(() => client.from('profiles').select('role,is_active').eq('id', user.id).abortSignal(signal).single(), { signal });
  if (profile.error) throw new AccessError('No se pudo comprobar el perfil.', 503);
  if (!profile.data?.is_active || !['admin', 'cashier', 'barista'].includes(profile.data.role)) throw new AccessError('Sin acceso a comprobantes.', 403);
  const params = new URL(request.url).searchParams;
  const id = params.get('orderId'), ticket = params.get('ticketNumber');
  if ([...params.keys()].some(k => !['orderId', 'ticketNumber'].includes(k)) || (id && ticket)
    || (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || (ticket !== null && !/^[1-9]\d{0,14}$/.test(ticket))) throw new AccessError('Folio inválido.', 400);
  let query = client.from('orders').select('*,order_items(product_id,quantity,unit_price,total_price,notes,product_snapshot)');
  if (profile.data.role !== 'admin') query = query.eq('cashier_id', user.id);
  if (id) query = query.eq('id', id);
  else if (ticket) query = query.eq('ticket_number', ticket);
  else query = query.order('created_at', { ascending: false }).limit(1);
  const sale = await withDeadline(() => query.abortSignal(signal).single(), { signal });
  if (sale.error) throw new AccessError('Ticket no encontrado o no disponible.', sale.error.code === 'PGRST116' ? 404 : 503);
  if (!sale.data || (profile.data.role !== 'admin' && sale.data.cashier_id !== user.id)) throw new AccessError('Sin acceso a este ticket.', 403);
  if (!['completed', 'cancelled', 'canceled'].includes(sale.data.status)) throw new AccessError('Venta pendiente de revisión; no se puede emitir un ticket de venta.', 409);
  let document = (options.stored ?? storedCustomerReceipt)(sale.data.cashier_id, sale.data.id);
  let source: 'stored' | 'snapshot' | 'legacy' = 'stored';
  if (!document || !document.issuerComplete || document.testOnly) {
    const issuer = (options.issuer ?? readReceiptIssuer)();
    if (!validReceiptIssuer(issuer)) throw new AccessError('Configura los datos fiscales del emisor para reimprimir.', 503);
    // The immutable sale snapshot is still the source when no original local
    // document exists (for example, reprinting from another POS installation).
    if (sale.data.receipt_snapshot) {
      const order = { ...sale.data.receipt_snapshot, id: sale.data.id, ticket_number: sale.data.ticket_number, status: 'completed' } as SavedOrder;
      document = saleDocuments(order, { issuer }).customer;
      source = 'snapshot';
    } else {
      document = legacyReceipt(sale.data, { issuer });
      source = 'legacy';
    }
  }
  return { document, source, status: sale.data.status, ticket: String(sale.data.ticket_number) };
}
