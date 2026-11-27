// Legacy `mixto` means MXN + USD cash. Card/cash uses a separate stored method.
export const splitPaymentMethod = 'efectivo_tarjeta';
export const paymentMethodLabel = (method: string) => ({
  efectivo: 'Efectivo', cash: 'Efectivo', mixto: 'MXN + USD', tarjeta: 'Tarjeta',
  efectivo_tarjeta: 'Mixto · efectivo + tarjeta', otro: 'Otro',
} as Record<string, string>)[method.toLowerCase()] ?? method;

export function splitPayment(total: number, card: string | number, cash: string | number) {
  const parse = (value: string | number) => Number(String(value || 0).replace(',', '.'));
  const cardAmount = parse(card), cashAmount = parse(cash);
  const cents = (value: number) => Math.round(value * 100);
  const validAmount = (value: number) => Number.isFinite(value) && value >= 0 && value <= 10_000_000 && cents(value) / 100 === value;
  const validCard = validAmount(cardAmount) && cardAmount > 0 && cardAmount < total;
  const cashDue = validCard ? (cents(total) - cents(cardAmount)) / 100 : total;
  const valid = validCard && validAmount(cashAmount) && cents(cashAmount) >= cents(cashDue);
  return { cardAmount, cashDue, change: (cents(cashAmount) - cents(cashDue)) / 100, valid };
}
