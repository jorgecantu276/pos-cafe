'use client';

import { type Sale, errorMessage } from '@/lib/pos-types';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { reportDate } from '@/lib/reports';
import { cancelLegacySale, cancellationNotice } from '@/lib/cancellation';
import { XCircle, Search, RefreshCw, ShieldAlert, Loader2 } from 'lucide-react';

export default function CancelacionesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadOrders = useCallback(async (signal: AbortSignal) => {
    const { data, error } = await supabase.from('orders').select('*, order_items(*, products(name))')
      .order('created_at', { ascending: false }).limit(20).abortSignal(signal);
    if (error) throw error;
    return (data || []) as Sale[];
  }, []);
  const { data: orders, loading, error: loadError, reload: fetchOrders } = useResource(loadOrders, []);


  const handleCancelOrder = async (orderId: string) => {
    if (!confirm(cancellationNotice)) return;
    
    setActionLoading(orderId);
    try {
      await cancelLegacySale(supabase, orderId);
      alert('Venta marcada como cancelada. No se ejecutó devolución de dinero.');
      fetchOrders();
    } catch (err: unknown) {
      alert('Error: ' + errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const filteredOrders = orders.filter(o => 
    o.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.total.toString().includes(searchTerm)
  );

  if (loadError) return <LoadFailure message={loadError} retry={fetchOrders} />;
  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-red-500 w-12 h-12" /></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Auditoría y Cancelaciones</h2>
          <p className="text-red-500 text-xs font-black uppercase tracking-[0.2em] mt-1 italic">Últimas 20 ventas · Matamoros · Consulta Ventas para el historial completo</p>
          <p className="text-sm text-slate-600">Para devolver productos al inventario, abre el ticket cancelado en <a href="/admin/ventas" className="underline">Ventas</a>.</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar ID de ticket..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-12 pr-4 outline-none text-sm font-bold focus:ring-2 focus:ring-red-100 transition-all"
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {filteredOrders.map(order => {
          const isCancelled = order.status === 'cancelled';
          return (
            <div key={order.id} className={`p-6 rounded-[2.5rem] border transition-all flex flex-col md:flex-row justify-between items-center gap-6 ${isCancelled ? 'bg-red-50/30 border-red-100 opacity-60' : 'bg-white border-slate-100 shadow-sm'}`}>
              <div className="flex gap-5 items-center w-full md:w-auto">
                <div className={`p-4 rounded-3xl ${isCancelled ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-400'}`}>
                  {isCancelled ? <XCircle size={24}/> : <ShieldAlert size={24}/>}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ticket #{order.id.split('-')[0]}</span>
                    {isCancelled && <span className="bg-red-600 text-white text-[8px] font-black px-2 py-0.5 rounded-full uppercase">Anulado</span>}
                  </div>
                  <h4 className="font-bold text-slate-800">
                    {order.order_items?.map((i) => `${i.quantity}x ${i.product_snapshot?.name || (Array.isArray(i.products) ? i.products[0]?.name : i.products?.name) || 'Producto'}`).join(', ')}
                  </h4>
                  <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">
                    Realizado: {reportDate(order.created_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-8 w-full md:w-auto justify-between">
                <div className="text-right">
                  <p className="text-2xl font-black text-slate-900 tracking-tighter">${Number(order.total).toFixed(2)}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{order.payment_method}</p>
                </div>
                
                {order.status === 'completed' && (
                  <button 
                    onClick={() => handleCancelOrder(order.id)}
                    disabled={actionLoading === order.id}
                    className="bg-white border-2 border-red-100 text-red-500 hover:bg-red-500 hover:text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                  >
                    {actionLoading === order.id ? <RefreshCw className="animate-spin" size={16}/> : 'Anular Ticket'}
                  </button>
                )}
                {isCancelled && (
                  <div className="px-6 py-3 text-red-300 font-black text-xs uppercase tracking-widest">Sin Acción</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredOrders.length === 0 && (
        <div className="text-center py-20 bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
          <p className="text-slate-400 font-bold uppercase tracking-[0.2em]">No se encontraron tickets para auditar</p>
        </div>
      )}
    </div>
  );
}
