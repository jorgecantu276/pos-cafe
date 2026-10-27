'use client';

import { TrendingUp, Users, Receipt, Coffee } from 'lucide-react';

export default function AdminDashboard() {
  return (
    <div className="max-w-[1100px] mx-auto space-y-12 py-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <header className="space-y-1">
        <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Dashboard</h2>
        <p className="text-[#86868b] text-lg font-medium">Bienvenido al centro de control de Mi Café.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: 'Ventas de Hoy', value: '$0.00', icon: <TrendingUp size={22} />, color: 'text-[#06c167]', bg: 'bg-[#06c167]/10' },
          { title: 'Órdenes', value: '0', icon: <Receipt size={22} />, color: 'text-[#0071e3]', bg: 'bg-[#0071e3]/10' },
          { title: 'Clientes Activos', value: '0', icon: <Users size={22} />, color: 'text-[#ff9f0a]', bg: 'bg-[#ff9f0a]/10' },
          { title: 'Productos', value: 'Activos', icon: <Coffee size={22} />, color: 'text-[#bf5af2]', bg: 'bg-[#bf5af2]/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 flex flex-col justify-between hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight">{stat.title}</p>
              <div className={`p-2 rounded-xl ${stat.bg} ${stat.color}`}>
                {stat.icon}
              </div>
            </div>
            <h3 className="text-3xl font-semibold text-[#1d1d1f] tracking-tighter">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="bg-[#f5f5f7] rounded-[24px] p-12 text-center border border-slate-200/50">
        <Coffee size={48} className="mx-auto text-slate-300 mb-4" strokeWidth={1.5} />
        <h3 className="text-xl font-semibold text-[#1d1d1f] mb-2">Todo listo para operar</h3>
        <p className="text-[#86868b] font-medium">Usa el menú lateral para gestionar tu inventario, recetas, costeo y equipo.</p>
      </div>
    </div>
  );
}