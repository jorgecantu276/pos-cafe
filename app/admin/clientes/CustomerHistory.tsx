'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { loadReport, reportDate, reportMoney } from '@/lib/reports';
import type { Sale } from '@/lib/pos-types';
import LoadFailure from '@/app/LoadFailure';
import { ReportPagination } from '../ReportControls';

interface Purchases { captured_at: string; as_of: string; page: number; page_size: number; summary: { rows: number; sales: number }; orders: Sale[] }

export default function CustomerHistory({ customer, onClose }: { customer: { id: string; name: string }; onClose: () => void }) {
  const section = useRef<HTMLElement>(null);
  const [query, setQuery] = useState<{ page: number; asOf: string | null }>({ page: 0, asOf: null });
  const load = useCallback((signal: AbortSignal) => loadReport<Purchases>(supabase, 'pos_customer_history', {
    p_customer: customer.id, p_page: query.page, p_as_of: query.asOf,
  }, signal), [customer.id, query]);
  const { data, loading, error, reload } = useResource<Purchases | null>(load, null);
  useEffect(() => { if (!loading) section.current?.scrollIntoView?.({ block: 'start' }); }, [data, loading]);
  const status = (value: string | null) => value === 'completed' ? 'Completada' : ['cancelled', 'canceled'].includes(value ?? '') ? 'Cancelada' : value === 'pending' ? 'Pendiente' : value ?? 'Sin estado';
  return <section ref={section} aria-label={`Compras de ${customer.name}`} className="scroll-mt-24 rounded-2xl border bg-white p-6 space-y-4">
    <div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold">Compras de {customer.name}</h3><p className="text-sm text-slate-500">Compras pagadas; no incluye cancelaciones.</p></div><button type="button" className="rounded-xl border px-4 py-2" onClick={onClose}>Cerrar historial</button></div>
    <button type="button" className="rounded-xl border px-4 py-2" onClick={() => setQuery({ page: 0, asOf: null })}>Actualizar historial</button>
    {error ? <LoadFailure message={error} retry={reload}/> : loading ? <p role="status">Cargando compras…</p> : data && <>
      <p>{data.summary.rows} tickets · Compras completadas {reportMoney(data.summary.sales)}</p>
      {!data.orders.length && <p>No hay compras registradas para este cliente.</p>}
      <ul className="divide-y">{data.orders.map(order => <li key={order.id} className="py-3"><details><summary className="cursor-pointer"><span className="inline-flex flex-wrap gap-x-5 gap-y-1"><strong>Folio {order.ticket_number}</strong><span>{reportDate(order.created_at)}</span><span>{reportMoney(order.total)}</span><span>{status(order.status)}</span></span></summary>
        <p className="mt-3 text-sm">Pago: {order.payment_method === 'efectivo_tarjeta' ? 'Mixto · efectivo + tarjeta' : order.payment_method ?? 'Sin registro'}</p><ul className="mt-2 space-y-2">{order.order_items.map((item, index) => {
          const product = Array.isArray(item.products) ? item.products[0] : item.products;
          return <li key={index} className="text-sm">{item.quantity} × {item.product_snapshot?.name ?? product?.name ?? 'Producto eliminado'} · {reportMoney(item.total_price)}{!!item.product_snapshot?.displayExtras?.length && <p className="text-slate-500">{item.product_snapshot.displayExtras.map(extra => extra.name).join(' · ')}</p>}{item.notes && <p className="text-slate-500 whitespace-pre-wrap">{item.notes}</p>}</li>;
        })}</ul>
      </details></li>)}</ul>
      <ReportPagination page={data.page} pageSize={data.page_size} rows={data.summary.rows} onPage={page => setQuery({ page, asOf: data.as_of })}/>
    </>}
  </section>;
}
