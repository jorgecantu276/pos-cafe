import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDrawerStatus } from './drawer';
import { loadShiftSummary } from './shift-state';

export async function loadActiveDrawer(client: Pick<SupabaseClient, 'rpc'>, signal?: AbortSignal) {
  const drawer = await loadDrawerStatus(client, signal);
  if (!drawer.active) return { drawer, summary: null };
  const summary = await loadShiftSummary(client, drawer.active.id, signal);
  const verified = await loadDrawerStatus(client, signal);
  if (summary.status !== 'open' || verified.active?.id !== drawer.active.id
      || verified.active.cashier_id !== drawer.active.cashier_id) {
    throw Error('La caja cambió durante la consulta. Actualiza para ver el turno vigente.');
  }
  return { drawer: verified, summary };
}
