import type { SupabaseClient } from '@supabase/supabase-js';

export async function cancelLegacySale(client: Pick<SupabaseClient, 'rpc'>, orderId: string) {
  const { error } = await client.rpc('pos_cancel_sale', { p_order: orderId });
  if (error) throw new Error(error.message);
}
export const cancellationNotice = 'La venta se marcará como cancelada. Esto no devuelve dinero ni repone productos. En ventas nuevas revierte puntos y consumo una sola vez. Las piezas que puedan volver a venderse se devuelven a inventario por separado.';
