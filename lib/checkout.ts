import type { SupabaseClient } from '@supabase/supabase-js';
import type { CartItem } from '../store/useCartStore';
import { withDeadline } from './request-deadline';

export interface CheckoutPayload {
  register_id: string;
  items: { product_id: string; quantity: number; extra_ids: string[]; note: string }[];
  expected_total: number;
  payment_method: string;
  tender_mxn: number;
  tender_usd: number;
  customer_id: string | null;
  order_type: string;
  order_note: string;
  pager_number?: number | null;
}
export interface SavedOrder {
  pager_number?: number | null;
  id: string;
  ticket_number: number | string;
  status: string;
  items: CartItem[];
  total: number;
  customer_name: string;
  order_type: string;
  order_note: string;
  created_at: string;
  payment_method: string;
  tender_mxn: number;
  tender_usd: number;
  exchange_rate: number;
  change_mxn: number;
}
export interface CheckoutReview {
  provider?: 'clip';
  startedAt: string;
  total: number;
  orderId?: string;
  ticketNumber?: number | string;
  requestId?: string;
  payload?: CheckoutPayload;
}
export class CheckoutRejected extends Error {}
export class ClipPaymentPending extends Error {}
export async function withCheckoutLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Actualiza Chrome o Edge para cobrar.');
  return navigator.locks.request(`pos-checkout:${key}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Esta venta está abierta en otra ventana. Compruébala allí antes de cobrar.');
    return action();
  });
}
export function readCheckoutReview(raw: string | null): CheckoutReview | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('startedAt' in value) || typeof value.startedAt !== 'string'
    || !('total' in value) || typeof value.total !== 'number' || !Number.isFinite(value.total)
    || ('provider' in value && value.provider !== 'clip')) throw new Error('No se pudo abrir la venta pendiente. Pide ayuda al responsable antes de cobrar.');
  return value as CheckoutReview;
}
export function checkoutPayload(items: readonly CartItem[], fields: Omit<CheckoutPayload, 'items'>): CheckoutPayload {
  if (fields.pager_number != null && (!Number.isInteger(fields.pager_number) || fields.pager_number < 1 || fields.pager_number > 30)) throw new Error('El control debe ser del 1 al 30.');
  if (!items.length || items.some(i => !Number.isInteger(i.quantity) || i.quantity < 1
    || (i.product.displayExtras ?? []).some(e => !e.id))) throw new Error('Revisa las cantidades y vuelve a seleccionar los extras del catálogo.');
  return { ...fields, items: items.map(i => ({ product_id: i.product.id, quantity: i.quantity,
    extra_ids: (i.product.displayExtras ?? []).map(e => e.id!), note: i.product.note?.trim() || '' })) };
}
// Exactly one RPC; prices, points and order writes remain server-authoritative.
export async function executeCheckout(client: Pick<SupabaseClient, 'rpc'>, pending: CheckoutReview, timeoutMs = 12_000): Promise<SavedOrder> {
  if (!pending.requestId || !pending.payload) throw new Error('Esta venta necesita revisión del responsable. No vuelvas a cobrar.');
  if (pending.provider === 'clip') {
    const signal = AbortSignal.timeout(timeoutMs + 12_000);
    // Recovery reads first: a completed payment stays recoverable even if CLIP is disabled later.
    const lookup = await withDeadline(() => fetch(`/api/payments/clip?request=${encodeURIComponent(pending.requestId!)}`, {cache:'no-store',signal}), {signal});
    let response = lookup;
    if (lookup.status === 404) response = await withDeadline(() => fetch('/api/payments/clip', {method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:pending.requestId,payload:pending.payload})}), {signal});
    else if (lookup.ok) {
      const existing = await withDeadline(() => lookup.clone().json(), {signal});
      if (existing.state === 'prepared') response = await withDeadline(() => fetch('/api/payments/clip', {method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:pending.requestId,payload:pending.payload})}), {signal});
    }
    const reply = await withDeadline(() => response.json(), {signal});
    if (!response.ok && reply.notSent === true) throw new CheckoutRejected(reply.error || 'Revisa el pedido antes de enviar a CLIP.');
    if (!response.ok || reply.requestId !== pending.requestId) throw new ClipPaymentPending(reply.error || 'No se confirmó el pago CLIP. Conserva la misma solicitud.');
    if (reply.state !== 'completed') throw new ClipPaymentPending(reply.message || 'Esperando el pago en CLIP. No vuelvas a cobrar.');
    const order = reply.order;
    if (!order?.id || order.ticket_number == null || !Array.isArray(order.items) || !Number.isFinite(order.total) || order.total !== pending.total || order.payment_method !== 'tarjeta') throw new ClipPaymentPending('Comprobante CLIP no confirmado. Conserva el pedido.');
    if (pending.payload.pager_number != null && order.pager_number !== pending.payload.pager_number) throw new ClipPaymentPending('No se confirmó el control de entrega. Comprueba la venta antes de volver a cobrar.');
    return order as SavedOrder;
  }
  const { data, error } = await withDeadline(() => client.rpc('pos_checkout', { p_request: pending.requestId, p_payload: pending.payload }), { timeoutMs });
  if (error) {
    // A PostgreSQL error confirms rollback. A transport failure says nothing
    // about commit, so it must retain the exact request for recovery.
    if (/^[0-9A-Z]{5}$/.test(error.code || '')) throw new CheckoutRejected(error.message);
    throw new Error(error.message);
  }
  if (!data?.id || data.ticket_number == null || !Array.isArray(data.items) || !Number.isFinite(data.total)) throw new Error('No se confirmó la venta. Compruébala antes de volver a cobrar.');
  if (pending.payload.pager_number != null && data.pager_number !== pending.payload.pager_number) throw new Error('No se confirmó el control de entrega. Comprueba la venta antes de volver a cobrar.');
  return data as SavedOrder;
}
