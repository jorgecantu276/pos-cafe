import type { SupabaseClient } from '@supabase/supabase-js';
import type { Customer } from './pos-types';
import { withDeadline } from './request-deadline';

type Client = Pick<SupabaseClient, 'rpc'>;
type Memory = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface CustomerCorrection { customer_id: string; name: string; phone: string }
export interface PendingCustomerCorrection {
  actor: string; request: string; payload: CustomerCorrection & { actor_id: string };
}
export const customerEditKey = (actor: string) => `pos_customer_edit:v1:${actor}`;

function validated(value: CustomerCorrection): CustomerCorrection {
  const name = value.name.trim(), phone = value.phone.replace(/[^0-9]/g, '');
  if (!value.customer_id || name.length < 1 || name.length > 150 || value.phone.length > 60
    || phone.length < 10 || phone.length > 15 || /[^0-9+().\s-]/.test(value.phone)) {
    throw new Error('Escribe el nombre y un teléfono válido de 10 a 15 dígitos.');
  }
  return { customer_id: value.customer_id, name, phone: phone.length === 10 ? `52${phone}` : phone };
}

export function readCustomerCorrection(storage: Memory, actor: string): PendingCustomerCorrection | null {
  const raw = storage.getItem(customerEditKey(actor));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingCustomerCorrection;
  if (!value || value.actor !== actor || typeof value.request !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.request)
    || value.payload?.actor_id !== actor || typeof value.payload.customer_id !== 'string'
    || typeof value.payload.name !== 'string' || typeof value.payload.phone !== 'string') {
    throw new Error('No se pudieron abrir los cambios pendientes del cliente. Pide ayuda al responsable.');
  }
  validated(value.payload);
  return value;
}

async function locked<T>(actor: string, action: () => Promise<T>): Promise<T> {
  if (!actor) throw new Error('Espera a que termine de cargar la sesión.');
  if (!navigator.locks) throw new Error('Actualiza Chrome o Edge para corregir clientes.');
  return navigator.locks.request(customerEditKey(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Otra ventana está guardando una corrección de cliente.');
    return action();
  });
}

async function submit(client: Client, storage: Memory, pending: PendingCustomerCorrection): Promise<Customer> {
  const key = customerEditKey(pending.actor), raw = JSON.stringify(pending), controller = new AbortController();
  try {
    const { data, error } = await withDeadline(() => client.rpc('pos_edit_customer', {
      p_request: pending.request, p_payload: pending.payload,
    }).abortSignal(controller.signal));
    if (error) {
      if ((error.code === 'P0001' || /^(22|23)[0-9A-Z]{3}$/.test(error.code || '')) && storage.getItem(key) === raw) storage.removeItem(key);
      throw new Error(error.message);
    }
    const customer = data?.customer as Customer | undefined;
    if (data?.request_id !== pending.request || !customer || customer.id !== pending.payload.customer_id
      || customer.name !== pending.payload.name || customer.phone !== pending.payload.phone) {
      throw new Error('No se confirmó el guardado. Pulsa Comprobar cambios.');
    }
    if (storage.getItem(key) !== raw) throw new Error('La corrección cambió en otra ventana. Actualiza antes de continuar.');
    storage.removeItem(key);
    return customer;
  } finally { controller.abort(); }
}

export async function saveCustomerCorrection(client: Client, storage: Memory, actor: string, correction: CustomerCorrection): Promise<Customer> {
  return locked(actor, async () => {
    const key = customerEditKey(actor);
    if (storage.getItem(key)) throw new Error('Comprueba los cambios pendientes antes de editar al cliente.');
    const pending: PendingCustomerCorrection = { actor, request: crypto.randomUUID(), payload: { ...validated(correction), actor_id: actor } };
    storage.setItem(key, JSON.stringify(pending));
    return submit(client, storage, pending);
  });
}

export async function recoverCustomerCorrection(client: Client, storage: Memory, actor: string): Promise<Customer> {
  return locked(actor, async () => {
    const pending = readCustomerCorrection(storage, actor);
    if (!pending) throw new Error('No hay cambios pendientes del cliente.');
    return submit(client, storage, pending);
  });
}
