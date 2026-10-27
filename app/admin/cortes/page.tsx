'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { 
  Receipt, Calculator, Wallet, TrendingUp, TrendingDown, 
  CreditCard, ShoppingBag, User, AlertCircle, Loader2, History,
  FileText, ChevronRight
} from 'lucide-react';

export default function CortesPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [loading, setLoading] = useState(true);
  
  // Estados del Turno Activo
  const [shiftActive, setShiftActive] = useState(false);
  const [shiftDetails, setShiftDetails] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState('Barista');

  // Estado del Historial de Cortes
  const [pastShifts, setPastShifts] = useState<any[]>([]);

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        setLoading(true);
        
        // 1. Obtener usuario actual
        const { data: { user } } = await supabase.auth.getUser();
        if (user) setCurrentUser(user.email?.split('@')[0] || 'Barista');

        // 2. Cargar historial de turnos pasados desde Supabase
        const { data: shiftsData, error: shiftsError } = await supabase
          .from('shifts')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (!shiftsError && shiftsData) {
          setPastShifts(shiftsData);
        }

        // 3. Cargar turno activo (en vivo) desde memoria
        const savedShift = localStorage.getItem('mi_cafe_shift');
        if (savedShift) {
          const parsedShift = JSON.parse(savedShift);
          setShiftDetails(parsedShift);
          setShiftActive(true);

          const { data: ordersData } = await supabase
            .from('orders')
            .select(`id, created_at, total, payment_method, status, order_items (quantity, products(name))`)
            .gte('created_at', parsedShift.shiftStartTime)
            .neq('status', 'canceled') // Excluir canceladas del conteo
            .order('created_at', { ascending: false });

          setOrders(ordersData || []);
        }

      } catch (error) {
        console.error("Error cargando página de cortes:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[#0071e3] w-8 h-8" strokeWidth={1.5} />
      </div>
    );
  }

  // MATEMÁTICAS DEL TURNO ACTIVO
  const startingCash = shiftDetails?.startingCash || 0;
  const expensesList = shiftDetails?.expenses || [];
  const totalExpenses = expensesList.reduce((sum: number, exp: any) => sum + Number(exp.amount), 0);
  const totalSales = orders.reduce((sum, o) => sum + Number(o.total), 0);
  const totalOperations = orders.length;
  const totalItemsSold = orders.reduce((sum, o) => sum + (o.order_items?.reduce((itemSum: number, i: any) => itemSum + i.quantity, 0) || 0), 0);

  const salesByMethod = orders.reduce((acc: any, o) => {
    const method = o.payment_method || 'desconocido';
    acc[method] = (acc[method] || 0) + Number(o.total);
    return acc;
  }, {});

  const cashSales = (salesByMethod['efectivo'] || 0); 
  const expectedCash = startingCash + cashSales - totalExpenses;

  return (
    <div className="max-w-[1100px] mx-auto space-y-12 animate-in fade-in duration-500 pb-32 pt-6">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-1">
          <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Cortes de Caja</h2>
          <p className="text-[#86868b] text-sm font-bold uppercase tracking-widest mt-1">Arqueo y registros históricos</p>
        </div>
      </header>

      {/* 🟢 SECCIÓN 1: TURNO EN VIVO */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 px-2">
          <div className={`w-2.5 h-2.5 rounded-full ${shiftActive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
          <h3 className="text-lg font-bold text-[#1d1d1f]">Turno en Curso</h3>
        </div>

        {!shiftActive ? (
          <div className="bg-white p-10 rounded-[32px] border border-slate-100 flex flex-col items-center text-center shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
            <div className="bg-slate-50 p-5 rounded-full mb-4">
              <AlertCircle size={32} className="text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Caja Cerrada</h3>
            <p className="max-w-sm text-slate-500 text-sm font-medium">
              Abre un turno desde el Punto de Venta para monitorear el desempeño y los ingresos en tiempo real.
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
                  <p className="text-[11px] font-bold text-[#0071e3] uppercase tracking-widest mb-1">Ventas Reales</p>
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
                        Object.entries(salesByMethod).map(([method, amount]: [string, any]) => (
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
                        expensesList.map((exp: any, idx: number) => (
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
                      <FileText size={20} strokeWidth={1.5} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
                          {new Date(shift.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                          Cierre: {new Date(shift.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

                    <button className="p-2 text-slate-300 group-hover:text-[#0071e3] transition-colors bg-white border border-transparent group-hover:border-blue-100 rounded-full shadow-sm opacity-0 group-hover:opacity-100">
                      <ChevronRight size={18} />
                    </button>
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
      </section>

    </div>
  );
}