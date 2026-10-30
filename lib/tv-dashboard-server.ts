import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdministrator } from './user-management';
import { cafeDayRange, summarizeTvOrders, type TvOrder } from './tv-dashboard';

export async function loadTvSnapshot(client: SupabaseClient, signal: AbortSignal, now = new Date()) {
  await requireAdministrator(client);
  const { start, end } = cafeDayRange(now);
  const rows: TvOrder[] = [];
  // Read every page, including days above Supabase's default 1,000 row limit.
  // A failed/oversized read never publishes a partial total as a successful snapshot.
  for (let page = 0; page < 40; page++) {
    const { data, error } = await client.from('orders')
      .select('id,ticket_number,created_at,total,status,payment_method')
      .gte('created_at', start).lt('created_at', end).lte('created_at', now.toISOString())
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page * 500, page * 500 + 499).abortSignal(signal);
    if (error || !data) throw new Error('No se pudieron actualizar las ventas.');
    rows.push(...data as TvOrder[]);
    if (data.length < 500) return summarizeTvOrders(rows, now);
  }
  throw new Error('Demasiadas ventas para mostrar un total verificado.');
}
