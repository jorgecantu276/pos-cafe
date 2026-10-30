'use client';

import { loadReport, reportMoney, reportDate, type CustomerReport } from '@/lib/reports';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { ReportPagination } from '../ReportControls';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, Star, Phone, Mail, TrendingUp } from 'lucide-react';

export default function ClientesPage() {
  const [query, setQuery] = useState({ search: '', page: 0 });
  const load = useCallback((signal: AbortSignal) => loadReport<CustomerReport>(supabase, 'pos_customer_report', { p_search: query.search, p_page: query.page }, signal), [query]);
  const { data: report, loading, error, reload } = useResource<CustomerReport | null>(load, null);
  const filtered = report?.customers ?? [];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">CRM de Clientes</h2>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-1">Tu comunidad de café</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar por nombre..."
            maxLength={100}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-12 pr-4 outline-none text-sm font-bold"
            value={query.search}
            onChange={event => setQuery({ search: event.target.value, page: 0 })}
          />
        </div>
      </header>

      <button className="rounded-xl border bg-white p-3" onClick={() => setQuery({ ...query, page: 0 })}>Actualizar clientes</button>
      <p className="text-sm text-slate-500">Compras completadas asociadas al cliente; excluye cancelaciones y pendientes. Los puntos conservan su registro de fidelidad.</p>
      {error ? <LoadFailure message={error} retry={reload} /> : loading ? <p role="status">Verificando clientes…</p> : report && <>
      <p className="text-sm">{report.summary.rows} clientes · Compras completadas {reportMoney(report.summary.sales)} · Actualizado {reportDate(report.captured_at)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(customer => (
          <div key={customer.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 font-black text-xl">
                {customer.name.charAt(0)}
              </div>
              <div className="bg-amber-50 text-amber-600 px-3 py-1 rounded-full flex items-center gap-1 text-[10px] font-black">
                <Star size={12} fill="currentColor" /> {customer.points} PTS
              </div>
            </div>
            <h4 className="text-lg font-bold text-slate-800">{customer.name}</h4>
            <div className="space-y-2 mt-4">
              <p className="text-xs text-slate-400 flex items-center gap-2"><Mail size={14}/> {'Sin correo'}</p>
              <p className="text-xs text-slate-400 flex items-center gap-2"><Phone size={14}/> {customer.phone || 'Sin teléfono'}</p>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-50 flex justify-between items-center">
               <div>
                 <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Compras completadas</p>
                 <p className="text-xl font-black text-slate-900">{reportMoney(customer.completed_spent)}</p>
               </div>
               <div className="bg-emerald-50 text-emerald-600 p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                 <TrendingUp size={20}/>
               </div>
            </div>
          </div>
        ))}
      </div>
      <ReportPagination page={report.page} pageSize={report.page_size} rows={report.summary.rows} onPage={page => setQuery({ ...query, page })} />
      </>}
    </div>
  );
}