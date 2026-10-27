'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Package, 
  History, 
  Receipt, 
  XCircle, 
  Users, 
  Settings, 
  ArrowLeft, 
  Utensils, 
  Ticket, 
  Heart,
  Calculator,
  Box // Icono ideal para Insumos
} from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Lista de menús actualizada con "Insumos"
  const menuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard size={20}/>, href: '/admin' },
    { name: 'Productos', icon: <Package size={20}/>, href: '/admin/productos' },
    { name: 'Insumos', icon: <Box size={20}/>, href: '/admin/insumos' }, // NUEVO
    { name: 'Recetas', icon: <Utensils size={20}/>, href: '/admin/recetas' },
    { name: 'Costeo', icon: <Calculator size={20}/>, href: '/admin/costeo' },
    { name: 'Clientes CRM', icon: <Heart size={20}/>, href: '/admin/clientes' },
    { name: 'Ventas', icon: <History size={20}/>, href: '/admin/ventas' },
    { name: 'Cupones', icon: <Ticket size={20}/>, href: '/admin/cupones' },
    { name: 'Cortes', icon: <Receipt size={20}/>, href: '/admin/cortes' },
    { name: 'Cancelaciones', icon: <XCircle size={20}/>, href: '/admin/cancelaciones' },
    { name: 'Usuarios', icon: <Users size={20}/>, href: '/admin/usuarios' },
    { name: 'Ajustes', icon: <Settings size={20}/>, href: '/admin/ajustes' },
  ];

  return (
    <div className="flex min-h-screen bg-[#F5F5F7]">
      {/* SIDEBAR */}
      <aside className="w-64 bg-white border-r border-slate-100 flex flex-col fixed h-full z-20 shadow-sm">
        <div className="p-8">
          <h1 className="text-2xl font-black italic text-slate-900 tracking-tighter">Mi Café</h1>
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Admin Panel</p>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto pb-8 custom-scrollbar">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm group ${
                  isActive 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={`${isActive ? 'text-white' : 'text-slate-400 group-hover:text-blue-600'} transition-colors`}>
                  {item.icon}
                </span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* BOTÓN VOLVER */}
        <div className="p-6 border-t border-slate-50 bg-white">
          <Link 
            href="/" 
            className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-[10px] uppercase tracking-widest transition-all hover:translate-x-1"
          >
            <ArrowLeft size={14}/> Volver al POS
          </Link>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <main className="ml-64 flex-1 p-8">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}