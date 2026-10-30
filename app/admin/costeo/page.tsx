'use client';

import { loadReport, reportDate, type CostReport } from '@/lib/reports';
import { ReportPagination } from '../ReportControls';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { TrendingUp, Loader2, BarChart3, Info } from 'lucide-react';

export default function CosteoPage() {

  const [page, setPage] = useState(0);
  const loadCosts = useCallback((signal: AbortSignal) => loadReport<CostReport>(supabase, 'pos_cost_report', { p_page: page }, signal), [page]);
  const { data: report, loading, error: loadError, reload: fetchCostData } = useResource<CostReport | null>(loadCosts, null);
  const productsCost = report?.products ?? [];
  const avgMargin = report?.summary.average;

  if (loadError) return <LoadFailure message={loadError} retry={fetchCostData} />;

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-slate-300 w-8 h-8" strokeWidth={1.5} />
    </div>
  );

  if (!report) return null;

  return (
    <div className="max-w-[1100px] mx-auto space-y-12 py-10 animate-in fade-in duration-1000">
      <header className="space-y-1">
        <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Costeo</h2>
        <p className="text-[#86868b] text-lg font-medium">Estimación de ingredientes de la receta base a costos actuales. No incluye variantes, mano de obra, otros gastos ni utilidad histórica.</p>
        <button className="rounded-xl border bg-white p-3" onClick={fetchCostData}>Actualizar costos</button>
        <p className="text-sm text-slate-500">Actualizado {reportDate(report.captured_at)} · Solo productos activos.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50">
          <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight mb-2">Margen base promedio</p>
          <div className="flex items-baseline gap-1">
            <h3 className="text-5xl font-semibold text-[#1d1d1f] tracking-tighter">{avgMargin == null ? 'Sin datos' : `${avgMargin.toFixed(1)}%`}</h3>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[#06c167] bg-[#06c167]/10 w-fit px-3 py-1 rounded-full text-xs font-semibold">
            <TrendingUp size={14} /> {report.summary.configured} de {report.summary.rows} con costo base
          </div>
        </div>

        <div className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 flex flex-col justify-between">
          <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight mb-2">Top Rentabilidad</p>
          <h3 className="text-xl font-semibold text-[#1d1d1f] truncate">{report.top || 'Sin costos completos'}</h3>
          <p className="text-sm text-slate-500">Promedio simple de recetas completas; no ponderado por ventas.</p>
        </div>

        <div className="bg-[#f5f5f7] p-8 rounded-[24px] flex flex-col justify-between border border-transparent">
          <div className="flex justify-between items-start">
            <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight">Alertas</p>
            <Info size={18} className="text-[#86868b]" />
          </div>
          <p className="text-[#1d1d1f] font-medium text-sm leading-relaxed mt-4">
            {report.summary.incomplete} productos sin costo base completo. {report.summary.low_margin} con margen base menor a 30%.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-50 flex items-center gap-2">
            <BarChart3 size={18} className="text-[#1d1d1f]" />
            <h4 className="font-semibold text-[#1d1d1f]">Desglose de productos</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[13px] font-semibold text-[#86868b] border-b border-slate-50">
                <th className="px-8 py-5 font-semibold">Producto</th>
                <th className="px-8 py-5 text-center font-semibold">Venta</th>
                <th className="px-8 py-5 text-center font-semibold">Costo</th>
                <th className="px-8 py-5 text-right font-semibold">Margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {productsCost.map(p => (
                <tr key={p.id} className="hover:bg-[#f5f5f7]/50 transition-colors">
                  <td className="px-8 py-6">
                    <p className="font-semibold text-[#1d1d1f]">{p.name}</p>
                    <p className="text-[11px] text-[#86868b] font-medium uppercase tracking-wider">{p.category}</p>
                  </td>
                  <td className="px-8 py-6 text-center text-[#1d1d1f] font-medium">${Number(p.price).toFixed(2)}</td>
                  <td className="px-8 py-6 text-center text-[#86868b] font-medium">{p.total_cost == null ? 'Sin costo completo' : `${p.total_cost.toFixed(2)}`}</td>
                  <td className="px-8 py-6 text-right">
                    <span className={`inline-block px-3 py-1 rounded-full text-[12px] font-semibold ${
                      p.margin != null && p.margin > 60 ? 'text-[#06c167] bg-[#06c167]/10' :
                      p.margin != null && p.margin > 30 ? 'text-[#0066cc] bg-[#0066cc]/10' : 'text-[#ff3b30] bg-[#ff3b30]/10'
                    }`}>
                      {p.margin == null ? 'Sin calcular' : `${p.margin.toFixed(1)}%`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ReportPagination page={report.page} pageSize={report.page_size} rows={report.summary.rows} onPage={setPage} />
    </div>
  );
}
