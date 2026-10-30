export interface ShiftSale {
  total: number | string;
  payment_method: string | null;
  status: string | null;
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
    // Current checkout uses Mixto for MXN/USD cash, not cash/card split tender.
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
