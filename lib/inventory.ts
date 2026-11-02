import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';
import { isDefinitiveWriteRejection } from './write-outcome';

export const inventoryUnits = ['pieza', 'rebanada', 'pastel', 'botella', 'lata', 'paquete'] as const;
export type InventoryUnit = typeof inventoryUnits[number];
export interface InventoryItem {
  product_id: string; code: string; name: string; category: string | null; is_active: boolean | null;
  mode: 'availability' | 'counted'; unit: InventoryUnit; quantity: number | null;
  minimum: number | null; available: boolean; revision: number; last_counted_at: string | null;
}
export interface InventoryMovement {
  id: number; product_id: string; product_name: string; unit: string; actor_name: string;
  kind: string; before_quantity: number | null; after_quantity: number | null;
  reason: string; created_at: string; ticket_number: number | null;
}
export interface InventoryChange {
  product_id: string; revision: number; action: 'configure' | 'availability' | 'count' | 'receive' | 'waste' | 'import';
  mode?: InventoryItem['mode']; unit?: InventoryUnit; quantity?: number | null;
  minimum?: number | null; available?: boolean; reason?: string;
}
export interface InventoryReturnLine { id: number; product_name: string; unit: string; sold: number; returned: number }
export type InventoryClient = Pick<SupabaseClient, 'rpc'>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface InventoryRequest {
  actor: string; request: string; rpc: 'pos_inventory_write' | 'pos_inventory_return' | 'pos_inventory_set_enabled';
  args: { p_changes: InventoryChange[] } | { p_order: string; p_lines: { id: number; quantity: number }[] } | { p_enabled: boolean; p_revision: number };
}
export const inventoryRequestKey = (actor: string) => `cm_inventory:v1:${actor}`;
export class InventoryRejected extends Error {}
export function inventoryStatus(item: InventoryItem) {
  if (item.mode === 'availability') return item.available ? 'Disponible' : 'Agotado';
  if (item.quantity === null) return 'Sin contar';
  if (item.quantity === 0) return 'Agotado';
  return item.minimum !== null && item.quantity <= item.minimum ? 'Por reponer' : 'En existencia';
}
export function readInventoryRequest(storage: Storage, actor: string): InventoryRequest | null {
  const raw = storage.getItem(inventoryRequestKey(actor));
  if (!raw) return null;
  if (raw.length > 400_000) throw new Error('La operación pendiente requiere revisión.');
  const p = JSON.parse(raw) as InventoryRequest;
  if (!p || p.actor !== actor || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(p.request)
    || !['pos_inventory_write', 'pos_inventory_return', 'pos_inventory_set_enabled'].includes(p.rpc) || !p.args || typeof p.args !== 'object'
    || (p.rpc === 'pos_inventory_write' ? !('p_changes' in p.args) || !Array.isArray(p.args.p_changes)
      : p.rpc === 'pos_inventory_return' ? !('p_order' in p.args) || !Array.isArray(p.args.p_lines)
      : !('p_enabled' in p.args) || typeof p.args.p_enabled !== 'boolean' || !Number.isInteger(p.args.p_revision))) throw new Error('La operación pendiente requiere revisión.');
  return p;
}
// Persist before sending. Unknown transport outcomes keep the original identity
// across reloads; a confirmed database rejection can safely clear it.
async function submitInventoryRequest(client: InventoryClient, storage: Storage, pending: InventoryRequest, timeoutMs = 12_000) {
  const key = inventoryRequestKey(pending.actor), raw = JSON.stringify(pending);
  const existing = storage.getItem(key);
  if (existing && existing !== raw) throw new Error('Recupera primero la operación pendiente.');
  storage.setItem(key, raw);
  const { data, error } = await withDeadline(() => client.rpc(pending.rpc, { ...pending.args, p_request: pending.request, p_actor: pending.actor }), { timeoutMs });
  if (error) {
    if (isDefinitiveWriteRejection(error.code)) {
      if (storage.getItem(key) === raw) storage.removeItem(key);
      throw new InventoryRejected(error.message);
    }
    throw new Error(error.message);
  }
  if (pending.rpc === 'pos_inventory_set_enabled' && 'p_enabled' in pending.args) {
    if (data?.enabled !== pending.args.p_enabled || data?.revision !== pending.args.p_revision + 1) throw new Error('No se confirmó la activación. Recupera la misma operación.');
    if (storage.getItem(key) !== raw) throw new Error('La operación cambió en otra ventana. Revisa la recuperación.');
    storage.removeItem(key); return data;
  }
  const rows: { product_id?: unknown; revision?: unknown; id?: unknown; returned?: unknown }[] = Array.isArray(data) ? data : [];
  let valid = rows.length > 0;
  if (valid && pending.rpc === 'pos_inventory_write' && 'p_changes' in pending.args) {
    const changes = pending.args.p_changes;
    valid = rows.length === changes.length && new Set(rows.map(row => row?.product_id)).size === changes.length
      && rows.every(row => { const input = changes.find(c => c.product_id === row?.product_id);
        return input && typeof row?.revision === 'number' && Number.isInteger(row.revision) && row.revision > input.revision; });
  } else if (valid && pending.rpc === 'pos_inventory_return' && 'p_lines' in pending.args) {
    const lines = pending.args.p_lines;
    valid = rows.length === lines.length && new Set(rows.map(row => row?.id)).size === lines.length
      && rows.every(row => { const input = lines.find(line => line.id === row?.id);
        return input && typeof row?.returned === 'number' && Number.isInteger(row.returned) && row.returned >= input.quantity; });
  } else valid = false;
  if (!valid) throw new Error('No se confirmó el resultado. Recupera la misma operación.');
  if (storage.getItem(key) === raw) storage.removeItem(key);
  return data;
}

export async function saveInventoryRequest(client: InventoryClient, storage: Storage, pending: InventoryRequest, timeoutMs = 12_000) {
  if (typeof window === 'undefined') return submitInventoryRequest(client, storage, pending, timeoutMs);
  if (!navigator.locks) throw new Error('Actualiza Chrome o Edge para guardar el inventario.');
  return navigator.locks.request(inventoryRequestKey(pending.actor), { ifAvailable: true }, lock => {
    if (!lock) throw new Error('Otra ventana está guardando el inventario.');
    return submitInventoryRequest(client, storage, pending, timeoutMs);
  });
}

export const inventoryCsvHeaders = ['codigo', 'producto', 'modo', 'unidad', 'cantidad', 'minimo', 'disponible'];
const normalize = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase('es');
function cell(value: string | number | null) {
  let text = value === null ? '' : String(value);
  if (/^\s*[=+@\-]|^[\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function inventoryCsv(items: InventoryItem[]) {
  return '\ufeff' + [inventoryCsvHeaders.join(','), ...items.map(i => [i.code, i.name,
    i.mode === 'counted' ? 'conteo' : 'disponibilidad', i.unit,
    i.mode === 'counted' ? i.quantity : null, i.minimum, i.available ? 'si' : 'no'].map(cell).join(','))].join('\r\n');
}
export function csvRows(text: string): string[][] {
  if (text.length > 300_000) throw new Error('El CSV admite hasta 300 KB.');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\ufeff/, '');
  for (let n = 0; n < text.length; n++) {
    const c = text[n];
    if (quoted) {
      if (c === '"') { if (text[n + 1] === '"') { field += '"'; n++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',' || c === '\r' || c === '\n') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && text[n + 1] === '\n') n++; }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Revisa las comillas del CSV.'); field += c; }
  }
  if (quoted) throw new Error('Faltan comillas de cierre en el CSV.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length > 501) throw new Error('Importa hasta 500 productos por archivo.');
  return rows;
}
export interface InventoryCsvPreview { changes: InventoryChange[]; errors: string[]; items: InventoryItem[] }
export function previewInventoryCsv(text: string, catalog: InventoryItem[]): InventoryCsvPreview {
  const rows = csvRows(text), errors: string[] = [], changes: InventoryChange[] = [], items: InventoryItem[] = [];
  if (!rows.length || rows[0].map(normalize).join(',') !== inventoryCsvHeaders.join(',')) throw new Error('Usa la plantilla CSV descargada desde Inventario.');
  if (rows.length < 2) throw new Error('El archivo no contiene productos.');
  const seen = new Set<string>();
  const integer = (value: string, label: string): number | null => {
    if (!value.trim()) return null;
    if (!/^\d+$/.test(value.trim()) || Number(value) > 1_000_000) throw new Error(`${label}: usa un entero de 0 a 1000000.`);
    return Number(value);
  };
  for (let n = 1; n < rows.length; n++) {
    try {
      if (rows[n].length !== 7) throw new Error('Se esperan 7 columnas.');
      const [code, rawName, mode, unit, quantity, minimum, available] = rows[n].map(v => v.trim());
      const key = code.toUpperCase(), item = catalog.find(i => i.code === key);
      if (!item) throw new Error(`Código desconocido: ${code}.`);
      if (seen.has(key)) throw new Error(`Código repetido: ${code}.`); seen.add(key);
      const name = /^'\s*[=+@\-]|^'[\t\r]/.test(rawName) ? rawName.slice(1) : rawName;
      if (name && normalize(name) !== normalize(item.name)) throw new Error(`El nombre no coincide con ${code} (${item.name}).`);
      if (!['conteo', 'disponibilidad'].includes(normalize(mode))) throw new Error('Modo: conteo o disponibilidad.');
      if (!inventoryUnits.includes(unit as InventoryUnit)) throw new Error('Unidad no reconocida.');
      if (!['si', 'no'].includes(normalize(available))) throw new Error('Disponible: si o no.');
      const q = integer(quantity, 'Cantidad'), min = integer(minimum, 'Mínimo');
      if (normalize(mode) === 'disponibilidad' && q !== null) throw new Error('Deja cantidad vacía para disponibilidad.');
      changes.push({ product_id: item.product_id, revision: item.revision, action: 'import',
        mode: normalize(mode) === 'conteo' ? 'counted' : 'availability', unit: unit as InventoryUnit,
        quantity: q, minimum: min, available: normalize(available) === 'si' }); items.push(item);
    } catch (error) { errors.push(`Fila ${n + 1}: ${(error as Error).message}`); }
  }
  return { changes, errors, items };
}
