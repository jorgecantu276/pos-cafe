import { customizeProduct, useCartStore, type CartItem } from '../store/useCartStore';
import type { CatalogProduct, ExtraRow } from './pos-types';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Draft {
  version: 1;
  id: string;
  userId: string;
  registerId: string;
  revision: string;
  items: { id: string; productId: string; quantity: number; extraIds: string[]; note: string; unitPrice: number }[];
  orderType: string;
  orderNote: string;
  pagerNumber?: number | null;
  phoneOrder?: boolean;
  phoneName?: string;
  phoneContact?: string;
  customerId: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const identifier = (value: unknown): value is string => text(value, 128) && value.length > 0;
export const cartDraftKey = (userId: string) => `mi_cafe_cart_draft:v1:${userId}`;

export function readCartDraft(raw: string | null, userId: string, registerId: string): Draft | null {
  if (!raw) return null;
  if (raw.length > 500_000) throw Error('El pedido tiene demasiados artículos. Pide ayuda al responsable.');
  const value = JSON.parse(raw) as Draft;
  if (!value || value.version !== 1 || value.userId !== userId || !identifier(value.registerId)
    || !uuid.test(value.id) || !identifier(value.revision) || !Array.isArray(value.items) || value.items.length > 100
    || !['En Local', 'Para Llevar'].includes(value.orderType) || !text(value.orderNote, 1000)
    || (value.pagerNumber != null && (!Number.isInteger(value.pagerNumber) || value.pagerNumber < 1 || value.pagerNumber > 30))
    || (value.phoneOrder !== undefined && typeof value.phoneOrder !== 'boolean')
    || (value.phoneName !== undefined && !text(value.phoneName,120)) || (value.phoneContact !== undefined && !text(value.phoneContact,60))
    || (value.phoneOrder === true && value.pagerNumber != null)
    || (value.customerId !== null && !identifier(value.customerId))) throw Error('No se pudo abrir el pedido. Pide ayuda al responsable.');
  const lines = new Set<string>();
  for (const line of value.items) {
    if (!line || !identifier(line.id) || lines.has(line.id) || !identifier(line.productId)
      || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000
      || !text(line.note, 1000) || !Number.isFinite(line.unitPrice) || line.unitPrice < 0
      || !Array.isArray(line.extraIds) || line.extraIds.length > 30 || !line.extraIds.every(identifier)
      || new Set(line.extraIds).size !== line.extraIds.length) throw Error('Hay un artículo que necesita revisión.');
    lines.add(line.id);
  }
  // A closed/other shift must never inherit an unpaid cart.
  return value.registerId === registerId ? value : null;
}

export function restoreDraftItems(draft: Draft, products: CatalogProduct[], extras: ExtraRow[]) {
  let repriced = false;
  const items: CartItem[] = draft.items.map(line => {
    const product = products.find(p => p.id === line.productId && p.is_active);
    if (!product) throw Error('Un producto del pedido ya no está disponible. Revisa el pedido antes de cobrar.');
    const selected = line.extraIds.map(id => {
      const extra = extras.find(e => e.id === id && e.active);
      if (!extra || !product.customizable || !product.wizard_steps?.includes(extra.phase))
        throw Error('Un extra del pedido ya no está disponible. Revisa el pedido antes de cobrar.');
      return { id: extra.id, name: extra.name, phase: extra.phase, price: Number(extra.price ?? 0) };
    });
    const restored = customizeProduct({ ...product, basePrice: Number(product.price) }, selected, line.note);
    if (!Number.isFinite(restored.price) || restored.price < 0) throw Error('Revisa el precio del producto.');
    repriced ||= Math.round(restored.price * 100) !== Math.round(line.unitPrice * 100);
    return { id: line.id, quantity: line.quantity, product: restored };
  });
  return { items, repriced };
}

export function bindCartDraft(options: { storage: Storage; userId: string; registerId: string;
  products: CatalogProduct[]; extras: ExtraRow[]; onError: (message: string) => void; onRepriced: () => void;
  store?: ReturnType<typeof import('../store/useCartStore').createCartStore> }) {
  const { storage, userId, registerId, onError } = options;
  const store = options.store ?? useCartStore;
  const key = cartDraftKey(userId), pendingKey = `mi_cafe_checkout_review:${userId}`;
  let expected = storage.getItem(key), id = crypto.randomUUID(), muted = false, conflicted = false, connected = true;
  const pending = () => {
    const raw=storage.getItem(pendingKey);if(!raw)return false;
    try {return !JSON.parse(raw).payload?.phone_order_id;}catch{return true;}
  };
  const pendingRaw = storage.getItem(pendingKey);
  if (pendingRaw && pending()) {
    try { const request = JSON.parse(pendingRaw).requestId; if (typeof request === 'string' && uuid.test(request)) id = request; }
    catch { /* An unreadable checkout marker remains blocked by checkout recovery. */ }
  }
  // The submitted request is authoritative even if a crash left an unpaid
  // snapshot alongside it. Never restore that snapshot as a fresh payment.
  const draft = pending() ? null : readCartDraft(expected, userId, registerId);
  const restored = draft ? restoreDraftItems(draft, options.products, options.extras) : { items: [], repriced: false };
  if (draft) id = draft.id;
  store.setState({ items: restored.items, orderType: draft?.orderType ?? 'En Local',
    orderNote: draft?.orderNote ?? '', pagerNumber: draft?.pagerNumber ?? null, phoneOrder:draft?.phoneOrder??false,phoneName:draft?.phoneName??'',phoneContact:draft?.phoneContact??'',customerId: draft?.customerId ?? null });
  const assertCurrent = () => {
    if (storage.getItem(key) !== expected) {
      conflicted = true;
      throw Error('El pedido cambió en otra ventana. Actualízalo antes de seguir.');
    }
  };
  const flush = () => {
    assertCurrent();
    if (pending()) return;
    const state = store.getState();
    if (!state.items.length && !state.customerId && !state.orderNote && !state.pagerNumber && !state.phoneOrder && !state.phoneName && !state.phoneContact && state.orderType === 'En Local') {
      storage.removeItem(key); expected = null; id = crypto.randomUUID(); return;
    }
    const snapshot: Draft = { version: 1, id, userId, registerId, revision: crypto.randomUUID(),
      items: state.items.map(line => ({ id: line.id, productId: line.product.id, quantity: line.quantity,
        extraIds: (line.product.displayExtras ?? []).map(e => e.id ?? ''), note: line.product.note ?? '', unitPrice: line.product.price })),
      orderType: state.orderType, orderNote: state.orderNote, pagerNumber: state.pagerNumber,phoneOrder:state.phoneOrder,phoneName:state.phoneName,phoneContact:state.phoneContact,customerId: state.customerId };
    const encoded = JSON.stringify(snapshot);
    readCartDraft(encoded, userId, registerId); // Validate before replacing a recoverable snapshot.
    storage.setItem(key, encoded); expected = encoded;
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (muted || (state.items === previous.items && state.orderType === previous.orderType
      && state.orderNote === previous.orderNote && state.pagerNumber === previous.pagerNumber && state.phoneOrder===previous.phoneOrder&&state.phoneName===previous.phoneName&&state.phoneContact===previous.phoneContact&&state.customerId === previous.customerId)) return;
    try { flush(); } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo guardar el borrador local.'); }
  });
  if (restored.repriced) {
    try { flush(); } catch (error) { unsubscribe(); throw error; }
    options.onRepriced();
  }
  const complete=()=>{
    // Only retire this sale's draft. Another window's newer draft is protected.
    const raw = storage.getItem(key);
    if (raw && JSON.parse(raw).id !== id) throw Error('Hay otro pedido abierto. Revisa la venta pendiente antes de continuar.');
    storage.removeItem(key); expected = null;
    // A delayed response after logout may retire its own persisted record,
    // but must never clear the next cashier's visible store.
    if (connected) { muted = true; store.getState().clearCart(); muted = false; }
    id = crypto.randomUUID();
  };
  return {
    key, scope: `${userId}:${registerId}`, customerId: draft?.customerId ?? null,
    get conflicted() { return conflicted; },
    disconnect() { connected = false; unsubscribe(); },
    flush,
    checkCurrent: assertCurrent,
    requestId() { flush(); return id; },
    complete,
    retireRequest(requestId:string) {
      if(!uuid.test(requestId))throw Error('No se pudo confirmar el pedido original.');
      const raw=storage.getItem(key);
      if(!raw){
        if(id===requestId)complete();
        else if(expected){const previous=JSON.parse(expected) as Draft;if(previous.userId===userId&&previous.id===requestId)expected=null;}
        return;
      }
      const saved=JSON.parse(raw) as Draft;
      if(saved.userId!==userId)throw Error('El pedido pertenece a otra sesión.');
      if(saved.id!==requestId)return; // A newer order is unrelated to this acknowledgment.
      assertCurrent();
      readCartDraft(raw,userId,saved.registerId); // Validate the original actor and scope, including an earlier shift.
      if(id===requestId){complete();return;}
      storage.removeItem(key);expected=null;
      // This binding belongs to a newer shift. Keep its current store and fresh
      // identity, and synchronize its storage expectation after retiring the old draft.
    },
  };
}
export type CartDraftBinding = ReturnType<typeof bindCartDraft>;
