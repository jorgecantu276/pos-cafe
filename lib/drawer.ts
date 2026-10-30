import type { SupabaseClient } from '@supabase/supabase-js';
import type { Customer } from './pos-types';
import type { ShiftSummary } from './shift-state';
import type { ShiftReport } from './shift';
import { withDeadline } from './request-deadline';

type Client = Pick<SupabaseClient, 'rpc'>;
export interface DrawerStatus {
  rate: number | null;
  active: { id: string; cashier_id: string; cashier_name: string } | null;
  handoff: { id: string; from_name: string; to_id: string; to_name: string; delivered: number; rate: number } | null;
  cashiers: { id: string; name: string }[];
}
type Operation = 'handoff' | 'accept' | 'rate' | 'reassign' | 'customer' | 'manager_close';
interface Pending { actor: string; operation: Operation; request: string; payload: Record<string, unknown> }
const functions: Record<Operation, string> = { handoff: 'pos_begin_drawer_handoff', accept: 'pos_accept_drawer_handoff', rate: 'pos_set_drawer_rate', reassign: 'pos_reassign_drawer_handoff', customer: 'pos_enroll_customer', manager_close: 'pos_manager_close_drawer' };
export const drawerRequestKey = (actor: string, operation: Operation) => `pos_drawer_request:v1:${actor}:${operation}`;
async function rpc(client: Client, name: string, args: object, signal?: AbortSignal) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const response = await withDeadline(() => client.rpc(name, args).abortSignal(combined), { signal: combined });
    return response;
  } finally { controller.abort(); }
}
export async function loadDrawerStatus(client: Client, signal?: AbortSignal): Promise<DrawerStatus> {
  const { data, error } = await rpc(client, 'pos_drawer_status', {}, signal);
  if (error) throw new Error(error.message);
  const value = data as DrawerStatus;
  if (!value || (value.rate !== null && (!Number.isFinite(value.rate) || value.rate <= 0)) || !Array.isArray(value.cashiers)
    || (value.active && (typeof value.active.id !== 'string' || typeof value.active.cashier_id !== 'string'))
    || (value.handoff && (typeof value.handoff.id !== 'string' || typeof value.handoff.to_id !== 'string' || !Number.isFinite(value.handoff.delivered) || !Number.isFinite(value.handoff.rate)))) throw new Error('No se pudo comprobar el estado de la única caja.');
  return value;
}
export function hasDrawerRequest(storage: Storage, actor: string, operation: Operation) { return storage.getItem(drawerRequestKey(actor, operation)) !== null; }
async function submit(client: Client, storage: Storage, pending: Pending) {
  const key = drawerRequestKey(pending.actor, pending.operation), raw = JSON.stringify(pending);
  const { data, error } = await rpc(client, functions[pending.operation], { p_request: pending.request, p_payload: pending.payload });
  if (error) {
    // Auth/permission/lock errors can precede replay; preserve uncertain requests.
    if ((error.code === 'P0001' || /^(22|23)[0-9A-Z]{3}$/.test(error.code || '')) && storage.getItem(key) === raw) storage.removeItem(key);
    throw new Error(error.message);
  }
  if (!data || data.request_id !== pending.request || (['handoff','manager_close'].includes(pending.operation) && (data.report?.register_id !== pending.payload.register
      || Number(data.report.counted_cash)!==pending.payload.counted
      || !['starting_cash','total_sales','total_expenses','expected_cash','counted_cash','difference'].every(key=>Number.isFinite(Number(data.report[key])))))
    || (pending.operation === 'accept' && (typeof data.register?.id !== 'string' || data.register.opened_by !== pending.actor || Number(data.register.initial_balance) !== pending.payload.counted))
    || (pending.operation === 'customer' && (typeof data.customer?.id !== 'string' || typeof data.customer.name !== 'string' || !Number.isFinite(data.customer.points)))
    || (pending.operation === 'rate' && data.rate !== pending.payload.rate)) throw new Error('Respuesta no confirmada. Recupera la misma solicitud.');
  if (storage.getItem(key) !== raw) throw new Error('La solicitud cambió en otra ventana. Actualiza antes de continuar.');
  storage.removeItem(key); return data;
}
async function locked<T>(actor: string, operation: Operation, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Actualiza Chrome o Edge para administrar la caja.');
  return navigator.locks.request(drawerRequestKey(actor, operation), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Otra ventana está guardando esta solicitud.'); return action();
  });
}
export async function drawerWrite(client: Client, storage: Storage, actor: string, operation: Operation, payload: Record<string, unknown>) {
  return locked(actor, operation, async () => {
    const key = drawerRequestKey(actor, operation), existing = storage.getItem(key);
    if (existing) throw new Error('Hay una solicitud sin confirmar. Recupera la misma solicitud antes de cambiar los datos.');
    const pending: Pending = { actor, operation, request: crypto.randomUUID(), payload: { ...payload, actor_id: actor } };
    storage.setItem(key, JSON.stringify(pending));
    return submit(client, storage, pending);
  });
}
export async function recoverDrawerRequest(client: Client, storage: Storage, actor: string, operation: Operation) {
  // Empty read-only recovery must not contend with Strict Mode's duplicate load.
  if (!hasDrawerRequest(storage, actor, operation)) return null;
  return locked(actor, operation, async () => {
    const raw = storage.getItem(drawerRequestKey(actor, operation)); if (!raw) return null;
    const pending = JSON.parse(raw) as Pending;
    if (pending.actor !== actor || pending.operation !== operation || typeof pending.request !== 'string' || !pending.payload || typeof pending.payload !== 'object') throw new Error('Solicitud pendiente ilegible. Conserva los datos para revisión.');
    return submit(client, storage, pending);
  });
}
export async function beginDrawerHandoff(client: Client, storage: Storage, actor: string, summary: ShiftSummary, counted: number, to: string): Promise<ShiftReport> {
  const result = hasDrawerRequest(storage, actor, 'handoff') ? await recoverDrawerRequest(client, storage, actor, 'handoff') :
    await drawerWrite(client, storage, actor, 'handoff', { register: summary.register_id, counted: Math.round(counted*100)/100, to, expenses: summary.expenses,
      preview: { cash_sales: summary.cash_sales, total_sales: summary.total_sales, expenses_revision: summary.expenses_revision } });
  return result.report;
}
export async function enrollCustomer(client: Client, storage: Storage, actor: string, payload: Record<string, unknown>): Promise<Customer> {
  const result = hasDrawerRequest(storage, actor, 'customer') ? await recoverDrawerRequest(client, storage, actor, 'customer') :
    await drawerWrite(client, storage, actor, 'customer', payload);
  return result.customer;
}
