export const CAFE_TIME_ZONE = 'America/Matamoros';
export const TV_REFRESH_MS = 5_000;
export const TV_STALE_MS = 20_000;

export interface TvOrder {
  id: string;
  ticket_number: number | null;
  created_at: string;
  total: number;
  status: string | null;
  payment_method: string | null;
}
export interface TvSnapshot {
  day: string;
  capturedAt: string;
  sales: number;
  completed: number;
  average: number;
  pending: number;
  cancelled: number;
  hourly: number[];
  payments: { name: string; total: number }[];
  recent: TvOrder[];
}

function parts(date: Date) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: CAFE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(values.map(p => [p.type, p.value]));
}
export function cafeDay(date: Date) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// Resolve local midnight on each side independently: DST days can be 23 or 25 hours.
export function cafeDayRange(now: Date) {
  const day = cafeDay(now);
  const midnight = (utcDay: number) => {
    let result = utcDay;
    for (let i = 0; i < 3; i++) {
      const p = parts(new Date(result));
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      result += utcDay - wall;
    }
    return new Date(result).toISOString();
  };
  const utcDay = Date.parse(`${day}T00:00:00Z`);
  return { day, start: midnight(utcDay), end: midnight(utcDay + 86_400_000) };
}

export function summarizeTvOrders(orders: TvOrder[], now: Date): TvSnapshot {
  const day = cafeDay(now);
  const today = orders.filter(o => cafeDay(new Date(o.created_at)) === day && Date.parse(o.created_at) <= now.getTime());
  let cents = 0, completed = 0, pending = 0, cancelled = 0;
  const hourly = Array<number>(24).fill(0);
  const payments = new Map<string, number>();
  for (const order of today) {
    if (order.status === 'pending') pending++;
    if (order.status === 'cancelled' || order.status === 'canceled') cancelled++;
    if (order.status !== 'completed') continue;
    const amount = Math.round(Number(order.total) * 100);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Importe de venta inválido.');
    cents += amount;
    completed++;
    hourly[+parts(new Date(order.created_at)).hour] += amount;
    const name = ({ efectivo: 'Efectivo', cash: 'Efectivo', tarjeta: 'Tarjeta', card: 'Tarjeta',
      mixto: 'Mixto', transfer: 'Transferencia', transferencia: 'Transferencia' } as Record<string, string>)[order.payment_method ?? ''] ?? 'Otro';
    payments.set(name, (payments.get(name) ?? 0) + amount);
  }
  return { day, capturedAt: now.toISOString(), sales: cents / 100, completed,
    average: completed ? Math.round(cents / completed) / 100 : 0, pending, cancelled,
    hourly: hourly.map(value => value / 100),
    payments: [...payments].map(([name, total]) => ({ name, total: total / 100 })).sort((a, b) => b.total - a.total),
    recent: [...today].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, 7),
  };
}

export function tvStatus(status: string | null) {
  return ({ completed: 'Completada', pending: 'Revisar pago', cancelled: 'Cancelada', canceled: 'Cancelada' } as Record<string, string>)[status ?? ''] ?? 'Sin clasificar';
}

export function tvIsStale(snapshot: TvSnapshot, now: Date) {
  return now.getTime() - Date.parse(snapshot.capturedAt) > TV_STALE_MS || snapshot.day !== cafeDay(now);
}

export const tvMoney = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
export const tvTime = (value: string) => new Intl.DateTimeFormat('es-MX', {
  timeZone: CAFE_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(new Date(value));
