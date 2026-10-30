import type { SupabaseClient } from '@supabase/supabase-js';
import type { Sale, PastShift } from './pos-types';
import { CAFE_TIME_ZONE } from './tv-dashboard';

export type ReportQuery = { period: 'all' | 'today' | 'range'; from: string; to: string; page: number; asOf: string | null; search: string };
export const reportQuery = (period: ReportQuery['period'] = 'today'): ReportQuery => ({ period, from: '', to: '', page: 0, asOf: null, search: '' });
export interface ReportPage { captured_at: string; as_of: string; day: string; page: number; page_size: number }
export interface SalesReport extends ReportPage {
  summary: { rows: number; completed: number; pending: number; cancelled: number; sales: number; average: number };
  registered_customers: number; active_products: number;
  top_products: { name: string; quantity: number }[];
  payments: { name: string; total: number }[]; orders: Sale[];
}
export interface ShiftReport extends ReportPage {
  summary: { rows: number; sales: number; expenses: number; difference: number }; shifts: PastShift[];
}
export interface CustomerReport {
  captured_at: string; page: number; page_size: number;
  summary: { rows: number; sales: number };
  customers: { id: string; name: string; phone: string | null; points: number | null; completed_spent: number }[];
}
export function reportParams(query: ReportQuery) {
  if (query.period === 'range' && (!/^\d{4}-\d{2}-\d{2}$/.test(query.from) || !/^\d{4}-\d{2}-\d{2}$/.test(query.to) || query.from > query.to)) {
    throw new Error('Selecciona un intervalo de fechas válido.');
  }
  return { p_period: query.period, p_from: query.period === 'range' ? query.from : null,
    p_to: query.period === 'range' ? query.to : null, p_page: query.page, p_as_of: query.asOf };
}
// The server owns totals and the business clock. Never turn unavailable data
// into a zero, or reuse a previous filter's result while the new read is pending.
export async function loadReport<T>(client: SupabaseClient, name: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  requestSignal.throwIfAborted();
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(requestSignal.reason);
    requestSignal.addEventListener('abort', abort, { once: true });
  });
  let response;
  try {
    // SDK credential refresh can stall before fetch exists. Bound that wait as
    // well as the HTTP request, and never publish a late response after abort.
    response = await Promise.race([client.rpc(name, params).abortSignal(requestSignal), aborted]);
  } finally { requestSignal.removeEventListener('abort', abort); }
  const { data, error } = response;
  requestSignal.throwIfAborted();
  if (error) throw new Error(`No se pudo verificar el reporte: ${error.message}`);
  if (!data || !data.summary || !Array.isArray(data.orders ?? data.shifts ?? data.products ?? data.customers)
      || !Number.isSafeInteger(data.summary.rows) || data.summary.rows < 0
      || !Number.isFinite(Date.parse(data.captured_at))) throw new Error('Reporte incompleto. Vuelve a consultar.');
  for (const [key, value] of Object.entries(data.summary)) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Importe inválido en el reporte: ${key}`);
  }
  return data as T;
}
export const reportMoney = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
export const reportDate = (value: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  new Intl.DateTimeFormat('es-MX', { ...options, timeZone: CAFE_TIME_ZONE }).format(new Date(value));
export const reportPeriod = (query: ReportQuery, day: string) => query.period === 'today' ? `Hoy · ${day}` : query.period === 'range' ? `${query.from} a ${query.to} (ambas fechas incluidas)` : 'Histórico';
