import type { SupabaseClient } from '@supabase/supabase-js';

export async function cancelLegacySale(client: Pick<SupabaseClient, 'rpc'>, orderId: string) {
  const { error } = await client.rpc('pos_cancel_sale', { p_order: orderId });
  if (error) throw new Error(error.message);
}
export const cancellationNotice = '¿Cancelar esta venta? Esto no devuelve dinero. Si corresponde, haz el reembolso por separado.';
