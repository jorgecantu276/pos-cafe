import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdministrator } from './user-management';
import { TV_ORDER_MS, summarizeTvOrders, type TvOrder } from './tv-dashboard';
export async function loadTvSnapshot(client: SupabaseClient, signal: AbortSignal, now = new Date()) {
    await requireAdministrator(client);
    const rows: TvOrder[] = [];
    for (let page = 0; page < 40; page++) {
        const { data, error } = await client.from('orders').select('id,ticket_number,created_at,status,receipt_snapshot').eq('status', 'completed')
            .gt('created_at', new Date(+now - TV_ORDER_MS).toISOString()).lte('created_at', now.toISOString())
            .order('created_at', { ascending: true }).order('id', { ascending: true }).range(page * 500, page * 500 + 499).abortSignal(signal);
        if (error || !data)
            throw new Error('No se pudo actualizar la preparación.');
        rows.push(...data as TvOrder[]);
        if (data.length < 500)
            return summarizeTvOrders(rows, now);
    }
    throw new Error('Demasiadas órdenes para mostrar la lista completa.');
}
