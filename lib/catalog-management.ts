import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';
import { catalogProduct, type CatalogProduct, type ExtraRow, type ProductRow } from './pos-types';
import { loadRegisterShortcuts } from './register-shortcuts';

export type CatalogChange = {
  kind: 'product' | 'extra'; action: 'save' | 'deactivate'|'reactivate'; id: string | null;revision?:number;
  fields?: { name: string; price: number; category?: string; phase?: string; customizable?: boolean; image_url?: string; wizard_steps?: string[]; applicable_product_ids?: string[] };
};
type Pending = { actor: string; request: string; payload: CatalogChange & { actor_id: string } };
type Memory = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Client = Pick<SupabaseClient, 'rpc'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const catalogRequestKey = (actor: string) => `pos_catalog_request:v1:${actor}`;
export const catalogChangeKey = 'pos_catalog_changed:v1';

export async function loadRegisterInventory(client: Client, signal: AbortSignal) {
  const { data, error } = await client.rpc('pos_inventory_register').abortSignal(signal);
  if (error) throw error;
  if (typeof data?.enabled !== 'boolean' || !Array.isArray(data.items)) throw Error('No se pudo verificar el inventario.');
  return new Map<string, CatalogProduct['inventory']>(data.enabled ? data.items.map((i: { product_id: string } & NonNullable<CatalogProduct['inventory']>) => [i.product_id, {mode:i.mode, quantity:i.quantity, available:i.available}]) : []);
}

export function catalogFingerprint(products: CatalogProduct[], extras: ExtraRow[], favorites: readonly string[]) {
  return JSON.stringify({ products: products.map(p => ({ id: p.id, name: p.name, price: Number(p.price), category: p.category,
    image: p.image_url || '', active: p.is_active, customizable: p.customizable, steps: p.wizard_steps ?? [] })).sort((a, b) => a.id.localeCompare(b.id)),
    extras: extras.map(e => ({ id: e.id, name: e.name, price: Number(e.price), phase: e.phase, active: e.active, products: e.applicable_product_ids ?? null })).sort((a, b) => a.id.localeCompare(b.id)), favorites });
}

export async function loadLiveCatalog(client: Pick<SupabaseClient, 'from' | 'rpc'>, signal: AbortSignal) {
  const [products, extras, favorites] = await Promise.all([
    client.from('products').select('*').order('name').abortSignal(signal),
    client.from('extras').select('*').order('phase').abortSignal(signal), loadRegisterShortcuts(client, signal),
  ]);
  if (products.error) throw products.error;
  if (extras.error) throw extras.error;
  return catalogFingerprint(((products.data ?? []) as ProductRow[]).map(catalogProduct), (extras.data ?? []) as ExtraRow[], favorites.product_ids);
}

export function announceCatalogChange() {
  // A notification must never turn a confirmed save into an uncertain one.
  try { localStorage.setItem(catalogChangeKey, crypto.randomUUID()); } catch { /* polling also detects changes */ }
  window.dispatchEvent(new window.Event(catalogChangeKey));
}

export function readCatalogRequest(storage: Memory, actor: string): Pending | null {
  const raw = storage.getItem(catalogRequestKey(actor));
  if (!raw) return null;
  const pending = JSON.parse(raw) as Pending;
  if (!pending || pending.actor !== actor || pending.payload?.actor_id !== actor || !uuid.test(pending.request)
    || !['product', 'extra'].includes(pending.payload.kind) || !['save', 'deactivate','reactivate'].includes(pending.payload.action)
    ||(pending.payload.revision!==undefined&&(!Number.isSafeInteger(pending.payload.revision)||pending.payload.revision<0))
    ||(pending.payload.action==='reactivate'&&(!pending.payload.id||pending.payload.revision===undefined))) {
    throw Error('No se pudieron abrir los cambios pendientes. Pide ayuda al responsable.');
  }
  return pending;
}

async function submit(client: Client, storage: Memory, pending: Pending) {
  const key = catalogRequestKey(pending.actor), raw = JSON.stringify(pending), controller = new AbortController();
  try {
    const routine = pending.payload.fields?.applicable_product_ids !== undefined ? 'pos_save_smoothies_extra' : 'pos_save_catalog';
    const { data, error } = await withDeadline(() => client.rpc(routine, {
      p_request: pending.request, p_payload: pending.payload,
    }).abortSignal(controller.signal));
    if (error) {
      if ((error.code === 'P0001' || /^(22|23)[0-9A-Z]{3}$/.test(error.code || '')) && storage.getItem(key) === raw) storage.removeItem(key);
      throw Error(error.message);
    }
    if (data?.request_id !== pending.request || data.kind !== pending.payload.kind || data.action !== pending.payload.action
      || typeof data.id !== 'string' || !uuid.test(data.id) || (pending.payload.id && data.id !== pending.payload.id)) {
      throw Error('No se confirmó el guardado. Pulsa Comprobar guardado.');
    }
    if (storage.getItem(key) !== raw) throw Error('El guardado cambió en otra ventana. Actualiza antes de continuar.');
    storage.removeItem(key);
    return data as { request_id: string; kind: string; action: string; id: string };
  } finally { controller.abort(); }
}

export async function saveCatalogChange(client: Client, storage: Memory, actor: string, change?: CatalogChange) {
  if (!actor) throw Error('Espera a que termine de cargar la sesión.');
  if (!navigator.locks) throw Error('Actualiza Chrome o Edge para guardar el catálogo.');
  return navigator.locks.request(catalogRequestKey(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw Error('Otra ventana está guardando el catálogo.');
    let pending = readCatalogRequest(storage, actor);
    if (change) {
      if (pending) throw Error('Comprueba los cambios pendientes antes de seguir.');
      pending = { actor, request: crypto.randomUUID(), payload: { ...change, actor_id: actor } };
      storage.setItem(catalogRequestKey(actor), JSON.stringify(pending));
    }
    if (!pending) throw Error('No hay cambios pendientes.');
    return submit(client, storage, pending);
  });
}
