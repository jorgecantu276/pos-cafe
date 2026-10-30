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
}
export interface SavedOrder {
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
  startedAt: string;
  total: number;
  orderId?: string;
  ticketNumber?: number | string;
  requestId?: string;
  payload?: CheckoutPayload;
}
export class CheckoutRejected extends Error {}
export async function withCheckoutLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Actualiza el navegador para coordinar el cobro entre ventanas.');
  return navigator.locks.request(`pos-checkout:${key}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Otra ventana está procesando esta venta. Espera y recupera la misma venta.');
    return action();
  });
}
export function readCheckoutReview(raw: string | null): CheckoutReview | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('startedAt' in value) || typeof value.startedAt !== 'string'
    || !('total' in value) || typeof value.total !== 'number' || !Number.isFinite(value.total)) throw new Error('Registro pendiente ilegible. Solicita revisión antes de cobrar.');
  return value as CheckoutReview;
}
export function checkoutPayload(items: readonly CartItem[], fields: Omit<CheckoutPayload, 'items'>): CheckoutPayload {
  if (!items.length || items.some(i => !Number.isInteger(i.quantity) || i.quantity < 1
    || (i.product.displayExtras ?? []).some(e => !e.id))) throw new Error('Revisa las cantidades y vuelve a seleccionar los extras del catálogo.');
  return { ...fields, items: items.map(i => ({ product_id: i.product.id, quantity: i.quantity,
    extra_ids: (i.product.displayExtras ?? []).map(e => e.id!), note: i.product.note?.trim() || '' })) };
}
// Exactly one RPC; no client-side stock, prices, points or order writes.
export async function executeCheckout(client: Pick<SupabaseClient, 'rpc'>, pending: CheckoutReview, timeoutMs = 12_000): Promise<SavedOrder> {
  if (!pending.requestId || !pending.payload) throw new Error('Venta antigua sin identidad de transacción. Requiere conciliación del responsable.');
  const { data, error } = await withDeadline(() => client.rpc('pos_checkout', { p_request: pending.requestId, p_payload: pending.payload }), { timeoutMs });
  if (error) {
    // A PostgreSQL error confirms rollback. A transport failure says nothing
    // about commit, so it must retain the exact request for recovery.
    if (/^[0-9A-Z]{5}$/.test(error.code || '')) throw new CheckoutRejected(error.message);
    throw new Error(error.message);
  }
  if (!data?.id || data.ticket_number == null || !Array.isArray(data.items) || !Number.isFinite(data.total)) throw new Error('No se recibió un comprobante válido. Conserva el registro pendiente.');
  return data as SavedOrder;
}
