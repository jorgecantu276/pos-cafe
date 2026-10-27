'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { 
  History, Search, Calendar, ShoppingBag, 
  Loader2, TrendingUp, Award, Clock, ArrowUpRight, CreditCard,
  ChevronRight, BarChart2, Delete, X, Printer, Ban, AlertCircle
} from 'lucide-react';

export default function VentasPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  
  // ESTADOS PARA EL BUSCADOR Y EL TECLADO
  const [searchTerm, setSearchTerm] = useState('');
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // 🟢 ESTADOS PARA EL MODAL DE DETALLE DE ORDEN
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items (
            quantity,
            product_id,
            unit_price,
            total_price,
            products ( name )
          )
        `)
        .order('created_at', { ascending: false });

      if (filter === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query = query.gte('created_at', today.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      setOrders(data || []);
} catch (err: any) {
      alert("Error de Supabase: " + err.message);
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [filter]);

  // Lógica para el Top de Productos (Solo cuenta los NO cancelados)
  const productSales: Record<string, number> = {};
  orders.forEach(order => {
    if (order.status !== 'canceled') {
      order.order_items?.forEach((item: any) => {
        const pInfo = Array.isArray(item.products) ? item.products[0] : item.products;
        const name = pInfo?.name || 'Producto Eliminado';
        productSales[name] = (productSales[name] || 0) + (item.quantity || 0);
      });
    }
  });

  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // FILTRO DE BÚSQUEDA APLICADO A LAS ÓRDENES
  const filteredOrders = orders.filter(order => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const isIdMatch = order.id.toLowerCase().includes(term);
    const isProductMatch = order.order_items?.some((item: any) => {
      const pInfo = Array.isArray(item.products) ? item.products[0] : item.products;
      return pInfo?.name?.toLowerCase().includes(term);
    });
    return isIdMatch || isProductMatch;
  });

  // LÓGICA DEL TECLADO VIRTUAL
  const handleKeyClick = (key: string) => {
    if (key === 'DELETE') {
      setSearchTerm(prev => prev.slice(0, -1));
    } else {
      setSearchTerm(prev => prev + key);
    }
  };

  const keys = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l','@'],
    ['z','x','c','v','b','n','m','.', '_', 'DELETE']
  ];

  // 🟢 FUNCIÓN PARA REIMPRIMIR TICKET
  const handleReprintTicket = (order: any) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const ticketDate = new Date(order.created_at).toLocaleString('es-MX', { 
      day: '2-digit', month: '2-digit', year: 'numeric', 
      hour: '2-digit', minute: '2-digit', hour12: true 
    });

    const content = `
      <div style="width: 85mm; font-family: 'Helvetica', 'Arial', sans-serif; color: #000; padding: 10px; margin: 0 auto; line-height: 1.4;">
        
        <div style="text-align: center; margin-bottom: 15px;">
          <img src="https://actv.mx/wp-content/uploads/2026/05/Logo-Carinito-Mio.jpg" style="width: 180px; margin-bottom: 10px;">
          <h1 style="font-size: 24px; margin: 0; font-weight: 900;">Cariñito Mío</h1>
          <p style="font-size: 11px; margin: 5px 0;">Calle Fuerza Aérea #37, Fraccionamiento Moderno,<br>H. Matamoros, Tam, México, 87380</p>
          <div style="display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 13px; font-weight: bold;">
             +52 868 305 4668
          </div>
          ${order.status === 'canceled' ? '<div style="margin-top: 10px; background: #000; color: #fff; padding: 5px; font-weight: bold; text-transform: uppercase;">*** TICKET CANCELADO ***</div>' : ''}
          <div style="margin-top: 5px; font-size: 10px; font-weight: bold; border: 1px solid #000; display: inline-block; padding: 2px 5px;">REIMPRESIÓN</div>
        </div>

        <div style="border-top: 1px dashed #ccc; margin: 10px 0;"></div>

        <div style="font-size: 12px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between;">
            <span><b>Folio:</b> #${order.id.split('-')[0].toUpperCase()}</span>
            <span><b>Fecha:</b> ${ticketDate}</span>
          </div>
        </div>

        <div style="border-top: 2px solid #000; margin: 10px 0;"></div>

        <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid #eee;">
              <th style="text-align: left; padding: 5px 0;">Cant.</th>
              <th style="text-align: left; padding: 5px 0;">Producto</th>
              <th style="text-align: right; padding: 5px 0;">Importe</th>
            </tr>
          </thead>
          <tbody>
            ${order.order_items.map((i: any) => {
              const pInfo = Array.isArray(i.products) ? i.products[0] : i.products;
              return `
              <tr style="vertical-align: top;">
                <td style="padding: 8px 0; font-weight: bold;">${i.quantity}</td>
                <td style="padding: 8px 0;">
                  <div style="font-weight: bold;">${pInfo?.name || 'Producto'}</div>
                </td>
                <td style="padding: 8px 0; text-align: right;">$${Number(i.total_price || 0).toFixed(2)}</td>
              </tr>
            `}).join('')}
          </tbody>
        </table>

        <div style="border-top: 2px solid #000; margin: 10px 0;"></div>

        <div style="font-size: 14px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 18px; margin-bottom: 5px;">
            <span>TOTAL MXN:</span>
            <span>$${Number(order.total).toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 5px; color: #444; font-size: 12px; font-weight: bold;">
            <span>Método de Pago:</span>
            <span style="text-transform: uppercase;">${order.payment_method || 'N/A'}</span>
          </div>
        </div>

      </div>
    `;

    printWindow.document.write(`
      <html>
        <head>
          <title>Reimpresión - ${order.id.split('-')[0].toUpperCase()}</title>
          <style>@page { margin: 0; } body { margin: 0; padding: 0; }</style>
        </head>
        <body onload="window.print();window.close()">${content}</body>
      </html>
    `);
    printWindow.document.close();
  };

  // 🟢 FUNCIÓN PARA CANCELAR ORDEN Y REGRESAR INVENTARIO
  const handleCancelOrder = async () => {
    if (!selectedOrder) return;
    
    const confirmCancel = window.confirm('¿Estás seguro de cancelar esta venta? \n\nEsto marcará el ticket como CANCELADO y regresará automáticamente los productos al inventario.');
    if (!confirmCancel) return;

    setIsCanceling(true);
    try {
      // 1. Actualizar el status de la orden a 'canceled'
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'canceled' })
        .eq('id', selectedOrder.id);

      if (updateError) throw updateError;

      // 2. Regresar el stock (Llamada a las RPC inversas)
      for (const item of selectedOrder.order_items) {
        if (item.product_id) {
          // Asegúrate de tener esta función en tu base de datos de Supabase
          await supabase.rpc('increment_stock', { 
            row_id: item.product_id, 
            amount: item.quantity 
          });
          // Si tienes recetas complejas, llama a la función inversa aquí
          // await supabase.rpc('reverse_recipe_stock', { p_product_id: item.product_id, p_quantity: item.quantity });
        }
      }

      // 3. Actualizar la lista localmente para no tener que recargar
      setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, status: 'canceled' } : o));
      setSelectedOrder(null);
      alert('Orden cancelada exitosamente y productos regresados al inventario.');

    } catch (error: any) {
      alert('Hubo un error al cancelar la orden: ' + error.message);
    } finally {
      setIsCanceling(false);
    }
  };

  if (loading && orders.length === 0) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-slate-300 w-8 h-8" strokeWidth={1.5} />
    </div>
  );

  return (
    <div className="max-w-[1100px] mx-auto space-y-12 py-10 animate-in fade-in duration-1000 relative pb-32">
      
      {/* HEADER ESTILO MACOS */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-1">
          <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Ventas</h2>
          <p className="text-[#86868b] text-lg font-medium">Historial y métricas de rendimiento operativo.</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-end">
          
          <div 
            className="relative group w-64 cursor-pointer"
            onClick={() => setIsKeyboardOpen(true)}
          >
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${isKeyboardOpen ? 'text-[#0071e3]' : 'text-slate-400'}`} />
            <input
              type="text"
              readOnly 
              placeholder="Buscar ticket o producto..."
              className={`w-full bg-white border rounded-full py-2.5 pl-10 pr-8 text-[13px] font-medium outline-none transition-all pointer-events-none ${isKeyboardOpen ? 'border-[#0071e3] shadow-sm' : 'border-slate-200'}`}
              value={searchTerm}
            />
            {searchTerm && (
              <button 
                onClick={(e) => { e.stopPropagation(); setSearchTerm(''); setIsKeyboardOpen(false); }} 
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 pointer-events-auto p-2 rounded-full"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex bg-[#eeeef0] p-1 rounded-full border border-slate-200/50 shadow-inner">
            <button 
              onClick={() => setFilter('all')} 
              className={`px-6 py-2 rounded-full text-[13px] font-semibold transition-all ${filter === 'all' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}
            >
              Histórico
            </button>
            <button 
              onClick={() => setFilter('today')} 
              className={`px-6 py-2 rounded-full text-[13px] font-semibold transition-all ${filter === 'today' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}
            >
              Hoy
            </button>
          </div>
        </div>
      </header>

      {/* MÉTRICAS SUPERIORES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 flex flex-col justify-between group">
            <div className="flex justify-between items-start">
                <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight">Producto Estrella</p>
                <Award size={20} className="text-[#0066cc]" />
            </div>
            <div className="mt-4">
                <h3 className="text-xl font-semibold text-[#1d1d1f] truncate">
                    {topProducts.length > 0 ? topProducts[0][0] : 'Sin datos'}
                </h3>
                <p className="text-[#86868b] text-sm font-medium mt-1">
                    {topProducts.length > 0 ? Number(topProducts[0][1]) : 0} unidades desplazadas
                </p>
            </div>
        </div>
        
        <div className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50">
            <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight mb-2">Ingresos Válidos {filter === 'today' ? 'Hoy' : 'Totales'}</p>
            <h3 className="text-4xl font-semibold text-[#1d1d1f] tracking-tighter">
                ${orders.filter(o => o.status !== 'canceled').reduce((acc, curr) => acc + Number(curr.total), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </h3>
            <div className="mt-4 flex items-center gap-2 text-[#06c167] bg-[#06c167]/10 w-fit px-3 py-1 rounded-full text-xs font-semibold">
                <TrendingUp size={14} /> Excluye cancelaciones
            </div>
        </div>

        <div className="bg-[#1d1d1f] p-8 rounded-[24px] shadow-lg shadow-slate-200">
            <p className="text-[13px] font-semibold text-slate-400 uppercase tracking-tight mb-2">Pedidos Procesados</p>
            <h3 className="text-4xl font-semibold text-white tracking-tighter">{orders.filter(o => o.status !== 'canceled').length}</h3>
            <p className="text-slate-500 text-xs font-medium mt-2">Transacciones exitosas</p>
        </div>
      </div>

      {/* CRONOLOGÍA */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 px-2">
            <BarChart2 size={18} className="text-[#1d1d1f]" />
            <h4 className="font-semibold text-[#1d1d1f]">Historial de transacciones</h4>
        </div>
        
        <div className="bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 overflow-hidden divide-y divide-slate-50">
          {filteredOrders.map(order => (
            <div 
              key={order.id} 
              onClick={() => setSelectedOrder(order)}
              className={`p-6 flex flex-col md:flex-row justify-between items-center gap-6 hover:bg-[#f5f5f7] cursor-pointer transition-colors group ${order.status === 'canceled' ? 'opacity-70 bg-red-50/20' : ''}`}
            >
              <div className="flex gap-6 items-center w-full md:w-auto">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 transition-all ${order.status === 'canceled' ? 'bg-red-100 text-red-500' : 'bg-[#f5f5f7] text-slate-400 group-hover:text-[#0066cc] group-hover:bg-[#0066cc]/10'}`}>
                    {order.status === 'canceled' ? <Ban size={20} strokeWidth={1.5}/> : <ShoppingBag size={20} strokeWidth={1.5}/>}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-bold text-[#86868b] uppercase tracking-wider">
                        {new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-200"></span>
                    <span className="text-[11px] font-bold text-[#86868b] uppercase tracking-wider">
                        {new Date(order.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                    </span>
                    {order.status === 'canceled' && (
                      <span className="ml-2 bg-red-500 text-white text-[9px] px-2 py-0.5 rounded uppercase font-black tracking-widest">
                        Cancelado
                      </span>
                    )}
                  </div>
                  <h4 className={`font-semibold text-base ${order.status === 'canceled' ? 'text-slate-500 line-through' : 'text-[#1d1d1f]'}`}>
                    {order.order_items?.map((item: any) => {
                      const pInfo = Array.isArray(item.products) ? item.products[0] : item.products;
                      return `${item.quantity}x ${pInfo?.name || 'Item'}`;
                    }).join(', ')}
                  </h4>
                  <p className="text-[11px] text-slate-400 font-medium tracking-tight mt-0.5">Ref: {order.id.split('-')[0].toUpperCase()}</p>
                </div>
              </div>

              <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end shrink-0">
                <div className="text-right">
                  <div className={`flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-tight mb-1 justify-end ${order.status === 'canceled' ? 'text-slate-400' : 'text-[#06c167]'}`}>
                    <CreditCard size={12}/>
                    {order.payment_method}
                  </div>
                  <p className={`text-2xl font-semibold tracking-tight ${order.status === 'canceled' ? 'text-slate-400' : 'text-[#1d1d1f]'}`}>
                    ${Number(order.total).toFixed(2)}
                  </p>
                </div>
                <div className="p-2 text-slate-300 group-hover:text-[#1d1d1f] group-hover:bg-slate-100 rounded-full transition-all">
                    <ChevronRight size={20} strokeWidth={1.5}/>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {filteredOrders.length === 0 && (
          <div className="text-center py-32 bg-[#f5f5f7] rounded-[32px] border border-dashed border-slate-200">
              <p className="text-[#86868b] font-medium">No hay registros que coincidan con tu búsqueda.</p>
          </div>
      )}

      {/* 🟢 MODAL DE DETALLE DE ORDEN (AQUÍ ESTÁ LA MAGIA DE CANCELAR Y REIMPRIMIR) */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-[500px] shadow-2xl p-8 animate-in zoom-in-95 duration-200">
            
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-2xl font-black italic tracking-tight text-slate-900 mb-1">
                  Ticket #{selectedOrder.id.split('-')[0].toUpperCase()}
                </h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  {new Date(selectedOrder.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 transition-colors"><X size={20}/></button>
            </div>

            {selectedOrder.status === 'canceled' && (
              <div className="bg-red-50 text-red-600 border border-red-200 p-4 rounded-xl flex items-center gap-3 mb-6">
                <AlertCircle size={20} />
                <p className="text-sm font-bold">Esta orden fue cancelada. Los artículos regresaron al inventario.</p>
              </div>
            )}

            <div className="bg-[#f5f5f7] rounded-2xl p-5 mb-6 space-y-3">
              <h4 className="text-[10px] font-black uppercase text-[#86868b] tracking-widest border-b border-slate-200 pb-2 mb-3">Artículos</h4>
              {selectedOrder.order_items.map((item: any, idx: number) => {
                const pInfo = Array.isArray(item.products) ? item.products[0] : item.products;
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

            <div className="flex flex-col gap-3">
              <button 
                onClick={() => handleReprintTicket(selectedOrder)}
                className="w-full bg-[#1d1d1f] hover:bg-black text-white h-14 rounded-[20px] font-bold text-base flex justify-center items-center gap-2 shadow-lg transition-all"
              >
                <Printer size={20} /> Reimprimir Ticket
              </button>

              {selectedOrder.status !== 'canceled' && (
                <button 
                  onClick={handleCancelOrder}
                  disabled={isCanceling}
                  className="w-full bg-white border-2 border-red-100 hover:border-red-200 hover:bg-red-50 text-red-500 h-14 rounded-[20px] font-bold text-base flex justify-center items-center gap-2 transition-all disabled:opacity-50"
                >
                  {isCanceling ? <Loader2 className="animate-spin" size={20} /> : <><Ban size={20} /> Cancelar Venta</>}
                </button>
              )}
            </div>

          </div>
        </div>
      )}

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