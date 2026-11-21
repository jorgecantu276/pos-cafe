// Use integer cents and the shift's four-decimal rate, matching SQL numeric rounding.
export function receivedCashMXN(mxn: number, usd: number, exchangeRate: number) {
  return (Math.round(mxn * 100) + Math.round(Math.round(usd * 100) * Math.round(exchangeRate * 10_000) / 10_000)) / 100;
}

// Quote whole USD for an MXN sale; the excess is returned in pesos.
export function usdCashQuote(totalMXN: number, exchangeRate: number) {
  if (!Number.isFinite(totalMXN) || totalMXN < 0 || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return null;
  const totalCents = Math.round(totalMXN * 100), rateUnits = Math.round(exchangeRate * 10_000);
  if (!rateUnits) return null;
  const usd = Math.ceil(totalCents * 100 / rateUnits);
  return { usd, changeMXN: (Math.round(receivedCashMXN(0, usd, exchangeRate) * 100) - totalCents) / 100 };
}
