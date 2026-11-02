import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';

type Client = Pick<SupabaseClient, 'rpc'>;
type Memory = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface RegisterShortcuts { product_ids: string[]; revision: number }
export interface PendingRegisterShortcuts {
  actor: string; request: string; payload: RegisterShortcuts & { actor_id: string };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const registerShortcutsKey = (actor: string) => `pos_register_shortcuts:v1:${actor}`;

function validated(value: RegisterShortcuts): RegisterShortcuts {
  if (!value || !Array.isArray(value.product_ids) || value.product_ids.length > 8
    || value.product_ids.some(id => typeof id !== 'string' || !uuid.test(id))
    || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error('Elige hasta 8 productos favoritos sin repetir y actualiza antes de guardar.');
  }
  const product_ids = value.product_ids.map(id => id.toLowerCase());
  if (new Set(product_ids).size !== product_ids.length) throw new Error('Elige hasta 8 productos favoritos sin repetir y actualiza antes de guardar.');
  return { product_ids, revision: value.revision };
}

export async function loadRegisterShortcuts(client: Client, signal?: AbortSignal): Promise<RegisterShortcuts> {
  const controller = new AbortController();
  try {
    const { data, error } = await withDeadline(() => client.rpc('get_register_shortcuts').abortSignal(signal ?? controller.signal), { signal });
    if (error) throw new Error(error.message);
    return validated(data as RegisterShortcuts);
  } finally { controller.abort(); }
}

export function readRegisterShortcutsRequest(storage: Memory, actor: string): PendingRegisterShortcuts | null {
  const raw = storage.getItem(registerShortcutsKey(actor));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingRegisterShortcuts;
  if (!value || value.actor !== actor || typeof value.request !== 'string' || !uuid.test(value.request)
    || value.payload?.actor_id !== actor) throw new Error('No se pudieron abrir los favoritos pendientes. Pide ayuda al responsable.');
  validated(value.payload);
  return value;
}

async function locked<T>(actor: string, action: () => Promise<T>): Promise<T> {
  if (!actor) throw new Error('Espera a que termine de cargar la sesión.');
  if (!navigator.locks) throw new Error('Actualiza Chrome o Edge para guardar favoritos.');
  return navigator.locks.request(registerShortcutsKey(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Otra ventana está guardando favoritos.');
    return action();
  });
}

async function submit(client: Client, storage: Memory, pending: PendingRegisterShortcuts): Promise<RegisterShortcuts> {
  const key = registerShortcutsKey(pending.actor), raw = JSON.stringify(pending), controller = new AbortController();
  try {
    const { data, error } = await withDeadline(() => client.rpc('pos_set_register_shortcuts', {
      p_request: pending.request, p_payload: pending.payload,
    }).abortSignal(controller.signal));
    if (error) {
      if ((error.code === 'P0001' || /^(22|23)[0-9A-Z]{3}$/.test(error.code || '')) && storage.getItem(key) === raw) storage.removeItem(key);
      throw new Error(error.message);
    }
    const result = validated(data as RegisterShortcuts);
    if (data?.request_id !== pending.request || result.revision !== pending.payload.revision + 1
      || JSON.stringify(result.product_ids) !== JSON.stringify(pending.payload.product_ids)) {
      throw new Error('No se confirmó el guardado. Pulsa Comprobar guardado.');
    }
    if (storage.getItem(key) !== raw) throw new Error('El guardado cambió en otra ventana. Actualiza antes de continuar.');
    storage.removeItem(key);
    return result;
  } finally { controller.abort(); }
}

export async function saveRegisterShortcuts(client: Client, storage: Memory, actor: string, choices: RegisterShortcuts): Promise<RegisterShortcuts> {
  return locked(actor, async () => {
    const key = registerShortcutsKey(actor);
    if (storage.getItem(key)) throw new Error('Comprueba los favoritos pendientes antes de cambiar la selección.');
    const pending: PendingRegisterShortcuts = { actor, request: crypto.randomUUID(), payload: { ...validated(choices), actor_id: actor } };
    storage.setItem(key, JSON.stringify(pending));
    return submit(client, storage, pending);
  });
}

export async function recoverRegisterShortcuts(client: Client, storage: Memory, actor: string): Promise<RegisterShortcuts> {
  return locked(actor, async () => {
    const pending = readRegisterShortcutsRequest(storage, actor);
    if (!pending) throw new Error('No hay favoritos pendientes.');
    return submit(client, storage, pending);
  });
}

export const preparationNoteChoices = ['Sin hielo', 'Sin azúcar'] as const;
export function hasPreparationNote(note: string, choice: string): boolean {
  return note.split('\n').some(line => line.replace(/\r$/, '') === choice);
}
export function togglePreparationNote(note: string, choice: string): string {
  if (!(preparationNoteChoices as readonly string[]).includes(choice)) return note;
  if (hasPreparationNote(note, choice)) return note.split('\n').filter(line => line.replace(/\r$/, '') !== choice).join('\n');
  const next = `${note}${note ? '\n' : ''}${choice}`;
  return next.length <= 1000 ? next : note;
}
