'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback } from 'react';
import { loadReport, reportMoney, reportParams, reportQuery, type SalesReport } from '@/lib/reports';
import { useResource } from '@/lib/use-resource';

export default function SmoothiesToday() {
  const load = useCallback(async (signal: AbortSignal) => {
    const { supabase } = await import('@/lib/supabase');
    return loadReport<SalesReport>(supabase, 'pos_sales_report', { ...reportParams(reportQuery('today')), p_search: '' }, signal);
  }, []);
  const { data, loading, error, reload } = useResource(load, null as SalesReport | null);
  const report = loading || error ? null : data;
  const best = report?.top_products?.[0];

  return <section className="smoothie-today" aria-labelledby="smoothie-today-title">
    <header><h2 id="smoothie-today-title">Hoy en la barra</h2><button type="button" className="admin-secondary-button" disabled={loading} onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" /> Actualizar</button></header>
    {loading ? <p role="status">Consultando ventas…</p> : error ? <p role="alert">No se pudieron consultar las ventas de hoy.</p> : report && <Link href="/admin/ventas" className="smoothie-today-sales">
      <span><small>Ventas de hoy</small><strong>{reportMoney(report.summary.sales)}</strong></span>
      <span><small>Pedidos pagados</small><strong>{report.summary.completed}</strong></span>
      {best && <span><small>Más pedido</small><strong>{best.name}</strong></span>}
      <ArrowRight size={20} aria-hidden="true" />
    </Link>}
    <nav aria-label="Accesos de la barra">
      <Link href="/admin/recetario"><BookOpen size={20} aria-hidden="true" /><span><strong>Recetario privado</strong><small>Guardar o comparar pruebas</small></span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link href="/admin/productos#especial-semanal"><Sparkles size={20} aria-hidden="true" /><span><strong>Especial de la semana</strong><small>Elegir qué destacar en el menú</small></span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
  </section>;
}
