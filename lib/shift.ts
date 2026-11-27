export interface ShiftSale {
  total: number | string;
  payment_method: string | null;
  status: string | null;
  card_amount_mxn?: number | string;
}
export interface ShiftReport {
  id: string;
  starting_cash: number | string;
  total_sales: number | string;
  total_expenses: number | string;
  expected_cash: number | string;
  counted_cash: number | string;
  difference: number | string;
  expenses_detail: { desc: string; amount: number }[];
  payments?: Record<string, number> | null;
}

export const isCanceled = (status: string | null | undefined) => status === 'canceled' || status === 'cancelled';

export function shiftSales(orders: ShiftSale[]) {
  let salesCents = 0;
  let cashCents = 0;
  for (const order of orders) {
    if (order.status !== 'completed') continue;
    const amount = Math.round(Number(order.total) * 100);
    if (!Number.isFinite(amount)) throw new Error('La venta contiene un importe inválido.');
    salesCents += amount;
    if (order.payment_method === 'efectivo_tarjeta') {
      const card = Math.round(Number(order.card_amount_mxn) * 100);
      if (!Number.isFinite(card) || card <= 0 || card >= amount) throw new Error('La venta mixta contiene un desglose inválido.');
      cashCents += amount - card;
    }
    // Legacy Mixto remains MXN/USD cash.
    if (['efectivo', 'mixto', 'cash'].includes(order.payment_method?.toLowerCase() ?? '')) cashCents += amount;
  }
  return { totalSales: salesCents / 100, cashSales: cashCents / 100 };
}

export async function saveShiftBeforeExit(
  save: () => PromiseLike<{ error: { message: string } | null }>,
  afterSave: () => Promise<void>,
) {
  const { error } = await save();
  if (error) throw new Error(error.message);
  await afterSave();
}
