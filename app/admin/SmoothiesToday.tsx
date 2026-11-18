'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, Coffee, RefreshCw, ShoppingBag } from 'lucide-react';
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
    <header><h2 id="smoothie-today-title">De tu receta a la barra</h2><button type="button" className="admin-secondary-button" disabled={loading} onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" /> Actualizar ventas</button></header>
    <nav aria-label="De la receta a la venta">
      <Link href="/admin/recetario"><BookOpen size={20} aria-hidden="true" /><span><strong>1. Prueba tu receta</strong><small>Anota, repite y compara</small></span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link href="/admin/productos"><Coffee size={20} aria-hidden="true" /><span><strong>2. Prepara tu menú</strong><small>Revisa tus bebidas y precios</small></span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link href="/"><ShoppingBag size={20} aria-hidden="true" /><span><strong>3. Vende en caja</strong><small>Elige la bebida y cobra</small></span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
    {loading ? <p role="status">Consultando ventas…</p> : error ? <p role="alert">No se pudieron consultar las ventas de hoy.</p> : report && <Link href="/admin/ventas" className="smoothie-today-sales">
      <span><small>Ventas de hoy</small><strong>{reportMoney(report.summary.sales)}</strong></span>
      <span><small>Pedidos pagados</small><strong>{report.summary.completed}</strong></span>
      {best && <span><small>Más pedido</small><strong>{best.name}</strong></span>}
      <ArrowRight size={20} aria-hidden="true" />
    </Link>}
  </section>;
}
