'use client';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import {loadSavedShift,printSavedShift} from '@/lib/shift-printing';
import {openPrintWindow} from '@/lib/printing';
import { loadReport, reportParams, reportQuery, reportDate, reportMoney, reportPeriod, type ShiftReport } from '@/lib/reports';
import { ReportFilters, ReportPagination } from '../ReportControls';
import { loadActiveDrawer } from '@/lib/active-drawer';
import { Receipt, CreditCard, User, AlertCircle, Loader2, History, FileText } from 'lucide-react';

export default function CortesPage() {

  const loadActive = useCallback((signal: AbortSignal) => loadActiveDrawer(supabase, signal), []);
  const { data: active, loading, error: loadError, reload: reloadActive } = useResource(loadActive, null);
  const summary = active?.summary ?? null;
  const shiftActive = summary !== null;

  // Estado del Historial de Cortes
  const [query, setQuery] = useState(reportQuery('all'));
  const loadHistory = useCallback((signal: AbortSignal) => loadReport<ShiftReport>(supabase, 'pos_shift_history', reportParams(query), signal), [query]);
  const { data: history, loading: historyLoading, error: historyError, reload: reloadHistory } = useResource<ShiftReport | null>(loadHistory, null);
  const pastShifts = history?.shifts ?? [];
  const reprint = async(id:string) => {
    const target=openPrintWindow();if(!target)return;
    try{const report=await loadSavedShift(supabase,id);printSavedShift(target,report,true);}
    catch(error){target.close();alert(error instanceof Error?error.message:'No se pudo recuperar el corte guardado.');}
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[#0071e3] w-8 h-8" strokeWidth={1.5} />
      </div>
    );
  }

  if (loadError) return <LoadFailure message={loadError} retry={reloadActive} />;

  // MATEMÁTICAS DEL TURNO ACTIVO
  const startingCash = summary?.starting_cash ?? 0;
  const expensesList = summary?.expenses ?? [];
  const totalExpenses = expensesList.reduce((sum, exp) => sum + Number(exp.amount), 0);
  const totalSales = summary?.total_sales ?? 0;
  const salesByMethod = summary?.payments ?? {};
  const expectedCash = summary?.expected_cash ?? 0;

  return (
    <div className="max-w-[1100px] mx-auto space-y-12 animate-in fade-in duration-500 pb-32 pt-6">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Caja</h1>
          <p className="text-[#86868b] text-sm font-bold uppercase tracking-widest mt-1">Turno actual e historial de cierres</p>
        </div>
        <button className="rounded-xl border bg-white p-3" onClick={() => { void reloadActive(); void reloadHistory(); }}>Actualizar caja</button>
      </header>

      {/* 🟢 SECCIÓN 1: TURNO EN VIVO */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 px-2">
          <div className={`w-2.5 h-2.5 rounded-full ${shiftActive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
          <h3 className="text-lg font-bold text-[#1d1d1f]">{shiftActive ? `Caja a cargo de ${active?.drawer.active?.cashier_name}` : 'Caja cerrada'}</h3>
        </div>

        {!shiftActive ? (
          <div className="bg-white p-10 rounded-[32px] border border-slate-100 flex flex-col items-center text-center shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
            <div className="bg-slate-50 p-5 rounded-full mb-4">
              <AlertCircle size={32} className="text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">{active?.drawer.handoff ? `Entrega pendiente para ${active.drawer.handoff.to_name}` : 'No hay un turno abierto'}</h3>
            <p className="max-w-sm text-slate-500 text-sm font-medium">
              El historial muestra los cortes de todos los cajeros.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* WIDGETS TURNO ACTIVO */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-slate-100/50 flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Fondo Inicial</p>
                  <h3 className="text-2xl font-black text-[#1d1d1f] tracking-tighter">${startingCash.toFixed(2)}</h3>
              </div>
              <div className="bg-white p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-slate-100/50 flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-[#0071e3] uppercase tracking-widest mb-1">Ventas completadas</p>
                  <h3 className="text-2xl font-black text-[#0071e3] tracking-tighter">${totalSales.toFixed(2)}</h3>
              </div>
              <div className="bg-white p-6 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-slate-100/50 flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-red-500 uppercase tracking-widest mb-1">Retiros/Gastos</p>
                  <h3 className="text-2xl font-black text-red-500 tracking-tighter">${totalExpenses.toFixed(2)}</h3>
              </div>
              <div className="bg-[#1d1d1f] p-6 rounded-[24px] shadow-lg shadow-slate-200 flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Efectivo Esperado</p>
                  <h3 className="text-3xl font-black text-white tracking-tighter">${expectedCash.toFixed(2)}</h3>
              </div>
            </div>

            {/* DESGLOSES */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-slate-100/50 p-6">
                  <div className="flex items-center gap-2 mb-4">
                     <CreditCard size={18} className="text-[#0071e3]" />
                     <h4 className="font-bold text-[#1d1d1f]">Ingresos por Método</h4>
                  </div>
                  <div className="space-y-3">
                     {Object.entries(salesByMethod).length > 0 ? (
                        Object.entries(salesByMethod).map(([method, amount]) => (
                          <div key={method} className="flex justify-between items-center p-3 bg-[#f5f5f7] rounded-xl">
                             <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{method}</span>
                             <span className="font-black text-slate-800">${amount.toFixed(2)}</span>
                          </div>
                        ))
                     ) : (
                        <p className="text-sm text-slate-400 font-medium">Aún no hay ventas registradas.</p>
                     )}
                  </div>
               </div>

               <div className="bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-slate-100/50 p-6">
                  <div className="flex items-center gap-2 mb-4">
                     <Receipt size={18} className="text-red-500" />
                     <h4 className="font-bold text-[#1d1d1f]">Detalle de Gastos</h4>
                  </div>
                  <div className="space-y-2">
                     {expensesList.length > 0 ? (
                        expensesList.map((exp, idx) => (
                          <div key={idx} className="flex justify-between items-center p-3 border border-slate-100 rounded-xl">
                             <span className="text-sm font-semibold text-slate-600">{exp.desc}</span>
                             <span className="text-sm font-black text-red-500">-${Number(exp.amount).toFixed(2)}</span>
                          </div>
                        ))
                     ) : (
                        <p className="text-sm text-slate-400 font-medium text-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">No hay retiros registrados.</p>
                     )}
                  </div>
               </div>
            </div>
          </div>
        )}
      </section>

      {/* 🟢 SECCIÓN 2: HISTORIAL DE CORTES (CORTES Z) */}
      <section className="space-y-6 pt-6">
        <ReportFilters query={query} onChange={setQuery} />
        {historyError ? <LoadFailure message={historyError} retry={reloadHistory} /> : historyLoading ? <p role="status">Verificando cortes…</p> : history && <>
        <p className="text-sm text-slate-500">{reportPeriod(query, history.day)} · Fecha de cierre en Matamoros. Actualizado {reportDate(history.captured_at)}.</p>
        <p className="text-sm">{history.summary.rows} cortes · Ventas de turnos cerrados {reportMoney(history.summary.sales)} · Retiros {reportMoney(history.summary.expenses)} · Diferencia neta {reportMoney(history.summary.difference)}</p>
        <div className="flex items-center gap-3 px-2">
          <History size={22} className="text-[#1d1d1f]" />
          <h3 className="text-xl font-bold text-[#1d1d1f]">Historial de Cortes (Z)</h3>
        </div>

        <div className="bg-white rounded-[32px] shadow-[0_4px_24px_rgba(0,0,0,0.03)] border border-slate-100/50 overflow-hidden">
          {pastShifts.length > 0 ? (
            <div className="divide-y divide-slate-50">
              {pastShifts.map((shift) => (
                <div key={shift.id} className="p-6 flex flex-col md:flex-row justify-between items-center gap-6 hover:bg-[#f5f5f7]/60 transition-colors group">
                  
                  <div className="flex items-center gap-5 w-full md:w-auto">
                    <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 border border-slate-100 group-hover:bg-white group-hover:shadow-md transition-all">
                      <button type="button" aria-label={`Reimprimir corte de ${shift.user_name}`} onClick={()=>void reprint(shift.id)}><FileText size={20} strokeWidth={1.5} /> Reimprimir Z</button>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
                          {reportDate(shift.created_at, { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                          Cierre: {reportDate(shift.created_at, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                        <User size={14} className="text-slate-400" /> Atendió: {shift.user_name || 'Cajero'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Ventas del Turno</p>
                      <p className="text-xl font-black text-[#1d1d1f] tracking-tighter">${Number(shift.total_sales).toFixed(2)}</p>
                    </div>
                    
                    <div className="w-px h-8 bg-slate-100 hidden md:block"></div>

                    <div className="text-right min-w-[100px]">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Arqueo</p>
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider ${Number(shift.difference) === 0 ? 'bg-green-50 text-green-600 border border-green-100' : Number(shift.difference) > 0 ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                        {Number(shift.difference) === 0 ? 'Cuadrado' : Number(shift.difference) > 0 ? `+ $${Number(shift.difference).toFixed(2)}` : `- $${Math.abs(Number(shift.difference)).toFixed(2)}`}
                      </span>
                    </div>


                  </div>

                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Receipt size={40} className="text-slate-200 mb-4" />
              <h4 className="text-slate-500 font-bold text-lg">Aún no hay cortes registrados</h4>
              <p className="text-slate-400 text-sm mt-1">Los cortes Z aparecerán aquí tras cerrar el turno.</p>
            </div>
          )}
        </div>
        <ReportPagination page={history.page} pageSize={history.page_size} rows={history.summary.rows} onPage={page => setQuery({ ...query, page, asOf: history.as_of })} />
        </>}
      </section>

    </div>
  );
}
