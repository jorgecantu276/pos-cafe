import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';

export interface RecentTicket {
  id: string;
  ticket_number: string;
  total: number;
  created_at: string | null;
  status: string;
  cashier_name: string;
}

export function canReprintTicket(status: string): boolean {
  // The historical-receipt endpoint marks cancelled copies explicitly.
  return ['completed', 'cancelled', 'canceled'].includes(status);
}

export function ticketStatusLabel(status: string): string {
  if (status === 'completed') return 'Completado';
  if (['cancelled', 'canceled'].includes(status)) return 'Cancelado';
  if (status === 'pending') return 'Pendiente de revisión';
  return 'Estado por revisar';
}

export async function readRecentTickets(client: Pick<SupabaseClient, 'rpc'>, signal?: AbortSignal): Promise<RecentTicket[]> {
  const { data, error } = await withDeadline(() => {
    const query = client.rpc('pos_recent_tickets', { p_limit: 10 });
    return signal ? query.abortSignal(signal) : query;
  }, { signal });
  if (error) throw new Error('No se pudieron cargar los tickets. Revisa la conexión y vuelve a intentar.');
  if (!Array.isArray(data) || data.length > 10) throw new Error('No se recibió una lista válida de tickets. Vuelve a intentar.');
  const seen = new Set<string>();
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('No se recibió una lista válida de tickets. Vuelve a intentar.');
    const row = value as Record<string, unknown>;
    const total = Number(row.total);
    if (typeof row.id !== 'string' || !row.id || seen.has(row.id)
      || !/^[1-9]\d{0,14}$/.test(String(row.ticket_number))
      || !['number', 'string'].includes(typeof row.total) || row.total === '' || !Number.isFinite(total) || total < 0
      || (row.created_at !== null && (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))))
      || typeof row.status !== 'string' || typeof row.cashier_name !== 'string' || !row.cashier_name.trim())
      throw new Error('No se recibió una lista válida de tickets. Vuelve a intentar.');
    seen.add(row.id);
    return { id: row.id, ticket_number: String(row.ticket_number), total, created_at: row.created_at as string | null,
      status: row.status, cashier_name: row.cashier_name };
  });
}
