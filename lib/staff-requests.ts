export const staffPendingKey = 'pos_staff_change_pending:v1';
export type StaffPending = { operation: 'create' | 'edit' | 'deactivate'; username: string; id?: string };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class StaffRequestUncertain extends Error {}
export function readStaffPending(storage: Storage): StaffPending | null {
  const raw = storage.getItem(staffPendingKey); if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (['create', 'edit', 'deactivate'].includes(value.operation) && typeof value.username === 'string') return value;
  } catch { /* Corrupt markers still block another write until reviewed. */ }
  return { operation: 'edit', username: 'operación anterior' };
}
export function acknowledgeStaffPending(storage: Storage) { storage.removeItem(staffPendingKey); }

export async function saveStaffChange(storage: Storage, pending: StaffPending, payload: Record<string, unknown>, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  if (readStaffPending(storage)) throw new StaffRequestUncertain('Hay un cambio sin confirmar. Revisa el resultado antes de enviar otro.');
  // Do not persist the password or full payload. Never replay this operation automatically.
  storage.setItem(staffPendingKey, JSON.stringify(pending));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    // Promise.race also bounds a stalled/mock fetch implementation that ignores abort.
    const expired = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new StaffRequestUncertain('La conexión tardó demasiado. No se confirmó el cambio; revisa la lista y el acceso antes de repetirlo.')), { once: true }));
    const request = (async () => {
      const response = await (options.fetch ?? fetch)('/api/users', { method: pending.operation === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) {
        if (result.uncertain || response.status >= 500) throw new StaffRequestUncertain(result.error || 'No se confirmó el cambio. Revisa antes de repetirlo.');
        storage.removeItem(staffPendingKey);
        throw new Error(result.error || 'No se pudo guardar.');
      }
      if (result.success !== true || (pending.operation !== 'create' && payload.password && result.password_changed !== true)) {
        throw new StaffRequestUncertain('No se confirmaron los cambios. Comprueba el usuario y su acceso.');
      }
      storage.removeItem(staffPendingKey);
      return result as { success: true; password_changed?: boolean };
    })();
    return await Promise.race([request, expired]);
  } catch (error) {
    if (error instanceof StaffRequestUncertain) throw error;
    if (storage.getItem(staffPendingKey)) throw new StaffRequestUncertain('No se confirmó el cambio. Comprueba el usuario y su acceso antes de volver a editarlo.');
    throw error;
  } finally { clearTimeout(timeout); }
}
