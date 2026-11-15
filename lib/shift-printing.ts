import { posProfile } from './pos-profile';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftReport } from './shift';
import { escapeHtml, writePrintDocument } from './printing';
import { withDeadline } from './request-deadline';

export type SavedShift = ShiftReport & { register_id?: string; user_name?: string; opened_at?: string; created_at?: string; closed_at?: string; manager_reason?: string | null };
const date = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-MX', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Matamoros'}).format(new Date(value)) : 'Sin fecha registrada';
export function savedShiftHtml(report: SavedShift, reprint = false) {
  const names = ['starting_cash','total_sales','total_expenses','expected_cash','counted_cash','difference'] as const;
  if (!report.id || names.some(key=>!Number.isFinite(Number(report[key]))) || !Array.isArray(report.expenses_detail)) throw new Error('El corte guardado está incompleto. Actualiza el historial.');
  const money = (value: number | string) => `$${Number(value).toFixed(2)}`;
  const rows = [['Fondo inicial',report.starting_cash],['Ventas totales',report.total_sales],
    ['Ventas en efectivo',Number(report.expected_cash)-Number(report.starting_cash)+Number(report.total_expenses)],
    ['Retiros / gastos',report.total_expenses],['Efectivo esperado',report.expected_cash],['Efectivo contado',report.counted_cash],['Diferencia',report.difference]] as const;
  return `<main style="font:12px Arial,sans-serif;width:70mm;margin:auto;color:#000"><h1>Corte de caja (Z)</h1><h2>${posProfile.shortName}</h2>
    ${reprint?'<p>REIMPRESIÓN DEL CORTE GUARDADO</p>':''}<p>Cajero: ${escapeHtml(report.user_name??'Sin nombre registrado')}</p>
    <p>Apertura: ${date(report.opened_at)}<br>Cierre: ${date(report.closed_at??report.created_at)}</p><p>Folio: ${escapeHtml(report.id)}</p><hr>
    ${rows.map(([label,value])=>`<p style="display:flex;justify-content:space-between"><span>${label}</span><b>${money(value)}</b></p>`).join('')}
    ${report.expenses_detail.length?`<hr><h3>Detalle de gastos</h3>${report.expenses_detail.map(e=>`<p>${escapeHtml(e.desc)}: ${money(e.amount)}</p>`).join('')}`:''}
    ${report.manager_reason?`<p>Cierre realizado por responsable. Motivo: ${escapeHtml(report.manager_reason)}</p>`:''}
    <hr><p>Firma del cajero / responsable</p><p>________________________</p><p>Documento de control interno.</p></main>`;
}
export function printSavedShift(target: Window, report: SavedShift, reprint = false) {
  writePrintDocument(target,savedShiftHtml(report,reprint),'receipt',`Corte Z ${report.id}`);
}
export async function loadSavedShift(client: Pick<SupabaseClient,'rpc'>, id: string): Promise<SavedShift> {
  const {data,error}=await withDeadline(()=>client.rpc('pos_closed_shift',{p_shift:id}));
  if(error)throw new Error(error.message);savedShiftHtml(data);return data;
}
