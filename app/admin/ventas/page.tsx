'use client';
import InventoryReturn from '../inventario/InventoryReturn';

import { type Sale, errorMessage } from '@/lib/pos-types';
import Link from 'next/link';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import {useDebouncedValue} from '@/lib/use-debounced-value';
import LoadFailure from '@/app/LoadFailure';
import { openPrintWindow } from '@/lib/printing';
import { printHistoricalReceipt } from '@/lib/receipt-reprint';
import { ReportFilters, ReportPagination } from '../ReportControls';
import { loadReport, reportParams, reportQuery, reportMoney, reportDate, reportPeriod, type SalesReport } from '@/lib/reports';
import { isCanceled } from '@/lib/shift';
import { cancelLegacySale, cancellationNotice } from '@/lib/cancellation';
import AdminDialog from '../AdminDialog';
import { Loader2, Keyboard, Delete, Printer, Ban, AlertCircle } from 'lucide-react';

export default function VentasPage() {

  const [query, setQuery] = useState(reportQuery('all'));
  
  // ESTADOS PARA EL BUSCADOR Y EL TECLADO
  const [searchTerm, setSearchTerm] = useState('');
  const resetSearchPage=useCallback(()=>setQuery(previous=>({...previous,page:0,asOf:null})),[]);
  const search=useDebouncedValue(searchTerm,300,resetSearchPage),searchPending=search!==searchTerm;
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // 🟢 ESTADOS PARA EL MODAL DE DETALLE DE ORDEN
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);

  const loadOrders = useCallback((signal: AbortSignal) => loadReport<SalesReport>(supabase, 'pos_sales_report', {
    ...reportParams(query), p_search: search,
  }, signal), [query, search]);
  const { data: report, loading, error: loadError, reload: fetchOrders } = useResource<SalesReport | null>(loadOrders, null);
  const orders = report?.orders ?? [];
  const filteredOrders = orders;

  const changeSearch = (value: string) => setSearchTerm(value);

  // LÓGICA DEL TECLADO VIRTUAL
  const handleKeyClick = (key: string) => {
    if (key === 'DELETE') {
      changeSearch(searchTerm.slice(0, -1));
    } else {
      changeSearch(searchTerm + key);
    }
  };

  const keys = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l','@'],
    ['z','x','c','v','b','n','m','.', '_', 'DELETE']
  ];

  // 🟢 FUNCIÓN PARA REIMPRIMIR TICKET
  const handleReprintTicket = async (order: Sale) => {
    const target = openPrintWindow();
    if (!target) return;
    try { await printHistoricalReceipt(target, { orderId: order.id }); }
    catch (error) { alert('Error: ' + errorMessage(error)); }
  };

  const handleCancelOrder = async () => {
    if (!selectedOrder) return;
    
    const confirmCancel = window.confirm(cancellationNotice);
    if (!confirmCancel) return;

    setIsCanceling(true);
    try {
      await cancelLegacySale(supabase, selectedOrder.id);
      setQuery(previous => ({ ...previous, page: 0, asOf: null }));
      setSelectedOrder(null);
      alert('Venta cancelada. El dinero no se ha devuelto.');

    } catch (error: unknown) {
      alert('No se pudo cancelar la venta. ' + errorMessage(error));
    } finally {
      setIsCanceling(false);
    }
  };

  if (loading && !report) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-slate-300 w-8 h-8" strokeWidth={1.5} />
    </div>
  );

  if (loadError&&!searchPending&&!loading) return <LoadFailure message={loadError} retry={fetchOrders} />;

  if (!report) return null;

  return (
    <div className="workspace-sales">
      <header><div className="workspace-admin-heading-row"><h1>Ventas</h1><Link className="workspace-admin-text-action" href="/tv" target="_blank" rel="noopener noreferrer">Abrir pantalla de ventas</Link></div><div className="workspace-sales-filters"><div className="workspace-sales-search"><input type="search" aria-label="Buscar ticket o producto" placeholder="Buscar ticket o producto" maxLength={100} value={searchTerm} onChange={event => changeSearch(event.target.value)} /><button type="button" aria-label="Teclado de búsqueda" aria-pressed={isKeyboardOpen} onClick={() => setIsKeyboardOpen(!isKeyboardOpen)}><Keyboard size={22}/></button></div><ReportFilters query={query} onChange={setQuery}/></div></header>
      {loading||searchPending ? <p role="status">Verificando reporte…</p> : <>
        <div className="workspace-sales-total"><span>Ventas pagadas <strong>{reportMoney(report.summary.sales)}</strong></span><span>{report.summary.completed} tickets · {reportPeriod(query, report.day)}</span></div>
        <div className="workspace-sales-list" aria-label="Tickets">{filteredOrders.map(order => <button type="button" key={order.id} onClick={() => setSelectedOrder(order)}>
          <span><strong>#{String(order.ticket_number ?? order.id.split('-')[0]).padStart(4, '0')}</strong><small>{reportDate(order.created_at, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span>
          <span className="workspace-sales-items">{order.order_items.map(item => { const info=item.product_snapshot || (Array.isArray(item.products) ? item.products[0] : item.products); return item.quantity+' × '+(info?.name || 'Producto'); }).join(', ')}{isCanceled(order.status) && <small>Cancelado</small>}{order.status === 'pending' && <small>Pendiente de revisión</small>}</span>
          <span className="workspace-sales-amount"><strong>{reportMoney(Number(order.total))}</strong><small>{order.payment_method}</small></span>
        </button>)}</div>
        {!filteredOrders.length && <p className="workspace-sales-empty">No hay ventas en este periodo.</p>}
        <ReportPagination page={report.page} pageSize={report.page_size} rows={report.summary.rows} onPage={page => setQuery({ ...query, page, asOf: report.as_of })}/>
        <details className="workspace-sales-details"><summary>Desglose</summary><p>{report.summary.pending} pendientes · {report.summary.cancelled} canceladas · Ticket promedio {reportMoney(report.summary.average)}</p><div>{report.payments.map(payment => <p key={payment.name}>{payment.name}: {reportMoney(payment.total)}</p>)}</div><p>Ventas pagadas en MXN; no incluye cancelaciones.</p><p>Actualizado {reportDate(report.captured_at)} · Matamoros</p></details>
      </>}
      {selectedOrder && <AdminDialog title={`Ticket #${String(selectedOrder.ticket_number ?? selectedOrder.id.split('-')[0]).padStart(4, '0')}`} onClose={() => setSelectedOrder(null)} busy={isCanceling} footer={<div className="ticket-actions">
        <button type="button" disabled={isCanceling} onClick={() => void handleReprintTicket(selectedOrder)} className="admin-primary-button"><Printer size={20}/>Reimprimir ticket</button>
        {selectedOrder.status === 'completed' && <button type="button" disabled={isCanceling} onClick={() => void handleCancelOrder()} className="admin-danger-button">{isCanceling ? <Loader2 className="animate-spin" size={20}/> : <Ban size={20}/>} {isCanceling ? 'Cancelando…' : 'Cancelar venta'}</button>}
        <Link className="workspace-admin-text-action" href="/admin/impresion">Revisar impresión pendiente</Link>
      </div>}>
        <p className="ticket-date">{reportDate(selectedOrder.created_at)}</p>
            {isCanceled(selectedOrder.status) && (
              <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-xl flex items-center gap-3 mb-6">
                <AlertCircle size={20} />
                <p className="text-sm font-bold">Venta cancelada. El dinero no se ha devuelto.</p>
              </div>
            )}

            <div className="bg-[#f5f5f7] rounded-2xl p-5 mb-6 space-y-3">
              <h4 className="text-[10px] font-black uppercase text-[#86868b] tracking-widest border-b border-slate-200 pb-2 mb-3">Artículos</h4>
              {selectedOrder.order_items.map((item, idx) => {
                const pInfo = item.product_snapshot || (Array.isArray(item.products) ? item.products[0] : item.products);
                return (
                  <div key={idx} className="flex justify-between items-center text-sm font-bold text-slate-700">
                    <span>{item.quantity}x {pInfo?.name || 'Producto'}</span>
                    <span>${Number(item.total_price || 0).toFixed(2)}</span>
                  </div>
                )
              })}
              <div className="border-t border-slate-200 pt-3 mt-3 flex justify-between items-end">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Total</span>
                <span className="text-2xl font-black tracking-tighter text-[#1d1d1f]">${Number(selectedOrder.total).toFixed(2)}</span>
              </div>
            </div>

        {isCanceled(selectedOrder.status) && <InventoryReturn key={selectedOrder.id} orderId={selectedOrder.id}/>}
      </AdminDialog>}

      {/* TECLADO VIRTUAL G-BOARD STYLE */}
      {isKeyboardOpen && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-slate-200 p-4 pb-8 animate-in slide-in-from-bottom duration-300 z-[100]">
          <div className="max-w-[800px] mx-auto">
            <div className="flex justify-between items-center mb-4 px-2">
               <span className="text-[11px] font-black uppercase tracking-widest text-blue-600">
                  Buscando en Ventas...
               </span>
               <button onClick={() => setIsKeyboardOpen(false)} className="text-xs font-bold bg-slate-100 hover:bg-slate-200 px-4 py-1.5 rounded-full uppercase transition-colors">
                  Ocultar Teclado
               </button>
            </div>
            <div className="flex flex-col gap-2">
              {keys.map((row, i) => (
                <div key={i} className="flex justify-center gap-1.5">
                  {row.map(key => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      className={`h-12 ${key === 'DELETE' ? 'w-20 bg-red-50 text-red-500' : 'flex-1 bg-white'} border border-slate-200 rounded-xl font-bold shadow-sm active:scale-95 active:bg-slate-100 transition-all ${key !== 'DELETE' && 'text-lg'} uppercase flex items-center justify-center`}
                    >
                      {key === 'DELETE' ? <Delete size={20}/> : key}
                    </button>
                  ))}
                </div>
              ))}
              <button 
                onClick={() => handleKeyClick(' ')} 
                className="w-full h-12 bg-white border border-slate-200 rounded-xl font-bold mt-1 shadow-sm active:bg-slate-50 uppercase tracking-widest text-[10px]"
              >
                Espacio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
