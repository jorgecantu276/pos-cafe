import type { SupabaseClient } from '@supabase/supabase-js';
import type { Expense } from './pos-types';
import type { ShiftReport } from './shift';

type Client = Pick<SupabaseClient, 'rpc'>;
export interface ShiftSummary {
  register_id: string; status: string; opened_at: string; starting_cash: number; exchange_rate: number;
  cash_sales: number; total_sales: number; expected_cash: number;
  expenses: Expense[]; expenses_revision: number; payments: Record<string, number>;
}
interface ExpenseRequest { p_register: string; p_request: string; p_revision: number; p_expenses: Expense[] }
interface CloseRequest { p_register: string; p_counted: number; p_expenses: Expense[];
  p_preview: Pick<ShiftSummary, 'cash_sales' | 'total_sales' | 'expenses_revision'> }
export const expenseRequestKey = (user: string) => `mi_cafe_expense_request:v1:${user}`;
export const closeRequestKey = (user: string) => `mi_cafe_close_request:v1:${user}`;

export function checkedExpenses(value: unknown): Expense[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(e => !e || typeof e.desc !== 'string'
    || !e.desc.trim() || e.desc.trim().length > 200 || typeof e.amount !== 'number'
    || !Number.isFinite(e.amount) || e.amount <= 0 || e.amount > 1_000_000 || Math.round(e.amount * 100) / 100 !== e.amount)) {
    throw new Error('Los gastos no son válidos. Conserva el registro para revisión.');
  }
  return value.map(e => ({ desc: e.desc, amount: e.amount }));
}
export function checkedSummary(value: unknown): ShiftSummary {
  const s = value as ShiftSummary;
  if (!s || typeof s.register_id !== 'string' || !['open', 'closed'].includes(s.status)
    || !Number.isInteger(s.expenses_revision) || s.expenses_revision < 0
    || ![s.starting_cash, s.exchange_rate, s.cash_sales, s.total_sales, s.expected_cash].every(Number.isFinite)
    || typeof s.opened_at !== 'string' || !s.payments || typeof s.payments !== 'object'
    || Object.values(s.payments).some(v => !Number.isFinite(v))) throw new Error('No se recibió un resumen válido del turno.');
  checkedExpenses(s.expenses);
  return s;
}
async function shiftRpc(client: Client, name: string, request: object, signal?: AbortSignal) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  if (combined.aborted) throw new Error('Se interrumpió la consulta del turno.');
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error('No se confirmó la respuesta del turno. Reintenta la misma solicitud.'));
  combined.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    // Bound SDK/Auth waiting too: passing a fetch signal alone cannot interrupt
    // a client stuck before it starts its PostgREST request.
    return await Promise.race([client.rpc(name, request).abortSignal(combined), aborted]);
  } finally { clearTimeout(timer); combined.removeEventListener('abort', onAbort); }
}
export async function loadShiftSummary(client: Client, register: string, signal?: AbortSignal): Promise<ShiftSummary> {
  const { data, error } = await shiftRpc(client, 'pos_shift_summary', { p_register: register }, signal);
  if (error) throw new Error(error.message);
  return checkedSummary(data);
}
async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Actualiza el navegador para guardar el turno entre ventanas.');
  return navigator.locks.request(`pos-shift:${key}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Otra ventana está guardando este turno. Espera y actualiza.');
    return action();
  });
}
async function submit<T>(client: Client, storage: Storage, key: string, rpc: string, request: object,
  validate: (value: unknown) => T): Promise<T> {
  // Persist the exact identity/payload before I/O. A transport timeout proves
  // nothing about commit; only a confirmed SQL rejection can retire this request.
  const raw = JSON.stringify(request);
  storage.setItem(key, raw);
  const { data, error } = await shiftRpc(client, rpc, request);
  if (error) {
    if (/^[0-9A-Z]{5}$/.test(error.code || '') && storage.getItem(key) === raw) storage.removeItem(key);
    throw new Error(error.message);
  }
  const result = validate(data);
  if (storage.getItem(key) !== raw) throw new Error('El registro pendiente cambió. Revisa el turno antes de continuar.');
  storage.removeItem(key);
  return result;
}
function readExpenseRequest(raw: string): ExpenseRequest {
  const p = JSON.parse(raw) as ExpenseRequest;
  if (!p || typeof p.p_register !== 'string' || typeof p.p_request !== 'string'
    || !Number.isInteger(p.p_revision) || p.p_revision < 0) throw new Error('Solicitud de gastos ilegible. Requiere revisión.');
  checkedExpenses(p.p_expenses);
  return p;
}
export async function saveShiftExpenses(client: Client, storage: Storage, user: string, summary: ShiftSummary,
  expenses: Expense[]): Promise<ShiftSummary> {
  const key = expenseRequestKey(user);
  return serialized(key, async () => {
    const raw = storage.getItem(key);
    const request = raw ? readExpenseRequest(raw) : { p_register: summary.register_id, p_request: crypto.randomUUID(),
      p_revision: summary.expenses_revision, p_expenses: checkedExpenses(expenses) };
    if (request.p_register !== summary.register_id) throw new Error('Recupera los gastos pendientes del turno anterior.');
    return submit(client, storage, key, 'pos_shift_expenses', request, checkedSummary);
  });
}
export async function restoreShiftExpenses(client: Client, storage: Storage, user: string, register: string,
  signal?: AbortSignal): Promise<ShiftSummary> {
  let summary = await loadShiftSummary(client, register, signal);
  const pending = storage.getItem(expenseRequestKey(user));
  if (pending) {
    const request = readExpenseRequest(pending);
    if (request.p_register !== register) throw new Error('Hay gastos pendientes de otro turno. Requiere conciliación.');
    summary = await saveShiftExpenses(client, storage, user, summary, request.p_expenses);
  }
  const legacyKey = `mi_cafe_shift:${user}`;
  const legacyRaw = storage.getItem(legacyKey);
  if (legacyRaw) {
    const legacy = JSON.parse(legacyRaw);
    if (legacy.registerId === register) {
      const expenses = checkedExpenses(legacy.expenses);
      if (expenses.length && JSON.stringify(expenses) !== JSON.stringify(summary.expenses)) {
        if (summary.expenses_revision !== 0) throw new Error('Los gastos locales anteriores difieren del registro guardado. Requiere conciliación; no se sobrescribió ningún gasto.');
        summary = await saveShiftExpenses(client, storage, user, summary, expenses);
      }
      if (storage.getItem(legacyKey) === legacyRaw) storage.removeItem(legacyKey);
    }
  }
  return summary;
}
export async function recoverPendingExpenses(client: Client, storage: Storage, user: string): Promise<void> {
  const raw = storage.getItem(expenseRequestKey(user));
  if (!raw) return;
  const request = readExpenseRequest(raw);
  const summary = await loadShiftSummary(client, request.p_register);
  await saveShiftExpenses(client, storage, user, summary, request.p_expenses);
}
function checkedReport(value: unknown): ShiftReport {
  const report = value as ShiftReport;
  if (!report?.id || !['starting_cash','total_sales','total_expenses','expected_cash','counted_cash','difference']
    .every(key => Number.isFinite(Number(report[key as keyof ShiftReport])))) throw new Error('No se recibió el corte guardado.');
  checkedExpenses(report.expenses_detail);
  return report;
}
function readCloseRequest(raw: string): CloseRequest {
  const p = JSON.parse(raw) as CloseRequest;
  if (!p || typeof p.p_register !== 'string' || !Number.isFinite(p.p_counted) || p.p_counted < 0 || !p.p_preview
    || ![p.p_preview.cash_sales,p.p_preview.total_sales,p.p_preview.expenses_revision].every(Number.isFinite)) {
    throw new Error('Corte pendiente ilegible. Requiere revisión.');
  }
  checkedExpenses(p.p_expenses);
  return p;
}
export async function closeShift(client: Client, storage: Storage, user: string, summary: ShiftSummary,
  counted: number): Promise<ShiftReport> {
  if (storage.getItem(expenseRequestKey(user))) throw new Error('Recupera el gasto pendiente antes de cerrar.');
  const key = closeRequestKey(user);
  return serialized(key, async () => {
    const raw = storage.getItem(key);
    const request: CloseRequest = raw ? readCloseRequest(raw) : { p_register: summary.register_id,
      p_counted: Math.round(counted * 100) / 100, p_expenses: summary.expenses,
      p_preview: { cash_sales: summary.cash_sales, total_sales: summary.total_sales, expenses_revision: summary.expenses_revision } };
    if (request.p_register !== summary.register_id) throw new Error('Recupera el corte pendiente anterior.');
    return submit(client, storage, key, 'pos_close_shift', request, checkedReport);
  });
}
export async function recoverShiftClose(client: Client, storage: Storage, user: string): Promise<void> {
  const key = closeRequestKey(user);
  if (!storage.getItem(key)) return;
  await serialized(key, async () => {
    const raw = storage.getItem(key);
    if (raw) await submit(client, storage, key, 'pos_close_shift', readCloseRequest(raw), checkedReport);
  });
}
